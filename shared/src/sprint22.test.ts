import { describe, expect, it } from 'vitest';
import {
  addDual,
  addStockSchema,
  damagedLotLabel,
  dualText,
  emptyDual,
  formatDummyTakaNo,
  isDummyTakaNo,
  orderInventoryMeters,
  partyReturnHeaderSchema,
  partyReturnLabel,
  removeRemark,
  removeStockSchema,
  returnOrganised,
  lineDamageError,
} from './stock22';
import { jobsheetRef, jobsheetRefShort } from './jobsheets';
import { FREE_STOCK_REASON_LABEL } from './freeStock';

describe('Sprint 22 — dummy taka numbers (CR-12)', () => {
  it('D01 … D99, D100 …', () => {
    expect(formatDummyTakaNo(1)).toBe('D01');
    expect(formatDummyTakaNo(99)).toBe('D99');
    expect(formatDummyTakaNo(100)).toBe('D100');
    expect(isDummyTakaNo('D07')).toBe(true);
    expect(isDummyTakaNo('D1')).toBe(false);
    expect(isDummyTakaNo('6245')).toBe(false);
  });
});

describe('Sprint 22 — pcs and metres are never mixed (C1)', () => {
  it('prints both units, each only when present', () => {
    expect(dualText(1240, 860.5)).toBe('1,240 pcs · 860.50 m');
    expect(dualText(1240, 0)).toBe('1,240 pcs');
    expect(dualText(0, 860.5)).toBe('860.50 m');
    expect(dualText(0, 0)).toBe('0 pcs');
  });
  it('adds the two units separately', () => {
    const a = emptyDual();
    a.pcs.free = 10;
    const b = emptyDual();
    b.meters.free = 5.5;
    const s = addDual(a, b);
    expect(s.pcs.free).toBe(10);
    expect(s.meters.free).toBe(5.5);
  });
  it('meter order figures: ordered, making (loom metres × sections), ready, damaged', () => {
    const q = orderInventoryMeters(
      { unit: 'meters', quantity: 1000 },
      [
        { id: 1, status: 'ongoing', meters: 100, completedMeters: null, sections: 3 },
        { id: 2, status: 'completed', meters: 100, completedMeters: 90, sections: 3 },
      ],
      [{ jobsheetId: 2, stage: 'final', meters: 270, damagedMeters: 5 }, { jobsheetId: 2, stage: 'refinish', meters: 20 }],
    );
    expect(q).toMatchObject({ ordered: 1000, inMaking: 300, ready: 270, refinish: 20, damaged: 5 });
    expect(orderInventoryMeters({ unit: 'pcs', quantity: 5 }, [], [])).toBeNull();
  });
});

describe('Sprint 22 — manual stock schemas (C2 / CR-14)', () => {
  const base = { materialId: 1, designId: 2, unit: 'pcs' as const, quantity: 10, condition: 'fresh' as const };
  it('adds fresh stock', () => {
    expect(addStockSchema.safeParse(base).success).toBe(true);
  });
  it('damaged needs a damage within the quantity, all four types are valid', () => {
    expect(addStockSchema.safeParse({ ...base, condition: 'damaged' }).success).toBe(false);
    for (const type of ['machine', 'butta', 'mill', 'godown'] as const) {
      expect(addStockSchema.safeParse({ ...base, condition: 'damaged', damage: { type, otherName: 'Hole', qty: 3 } }).success).toBe(true);
    }
    expect(addStockSchema.safeParse({ ...base, condition: 'damaged', damage: { type: 'machine', otherName: 'Hole', qty: 11 } }).success).toBe(false);
  });
  it('pcs must be whole, metres may have decimals', () => {
    expect(addStockSchema.safeParse({ ...base, quantity: 10.5 }).success).toBe(false);
    expect(addStockSchema.safeParse({ ...base, unit: 'meters', quantity: 10.5 }).success).toBe(true);
  });
  it('remove: takas or pcs, a reason, and a note for Other', () => {
    expect(removeStockSchema.safeParse({ takaIds: [1], reason: 'sample' }).success).toBe(true);
    expect(removeStockSchema.safeParse({ takaIds: [1], reason: 'other' }).success).toBe(false);
    expect(removeStockSchema.safeParse({ takaIds: [1], reason: 'other', note: 'x' }).success).toBe(true);
    expect(removeStockSchema.safeParse({ pcs: 48, designId: 1, materialId: 2, reason: 'sold' }).success).toBe(true);
    expect(removeStockSchema.safeParse({ pcs: 48, reason: 'sold' }).success).toBe(false);
    expect(removeStockSchema.safeParse({ reason: 'sold' }).success).toBe(false);
    expect(removeRemark('sample', null)).toBe('Sample');
    expect(removeRemark('other', 'exhibition')).toBe('Other: exhibition');
  });
  it('labels', () => {
    expect(damagedLotLabel(3)).toBe('DL-3');
    expect(partyReturnLabel(7)).toBe('GR-7');
    expect(FREE_STOCK_REASON_LABEL.manual_add).toBe('Manual stock');
  });
});

describe('Sprint 22 — goods return against the party (CR-13)', () => {
  const head = { customerId: 1, receivedDate: '2026-11-06' };
  it('pcs / meters need a quantity, takas need takas', () => {
    expect(partyReturnHeaderSchema.safeParse({ ...head, receivedAs: 'pcs', receivedQty: 120 }).success).toBe(true);
    expect(partyReturnHeaderSchema.safeParse({ ...head, receivedAs: 'pcs' }).success).toBe(false);
    expect(partyReturnHeaderSchema.safeParse({ ...head, receivedAs: 'pcs', receivedQty: 12.5 }).success).toBe(false);
    expect(partyReturnHeaderSchema.safeParse({ ...head, receivedAs: 'meters', receivedQty: 12.5 }).success).toBe(true);
    expect(partyReturnHeaderSchema.safeParse({ ...head, receivedAs: 'takas' }).success).toBe(false);
    expect(partyReturnHeaderSchema.safeParse({ ...head, receivedAs: 'takas', takaIds: [4, 5] }).success).toBe(true);
  });
  it('organised vs received', () => {
    expect(returnOrganised(120, [{ qty: 50 }, { qty: 46 }])).toEqual({ organised: 96, left: 24, complete: false });
    expect(returnOrganised(120, [{ qty: 70 }, { qty: 50 }])).toEqual({ organised: 120, left: 0, complete: true });
    expect(returnOrganised(120, []).complete).toBe(false);
    expect(lineDamageError(10, [{ qty: 6 }, { qty: 5 }])).not.toBeNull();
    expect(lineDamageError(10, [{ qty: 6 }, { qty: 4 }])).toBeNull();
  });
});

describe('Sprint 22 — Manual stock is never shown with its negative order number', () => {
  it('jobsheet references say Manual stock', () => {
    expect(jobsheetRef(-3, -3)).toBe('Manual stock');
    expect(jobsheetRefShort(-3, 12)).toBe('Manual stock');
    expect(jobsheetRef(26, 319)).toBe('Order #26 (319)');
  });
});
