import { describe, expect, it } from 'vitest';
import {
  actualVsExpectedLine,
  canReadyDispatch,
  checkedPcsBar,
  cleanTakaNo,
  compareTakaNo,
  formatPcsDiff,
  godownKpis,
  millQcOpenState,
  nextSplitNumber,
  orderStatusForJobsheets,
  readyDispatchBlockers,
  splitBase,
  splitMeters,
  takaActualPcs,
  takaNoError,
  totalActualPcs,
  validateSplit,
  type GodownTakaLike,
} from './index';

const done = [{ status: 'completed', takaCount: 3 }];
const status = (stages: string[]) => orderStatusForJobsheets(done, stages);

describe('order statuses after the mill (Sprint 9)', () => {
  it('some mill_qc + some final → Received from mill', () => {
    expect(status(['mill_qc', 'final'])).toBe('received_from_mill');
    expect(status(['mill_qc', 'mill_qc'])).toBe('received_from_mill');
  });

  it('every taka final / refinish / ready_dispatch → Mill QC done', () => {
    expect(status(['final', 'final'])).toBe('mill_qc_done');
    expect(status(['final', 'refinish'])).toBe('mill_qc_done');
    expect(status(['refinish', 'ready_dispatch'])).toBe('mill_qc_done');
    expect(status(['final', 'ready_dispatch'])).toBe('mill_qc_done');
  });

  it('every taka ready_dispatch → Ready for dispatch', () => {
    expect(status(['ready_dispatch', 'ready_dispatch'])).toBe('ready_for_dispatch');
  });

  it('the earliest unfinished stage wins', () => {
    expect(status(['final', 'at_mill'])).toBe('in_mill');
    expect(status(['final', 'waiting_mill'])).toBe('in_mill');
    expect(status(['final', 'at_butta'])).toBe('in_butta_cutting');
    expect(status(['final', 'entered'])).toBe('taka_entry_done');
    expect(status(['ready_dispatch', 'at_mill'])).toBe('in_mill');
  });

  it('a refinish taka sent back to the mill pulls the order back to In mill', () => {
    expect(status(['final', 'final', 'at_mill'])).toBe('in_mill');
    expect(status(['final', 'final', 'mill_qc'])).toBe('received_from_mill');
  });
});

describe('Mill QC open rules', () => {
  it('maps the taka stage to what the Mill QC does', () => {
    expect(millQcOpenState('mill_qc')).toBe('qc');
    expect(millQcOpenState('at_mill')).toBe('qc_not_received');
    expect(millQcOpenState('final')).toBe('checked');
    expect(millQcOpenState('ready_dispatch')).toBe('checked');
    for (const s of ['entered', 'at_butta', 'butta_qc', 'waiting_mill', 'refinish']) expect(millQcOpenState(s)).toBe('never_sent');
  });
});

describe('taka numbers with a split letter', () => {
  it('accepts one capital letter at the end only', () => {
    expect(takaNoError('1101A')).toBeNull();
    expect(takaNoError('62/45B')).toBeNull();
    expect(takaNoError('1101a')).toBe('format');
    // Sprint 16: a 1–4 letter prefix (weaver code) is allowed in front.
    expect(takaNoError('A1101')).toBeNull();
    expect(takaNoError('1101AB')).toBe('format');
    expect(cleanTakaNo('1101A')).toBe('1101A');
    expect(cleanTakaNo('1101ab')).toBe('1101');
    expect(cleanTakaNo('A1101')).toBe('A1101');
    expect(cleanTakaNo('11A01')).toBe('1101');
  });

  it('sorts a part right after its parent', () => {
    expect(['1102', '1101B', '1101', '1101A'].sort(compareTakaNo)).toEqual(['1101', '1101A', '1101B', '1102']);
  });
});

describe('split helpers', () => {
  it('suggests the next free letter', () => {
    expect(nextSplitNumber('1101', [])).toBe('1101A');
    expect(nextSplitNumber('1101', ['1101A'])).toBe('1101B');
    expect(nextSplitNumber('1101', ['1101', '1101A', '1101C'])).toBe('1101B');
    expect(nextSplitNumber('1101A', ['1101A'])).toBe('1101B');
    expect(splitBase('1101A')).toBe('1101');
    expect(nextSplitNumber('1101', [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((l) => `1101${l}`))).toBeNull();
    expect(nextSplitNumber('12345678901234', [])).toBe('12345678901234A');
    expect(nextSplitNumber('123456789012345', [])).toBeNull();
  });

  it('divides meters by pcs and the parts always add up', () => {
    expect(splitMeters(100, [5, 5])).toEqual([50, 50]);
    const parts = splitMeters(100, [1, 1, 1]);
    expect(parts).toEqual([33.33, 33.33, 33.34]);
    const odd = splitMeters(105.55, [3, 4, 5]);
    expect(Math.round(odd.reduce<number>((s, n) => s + (n ?? 0), 0) * 100) / 100).toBe(105.55);
    expect(splitMeters(null, [1, 2])).toEqual([null, null]);
    expect(splitMeters(10, [10])).toEqual([10]);
  });

  it('validates the parts: total = actual pcs, numbers valid and unique', () => {
    const ok = validateSplit([{ takaNo: '1101', pcs: 6 }, { takaNo: '1101A', pcs: 4 }], 10, new Set(['2000']));
    expect(ok).toMatchObject({ ok: true, total: 10, diff: 0 });
    const short = validateSplit([{ takaNo: '1101', pcs: 6 }, { takaNo: '1101A', pcs: 3 }], 10);
    expect(short).toMatchObject({ ok: false, diff: 1 });
    const empty = validateSplit([{ takaNo: '1101', pcs: null }, { takaNo: '1101A', pcs: 10 }], 10);
    expect(empty.rows).toEqual(['pcs_required', null]);
    expect(empty.ok).toBe(false);
    const dup = validateSplit([{ takaNo: '1101', pcs: 5 }, { takaNo: '1101', pcs: 5 }], 10);
    expect(dup.rows[1]).toBe('duplicate');
    const used = validateSplit([{ takaNo: '1101', pcs: 5 }, { takaNo: '1101A', pcs: 5 }], 10, new Set(['1101A', '1101']));
    // The first part keeps the parent's own number, so only the other parts are checked against the numbers in use.
    expect(used.rows).toEqual([null, 'already_used']);
    expect(validateSplit([{ takaNo: '1101', pcs: 10 }], 10).ok).toBe(false);
    expect(validateSplit([{ takaNo: '11x', pcs: 5 }, { takaNo: '12', pcs: 5 }], 10).rows[0]).toBe('number_format');
  });
});

describe('actual vs expected pcs', () => {
  it('actual falls back to the expected pcs', () => {
    expect(takaActualPcs({ pcs: 10, actualPcs: null })).toBe(10);
    expect(takaActualPcs({ pcs: 10, actualPcs: 8 })).toBe(8);
    expect(takaActualPcs({ pcs: null, actualPcs: null })).toBeNull();
    expect(totalActualPcs([{ pcs: 10, actualPcs: 8 }, { pcs: 5, actualPcs: null }])).toBe(13);
    expect(totalActualPcs([{ pcs: null, actualPcs: null }])).toBeNull();
    expect(formatPcsDiff(-2)).toBe('−2');
    expect(formatPcsDiff(3)).toBe('+3');
    expect(formatPcsDiff(0)).toBe('0');
  });
});

const t = (stage: string, pcs: number | null, actualPcs: number | null = null, checked = false): GodownTakaLike => ({ stage, pcs, actualPcs, checked });

describe('godown KPIs, bar and dispatch rules', () => {
  const list = [
    t('final', 12, 12, true),
    t('final', 10, 8, true),
    t('final', 10, null, false),
    t('ready_dispatch', 10, 10, true),
    t('refinish', 10),
    t('at_mill', 10),
  ];

  it('counts cleared / checked / refinish with actual pcs', () => {
    const k = godownKpis(list);
    expect(k).toMatchObject({ total: 6, cleared: 4, refinish: 1, uncheckedCount: 1, readyCount: 2, readyPcs: 20 });
    // checked = the two ticked final takas + the one already ready to dispatch → 12 + 8 + 10.
    expect(k.checkedTakas).toBe(3);
    expect(k.checkedPcs).toBe(30);
    expect(k.expectedPcs).toBe(42);
    expect(k.actualPcs).toBe(40);
  });

  it('builds the checked-pcs bar and its over-100% shade', () => {
    expect(checkedPcsBar(236, 300)).toMatchObject({ fillPercent: 78.7, over: false, text: '236 / 300 pcs checked' });
    expect(checkedPcsBar(300, 300)).toMatchObject({ fillPercent: 100, over: false });
    expect(checkedPcsBar(320, 300)).toMatchObject({ fillPercent: 100, over: true });
    expect(checkedPcsBar(10, 0)).toMatchObject({ fillPercent: 0, over: false });
  });

  it('words the actual vs expected line', () => {
    expect(actualVsExpectedLine(296, 300)).toEqual({ text: 'Actual 296 pcs vs expected 300 (−4)', differs: true });
    expect(actualVsExpectedLine(300, 300)).toEqual({ text: 'Actual 300 pcs vs expected 300', differs: false });
    expect(actualVsExpectedLine(302, 300).text).toContain('(+2)');
  });

  it('only checked final takas can be confirmed ready to dispatch', () => {
    expect(canReadyDispatch({ stage: 'final', checked: true })).toBe(true);
    expect(canReadyDispatch({ stage: 'final', checked: false })).toBe(false);
    expect(canReadyDispatch({ stage: 'ready_dispatch', checked: true })).toBe(false);
    expect(canReadyDispatch({ stage: 'refinish', checked: true })).toBe(false);
    expect(readyDispatchBlockers(list).length).toBe(4);
  });
});
