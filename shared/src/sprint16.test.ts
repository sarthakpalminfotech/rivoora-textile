import { describe, expect, it } from 'vitest';
import { externalJobsheetNo, isExternalJobsheetNo, jobsheetRef, jobsheetRefShort, orderJobsheetPlan, outsidePoCommittedPcs, coverageWarnings } from './jobsheets';
import { nextTakaStage } from './pipeline';
import { orderKind, stepsChangeError, stepsChangeNote, stepsHelperText, stepUntickLocks } from './orderSteps';
import {
  cleanTakaNo,
  compareTakaNo,
  initialTakaStage,
  nextSplitNumber,
  outsideTakaNumber,
  printTakaNo,
  splitBase,
  splitWeaverTakaNo,
  suggestWeaverCode,
  TAKA_NO_REGEX,
  takaNoError,
  validateOutsideRows,
  weaverCodeError,
} from './takas';
import { stageAfterButtaQc } from './rework';
import { getStatus, orderStatusForJobsheets } from './statuses';
import { buildOrderDashboard, type DashboardInput } from './orderDashboard';
import { orderMilestones, type OrderMilestoneInput } from './orderMilestones';
import { orderInventoryPcs } from './inventory';
import { canReceiveFreeStock, damageTypeOptions, damageTypeLabelFor, FREE_STOCK_REASON_LABEL } from './freeStock';
import { givenOutsideLine, outsidePoTotals, parsePoNo, poCanEdit, poLabel, poPendingQty, poStatusFor, receivedLot, receivedQtyOf } from './outside';
import { orderCreateSchema, orderUpdateSchema, outsideReceiptSchema, fgReceiptSchema, weaverInputSchema } from './schemas';

const ALL = { hasProduction: true, hasButta: true, hasMill: true };
const steps = (p: boolean, b: boolean, m: boolean) => ({ hasProduction: p, hasButta: b, hasMill: m });

describe('orderKind', () => {
  it('in-house / outside production / FG purchase', () => {
    expect(orderKind(ALL)).toBe('in_house');
    expect(orderKind(steps(true, false, false))).toBe('in_house');
    expect(orderKind(steps(false, true, true))).toBe('outside_production');
    expect(orderKind(steps(false, false, true))).toBe('outside_production');
    expect(orderKind(steps(false, true, false))).toBe('outside_production');
    expect(orderKind(steps(false, false, false))).toBe('fg_purchase');
  });

  it('helper line + history note', () => {
    expect(stepsHelperText(ALL)).toBe('Jobsheets → taka entry → Butta → Mill → Dispatch');
    expect(stepsHelperText(steps(true, false, true))).toBe('Jobsheets → taka entry → Mill → Dispatch');
    expect(stepsHelperText(steps(false, true, false))).toMatch(/POs to outside weavers/);
    expect(stepsHelperText(steps(false, false, false))).toMatch(/^Direct FG purchase/);
    expect(stepsChangeNote(ALL, steps(true, false, true))).toBe('Steps changed: Butta removed');
    expect(stepsChangeNote(steps(true, false, true), ALL)).toBe('Steps changed: Butta added');
    expect(stepsChangeNote(ALL, ALL)).toBeNull();
  });

  it('untick guards', () => {
    const facts = { jobsheets: 2, buttaTakas: 0, millTakas: 1, outsidePos: 0 };
    expect(stepUntickLocks(facts).production).toMatch(/2 jobsheets/);
    expect(stepUntickLocks(facts).butta).toBeNull();
    expect(stepsChangeError(ALL, steps(true, false, true), facts)).toBeNull();
    expect(stepsChangeError(ALL, steps(true, true, false), facts)?.step).toBe('mill');
    expect(stepsChangeError(ALL, steps(false, true, true), facts)?.step).toBe('production');
    expect(stepsChangeError(steps(false, true, false), steps(false, false, false), { jobsheets: 0, buttaTakas: 0, millTakas: 0, outsidePos: 1 })?.message).toMatch(/outside POs/);
  });
});

describe('nextTakaStage — one routing rule', () => {
  it('taka entry / outside receipt follow the ticks', () => {
    for (const from of ['taka_entry', 'outside_receipt'] as const) {
      expect(nextTakaStage({ hasButta: true, hasMill: true }, from)).toBe('entered');
      expect(nextTakaStage({ hasButta: true, hasMill: false }, from)).toBe('entered');
      expect(nextTakaStage({ hasButta: false, hasMill: true }, from)).toBe('waiting_mill');
      expect(nextTakaStage({ hasButta: false, hasMill: false }, from)).toBe('final');
    }
  });

  it('FG receipt and Mill QC always go to final', () => {
    expect(nextTakaStage({ hasButta: true, hasMill: true }, 'fg_receipt')).toBe('final');
    expect(nextTakaStage({ hasButta: false, hasMill: false }, 'mill_qc')).toBe('final');
  });

  it('Butta QC: waiting for mill only when Mill is ticked and the taka is not dyed yet', () => {
    expect(nextTakaStage({ hasButta: true, hasMill: true }, 'butta_qc')).toBe('waiting_mill');
    expect(nextTakaStage({ hasButta: true, hasMill: false }, 'butta_qc')).toBe('final');
    expect(nextTakaStage({ hasButta: true, hasMill: true }, 'butta_qc', { hasBeenToMill: true })).toBe('final');
    expect(nextTakaStage({ hasButta: true, hasMill: true }, 'butta_qc', { ancestorHasBeenToMill: true })).toBe('final');
    expect(nextTakaStage({ hasButta: true, hasMill: true }, 'butta_qc', { refinishCount: 1 })).toBe('final');
    // Rework (re-butta) on an order without Butta: back to final after the QC.
    expect(nextTakaStage({ hasButta: false, hasMill: false }, 'butta_qc')).toBe('final');
  });

  it('the old helpers are the same rule for existing (all-ticked) orders', () => {
    expect(initialTakaStage({ buttaCutting: true })).toBe('entered');
    expect(initialTakaStage({ buttaCutting: false })).toBe('waiting_mill');
    expect(initialTakaStage(null)).toBe('entered');
    expect(stageAfterButtaQc({})).toBe('waiting_mill');
    expect(stageAfterButtaQc({ hasMillHistory: true })).toBe('final');
  });
});

describe('outside taka numbers', () => {
  it('regex: 1–4 letter prefix, split letter', () => {
    for (const v of ['S1101', 'S1101A', 'FG25', 'ABCD1', '1101', '1101A', '62/45B', 'ST12-3']) expect(TAKA_NO_REGEX.test(v), v).toBe(true);
    for (const v of ['ABCDE1', 'S', '1101AB', 's1101', 'S-1101', 'S1101-']) expect(TAKA_NO_REGEX.test(v), v).toBe(false);
    expect(takaNoError('S1101A')).toBeNull();
  });

  it('cleanTakaNo keeps the prefix + split letter', () => {
    expect(cleanTakaNo('S1101')).toBe('S1101');
    expect(cleanTakaNo('S1101A')).toBe('S1101A');
    expect(cleanTakaNo('ABCDE1101')).toBe('ABCD1101');
    expect(cleanTakaNo('S11A01')).toBe('S1101');
  });

  it('our number wins; else code + weaver number', () => {
    expect(outsideTakaNumber('S', '1101')).toBe('S1101');
    expect(outsideTakaNumber('S', '1101', '25')).toBe('25');
    expect(outsideTakaNumber('FG', '1101', '  ')).toBe('FG1101');
  });

  it('printTakaNo: our number, else the weaver exact number; split parts keep the letter', () => {
    expect(printTakaNo({ takaNo: '6245' })).toBe('6245');
    expect(printTakaNo({ takaNo: 'S1101', weaverTakaNo: '1101', hasOwnNumber: false })).toBe('1101');
    expect(printTakaNo({ takaNo: '25', weaverTakaNo: '1101', hasOwnNumber: true })).toBe('25');
    expect(splitWeaverTakaNo('1101', 'S1101A')).toBe('1101A');
    expect(splitWeaverTakaNo('1101A', 'S1101B')).toBe('1101B');
    expect(splitWeaverTakaNo(null, '25A')).toBeNull();
    expect(printTakaNo({ takaNo: 'S1101A', weaverTakaNo: '1101A', hasOwnNumber: false })).toBe('1101A');
  });

  it('split parts of a prefixed taka', () => {
    expect(splitBase('S1101A')).toBe('S1101');
    expect(nextSplitNumber('S1101', ['S1101', 'S1101A'])).toBe('S1101B');
  });

  it('sorting: ours first, then by prefix, then numerically', () => {
    expect(['S12', '10', 'S2', 'FG5', '9'].sort(compareTakaNo)).toEqual(['9', '10', 'FG5', 'S2', 'S12']);
  });

  it('weaver codes', () => {
    expect(weaverCodeError('S')).toBeNull();
    expect(weaverCodeError('FG')).toBe('reserved');
    expect(weaverCodeError('ABCDE')).toBe('format');
    expect(weaverCodeError('')).toBe('required');
    expect(suggestWeaverCode('Shree Textiles')).toBe('ST');
    expect(suggestWeaverCode('Shree')).toBe('S');
    expect(suggestWeaverCode('Shree', ['S'])).toBe('SH');
    expect(suggestWeaverCode('Fine Goods')).toBe('F');
  });

  it('receipt rows: weaver numbers per weaver, system numbers system-wide', () => {
    const rows = [{ weaverTakaNo: '1101' }, { weaverTakaNo: '1102', ourTakaNo: '55' }, { weaverTakaNo: '1101' }, { weaverTakaNo: '1103' }, { weaverTakaNo: '' }, { weaverTakaNo: '1104', ourTakaNo: '55' }];
    expect(validateOutsideRows(rows, 'S', { usedWeaverNos: new Set(['1103']) })).toEqual([null, null, 'weaver_duplicate', 'weaver_used', 'weaver_required', 'own_duplicate']);
    expect(validateOutsideRows([{ weaverTakaNo: '7' }], 'FG', { usedSystemNos: new Set(['FG7']) })).toEqual(['system_used']);
  });
});

describe('the hidden external jobsheet', () => {
  it('has a negative number that never clashes and is never shown', () => {
    expect(externalJobsheetNo(26)).toBe(-26);
    expect(isExternalJobsheetNo(-26)).toBe(true);
    expect(isExternalJobsheetNo(319)).toBe(false);
    expect(jobsheetRef(26, -26)).toBe('Order #26');
    expect(jobsheetRefShort(26, -26)).toBe('#26');
    expect(jobsheetRef(26, 319)).toBe('Order #26 (319)');
  });
});

describe('outside POs', () => {
  it('status by what came', () => {
    expect(poStatusFor({ status: 'open', quantity: 100, receivedQty: 0 })).toBe('open');
    expect(poStatusFor({ status: 'open', quantity: 100, receivedQty: 40 })).toBe('partly_received');
    expect(poStatusFor({ status: 'partly_received', quantity: 100, receivedQty: 100 })).toBe('received');
    expect(poStatusFor({ status: 'closed', quantity: 100, receivedQty: 40 })).toBe('closed');
    expect(poPendingQty({ status: 'partly_received', quantity: 100, receivedQty: 40 })).toBe(60);
    expect(poPendingQty({ status: 'closed', quantity: 100, receivedQty: 40 })).toBe(0);
    expect(poCanEdit({ status: 'open', receivedTakas: 0 })).toBe(true);
    expect(poCanEdit({ status: 'partly_received', receivedTakas: 2 })).toBe(false);
    expect(poLabel(3)).toBe('PO-3');
    expect(parsePoNo('po 12')).toBe(12);
    expect(receivedQtyOf('meters', [{ pcs: 3, meters: 10.5 }, { pcs: 4, meters: null }])).toBe(10.5);
    expect(receivedQtyOf('pcs', [{ pcs: 3, meters: 10.5 }, { pcs: 4, meters: null }])).toBe(7);
    expect(receivedLot(50, 70)).toEqual({ pcs: 50, damagedPcs: 50 });
  });

  it('totals + the jobsheet plan of a partly-outside order', () => {
    const pos = [
      { unit: 'pcs', quantity: 120, receivedQty: 40, receivedTakas: 2, status: 'partly_received' },
      { unit: 'meters', quantity: 500, receivedQty: 0, receivedTakas: 0, status: 'open' },
      { unit: 'pcs', quantity: 60, receivedQty: 0, receivedTakas: 0, status: 'cancelled' },
      { unit: 'pcs', quantity: 30, receivedQty: 10, receivedTakas: 1, status: 'closed' },
    ];
    const t = outsidePoTotals(pos);
    expect(t).toMatchObject({ pos: 3, openPos: 2, pcsOrdered: 150, pcsReceived: 50, pcsPending: 80, pcsCommitted: 130, metersPending: 500, takasReceived: 3 });
    expect(outsidePoCommittedPcs(pos)).toBe(130);
    // 300 pcs ordered, 130 given outside → 170 pcs → 57 frames needed.
    const plan = orderJobsheetPlan(300 - 130, [{ frames: 57, status: 'pending', completedFrames: null }]);
    expect(plan.targetFrames).toBe(57);
    expect(coverageWarnings(plan)).toEqual([]);
    expect(givenOutsideLine([{ poNo: 3, pcs: 120 }])).toBe('120 pcs given outside (PO-3)');
    expect(givenOutsideLine([])).toBeNull();
  });
});

describe('order status per kind', () => {
  const done = [{ status: 'completed', takaCount: 2 }];
  it('closed overrides everything', () => {
    expect(orderStatusForJobsheets(done, ['final'], false, { isClosed: true })).toBe('closed');
    expect(getStatus('closed').label).toBe('Closed');
  });
  it('outside production / awaiting goods before any taka; the stage rules after', () => {
    expect(orderStatusForJobsheets([], [], false, { steps: steps(false, true, true) })).toBe('outside_production');
    expect(orderStatusForJobsheets([], [], false, { steps: steps(false, false, false) })).toBe('awaiting_goods');
    expect(orderStatusForJobsheets([], ['entered'], false, { steps: steps(false, true, true) })).toBe('taka_entry_done');
    expect(orderStatusForJobsheets([], ['waiting_mill'], false, { steps: steps(false, false, true) })).toBe('ready_for_mill');
    expect(orderStatusForJobsheets([], ['final'], false, { steps: steps(false, false, false) })).toBe('in_godown');
    expect(orderStatusForJobsheets([], ['ready_dispatch'], false, { steps: steps(false, false, false) })).toBe('ready_for_dispatch');
    expect(orderStatusForJobsheets([], ['dispatched'], false, { steps: steps(false, false, false) })).toBe('dispatched');
  });
  it('in-house: Production only / Production + Butta end In godown, existing orders unchanged', () => {
    expect(orderStatusForJobsheets(done, ['final', 'final'], false, { steps: steps(true, false, false) })).toBe('in_godown');
    expect(orderStatusForJobsheets(done, ['final', 'final'], false, { steps: steps(true, true, false) })).toBe('in_godown');
    expect(orderStatusForJobsheets(done, ['final', 'final'], false, { steps: ALL })).toBe('mill_qc_done');
    expect(orderStatusForJobsheets(done, ['final', 'final'])).toBe('mill_qc_done');
    // An in-house order without jobsheets stays Jobsheet pending (e.g. free stock was added first).
    expect(orderStatusForJobsheets([], ['final'], false, { steps: ALL })).toBe('ready_production');
  });
  it('statuses are visible to the right roles', () => {
    expect(getStatus('awaiting_goods').visibleTo).toContain('dhruvil');
    expect(getStatus('outside_production').visibleTo).toContain('gaurang');
    expect(getStatus('closed').visibleTo).not.toContain('supervisor');
  });
});

describe('dashboard per kind', () => {
  const base = (over: Partial<DashboardInput>): DashboardInput => ({ order: { orderNo: 7, unit: 'pcs', quantity: 300 }, jobsheets: [], takas: [], ...over });
  const keys = (d: ReturnType<typeof buildOrderDashboard>) => d.mainStages.map((m) => m.key).join();

  it('in-house all ticked = the old four stages', () => {
    expect(keys(buildOrderDashboard(base({})))).toBe('production,butta,mill,ready');
  });
  it('unticked stages are hidden (not skipped), unless a taka is there', () => {
    expect(keys(buildOrderDashboard(base({ steps: steps(true, false, true) })))).toBe('production,mill,ready');
    expect(keys(buildOrderDashboard(base({ steps: steps(true, false, false) })))).toBe('production,ready');
    const rework = buildOrderDashboard(base({ steps: steps(true, false, false), takas: [{ jobsheetId: -1, stage: 'rework_butta', isDamaged: false, pcs: 10 }] }));
    expect(keys(rework)).toBe('production,butta,ready');
  });
  it('outside production: an Outside card with the POs, the At outside weaver sub-stage, pending pcs in the bar', () => {
    const outside = outsidePoTotals([{ unit: 'pcs', quantity: 300, receivedQty: 100, receivedTakas: 4, status: 'partly_received' }]);
    const d = buildOrderDashboard(
      base({ steps: steps(false, true, true), outside, takas: [{ jobsheetId: -7, stage: 'entered', isDamaged: false, count: 4, pcs: 100 }] }),
    );
    expect(keys(d)).toBe('outside,butta,mill,ready');
    expect(d.kind).toBe('outside_production');
    const card = d.mainStages[0];
    expect(card).toMatchObject({ key: 'outside', unit: 'pos', count: 1, takas: 4 });
    expect(d.subStages.filter((s) => s.mainStage === 'outside').map((s) => s.key).join()).toBe('taka_done,at_weaver');
    expect(d.subStages.find((s) => s.key === 'at_weaver')!.count).toBe(1);
    expect(d.subStages.some((s) => s.unit === 'jobsheets')).toBe(false);
    // 200 pcs still at the weaver + 100 received waiting for butta = all in the Outside segment.
    expect(d.bar.find((b) => b.stage === 'outside')!.pcs).toBe(300);
    expect(d.barTotalPcs).toBe(300);
    expect(d.progress.targetPcs).toBe(300);
    expect(d.alerts).toEqual([]);
  });
  it('FG purchase: a Purchase card, then Ready', () => {
    const awaiting = buildOrderDashboard(base({ steps: steps(false, false, false) }));
    expect(keys(awaiting)).toBe('purchase,ready');
    expect(awaiting.mainStages[0]).toMatchObject({ key: 'purchase', count: 0, hasWork: true });
    const got = buildOrderDashboard(base({ steps: steps(false, false, false), takas: [{ jobsheetId: -7, stage: 'final', isDamaged: false, count: 2, pcs: 300 }] }));
    expect(got.mainStages[0]).toMatchObject({ key: 'purchase', count: 2, state: 'completed' });
    expect(got.bar.find((b) => b.stage === 'ready')!.pcs).toBe(300);
  });
  it('in-house with a partial PO: an Outside sub-stage under Production, target includes the PO pcs', () => {
    const outside = outsidePoTotals([{ unit: 'pcs', quantity: 120, receivedQty: 0, receivedTakas: 0, status: 'open' }]);
    const d = buildOrderDashboard(base({ outside, jobsheets: [{ id: 1, jobsheetNo: 10, status: 'pending', frames: 60, completedFrames: null, sentAt: null, startedAt: null, completedAt: null, runningMachineId: null }] }));
    expect(d.subStages.some((s) => s.key === 'outside_po' && s.mainStage === 'production' && s.count === 1)).toBe(true);
    expect(d.progress.targetPcs).toBe(180 + 120);
    // 60 frames = 180 pcs cover the 300 − 120 pcs: no coverage warning.
    expect(d.alerts).toEqual([]);
    expect(d.bar.find((b) => b.stage === 'production')!.pcs).toBe(300);
  });
});

describe('milestones per kind', () => {
  const at = (d: number) => `2026-10-${String(d).padStart(2, '0')}T10:00:00.000Z`;
  const input = (over: Partial<OrderMilestoneInput>): OrderMilestoneInput => ({
    createdAt: at(1),
    productionStartedAt: null,
    buttaApplies: true,
    buttaSent: [],
    buttaReceived: [],
    millSent: [],
    millReceived: [],
    dispatched: [],
    ...over,
  });
  const keys = (i: OrderMilestoneInput) => orderMilestones(i).map((m) => m.key).join();
  it('existing orders: the old seven steps', () => {
    expect(keys(input({}))).toBe('created,in_production,butta_sent,butta_received,mill_sent,mill_received,dispatched');
  });
  it('production steps only when ticked; outside / FG steps', () => {
    expect(keys(input({ steps: steps(true, false, true) }))).toBe('created,in_production,mill_sent,mill_received,dispatched');
    expect(keys(input({ steps: steps(false, false, true) }))).toBe('created,po_placed,received_weaver,mill_sent,mill_received,dispatched');
    expect(keys(input({ steps: steps(false, false, false) }))).toBe('created,goods_received,dispatched');
    expect(keys(input({ steps: ALL, poPlaced: [{ first: at(2), last: at(2) }] }))).toBe(
      'created,in_production,po_placed,received_weaver,butta_sent,butta_received,mill_sent,mill_received,dispatched',
    );
  });
  it('durations between the steps that exist', () => {
    const m = orderMilestones(input({ steps: steps(false, false, true), poPlaced: [{ first: at(2), last: at(2) }], receivedOutside: [{ first: at(6), last: at(6) }] }));
    expect(m.find((x) => x.key === 'received_weaver')!.sincePrevious!.text).toBe('The weaver took 4 days');
  });
});

describe('inventory with outside / FG / closed', () => {
  it('pending outside PO pcs count as In making; an FG order with nothing has nothing in making', () => {
    expect(orderInventoryPcs({ unit: 'pcs', quantity: 300 }, [], [], 200)?.inMaking).toBe(200);
    expect(orderInventoryPcs({ unit: 'pcs', quantity: 300 }, [], [])?.inMaking).toBe(0);
    const p = orderInventoryPcs({ unit: 'pcs', quantity: 300 }, [], [{ jobsheetId: -9, stage: 'entered', count: 2, pcs: 50 }, { jobsheetId: -9, stage: 'final', pcs: 30 }], 100)!;
    expect(p).toMatchObject({ inMaking: 150, inGodown: 30 });
  });
  it('closed orders cannot receive free stock; the reason has a label', () => {
    expect(canReceiveFreeStock('closed')).toBe(false);
    expect(canReceiveFreeStock('awaiting_goods')).toBe(true);
    expect(FREE_STOCK_REASON_LABEL.order_closed).toBe('Order closed');
  });
});

describe('damage type options per taka', () => {
  it('follow the source and the steps', () => {
    expect(damageTypeOptions()).toEqual(['machine', 'butta', 'mill']);
    expect(damageTypeOptions({ source: 'production', hasButta: false, hasMill: false })).toEqual(['machine']);
    expect(damageTypeOptions({ source: 'outside_po', hasButta: false, hasMill: true })).toEqual(['weaver', 'mill']);
    expect(damageTypeOptions({ source: 'fg_purchase', hasButta: false, hasMill: false })).toEqual(['weaver']);
    expect(damageTypeOptions({ source: 'fg_purchase', hasButta: false, hasMill: false, beenToMill: true })).toEqual(['weaver', 'mill']);
    expect(damageTypeLabelFor('weaver', 'fg_purchase').en).toBe('Weaver / supplier damage');
  });
});

describe('request schemas', () => {
  it('a new order gets all three steps by default; editing keeps them unless sent', () => {
    const body = { customerId: 1, orderType: 'lump', materialId: 1, quantity: 10, unit: 'pcs', orderDate: '2026-10-01' };
    expect(orderCreateSchema.parse(body)).toMatchObject({ hasProduction: true, hasButta: true, hasMill: true });
    expect(orderUpdateSchema.parse(body).hasButta).toBeUndefined();
  });
  it('weaver: code upper-cased, FG reserved', () => {
    expect(weaverInputSchema.parse({ name: 'Shree', shortCode: 's' }).shortCode).toBe('S');
    expect(weaverInputSchema.safeParse({ name: 'X', shortCode: 'FG' }).success).toBe(false);
  });
  it('receipts', () => {
    expect(outsideReceiptSchema.safeParse({ challanNo: '445', date: '2026-10-01', rows: [{ weaverTakaNo: '1101', pcs: 10 }] }).success).toBe(true);
    expect(outsideReceiptSchema.safeParse({ challanNo: '445', date: '2026-10-01', rows: [{ weaverTakaNo: 'A1', pcs: 10 }] }).success).toBe(false);
    expect(fgReceiptSchema.safeParse({ challanNo: '9', date: '2026-10-01', supplierName: 'Shree', pcs: 50 }).success).toBe(true);
    expect(fgReceiptSchema.safeParse({ challanNo: '9', date: '2026-10-01', supplierName: 'Shree', rows: [{ weaverTakaNo: '7', pcs: 5 }] }).success).toBe(true);
  });
});
