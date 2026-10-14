import { describe, expect, it } from 'vitest';
import {
  applyResolve,
  CHALLAN_TAKAS_PER_PAGE,
  challanTotals,
  formatChallanDate,
  formatChallanRowMeters,
  formatChallanTotalMeters,
  paginateChallanTakas,
  takaEditNote,
  validateQcDecisions,
} from './butta';
import { challanLabel, CHALLAN_KIND_CONFIG, isTakaReady, parseChallanNo, splitReadyTakas } from './challans';
import { COMPANY } from './company';
import { can, landingRoute, ROLES } from './roles';
import { buttaReceiveSchema, challanCreateSchema, designInputSchema, qcSubmitSchema } from './schemas';
import { canRoleSeeStatus, getStatus, orderStatusForJobsheets, statusesForRole } from './statuses';

const takas = (n: number, meters = 10) => Array.from({ length: n }, (_, i) => ({ takaNo: String(1000 + i), meters }));

describe('challan numbering', () => {
  it('formats GSM-<n> and parses what users type in a search box', () => {
    expect(challanLabel(1)).toBe('GSM-1');
    expect(challanLabel(173)).toBe('GSM-173');
    expect(parseChallanNo('173')).toBe(173);
    expect(parseChallanNo('GSM-173')).toBe(173);
    expect(parseChallanNo(' gsm 173 ')).toBe(173);
    expect(parseChallanNo('gsm')).toBeNull();
    expect(parseChallanNo('0')).toBeNull();
    expect(parseChallanNo('17a')).toBeNull();
  });

  it('mill challans are MIL-<n>, numbered by their own counter; a search needs the matching prefix', () => {
    expect(challanLabel(1, 'mill')).toBe('MIL-1');
    expect(challanLabel(12, 'mill')).toBe('MIL-12');
    expect(challanLabel(173, 'butta')).toBe('GSM-173');
    expect(CHALLAN_KIND_CONFIG.butta.counter).toBe('butta_challan_no');
    expect(CHALLAN_KIND_CONFIG.mill.counter).toBe('mill_challan_no');
    expect(parseChallanNo('MIL-12', 'mill')).toBe(12);
    expect(parseChallanNo('mil 12', 'mill')).toBe(12);
    expect(parseChallanNo('12', 'mill')).toBe(12);
    expect(parseChallanNo('GSM-12', 'mill')).toBeNull();
    expect(parseChallanNo('MIL-12', 'butta')).toBeNull();
  });
});

describe('mill readiness and the send-ready-only split', () => {
  const list = [
    { id: 1, takaNo: '6245', stage: 'waiting_mill' },
    { id: 2, takaNo: '6251', stage: 'at_butta' },
    { id: 3, takaNo: '6252', stage: 'butta_qc' },
    { id: 4, takaNo: '6253', stage: 'waiting_mill' },
    { id: 5, takaNo: '6254', stage: 'entered' },
  ];

  it('mill: only waiting_mill takas are ready; butta: only entered', () => {
    expect(isTakaReady('waiting_mill', 'mill')).toBe(true);
    expect(isTakaReady('butta_qc', 'mill')).toBe(false);
    expect(isTakaReady('entered', 'butta')).toBe(true);
    expect(isTakaReady('waiting_mill', 'butta')).toBe(false);
  });

  it('splits a selection into ready / not ready, keeping the order', () => {
    const { ready, notReady } = splitReadyTakas(list, 'mill');
    expect(ready.map((t) => t.takaNo)).toEqual(['6245', '6253']);
    expect(notReady.map((t) => [t.takaNo, t.stage])).toEqual([
      ['6251', 'at_butta'],
      ['6252', 'butta_qc'],
      ['6254', 'entered'],
    ]);
    expect(splitReadyTakas(list, 'butta').ready.map((t) => t.id)).toEqual([5]);
    expect(splitReadyTakas([], 'mill')).toEqual({ ready: [], notReady: [] });
  });

  it('the stages the kinds move takas between', () => {
    expect(CHALLAN_KIND_CONFIG.mill).toMatchObject({ readyStage: 'waiting_mill', sentStage: 'at_mill', receivedStage: 'mill_qc' });
    expect(CHALLAN_KIND_CONFIG.butta).toMatchObject({ readyStage: 'entered', sentStage: 'at_butta', receivedStage: 'butta_qc' });
    expect(CHALLAN_KIND_CONFIG.mill.notSentStages).toContain('butta_qc');
  });
});

describe('challan print paging (4 groups × 12 rows)', () => {
  it('19 takas: one page, filled column by column, subtotals per group', () => {
    const list = takas(19).map((t, i) => ({ ...t, meters: i < 12 ? 60 : 10 }));
    const [page, ...rest] = paginateChallanTakas(list);
    expect(rest).toEqual([]);
    expect(page).toMatchObject({ page: 1, pages: 1, isLast: true });
    expect(page.groups).toHaveLength(4);
    expect(page.groups.every((g) => g.rows.length === 12)).toBe(true);
    expect(page.groups[0].rows[0]).toEqual({ no: 1, takaNo: '1000', meters: 60 });
    expect(page.groups[0].rows[11]!.no).toBe(12);
    expect(page.groups[1].rows[0]!.no).toBe(13);
    expect(page.groups[1].rows[6]!.no).toBe(19);
    expect(page.groups[1].rows[7]).toBeNull();
    expect(page.groups.map((g) => g.subtotal)).toEqual([720, 70, null, null]);
  });

  it('exactly 48 fits one page; 49 starts page 2 with continuing numbers', () => {
    expect(CHALLAN_TAKAS_PER_PAGE).toBe(48);
    expect(paginateChallanTakas(takas(48))).toHaveLength(1);
    const pages = paginateChallanTakas(takas(49));
    expect(pages).toHaveLength(2);
    expect(pages.map((p) => [p.page, p.pages, p.isLast])).toEqual([
      [1, 2, false],
      [2, 2, true],
    ]);
    expect(pages[1].groups[0].rows[0]).toEqual({ no: 49, takaNo: '1048', meters: 10 });
    expect(pages[1].groups[0].subtotal).toBe(10);
    expect(pages[1].groups[1].subtotal).toBeNull();
  });

  it('130 takas → 3 pages; an empty challan still has one page', () => {
    const pages = paginateChallanTakas(takas(130));
    expect(pages).toHaveLength(3);
    expect(pages[2].groups[0].rows[0]!.no).toBe(97);
    expect(paginateChallanTakas([])).toHaveLength(1);
    expect(paginateChallanTakas([])[0].groups.every((g) => g.subtotal === null)).toBe(true);
  });

  it('totals and meter formats', () => {
    expect(challanTotals([{ takaNo: '1', meters: 100.25 }, { takaNo: '2', meters: null }, { takaNo: '3', meters: 50 }])).toEqual({
      count: 3,
      meters: 150.25,
    });
    expect(formatChallanRowMeters(493)).toBe('493.00');
    expect(formatChallanRowMeters(null)).toBe('');
    expect(formatChallanTotalMeters(1210)).toBe('1210');
    expect(formatChallanTotalMeters(1210.5)).toBe('1210.50');
    expect(formatChallanDate('2026-07-21')).toBe('21/07/2026');
  });

  it('company details are exactly as on the paper challan', () => {
    expect(COMPANY.name).toBe('RIVOORA ETHNIC FASHION');
    expect(COMPANY.gstin).toBe('24AAZFR7705C2ZX');
    expect(COMPANY.mobiles).toEqual(['9879885024', '9913311903']);
    expect(COMPANY.jurisdiction).toBe('SURAT');
  });
});

describe('QC decision validation (resolved pcs)', () => {
  const open = [
    { id: 1, pcs: 3 },
    { id: 2, pcs: null },
  ];

  it('every open damage must be answered', () => {
    const r = validateQcDecisions(open, [{ takaDamageId: 1, resolvedPcs: 3 }], 12);
    expect(r.unanswered).toEqual([2]);
    expect(r.ok).toBe(false);
  });

  it('a damage without pcs needs a pcs count when answered', () => {
    const r = validateQcDecisions(open, [{ takaDamageId: 1, resolvedPcs: 3 }, { takaDamageId: 2, resolvedPcs: 0 }], 12);
    expect(r.pcsMissing).toEqual([2]);
    expect(r.ok).toBe(false);
    const fixed = validateQcDecisions(open, [{ takaDamageId: 1, resolvedPcs: 3 }, { takaDamageId: 2, resolvedPcs: 0, pcs: 3 }], 12);
    expect(fixed.ok).toBe(true);
  });

  it('damaged pcs may not exceed the taka pcs (after the QC edit)', () => {
    const r = validateQcDecisions([{ id: 1, pcs: 5 }], [{ takaDamageId: 1, resolvedPcs: 0 }], 4);
    expect(r.pcsTooBig).toEqual([1]);
    expect(r.ok).toBe(false);
  });

  it('resolved pcs: 0 (not resolved) up to the pcs still open, not more', () => {
    expect(validateQcDecisions([{ id: 1, pcs: 3 }], [{ takaDamageId: 1, resolvedPcs: 0 }], 12).ok).toBe(true);
    expect(validateQcDecisions([{ id: 1, pcs: 3 }], [{ takaDamageId: 1, resolvedPcs: 2 }], 12).ok).toBe(true);
    expect(validateQcDecisions([{ id: 1, pcs: 3 }], [{ takaDamageId: 1, resolvedPcs: 4 }], 12).resolvedTooBig).toEqual([1]);
    // 1 of 3 were already resolved → only 2 are open
    expect(validateQcDecisions([{ id: 1, pcs: 3, resolvedPcs: 1 }], [{ takaDamageId: 1, resolvedPcs: 3 }], 12).resolvedTooBig).toEqual([1]);
    // a legacy damage with the pcs typed now
    expect(validateQcDecisions([{ id: 2, pcs: null }], [{ takaDamageId: 2, resolvedPcs: 5, pcs: 4 }], 12).resolvedTooBig).toEqual([2]);
  });

  it('applyResolve: partial keeps the damage open with fewer open pcs; the damage resolves only when all pcs are', () => {
    expect(applyResolve({ pcs: 3 }, 3)).toEqual({ resolvedPcs: 3, openPcs: 0, status: 'resolved' });
    expect(applyResolve({ pcs: 3 }, 2)).toEqual({ resolvedPcs: 2, openPcs: 1, status: 'open' });
    expect(applyResolve({ pcs: 3 }, 0)).toEqual({ resolvedPcs: 0, openPcs: 3, status: 'open' });
    expect(applyResolve({ pcs: 3, resolvedPcs: 2 }, 1)).toEqual({ resolvedPcs: 3, openPcs: 0, status: 'resolved' });
  });

  it('decisions for unknown damages are flagged; a taka without damages is fine', () => {
    expect(validateQcDecisions([], [{ takaDamageId: 9, resolvedPcs: 1 }], 5).unknown).toEqual([9]);
    expect(validateQcDecisions([], [], 5).ok).toBe(true);
  });

  it('edit note: meters and pcs old → new', () => {
    expect(takaEditNote({ meters: 61, pcs: 12 }, { meters: 60.5, pcs: 12 })).toBe('meters 61 m → 60.5 m');
    expect(takaEditNote({ meters: null, pcs: 12 }, { meters: 60, pcs: 11 })).toBe('meters – → 60 m · pcs 12 → 11');
    expect(takaEditNote({ meters: 1, pcs: 1 }, { meters: 1, pcs: 1 })).toBe('');
  });

  it('QC body schema: pcs required, decisions + new damages with pcs', () => {
    const ok = qcSubmitSchema.parse({
      meters: 60.5,
      pcs: 12,
      damageDecisions: [{ takaDamageId: 1, resolvedPcs: 2 }],
      newDamages: [{ otherName: 'Cut', pcs: 1, images: [{ url: '/u/a.webp', thumbUrl: '/u/a-t.webp' }] }],
    });
    expect(ok.damageDecisions[0].pcs).toBeNull();
    expect(ok.newDamages[0].images).toHaveLength(1);
    expect(qcSubmitSchema.parse({ pcs: 3, newDamages: [{ damageId: 2, pcs: 1 }] }).newDamages[0].images).toEqual([]);
    expect(qcSubmitSchema.safeParse({ pcs: 3, damageDecisions: [{ takaDamageId: 1, resolvedPcs: -1 }] }).success).toBe(false);
    expect(qcSubmitSchema.safeParse({ pcs: 3, damageDecisions: [{ takaDamageId: 1, resolved: true }] }).success).toBe(false);
    expect(
      qcSubmitSchema.safeParse({
        pcs: 3,
        newDamages: [{ damageId: 2, pcs: 1, images: Array.from({ length: 11 }, (_, i) => ({ url: 'u' + i, thumbUrl: 't' + i })) }],
      }).success,
    ).toBe(false);
    expect(qcSubmitSchema.safeParse({ meters: 60, damageDecisions: [], newDamages: [] }).success).toBe(false);
    expect(qcSubmitSchema.safeParse({ pcs: 3, newDamages: [{ damageId: 2 }] }).success).toBe(false);
    expect(qcSubmitSchema.parse({ pcs: 3 }).newDamages).toEqual([]);
  });
});

describe('butta bodies', () => {
  it('challan create: taka ids de-duplicated, party required, date format', () => {
    const ok = challanCreateSchema.parse({ takaIds: [1, 2, 2], partyId: 3, challanDate: '2026-07-21', ewayNo: ' ' });
    expect(ok.takaIds).toEqual([1, 2]);
    expect(ok.ewayNo).toBeNull();
    expect(challanCreateSchema.safeParse({ takaIds: [], partyId: 3, challanDate: '2026-07-21' }).success).toBe(false);
    expect(challanCreateSchema.safeParse({ takaIds: [1], challanDate: '2026-07-21' }).success).toBe(false);
    expect(challanCreateSchema.safeParse({ takaIds: [1], partyId: 3, challanDate: '21-07-2026' }).success).toBe(false);
  });

  it('receive: either a taka number or taka ids', () => {
    expect(buttaReceiveSchema.safeParse({ takaNo: '6245-1' }).success).toBe(true);
    expect(buttaReceiveSchema.safeParse({ takaIds: [1, 2] }).success).toBe(true);
    expect(buttaReceiveSchema.safeParse({}).success).toBe(false);
    expect(buttaReceiveSchema.safeParse({ takaNo: '1', takaIds: [1] }).success).toBe(false);
    expect(buttaReceiveSchema.safeParse({ takaNo: 'abc' }).success).toBe(false);
  });

  it('design: "goes for butta cutting" must be chosen (no default)', () => {
    expect(designInputSchema.safeParse({ code: 'D1' }).success).toBe(false);
    expect(designInputSchema.parse({ code: 'D1', buttaCutting: false }).buttaCutting).toBe(false);
  });
});

describe('order status: butta cutting + ready for mill', () => {
  const done = [{ status: 'completed', takaCount: 3 }, { status: 'completed', takaCount: 2 }];

  it('Taka entry done while takas wait for butta cutting (entered)', () => {
    expect(orderStatusForJobsheets(done, ['entered', 'entered'])).toBe('taka_entry_done');
    expect(orderStatusForJobsheets(done)).toBe('taka_entry_done');
  });

  it('In butta cutting while at least one taka is at butta cutting or in butta QC', () => {
    expect(orderStatusForJobsheets(done, ['at_butta', 'entered', 'entered'])).toBe('in_butta_cutting');
    expect(orderStatusForJobsheets(done, ['butta_qc', 'waiting_mill', 'entered'])).toBe('in_butta_cutting');
    expect(orderStatusForJobsheets(done, ['at_butta', 'waiting_mill'])).toBe('in_butta_cutting');
  });

  it('Ready for mill when every active taka waits for the mill — also a design that skips butta cutting', () => {
    expect(orderStatusForJobsheets(done, ['waiting_mill', 'waiting_mill', 'waiting_mill'])).toBe('ready_for_mill');
    // some still waiting for butta cutting → not ready
    expect(orderStatusForJobsheets(done, ['waiting_mill', 'entered'])).toBe('taka_entry_done');
  });

  it('while production is still running the order stays In production', () => {
    const running = [{ status: 'completed', takaCount: 3 }, { status: 'ongoing', takaCount: 0 }];
    expect(orderStatusForJobsheets(running, ['at_butta', 'waiting_mill'])).toBe('in_production');
    expect(orderStatusForJobsheets([{ status: 'completed', takaCount: 3 }, { status: 'pending' }], ['waiting_mill'])).toBe('in_production');
  });

  it('a completed jobsheet without takas keeps Production completed', () => {
    expect(orderStatusForJobsheets([{ status: 'completed', takaCount: 3 }, { status: 'completed', takaCount: 0 }], ['waiting_mill'])).toBe(
      'production_completed',
    );
  });

  it('no takas yet / a taka removed back to nothing', () => {
    expect(orderStatusForJobsheets(done, [])).toBe('taka_entry_done');
  });

  it('the new statuses have their own order, badge and are visible to Jemish and Gaurang only', () => {
    expect(getStatus('in_butta_cutting')).toMatchObject({ label: 'In butta cutting', sequence: 70 });
    expect(getStatus('ready_for_mill')).toMatchObject({ label: 'Ready for mill', sequence: 80 });
    expect(getStatus('in_butta_cutting').badge.dot).not.toBe(getStatus('ready_for_mill').badge.dot);
    expect(getStatus('in_butta_cutting').badge.dot).not.toBe(getStatus('taka_entry_done').badge.dot);
    for (const role of ['jemish', 'gaurang'] as const) {
      expect(canRoleSeeStatus(role, 'in_butta_cutting')).toBe(true);
      expect(canRoleSeeStatus(role, 'ready_for_mill')).toBe(true);
    }
    expect(statusesForRole('godown_supervisor')).toEqual([]);
    expect(statusesForRole('qc')).toEqual([]);
  });
});

describe('sprint 7 roles', () => {
  it('Jemish and Gaurang: butta module, cancel challan and parties; no QC', () => {
    for (const r of ['jemish', 'gaurang'] as const) {
      expect(can(r, 'canUseButtaModule')).toBe(true);
      expect(can(r, 'canCancelChallan')).toBe(true);
      expect(can(r, 'canManageButtaParties')).toBe(true);
      expect(can(r, 'canButtaQc')).toBe(false);
    }
  });

  it('Godown supervisor: only the butta module, restricted view, lands on /butta', () => {
    expect(landingRoute('godown_supervisor')).toBe('/butta');
    expect(ROLES.godown_supervisor.initials).toBe('GS');
    expect(can('godown_supervisor', 'canUseButtaModule')).toBe(true);
    for (const p of ['canCancelChallan', 'canManageButtaParties', 'canButtaQc', 'canViewOrders', 'canViewMasters', 'canSeeRate', 'canEditTakas', 'canViewTakas'] as const) {
      expect(can('godown_supervisor', p), p).toBe(false);
    }
  });

  it('QC (butta + mill): bilingual, only QC, lands on /qc', () => {
    expect(landingRoute('qc')).toBe('/qc');
    expect(ROLES.qc.bilingual).toBe(true);
    expect(can('qc', 'canButtaQc')).toBe(true);
    for (const p of ['canUseButtaModule', 'canCancelChallan', 'canManageButtaParties', 'canViewOrders', 'canViewMasters', 'canEnterTakas', 'canUseTakaModules'] as const) {
      expect(can('qc', p), p).toBe(false);
    }
  });

  it('the old roles gain nothing they should not have', () => {
    for (const r of ['supervisor', 'taka_entry'] as const) {
      expect(can(r, 'canUseButtaModule')).toBe(false);
      expect(can(r, 'canButtaQc')).toBe(false);
    }
  });
});

describe('order status: mill', () => {
  const done = [{ status: 'completed', takaCount: 3 }, { status: 'completed', takaCount: 2 }];

  it('In mill: nothing before the mill is left and at least one taka is at the mill (some may still wait)', () => {
    expect(orderStatusForJobsheets(done, ['at_mill', 'at_mill', 'at_mill'])).toBe('in_mill');
    expect(orderStatusForJobsheets(done, ['at_mill', 'waiting_mill', 'waiting_mill'])).toBe('in_mill');
    expect(orderStatusForJobsheets(done, ['at_mill', 'mill_qc', 'waiting_mill'])).toBe('in_mill');
  });

  it('butta and mill at the same time: the earliest unfinished stage wins', () => {
    expect(orderStatusForJobsheets(done, ['at_mill', 'at_butta'])).toBe('in_butta_cutting');
    expect(orderStatusForJobsheets(done, ['at_mill', 'butta_qc', 'waiting_mill'])).toBe('in_butta_cutting');
    // a taka that has not been sent to butta cutting yet holds the order back from In mill
    expect(orderStatusForJobsheets(done, ['at_mill', 'entered'])).toBe('taka_entry_done');
  });

  it('Received from mill: every active taka is back (QC pending)', () => {
    expect(orderStatusForJobsheets(done, ['mill_qc', 'mill_qc'])).toBe('received_from_mill');
    expect(orderStatusForJobsheets(done, ['mill_qc', 'at_mill'])).toBe('in_mill');
    expect(orderStatusForJobsheets(done, ['mill_qc', 'waiting_mill'])).toBe('in_mill');
  });

  it('Ready for mill and the mill statuses only apply once taka entry is done', () => {
    expect(orderStatusForJobsheets([{ status: 'completed', takaCount: 3 }, { status: 'ongoing', takaCount: 0 }], ['at_mill'])).toBe('in_production');
    expect(orderStatusForJobsheets([{ status: 'completed', takaCount: 3 }, { status: 'completed', takaCount: 0 }], ['at_mill'])).toBe('production_completed');
  });

  it('new statuses: own order and colours, visible to Jemish and Gaurang only', () => {
    expect(getStatus('in_mill')).toMatchObject({ label: 'In mill', sequence: 90 });
    expect(getStatus('received_from_mill')).toMatchObject({ label: 'Received from mill', sequence: 100 });
    const dots = ['ready_for_mill', 'in_mill', 'received_from_mill', 'in_butta_cutting'].map((k) => getStatus(k).badge.dot);
    expect(new Set(dots).size).toBe(dots.length);
    for (const role of ['jemish', 'gaurang'] as const) {
      expect(canRoleSeeStatus(role, 'in_mill')).toBe(true);
      expect(canRoleSeeStatus(role, 'received_from_mill')).toBe(true);
    }
    for (const role of ['supervisor', 'taka_entry', 'godown_supervisor', 'qc'] as const) {
      expect(canRoleSeeStatus(role, 'in_mill')).toBe(false);
    }
  });
});

describe('sprint 8 roles', () => {
  it('Jemish, Gaurang and the Godown supervisor use the mill module; only Jemish and Gaurang manage mill parties', () => {
    for (const r of ['jemish', 'gaurang', 'godown_supervisor'] as const) expect(can(r, 'canUseMillModule'), r).toBe(true);
    for (const r of ['jemish', 'gaurang'] as const) expect(can(r, 'canManageMillParties'), r).toBe(true);
    expect(can('godown_supervisor', 'canManageMillParties')).toBe(false);
    for (const r of ['supervisor', 'taka_entry', 'qc'] as const) {
      expect(can(r, 'canUseMillModule'), r).toBe(false);
      expect(can(r, 'canManageMillParties'), r).toBe(false);
    }
  });
});
