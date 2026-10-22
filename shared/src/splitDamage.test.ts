import { describe, expect, it } from 'vitest';
import { duplicateMovedDamages, movedDamagePcsCheck, splitDamageLabel, splitPickerOptions, type SplitDamageOption } from './splitDamage';
import { godownSplitSchema } from './schemas';

const opt = (id: number, takaId: number, markedAt: string, openPcs = 2): SplitDamageOption => ({
  id, takaId, takaNo: String(1100 + takaId), foundAt: 'mill', damageName: 'Hole', openPcs, pcs: openPcs, markedAt, recordedAt: 'mill_qc', images: [],
});

describe('split damage picker', () => {
  const list = [opt(1, 5, '2026-10-10T00:00:00Z'), opt(2, 9, '2026-10-12T00:00:00Z'), opt(3, 9, '2026-10-11T00:00:00Z'), opt(4, 7, '2026-10-01T00:00:00Z', 0)];
  it('own taka first, then the others, oldest first; nothing without open pcs', () => {
    expect(splitPickerOptions(list, 9, new Set()).map((o) => o.id)).toEqual([3, 2, 1]);
  });
  it('a damage picked for another part disappears (the part that holds it keeps it)', () => {
    expect(splitPickerOptions(list, 9, new Set([3])).map((o) => o.id)).toEqual([2, 1]);
    expect(splitPickerOptions(list, 9, new Set([3]), 3).map((o) => o.id)).toEqual([3, 2, 1]);
  });
  it('label: type · name · pcs · date · taka', () => {
    expect(splitDamageLabel(opt(1, 1, '2026-10-14T08:00:00Z'))).toBe('Mill damage · Hole · 2 pcs · 14-10-2026 · Taka 1101');
  });
  it('single use across parts', () => {
    expect(duplicateMovedDamages([[1, 2], [3], [2]])).toEqual([2]);
    expect(duplicateMovedDamages([[1], [2]])).toEqual([]);
  });
});

describe('moved damage pcs', () => {
  it('prefilled value is fine, a different value is an amber mismatch, more than the part blocks', () => {
    expect(movedDamagePcsCheck({ originalOpenPcs: 3, entered: 3, partPcs: 10 })).toEqual({ error: null, mismatch: null });
    expect(movedDamagePcsCheck({ originalOpenPcs: 3, entered: 2, partPcs: 10 }).mismatch).toBe('Original damage was 3 pcs — you entered 2.');
    expect(movedDamagePcsCheck({ originalOpenPcs: 3, entered: 11, partPcs: 10 }).error).toMatch(/more than the part's 10/);
    expect(movedDamagePcsCheck({ originalOpenPcs: 3, entered: null, partPcs: 10 }).error).toBeTruthy();
  });
});

describe('split schema accepts moved damages', () => {
  it('fromTakaDamageId + pcs, or a new damage', () => {
    const r = godownSplitSchema.parse({
      parts: [
        { takaNo: '11', pcs: 5, damages: [{ fromTakaDamageId: 7, pcs: 2 }] },
        { takaNo: '11A', pcs: 5, damages: [{ type: 'machine', otherName: 'Cut', pcs: 1, images: [] }] },
      ],
    });
    expect(r.parts[0].damages).toEqual([{ fromTakaDamageId: 7, pcs: 2 }]);
    expect(godownSplitSchema.safeParse({ parts: [{ takaNo: '11', pcs: 5, damages: [{ fromTakaDamageId: 7 }] }, { takaNo: '11A', pcs: 5 }] }).success).toBe(false);
  });
});
