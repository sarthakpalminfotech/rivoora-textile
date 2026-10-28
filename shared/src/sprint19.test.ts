import { describe, expect, it } from 'vitest';
import {
  allocUnits,
  completedMetersNote,
  coverageClothMeters,
  coverageMeters,
  coverageWarningsMeters,
  effectiveMeters,
  jobsheetMeters,
  jobsheetQuantityWarningMeters,
  nextMetersAfterCompletedChange,
  orderJobsheetMetersPlan,
  outsidePoCommittedMeters,
  outsidePoCommittedPcs,
  planJobsheetsMeters,
  planMetersEdit,
  quantityForUnits,
  remainingMeters,
  splitQuantity,
  type AdjustMetersJobsheet,
} from './jobsheets';
import { formatQty, isManualStockOrderNo, isMeterOrder, MANUAL_STOCK_LABEL, orderRefText, qtyLabel, takaQty } from './orderUnit';
import { takaActualMeters } from './takas';

/** n jobsheets numbered from `start`, each with `meters` loom metres (ids = numbers). */
function metersSheets(meters: number[], start = 1): AdjustMetersJobsheet[] {
  return meters.map((m, i) => ({ id: start + i, jobsheetNo: start + i, meters: m }));
}

describe('orderUnit helpers', () => {
  it('isMeterOrder', () => {
    expect(isMeterOrder({ unit: 'meters' })).toBe(true);
    expect(isMeterOrder({ unit: 'pcs' })).toBe(false);
  });

  it('qtyLabel', () => {
    expect(qtyLabel('meters')).toBe('m');
    expect(qtyLabel('pcs')).toBe('pcs');
  });

  it('formatQty', () => {
    expect(formatQty(1250.5, 'meters')).toBe('1,250.5 m');
    expect(formatQty(1250, 'pcs')).toBe('1,250 pcs');
  });

  it('takaQty prefers the godown-corrected value', () => {
    expect(takaQty({ meters: 100, actualMeters: 95, pcs: null }, 'meters')).toBe(95);
    expect(takaQty({ meters: 100, actualMeters: null, pcs: null }, 'meters')).toBe(100);
    expect(takaQty({ meters: null, pcs: 40, actualPcs: 38 }, 'pcs')).toBe(38);
    expect(takaQty({ meters: null, pcs: 40 }, 'pcs')).toBe(40);
  });

  it('manual stock order refs', () => {
    expect(isManualStockOrderNo(-3)).toBe(true);
    expect(isManualStockOrderNo(26)).toBe(false);
    expect(orderRefText(-3)).toBe(MANUAL_STOCK_LABEL);
    expect(orderRefText(26)).toBe('#26');
  });
});

describe('takaActualMeters', () => {
  it('prefers actualMeters, falls back to meters', () => {
    expect(takaActualMeters({ meters: 100, actualMeters: 95 })).toBe(95);
    expect(takaActualMeters({ meters: 100, actualMeters: null })).toBe(100);
    expect(takaActualMeters({ meters: null })).toBe(null);
  });
});

describe('generic quantity engine (meters)', () => {
  it('allocUnits rounds UP to 2 decimals for meters (never ceil to a whole number)', () => {
    expect(allocUnits(100, 3, 'meters')).toBeCloseTo(33.34, 5);
    expect(allocUnits(90, 3, 'meters')).toBeCloseTo(30, 5);
    // pcs path is untouched: ceil to a whole frame.
    expect(allocUnits(101, 3, 'pcs')).toBe(34);
  });

  it('quantityForUnits = units × sections, rounded to 2dp for meters', () => {
    expect(quantityForUnits(33.34, 3, 'meters')).toBeCloseTo(100.02, 5);
    expect(quantityForUnits(34, 3, 'pcs')).toBe(102);
  });

  it('splitQuantity: last jobsheet absorbs the remainder, 2dp for meters', () => {
    expect(splitQuantity(100, 50, 'meters')).toEqual([50, 50]);
    expect(splitQuantity(33.34, 20, 'meters')).toEqual([20, 13.34]);
    expect(splitQuantity(0, 50, 'meters')).toEqual([]);
  });
});

describe('planJobsheetsMeters (sibling of 7.1)', () => {
  it('300 m, 3 sections → 100 loom m, 50 per jobsheet → 2 × 50', () => {
    const p = planJobsheetsMeters(300, 50, 3)!;
    expect(p.totalLoomMeters).toBe(100);
    expect(p.jobsheetCount).toBe(2);
    expect(p.loomMeters).toEqual([50, 50]);
    expect(p.exactLoomMeters).toBe(100);
  });

  it('a non-multiple splits with the remainder on the last jobsheet', () => {
    const p = planJobsheetsMeters(100, 3, 1)!; // 100 loom m already (sections=1), 3 per sheet
    expect(p.totalLoomMeters).toBe(100);
    expect(p.jobsheetCount).toBe(34);
    expect(p.loomMeters[33]).toBeCloseTo(1, 5);
  });

  it('rejects non-positive inputs', () => {
    expect(planJobsheetsMeters(0, 10)).toBeNull();
    expect(planJobsheetsMeters(100, 0)).toBeNull();
    expect(planJobsheetsMeters(100, 10, 13)).toBeNull();
  });
});

describe('effective / coverage meters', () => {
  it('effectiveMeters: assigned unless Completed with a completedMeters value', () => {
    expect(effectiveMeters({ meters: 50, status: 'completed', completedMeters: 48 })).toBe(48);
    expect(effectiveMeters({ meters: 50, status: 'pending', completedMeters: null })).toBe(50);
    expect(effectiveMeters({ meters: 50, status: 'completed', completedMeters: null })).toBe(50);
  });

  it('coverageMeters sums effective metres, rounded to 2dp', () => {
    const list = [
      { meters: 50.1, status: 'completed' as const, completedMeters: 48.33 },
      { meters: 50, status: 'pending' as const, completedMeters: null },
    ];
    expect(coverageMeters(list)).toBe(98.33);
  });

  it('jobsheetMeters / coverageClothMeters multiply by each jobsheet\'s own sections', () => {
    const j = { meters: 50, status: 'pending' as const, completedMeters: null, sections: 4 };
    expect(jobsheetMeters(j)).toBe(200);
    expect(coverageClothMeters([j, { ...j, sections: 3 }])).toBe(350);
  });
});

describe('planMetersEdit (sibling of 7.4 auto-adjust)', () => {
  it('editing the last Pending jobsheet changes only it', () => {
    const list = metersSheets([50, 50]);
    const plan = planMetersEdit({ jobsheets: list, editedId: 2, newMeters: 70, metersPerJobsheet: 50 });
    expect(plan.editedIsLast).toBe(true);
    expect(plan.updated).toEqual([{ id: 2, jobsheetNo: 2, from: 50, to: 70, edited: true }]);
    expect(plan.created).toEqual([]);
    expect(plan.removed).toEqual([]);
    expect(plan.totalMetersAfter).toBe(120);
  });

  it('editing a non-last jobsheet: the last one absorbs the opposite delta', () => {
    const list = metersSheets([50, 50, 50]);
    const plan = planMetersEdit({ jobsheets: list, editedId: 1, newMeters: 70, metersPerJobsheet: 50 });
    expect(plan.editedIsLast).toBe(false);
    // delta = +20 on jobsheet 1, so the last one (id 3) should drop by 20 → 30.
    expect(plan.updated).toContainEqual({ id: 1, jobsheetNo: 1, from: 50, to: 70, edited: true });
    expect(plan.updated).toContainEqual({ id: 3, jobsheetNo: 3, from: 50, to: 30, edited: false });
    expect(plan.totalMetersAfter).toBe(150);
  });

  it('shrinking the last one below the per-jobsheet cap down to 0 removes it', () => {
    const list = metersSheets([50, 50]);
    // Grow jobsheet 1 by 50 — jobsheet 2 would go to 0 and is removed instead.
    const plan = planMetersEdit({ jobsheets: list, editedId: 1, newMeters: 100, metersPerJobsheet: 50 });
    expect(plan.removed).toEqual([{ id: 2, jobsheetNo: 2, meters: 50 }]);
    expect(plan.totalMetersAfter).toBe(100);
  });

  it('shrinking the edited one so the last exceeds the per-jobsheet cap splits new jobsheets off', () => {
    const list = metersSheets([50, 50]);
    // Shrink jobsheet 1 to 10 m (delta −40), so jobsheet 2 would grow to 90 — over the 50 cap → stays at 50, +1 new.
    const plan = planMetersEdit({ jobsheets: list, editedId: 1, newMeters: 10, metersPerJobsheet: 50 });
    expect(plan.updated).toEqual([{ id: 1, jobsheetNo: 1, from: 50, to: 10, edited: true }]);
    expect(plan.created).toEqual([{ meters: 40 }]);
    expect(plan.totalMetersAfter).toBe(100);
  });

  it('rejects editing a non-Pending jobsheet', () => {
    const list: AdjustMetersJobsheet[] = [{ id: 1, jobsheetNo: 1, meters: 50, status: 'sent' }];
    expect(() => planMetersEdit({ jobsheets: list, editedId: 1, newMeters: 70, metersPerJobsheet: null })).toThrow();
  });

  it('rejects non-positive meters', () => {
    const list = metersSheets([50]);
    expect(() => planMetersEdit({ jobsheets: list, editedId: 1, newMeters: 0, metersPerJobsheet: null })).toThrow();
  });
});

describe('orderJobsheetMetersPlan + coverageWarningsMeters (sibling of 7.5)', () => {
  it('on target: jobsheets cover the order within the 0.05 m slack', () => {
    // 100 m order ÷ 3 sections = 33.34 loom m needed; one jobsheet of exactly that covers it (100.02 cloth m, 0.02 over).
    const plan = orderJobsheetMetersPlan(100, 0, metersSheets([33.34]).map((j) => ({ ...j, sections: 3 })));
    expect(coverageWarningsMeters(plan)).toEqual([]);
  });

  it('short: warns with both a cloth-metres and a loom-metres message', () => {
    const plan = orderJobsheetMetersPlan(300, 0, metersSheets([90]).map((j) => ({ ...j, sections: 3 })));
    // 90 loom m × 3 sections = 270 cloth m < 300 ordered.
    expect(plan.jobsheetClothMeters).toBe(270);
    const warnings = coverageWarningsMeters(plan);
    expect(warnings.map((w) => w.kind)).toEqual(['pieces_less', 'frames_short']);
    expect(warnings[0].message).toBe('Jobsheet quantity (270 m) is less than the order (300 m).');
    expect(warnings[1].message).toBe('Jobsheets cover 90 loom meters, but 100 loom meters are needed (10 short).');
  });

  it('over: warns in the other direction', () => {
    const plan = orderJobsheetMetersPlan(300, 0, metersSheets([110]).map((j) => ({ ...j, sections: 3 })));
    expect(plan.jobsheetClothMeters).toBe(330);
    const warnings = coverageWarningsMeters(plan);
    expect(warnings.map((w) => w.kind)).toEqual(['pieces_more', 'frames_over']);
    expect(warnings[1].message).toBe('Jobsheets cover 110 loom meters, which is 10 more than the 100 needed.');
  });

  it('outside meters are subtracted from what the loom needs to cover', () => {
    const plan = orderJobsheetMetersPlan(300, 100, metersSheets([]));
    expect(plan.neededMeters).toBe(200);
    // ceil(200 / 3, 2dp) = 66.67, not the repeating decimal — allocUnits always rounds UP to 2dp.
    expect(plan.targetLoomMeters).toBe(66.67);
  });

  it('no jobsheets yet: silent (nothing to warn about)', () => {
    expect(coverageWarningsMeters(orderJobsheetMetersPlan(300, 0, []))).toEqual([]);
  });

  it('0.05 m rounding dust stays silent well under the slack, warns once clearly over it', () => {
    const silent = orderJobsheetMetersPlan(100, 0, metersSheets([100.03]).map((j) => ({ ...j, sections: 1 })));
    expect(coverageWarningsMeters(silent)).toEqual([]);
    const warns = orderJobsheetMetersPlan(100, 0, metersSheets([100.1]).map((j) => ({ ...j, sections: 1 })));
    expect(coverageWarningsMeters(warns)).not.toEqual([]);
  });
});

describe('jobsheetQuantityWarningMeters (live preview)', () => {
  it('null when the addition lands within the slack of the order', () => {
    expect(jobsheetQuantityWarningMeters(100, 0, 33.34, 3)).toBeNull();
  });

  it('warns with the exact gap otherwise', () => {
    const msg = jobsheetQuantityWarningMeters(300, 0, 90, 3);
    expect(msg).toBe('This makes the jobsheet quantity 270 m — 30 m less than the order (300 m).');
  });
});

describe('remainingMeters', () => {
  it('the gap left to cover, or null once covered', () => {
    expect(remainingMeters(300, 270)).toBe(30);
    expect(remainingMeters(300, 300)).toBeNull();
    expect(remainingMeters(300, 310)).toBeNull();
  });
});

describe('outsidePoCommittedMeters', () => {
  it('sums open/received meter POs, closed POs count what was received, pcs POs and cancelled ones are ignored', () => {
    const pos = [
      { unit: 'meters', quantity: 100, receivedQty: 100, status: 'received' },
      { unit: 'meters', quantity: 50, receivedQty: 20, status: 'open' },
      { unit: 'meters', quantity: 40, receivedQty: 35.5, status: 'closed' },
      { unit: 'pcs', quantity: 999, receivedQty: 999, status: 'received' },
      { unit: 'meters', quantity: 999, receivedQty: 0, status: 'cancelled' },
    ];
    // open PO counts max(quantity, receivedQty) = 50; closed counts what was received = 35.5.
    expect(outsidePoCommittedMeters(pos)).toBe(185.5);
  });

  it('existing pcs helper is untouched', () => {
    expect(outsidePoCommittedPcs([{ unit: 'pcs', quantity: 120, receivedQty: 120, status: 'received' }])).toBe(120);
  });
});

describe('supervisor dialog helpers (meters)', () => {
  it('nextMetersAfterCompletedChange follows the remainder until touched', () => {
    expect(nextMetersAfterCompletedChange({ assigned: 50, completed: 48, current: 10, touched: false })).toBe(2);
    expect(nextMetersAfterCompletedChange({ assigned: 50, completed: 48, current: 10, touched: true })).toBe(10);
    expect(nextMetersAfterCompletedChange({ assigned: 50, completed: 50, current: 0, touched: false })).toBe(0.01);
  });

  it('completedMetersNote only when different', () => {
    expect(completedMetersNote(50, 50)).toBeNull();
    expect(completedMetersNote(50, 48)).toBe('Assigned 50 m — you\'re recording 48 m (2 m fewer).');
    expect(completedMetersNote(50, 52)).toBe('Assigned 50 m — you\'re recording 52 m (2 m more).');
  });
});
