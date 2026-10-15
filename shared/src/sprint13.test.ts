import { describe, expect, it } from 'vitest';
import {
  blouseBreakdownText,
  blouseBucket,
  blouseFilterOptions,
  blouseMismatchNote,
  canReceiveFreeStock,
  damageTypeLine,
  effectiveOrderId,
  freeStockStage,
  hasBeenToMillThroughAncestors,
  matchesBlouse,
  moveToInventorySelectable,
  orderStatusForJobsheets,
  orderInventoryPcs,
  partialMoveMeters,
  pcsMoveAvailable,
  planPcsMove,
  resolveDamageType,
  returnedSummary,
  stageAfterButtaQc,
  takaCountsForOrder,
  can,
  getStatus,
  statusesForRole,
  orderCreateSchema,
  qcNewDamageSchema,
  grDamageSchema,
  moveToInventorySchema,
  addFromFreeStockSchema,
  takaDamageSchema,
  damageLabel,
  DAMAGE_NOT_MARKED,
  type PcsMoveCandidate,
} from './index';

const done = (n = 1) => Array.from({ length: n }, () => ({ status: 'completed', takaCount: 3 }));

describe('free stock: a taka counts for exactly one order, or for free stock', () => {
  const t = (orderId: number, isFreeStock = false, allocatedOrderId: number | null = null) => ({ orderId, isFreeStock, allocatedOrderId });
  it('normal taka → its own order', () => {
    expect(effectiveOrderId(t(26))).toBe(26);
    expect(takaCountsForOrder(t(26), 26)).toBe(true);
    expect(takaCountsForOrder(t(26), 31)).toBe(false);
  });
  it('free stock → no order at all', () => {
    expect(effectiveOrderId(t(26, true))).toBeNull();
    expect(takaCountsForOrder(t(26, true), 26)).toBe(false);
  });
  it('allocated free stock → the order it was allocated to (not the origin)', () => {
    expect(effectiveOrderId(t(26, false, 31))).toBe(31);
    expect(takaCountsForOrder(t(26, false, 31), 26)).toBe(false);
    expect(takaCountsForOrder(t(26, false, 31), 31)).toBe(true);
  });
  it('numbers reconcile: sum across orders + free stock = all active takas, nothing counted twice', () => {
    const rows = [
      { id: 1, pcs: 10, ...t(1) },
      { id: 2, pcs: 20, ...t(1, true) },
      { id: 3, pcs: 30, ...t(1, false, 2) },
      { id: 4, pcs: 40, ...t(2) },
      { id: 5, pcs: 50, ...t(2, true) },
    ];
    const perOrder = new Map<number, number>();
    let free = 0;
    for (const r of rows) {
      const o = effectiveOrderId(r);
      if (o === null) free += r.pcs;
      else perOrder.set(o, (perOrder.get(o) ?? 0) + r.pcs);
    }
    const sum = [...perOrder.values()].reduce((a, b) => a + b, 0) + free;
    expect(sum).toBe(rows.reduce((a, r) => a + r.pcs, 0));
    expect(perOrder.get(1)).toBe(10);
    expect(perOrder.get(2)).toBe(70);
    expect(free).toBe(70);
  });
  it('free taka leaves the order inventory figures; allocated one joins the new order', () => {
    const js = [{ id: 1, status: 'completed', frames: 4, completedFrames: 4 }];
    const takas = [
      { jobsheetId: 1, stage: 'final', pcs: 12 },
      { jobsheetId: 1, stage: 'final', pcs: 12 },
      { jobsheetId: 1, stage: 'waiting_mill', pcs: 12 },
    ];
    const before = orderInventoryPcs({ unit: 'pcs', quantity: 36 }, js, takas)!;
    expect(before.inGodown).toBe(24);
    const after = orderInventoryPcs({ unit: 'pcs', quantity: 36 }, js, takas.slice(1))!;
    expect(after.inGodown).toBe(12);
    expect(after.inMaking).toBe(12);
  });
});

describe('move to inventory: which takas can move', () => {
  it('everything physically with us is selectable', () => {
    for (const s of ['entered', 'rework_butta', 'waiting_mill', 'butta_qc', 'mill_qc', 'refinish', 'final', 'ready_dispatch']) {
      expect(moveToInventorySelectable(s).selectable, s).toBe(true);
    }
  });
  it('out-of-house and dispatched takas are greyed with a reason', () => {
    for (const s of ['at_butta', 'at_mill', 'dispatched']) {
      const r = moveToInventorySelectable(s);
      expect(r.selectable, s).toBe(false);
      expect(r.reason, s).toBeTruthy();
    }
    expect(moveToInventorySelectable('final', true).selectable).toBe(false);
  });
  it('a ready_dispatch taka goes back to final; others keep their stage', () => {
    expect(freeStockStage('ready_dispatch')).toBe('final');
    expect(freeStockStage('waiting_mill')).toBe('waiting_mill');
    expect(freeStockStage('butta_qc')).toBe('butta_qc');
  });
  it('free stock can be assigned to a running order, not to a dispatched / returned / unsent one', () => {
    expect(canReceiveFreeStock('in_mill')).toBe(true);
    expect(canReceiveFreeStock('partly_dispatched')).toBe(true);
    for (const s of ['pending_production', 'dispatched', 'returned']) expect(canReceiveFreeStock(s)).toBe(false);
  });
});

describe('pcs-to-pcs move: the system picks the takas', () => {
  const c = (id: number, takaNo: string, stage: string, pcs: number, actualPcs: number | null = null): PcsMoveCandidate => ({ id, takaNo, stage, pcs, actualPcs });
  const pool = [c(1, '11', 'final', 10), c(2, '12', 'final', 30), c(3, '13', 'ready_dispatch', 50), c(4, '14', 'waiting_mill', 99)];

  it('only final + ready_dispatch pcs are available', () => {
    expect(pcsMoveAvailable(pool)).toBe(90);
  });
  it('final first (largest first), then ready_dispatch; whole takas while they fit', () => {
    const plan = planPcsMove(pool, 40);
    expect(plan.whole).toEqual([2, 1]);
    expect(plan.partial).toBeNull();
    expect(plan.movedPcs).toBe(40);
    expect(plan.shortBy).toBe(0);
  });
  it('splits the taka that is needed only partly', () => {
    const plan = planPcsMove(pool, 45);
    expect(plan.whole).toEqual([2, 1]);
    expect(plan.partial).toEqual({ id: 3, keepPcs: 45, movePcs: 5 });
    expect(plan.movedPcs).toBe(45);
  });
  it('a partial split in the first taka', () => {
    const plan = planPcsMove(pool, 5);
    expect(plan.whole).toEqual([]);
    expect(plan.partial).toEqual({ id: 2, keepPcs: 25, movePcs: 5 });
  });
  it('uses the actual pcs counted by the godown', () => {
    const plan = planPcsMove([c(1, '11', 'final', 10, 8)], 8);
    expect(plan.whole).toEqual([1]);
  });
  it('asking for more than available reports the shortage', () => {
    const plan = planPcsMove(pool, 120);
    expect(plan.shortBy).toBe(30);
    expect(plan.movedPcs).toBe(90);
  });
  it('the moved + kept parts add up and meters follow pcs', () => {
    const m = partialMoveMeters(100, 25, 5);
    expect(m.keep).toBe(83.33);
    expect(m.move).toBe(16.67);
    expect((m.keep ?? 0) + (m.move ?? 0)).toBeCloseTo(100, 2);
    expect(partialMoveMeters(null, 3, 2)).toEqual({ keep: null, move: null });
  });
});

describe('has_been_to_mill + stageAfterButtaQc (re-butta fix)', () => {
  it('a normal taka goes to the mill', () => {
    expect(stageAfterButtaQc({})).toBe('waiting_mill');
    expect(stageAfterButtaQc({ hasBeenToMill: false, ancestorHasBeenToMill: false })).toBe('waiting_mill');
  });
  it('a re-butta taka that has been to the mill goes back to final', () => {
    expect(stageAfterButtaQc({ hasBeenToMill: true })).toBe('final');
    expect(stageAfterButtaQc({ hasMillHistory: true })).toBe('final');
    expect(stageAfterButtaQc({ refinishCount: 1 })).toBe('final');
  });
  it('a split part of a re-butta taka inherits it (through its ancestor)', () => {
    const byId = new Map([
      [1, { hasBeenToMill: true, parentTakaId: null }],
      [2, { hasBeenToMill: false, parentTakaId: 1 }],
      [3, { hasBeenToMill: false, parentTakaId: 2 }],
    ]);
    expect(hasBeenToMillThroughAncestors(3, byId)).toBe(true);
    expect(stageAfterButtaQc({ hasBeenToMill: false, ancestorHasBeenToMill: hasBeenToMillThroughAncestors(3, byId) })).toBe('final');
  });
  it('a split part of a taka that never went to the mill still goes to the mill', () => {
    const byId = new Map([
      [1, { hasBeenToMill: false, parentTakaId: null }],
      [2, { hasBeenToMill: false, parentTakaId: 1 }],
    ]);
    expect(hasBeenToMillThroughAncestors(2, byId)).toBe(false);
    expect(stageAfterButtaQc({ ancestorHasBeenToMill: hasBeenToMillThroughAncestors(2, byId) })).toBe('waiting_mill');
  });
  it('survives a loop and a missing parent', () => {
    const loop = new Map([
      [1, { hasBeenToMill: false, parentTakaId: 2 }],
      [2, { hasBeenToMill: false, parentTakaId: 1 }],
    ]);
    expect(hasBeenToMillThroughAncestors(1, loop)).toBe(false);
    expect(hasBeenToMillThroughAncestors(9, loop)).toBe(false);
  });
});

describe('order status: Partly dispatched / Dispatched / Returned', () => {
  it('some non-free takas still not dispatched → Partly dispatched', () => {
    expect(orderStatusForJobsheets(done(), ['dispatched', 'final'])).toBe('partly_dispatched');
    expect(orderStatusForJobsheets(done(), ['dispatched', 'final'], true)).toBe('partly_dispatched');
  });
  it('all remaining takas dispatched, no goods return → Dispatched', () => {
    expect(orderStatusForJobsheets(done(), ['dispatched', 'dispatched'])).toBe('dispatched');
  });
  it('all remaining takas dispatched after a goods return → Returned', () => {
    expect(orderStatusForJobsheets(done(), ['dispatched', 'dispatched'], true)).toBe('returned');
  });
  it('Returned has its own status: sequence 145, visible to Jemish, Gaurang and Dhruvil only', () => {
    const s = getStatus('returned');
    expect(s.label).toBe('Returned');
    expect(s.sequence).toBe(145);
    expect(statusesForRole('dhruvil').map((x) => x.key)).toContain('returned');
    expect(statusesForRole('jemish').map((x) => x.key)).toContain('returned');
    expect(statusesForRole('gaurang').map((x) => x.key)).toContain('returned');
    expect(statusesForRole('supervisor').map((x) => x.key)).not.toContain('returned');
  });
  it('a goods return alone (not all dispatched yet) never shows Returned', () => {
    expect(orderStatusForJobsheets(done(), ['final', 'dispatched'], true)).toBe('partly_dispatched');
    expect(orderStatusForJobsheets(done(), ['final'], true)).not.toBe('returned');
  });
});

describe('damage type: radio required, optional at goods return', () => {
  const base = { pcs: 2, damageId: 1 };
  it('required on taka entry / QC / godown damages', () => {
    expect(takaDamageSchema.safeParse(base).success).toBe(false);
    expect(takaDamageSchema.safeParse({ ...base, type: 'mill' }).success).toBe(true);
    expect(qcNewDamageSchema.safeParse(base).success).toBe(false);
    expect(qcNewDamageSchema.safeParse({ ...base, type: 'butta' }).success).toBe(true);
    expect(qcNewDamageSchema.safeParse({ ...base, type: 'godown' }).success).toBe(false);
  });
  it('optional at goods return (null = not marked)', () => {
    expect(grDamageSchema.parse(base).type).toBeNull();
    expect(grDamageSchema.parse({ ...base, type: 'machine' }).type).toBe('machine');
    expect(grDamageSchema.safeParse({ ...base, type: 'nope' }).success).toBe(false);
  });
  it('resolveDamageType', () => {
    expect(resolveDamageType('mill', false)).toBe('mill');
    expect(resolveDamageType(null, false)).toBeNull();
    expect(resolveDamageType(null, true)).toBe(DAMAGE_NOT_MARKED);
    expect(resolveDamageType('godown', true)).toBe(DAMAGE_NOT_MARKED);
  });
  it('labels show type, name and pcs; unmarked and the legacy types keep a label', () => {
    expect(damageLabel('mill', 'Hole', 2)).toBe('Mill damage · Hole · 2 pcs');
    expect(damageLabel('unmarked', 'Hole', 1)).toBe('Damage type not marked · Hole · 1 pcs');
    expect(damageLabel('godown', null)).toBe('Supervisor marked');
    expect(damageTypeLine('Machine damage', 'Oil', 3)).toBe('Machine damage · Oil · 3 pcs');
  });
});

describe('blouse option', () => {
  it('order schema: optional, validated, null when missing', () => {
    const o = { customerId: 1, orderType: 'lump', materialId: 1, quantity: 5, unit: 'pcs', orderDate: '2026-10-01' };
    expect(orderCreateSchema.parse(o).blouseOption).toBeNull();
    expect(orderCreateSchema.parse({ ...o, blouseOption: 'with_blouse' }).blouseOption).toBe('with_blouse');
    expect(orderCreateSchema.safeParse({ ...o, blouseOption: 'maybe' }).success).toBe(false);
  });
  it('filter: All · With · Without · Not set', () => {
    expect(matchesBlouse('all', null)).toBe(true);
    expect(matchesBlouse(undefined, 'with_blouse')).toBe(true);
    expect(matchesBlouse('with_blouse', 'with_blouse')).toBe(true);
    expect(matchesBlouse('with_blouse', 'without_blouse')).toBe(false);
    expect(matchesBlouse('not_set', null)).toBe(true);
    expect(matchesBlouse('not_set', 'with_blouse')).toBe(false);
    expect(blouseBucket(null)).toBe('not_set');
  });
  it('toggle options show only buckets with data; All always', () => {
    expect(blouseFilterOptions({})).toEqual([{ key: 'all', label: 'All', pcs: 0 }]);
    expect(blouseFilterOptions({ with_blouse: 120, not_set: 40 }).map((o) => o.key)).toEqual(['all', 'with_blouse', 'not_set']);
    expect(blouseFilterOptions({ with_blouse: 120, not_set: 40 })[0].pcs).toBe(160);
  });
  it('filtering the inventory figures by blouse keeps the totals consistent', () => {
    const rows = [
      { blouse: 'with_blouse' as const, pcs: 120 },
      { blouse: 'without_blouse' as const, pcs: 80 },
      { blouse: null, pcs: 40 },
    ];
    const sum = (f: Parameters<typeof matchesBlouse>[0]) => rows.filter((r) => matchesBlouse(f, r.blouse)).reduce((n, r) => n + r.pcs, 0);
    expect(sum('all')).toBe(240);
    expect(sum('with_blouse') + sum('without_blouse') + sum('not_set')).toBe(240);
    expect(blouseBreakdownText({ with_blouse: 120, without_blouse: 80, not_set: 40 })).toBe('With blouse 120 · Without 80 · Not set 40');
    expect(blouseBreakdownText({ with_blouse: 120 })).toBe('With blouse 120');
  });
  it('free taka with another blouse option than the order gets an amber note', () => {
    expect(blouseMismatchNote('without_blouse', 'with_blouse')).toBe('Without blouse');
    expect(blouseMismatchNote('with_blouse', 'with_blouse')).toBeNull();
    expect(blouseMismatchNote(null, 'with_blouse')).toBeNull();
  });
});

describe('request schemas', () => {
  it('move to inventory: lump takaIds or pcs-to-pcs pcs', () => {
    expect(moveToInventorySchema.safeParse({ takaIds: [1, 2], note: 'x' }).success).toBe(true);
    expect(moveToInventorySchema.safeParse({ pcs: 40 }).success).toBe(true);
    expect(moveToInventorySchema.safeParse({ pcs: 0 }).success).toBe(false);
    expect(moveToInventorySchema.safeParse({ takaIds: [] }).success).toBe(false);
    expect(moveToInventorySchema.safeParse({}).success).toBe(false);
    expect(addFromFreeStockSchema.safeParse({ takaIds: [3] }).success).toBe(true);
    expect(addFromFreeStockSchema.safeParse({ pcs: 12 }).success).toBe(true);
  });
  it('permission canMoveToInventory: Jemish, Gaurang, Dhruvil', () => {
    for (const r of ['jemish', 'gaurang', 'dhruvil'] as const) expect(can(r, 'canMoveToInventory'), r).toBe(true);
    for (const r of ['supervisor', 'taka_entry', 'qc', 'godown_supervisor'] as const) expect(can(r, 'canMoveToInventory'), r).toBe(false);
  });
  it('returned summary text', () => {
    expect(returnedSummary(3, 120)).toBe('Dispatched · 3 takas / 120 pcs returned to stock');
    expect(returnedSummary(0, 40)).toBe('Dispatched · 40 pcs returned to stock');
    expect(returnedSummary(1, 10)).toBe('Dispatched · 1 taka / 10 pcs returned to stock');
  });
});
