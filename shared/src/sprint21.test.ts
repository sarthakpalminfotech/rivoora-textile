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
