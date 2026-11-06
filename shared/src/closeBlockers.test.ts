import { describe, expect, it } from 'vitest';
import { closeBlockedMessage, closeBlockers, type CloseBlockerInput } from './closeBlockers';

const base: CloseBlockerInput = { orderId: 7, jobsheetsOnLoom: 0, completedWithoutTakas: 0, takasByStage: {}, openOutsidePos: 0 };

describe('closeBlockers (Sprint 21 CR-04)', () => {
  it('is empty when nothing is in process — pending jobsheets and takas with us are not blockers', () => {
    expect(closeBlockers({ ...base, takasByStage: { entered: 4, waiting_mill: 2, final: 5, ready_dispatch: 3, dispatched: 9 } })).toEqual([]);
  });
  it.each([
    ['jobsheet_on_loom', { jobsheetsOnLoom: 2 }],
    ['completed_without_takas', { completedWithoutTakas: 1 }],
    ['at_butta', { takasByStage: { at_butta: 3 } }],
    ['butta_qc', { takasByStage: { butta_qc: 3 } }],
    ['at_mill', { takasByStage: { at_mill: 3 } }],
    ['mill_qc', { takasByStage: { mill_qc: 3 } }],
    ['refinish', { takasByStage: { refinish: 3 } }],
    ['rework_butta', { takasByStage: { rework_butta: 3 } }],
    ['outside_po_open', { openOutsidePos: 1 }],
  ] as const)('blocks on %s', (kind, patch) => {
    const b = closeBlockers({ ...base, ...patch });
    expect(b).toHaveLength(1);
    expect(b[0].kind).toBe(kind);
    expect(b[0].count).toBeGreaterThan(0);
    expect(b[0].link.startsWith('/')).toBe(true);
  });
  it('lists several in flow order and builds the 409 text', () => {
    const b = closeBlockers({ ...base, jobsheetsOnLoom: 1, takasByStage: { at_mill: 2, at_butta: 1 }, openOutsidePos: 1 });
    expect(b.map((x) => x.kind)).toEqual(['jobsheet_on_loom', 'at_butta', 'at_mill', 'outside_po_open']);
    expect(closeBlockedMessage(b)).toContain('1 jobsheet on the loom');
    expect(closeBlockedMessage(b)).toContain('2 takas at the mill');
  });
});
