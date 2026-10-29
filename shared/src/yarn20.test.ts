import { describe, expect, it } from 'vitest';
import {
  availableAfterReserved,
  availableText,
  boxesStayText,
  boxNoKey,
  stopTotals,
  validateStopBox,
} from './yarn';
import { tfoPendingProgramsCreateSchema, tfoProgramStopSchema } from './yarnSchemas';

/** Sprint 20 — lots, boxes, pending programs / jobs (pure rules). */

describe('reservations', () => {
  it('available = balance − reserved, never below 0', () => {
    expect(availableAfterReserved(300_000, 200_000)).toBe(100_000);
    expect(availableAfterReserved(100_000, 150_000)).toBe(0);
  });
  it('picker text shows the reserved part only when there is one', () => {
    expect(availableText(100_000, 0)).toBe('100 kg available');
    expect(availableText(100_000, 200_000)).toBe('100 kg available · reserved 200 kg');
  });
});

describe('pending programs', () => {
  const base = { rawQualityId: 1, rawKg: 10, outputQualityId: 2, tpm: 600, direction: 'SZ' as const };
  it('accepts S + Z and "No lot" (null / missing lot)', () => {
    const r = tfoPendingProgramsCreateSchema.parse({ programs: [base, { ...base, lotId: null }, { ...base, lotId: 5, direction: 'S' }] });
    expect(r.programs.map((p) => p.lotId ?? null)).toEqual([null, null, 5]);
    expect(r.programs[0].direction).toBe('SZ');
  });
  it('needs at least one program', () => {
    expect(tfoPendingProgramsCreateSchema.safeParse({ programs: [] }).success).toBe(false);
  });
});

describe('stop with boxes', () => {
  const box = { boxNo: 'B1', rolls: 10, grossG: 40_000, netG: 38_000, avgG: 3_800, zone: 'tfo' as const };
  it('validates one box', () => {
    expect(validateStopBox(box)).toBeNull();
    expect(validateStopBox({ ...box, boxNo: ' ' })).toBe('box_no');
    expect(validateStopBox({ ...box, rolls: 0 })).toBe('rolls');
    expect(validateStopBox({ ...box, netG: 41_000 })).toBe('net_over_gross');
    expect(validateStopBox({ ...box, avgG: 0 })).toBe('avg');
    expect(validateStopBox(box, ['b1 '])).toBe('box_no_repeat');
    expect(boxNoKey(' B-12 ')).toBe(boxNoKey('b-12'));
  });
  it('totals: boxes, rolls, gross, net (= the TFO output) and how many stay in TFO', () => {
    const t = stopTotals([
      { ...box, zone: 'warping' },
      { ...box, rolls: 12, netG: 37_250, zone: 'direct' },
      { ...box, grossG: 42_000, netG: 40_000, zone: 'tfo' },
    ]);
    expect(t).toEqual({ boxes: 3, rolls: 32, grossG: 122_000, netG: 115_250, stayInTfo: 1 });
  });
  it('"stay in TFO" note', () => {
    expect(boxesStayText(0)).toBeNull();
    expect(boxesStayText(1)).toBe('1 box stays in TFO — move it later with Transfer.');
    expect(boxesStayText(3)).toBe('3 boxes stay in TFO — move them later with Transfer.');
  });
  it('the stop schema rejects repeated box numbers and net > gross; boxes default to Stay in TFO', () => {
    const ok = tfoProgramStopSchema.parse({ warpingQualityId: 1, boxes: [{ boxNo: 'X1', rolls: 1, grossKg: 2, netKg: 1.5, avgKg: 1.5 }] });
    expect(ok.boxes[0].zone).toBe('tfo');
    expect(tfoProgramStopSchema.safeParse({ warpingQualityId: 1, boxes: [{ boxNo: 'X1', rolls: 1, grossKg: 2, netKg: 1, avgKg: 1 }, { boxNo: 'x1', rolls: 1, grossKg: 2, netKg: 1, avgKg: 1 }] }).success).toBe(false);
    expect(tfoProgramStopSchema.safeParse({ warpingQualityId: 1, boxes: [{ boxNo: 'X1', rolls: 1, grossKg: 2, netKg: 3, avgKg: 1 }] }).success).toBe(false);
    expect(tfoProgramStopSchema.safeParse({ warpingQualityId: 1, boxes: [] }).success).toBe(false);
    expect(tfoProgramStopSchema.safeParse({ warpingQualityId: 1, boxes: [], returnedRawKg: 5 }).success).toBe(true);
  });
});
