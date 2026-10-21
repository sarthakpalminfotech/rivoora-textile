import { describe, expect, it } from 'vitest';
import {
  addInventoryPcs,
  buildOrderDashboard,
  compareInventoryItems,
  EMPTY_INVENTORY_PCS,
  inventoryBarShares,
  inventoryKey,
  orderInventoryPcs,
  parseInventoryKey,
  totalInGodown,
  type InventoryTakaInput,
} from './index';

const order = { unit: 'pcs', quantity: 300 };
const js = (id: number, status: string, frames: number, completedFrames: number | null = null) => ({ id, status, frames, completedFrames });
const row = (jobsheetId: number, stage: string, pcs: number | null, extra: Partial<InventoryTakaInput> = {}): InventoryTakaInput => ({ jobsheetId, stage, pcs, ...extra });

describe('orderInventoryPcs', () => {
  it('returns null for non-pcs orders (left out)', () => {
    expect(orderInventoryPcs({ unit: 'kg', quantity: 50 }, [], [])).toBeNull();
    expect(orderInventoryPcs({ unit: 'meters', quantity: 50 }, [], [])).toBeNull();
  });

  it('counts every figure from the taka stages', () => {
    const p = orderInventoryPcs(
      order,
      [js(1, 'completed', 10)],
      [
        row(1, 'entered', 12, { count: 1 }),
        row(1, 'at_mill', 30, { count: 2 }),
        row(1, 'final', 40, { count: 2, damagedPcs: 5 }),
        row(1, 'ready_dispatch', 90, { count: 3, damagedPcs: 7 }),
        row(1, 'refinish', 8, { count: 1 }),
      ],
    )!;
    expect(p).toEqual({ ordered: 300, inMaking: 42, inGodown: 40, readyDispatch: 90, inRefinish: 8, damaged: 12 });
    expect(totalInGodown(p)).toBe(130);
  });

  it('counts damaged pcs only on godown stock (final / ready_dispatch)', () => {
    const p = orderInventoryPcs(order, [js(1, 'completed', 1)], [row(1, 'butta_qc', 10, { damagedPcs: 4 }), row(1, 'refinish', 10, { damagedPcs: 3 }), row(1, 'final', 10, { damagedPcs: 2 })])!;
    expect(p.damaged).toBe(2);
  });

  it('jobsheets without takas count frames × sections per beam as in making', () => {
    const p = orderInventoryPcs(order, [js(1, 'pending', 4), js(2, 'sent', 2), js(3, 'ongoing', 5), js(4, 'completed', 6, 5)], [])!;
    // (4 + 2 + 5 + 5 actual) × 3
    expect(p.inMaking).toBe(48);
    expect(p.inGodown + p.readyDispatch + p.inRefinish).toBe(0);
  });

  it('a jobsheet with takas is counted through its takas, not twice', () => {
    const p = orderInventoryPcs(order, [js(1, 'completed', 10), js(2, 'ongoing', 3)], [row(1, 'final', 28, { count: 2 })])!;
    expect(p.inMaking).toBe(9); // jobsheet 2 only
    expect(p.inGodown).toBe(28);
  });

  it('a taka without pcs gets its share of the jobsheet frames × sections', () => {
    // 10 frames × 3 = 30 pcs over 3 takas; one has 12 pcs of its own, two have none → 10 each
    const p = orderInventoryPcs(
      order,
      [js(1, 'completed', 10)],
      [row(1, 'final', 12, { count: 1 }), row(1, 'ready_dispatch', null, { count: 2 })],
    )!;
    expect(p.inGodown).toBe(12);
    expect(p.readyDispatch).toBe(20);
  });

  it('uses actual pcs of split parts (the caller sums COALESCE(actual_pcs, pcs))', () => {
    const p = orderInventoryPcs(order, [js(1, 'completed', 10)], [row(1, 'final', 38, { count: 2 })])!;
    expect(p.inGodown).toBe(38);
  });

  it('partial resolves: only the open pcs are damaged', () => {
    // a damage of 6 pcs with 4 resolved → 2 open (the server sends pcs − resolved_pcs)
    const p = orderInventoryPcs(order, [js(1, 'completed', 2)], [row(1, 'final', 20, { damagedPcs: 2 })])!;
    expect(p.damaged).toBe(2);
  });

  it('agrees with the order dashboard bar (same pcs, same rule)', () => {
    const jobsheets = [js(1, 'completed', 10), js(2, 'completed', 4, 4), js(3, 'ongoing', 6), js(4, 'pending', 2)];
    const takas = [
      row(1, 'entered', 11, { count: 1 }),
      row(1, 'waiting_mill', null, { count: 2 }),
      row(1, 'final', 9, { count: 1 }),
      row(2, 'mill_qc', 6, { count: 1 }),
      row(2, 'refinish', null, { count: 1 }),
      row(2, 'ready_dispatch', 5, { count: 1 }),
    ];
    const inv = orderInventoryPcs(order, jobsheets, takas)!;
    const dash = buildOrderDashboard({
      order: { orderNo: 1, unit: 'pcs', quantity: 300 },
      jobsheets: jobsheets.map((j) => ({ ...j, jobsheetNo: j.id, sentAt: null, startedAt: null, completedAt: null, runningMachineId: null })),
      takas: takas.map((t) => ({ jobsheetId: t.jobsheetId, stage: t.stage, isDamaged: false, count: t.count, pcs: t.pcs })),
    });
    const sum = inv.inMaking + inv.inGodown + inv.readyDispatch + inv.inRefinish;
    expect(Math.abs(sum - dash.barTotalPcs)).toBeLessThanOrEqual(1);
  });
});

describe('item keys and grouping', () => {
  it('variation wins over its base design; no design is its own item', () => {
    expect(inventoryKey({ designId: 3, variationId: 9 })).toBe('v-9');
    expect(inventoryKey({ designId: 3, variationId: null })).toBe('d-3');
    expect(inventoryKey({ designId: null, variationId: null })).toBe('none');
  });

  it('parses keys', () => {
    expect(parseInventoryKey('v-9')).toEqual({ kind: 'variation', id: 9 });
    expect(parseInventoryKey('d-3')).toEqual({ kind: 'design', id: 3 });
    expect(parseInventoryKey('none')).toEqual({ kind: 'none' });
    expect(parseInventoryKey('x-1')).toBeNull();
    expect(parseInventoryKey('d-')).toBeNull();
  });

  it('sums items and sorts: most making + ready first, then code, without design last', () => {
    const a = orderInventoryPcs(order, [js(1, 'pending', 2)], [])!;
    const b = orderInventoryPcs(order, [js(2, 'pending', 3)], [])!;
    expect(addInventoryPcs(a, b).inMaking).toBe(15);
    expect(addInventoryPcs(EMPTY_INVENTORY_PCS, a)).toEqual(a);
    const list = [
      { key: 'none', code: null, inMaking: 999, ready: 0 },
      { key: 'd-2', code: 'D102', inMaking: 5, ready: 0 },
      { key: 'd-1', code: 'D101', inMaking: 5, ready: 0 },
      { key: 'v-3', code: 'D101N1', inMaking: 50, ready: 10 },
    ];
    expect(list.sort(compareInventoryItems).map((i) => i.key)).toEqual(['v-3', 'd-1', 'd-2', 'none']);
  });

  it('bar shares never exceed 100 together', () => {
    expect(inventoryBarShares({ ordered: 300, inMaking: 60, readyDispatch: 90 })).toEqual({ ready: 30, making: 20 });
    const over = inventoryBarShares({ ordered: 100, inMaking: 80, readyDispatch: 90 });
    expect(over.ready + over.making).toBeLessThanOrEqual(100);
    expect(inventoryBarShares({ ordered: 0, inMaking: 5, readyDispatch: 5 })).toEqual({ ready: 0, making: 0 });
  });
});
