import { describe, expect, it } from 'vitest';
import { framesFromTakaPcs, framesFromTakasText, metersFromTakaMeters } from './jobsheets';
import { FG_TYPES, FG_TYPE_LABEL, isFgType } from './fgTypes';

describe('Sprint 21 — frames from taka entry (CR-05)', () => {
  it('rounds pcs ÷ sections half up', () => {
    expect(framesFromTakaPcs(96, 3)).toBe(32);
    expect(framesFromTakaPcs(97, 3)).toBe(32);
    expect(framesFromTakaPcs(98, 3)).toBe(33);
    expect(framesFromTakaPcs(10, 4)).toBe(3); // 2.5 → 3
    expect(framesFromTakaPcs(0, 3)).toBe(0);
  });
  it('meters ÷ sections with 2 decimals', () => {
    expect(metersFromTakaMeters(1000, 3)).toBe(333.33);
    expect(metersFromTakaMeters(900, 3)).toBe(300);
  });
  it('shows frames with the exact pcs', () => {
    expect(framesFromTakasText(96, 3)).toBe('Frames 32 (96 pcs)');
  });
});

describe('Sprint 21 — FG type (CR-01)', () => {
  it('has exactly Saree and Suit', () => {
    expect([...FG_TYPES]).toEqual(['saree', 'suit']);
    expect(FG_TYPE_LABEL.saree).toBe('Saree');
    expect(isFgType('suit')).toBe(true);
    expect(isFgType('kurti')).toBe(false);
  });
});

import { takaEditableAtEntry, takaLockedAtEntryText } from './takas';
describe('Sprint 21 — Taka entry person edits his own takas (CR-06)', () => {
  it('editable only in the first stage of the route and not free stock', () => {
    expect(takaEditableAtEntry({ stage: 'entered' }, 'entered')).toBe(true);
    expect(takaEditableAtEntry({ stage: 'waiting_mill' }, 'waiting_mill')).toBe(true);
    expect(takaEditableAtEntry({ stage: 'waiting_mill' }, 'entered')).toBe(false); // butta QC already done
    expect(takaEditableAtEntry({ stage: 'at_butta' }, 'entered')).toBe(false);
    expect(takaEditableAtEntry({ stage: 'entered', isFreeStock: true }, 'entered')).toBe(false);
    expect(takaEditableAtEntry({ stage: 'entered', allocatedOrderNo: 12 }, 'entered')).toBe(false);
    expect(takaEditableAtEntry({ stage: 'entered', parentTakaId: 3 }, 'entered')).toBe(false);
  });
  it('locked message names the taka and is bilingual', () => {
    const t = takaLockedAtEntryText('6245', 'at_butta');
    expect(t).toContain('Taka 6245 has already gone to butta cutting');
    expect(t).toContain('टाका 6245');
  });
});

import { orderShrinkage } from './godown';
describe('Sprint 21 — shrinkage (CR-08)', () => {
  it('sums only reductions as shrinkage, increases as gain; takas without metres are left out', () => {
    const s = orderShrinkage([
      { meters: 100, actualMeters: 96.5 },
      { meters: 100, actualMeters: 102 },
      { meters: 50, actualMeters: null },
      { meters: null, actualMeters: 40 },
    ]);
    expect(s.takaCount).toBe(3);
    expect(s.expectedMeters).toBe(250);
    expect(s.actualMeters).toBe(248.5);
    expect(s.shrinkage).toBe(3.5);
    expect(s.gain).toBe(2);
    expect(s.shrinkagePct).toBe(1.4);
  });
  it('is all zero with no takas', () => {
    expect(orderShrinkage([])).toEqual({ takaCount: 0, expectedMeters: 0, actualMeters: 0, shrinkage: 0, gain: 0, shrinkagePct: 0 });
  });
});
