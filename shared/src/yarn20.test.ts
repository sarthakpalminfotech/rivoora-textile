import { describe, expect, it } from 'vitest';
import {
  checkStartRolls,
  withdrawWholeBoxes,
  kindsForFilters,
  MOVE_KIND_LABEL,
  MOVE_KIND_SIGN,
  amountPaise,
  availableAfterReserved,
  boxNetG,
  cleanKgText,
  formatKg,
  gramsToKg,
  hasKgPrecision,
  kgToGrams,
  parseKgText,
  prefillBeamQuality,
  programSectionsLabel,
  rawFromRolls,
  tfoOutputQualityName,
  UNITS_PER_KG,
  validateBeam,
  validateWarpingJob,
  availableText,
  boxNoKey,
  stopTotals,
  validateStopBox,
} from './yarn';
import { switchableRoles } from './auth';
import { can, ROLES } from './roles';
import { tfoPendingProgramsCreateSchema, tfoPendingStartSchema, tfoProgramStopSchema, warpingJobDoneSchema, warpingPendingJobSchema, yarnManualAddSchema, yarnManualRemoveSchema, yarnWithdrawSchema } from './yarnSchemas';

/** Sprint 20 — lots, boxes, pending programs / jobs (pure rules). */

describe('reservations', () => {
  it('available = balance − reserved, never below 0', () => {
    expect(availableAfterReserved(300_000, 200_000)).toBe(100_000);
    expect(availableAfterReserved(100_000, 150_000)).toBe(0);
  });
  it('picker text shows the reserved part only when there is one', () => {
    expect(availableText(1_000_000, 0)).toBe('100 kg available');
    expect(availableText(1_000_000, 2_000_000)).toBe('100 kg available · reserved 200 kg');
  });
});

describe('pending programs', () => {
  const base = { rawQualityId: 1, rolls: 10, windingKg: 1, tpm: 600, direction: 'SZ' as const };
  it('accepts S + Z and "No lot" (null / missing lot)', () => {
    const r = tfoPendingProgramsCreateSchema.parse({ programs: [base, { ...base, lotId: null }, { ...base, lotId: 5, direction: 'S' }] });
    expect(r.programs.map((p) => p.lotId ?? null)).toEqual([null, null, 5]);
    expect(r.programs[0].direction).toBe('SZ');
  });
  it('needs at least one program', () => {
    expect(tfoPendingProgramsCreateSchema.safeParse({ programs: [] }).success).toBe(false);
  });
});

describe('Sprint 20b: TFO rolls, sections, boxes, output quality', () => {
  const kg = (n: number) => n * UNITS_PER_KG;
  it('raw kg = rolls × winding kg', () => {
    expect(rawFromRolls(12, kg(4.2505))).toBe(kg(51.006));
    expect(rawFromRolls(0, kg(4))).toBe(0);
    expect(rawFromRolls(1.5, kg(4))).toBe(0);
  });
  it('net = gross − roll weight × rolls; a box needs net > 0', () => {
    expect(boxNetG(kg(40), kg(0.25), 12)).toBe(kg(37));
    const box = { rolls: 12, grossG: kg(40) };
    expect(validateStopBox(box, kg(0.25))).toBeNull();
    expect(validateStopBox({ ...box, rolls: 0 }, kg(0.25))).toBe('rolls');
    expect(validateStopBox({ ...box, grossG: 0 }, kg(0.25))).toBe('gross');
    expect(validateStopBox({ ...box, grossG: kg(3) }, kg(0.25))).toBe('net');
    expect(validateStopBox(box, kg(0.25), true)).toBe('direction');
    expect(validateStopBox({ ...box, direction: 'Z' }, kg(0.25), true)).toBeNull();
    expect(boxNoKey(' B-12 ')).toBe(boxNoKey('b-12'));
  });
  it('stop totals: boxes, rolls, gross, net (= the TFO output)', () => {
    const t = stopTotals(
      [
        { rolls: 12, grossG: kg(40) },
        { rolls: 10, grossG: kg(38.5) },
      ],
      kg(0.25),
    );
    expect(t).toEqual({ boxes: 2, rolls: 22, grossG: kg(78.5), netG: kg(73) });
  });
  it('output quality name: "denier/filament RawQuality-TPM-Dir"', () => {
    expect(tfoOutputQualityName({ denierFilament: '75/36', rawQualityName: 'Poly 75D', tpm: 600, direction: 'S' })).toBe('75/36 Poly 75D-600-S');
    expect(tfoOutputQualityName({ denierFilament: null, rawQualityName: 'Poly 75D', tpm: 612.5, direction: 'Z' })).toBe('Poly 75D-612.5-Z');
  });
  it('sections label', () => {
    expect(programSectionsLabel([{ machineNo: 5, section: 'A' }, { machineNo: 3, section: 'B' }, { machineNo: 3, section: 'A' }])).toBe('3A, 3B, 5A');
  });
  it('schemas: start takes several sections (not twice the same); stop boxes have no number / zone, avg optional', () => {
    expect(tfoPendingStartSchema.safeParse({ sections: [{ machineId: 1, section: 'A' }, { machineId: 1, section: 'B' }, { machineId: 2, section: 'A' }] }).success).toBe(true);
    expect(tfoPendingStartSchema.safeParse({ sections: [{ machineId: 1, section: 'A' }, { machineId: 1, section: 'A' }] }).success).toBe(false);
    expect(tfoPendingStartSchema.safeParse({ sections: [] }).success).toBe(false);
    const ok = tfoProgramStopSchema.parse({ rollWeightKg: 0.25, boxes: [{ rolls: 12, grossKg: 40.1234 }] });
    expect(ok.boxes[0].avgKg).toBeNull();
    expect(tfoProgramStopSchema.safeParse({ rollWeightKg: 1, boxes: [{ rolls: 12, grossKg: 10 }] }).success).toBe(false);
    expect(tfoProgramStopSchema.safeParse({ rollWeightKg: 0.25, boxes: [] }).success).toBe(false);
    expect(tfoProgramStopSchema.safeParse({ rollWeightKg: 0.25, boxes: [], returnedRawKg: 5 }).success).toBe(true);
    expect(tfoPendingProgramsCreateSchema.safeParse({ programs: [{ rawQualityId: 1, rolls: 12, windingKg: 4.2505, tpm: 600, direction: 'S' }] }).success).toBe(true);
  });
});

describe('Sprint 20b: 4 decimals of kg', () => {
  it('kg ↔ units (1 kg = 10,000)', () => {
    expect(kgToGrams(1.2345)).toBe(12_345);
    expect(gramsToKg(12_345)).toBe(1.2345);
    expect(parseKgText('12.5')).toBe(125_000);
    expect(parseKgText('.2505')).toBe(2_505);
    expect(parseKgText('1.23456')).toBeNull();
    expect(cleanKgText('1.234567')).toBe('1.2345');
    expect(formatKg(12_345)).toBe('1.2345 kg');
    expect(hasKgPrecision(1.2345)).toBe(true);
    expect(hasKgPrecision(1.23456)).toBe(false);
  });
  it('amount = units × paise per kg ÷ 10,000', () => {
    expect(amountPaise(kgToGrams(100), 25_000)).toBe(2_500_000);
    expect(amountPaise(kgToGrams(0.0001), 25_000)).toBe(3);
  });
});

describe('warping: pending jobs and beams', () => {
  it('meters OR Full meter', () => {
    expect(validateWarpingJob({ taar: 4800, panna: 52, meters: null, fullMeter: true, inputs: 1 })).toBeNull();
    expect(validateWarpingJob({ taar: 4800, panna: 52, meters: null, fullMeter: false, inputs: 1 })).toBe('meters');
    expect(validateWarpingJob({ taar: 4800, panna: 52, meters: 1200, fullMeter: false, inputs: 0 })).toBe('no_inputs');
    expect(validateWarpingJob({ taar: 1.5, panna: 52, meters: 1200, fullMeter: false, inputs: 1 })).toBe('taar');
  });
  it('inputs from lots and boxes; Full meter clears the meters; a box only once', () => {
    const base = { taar: 4800, panna: 52, fullMeter: true, meters: 999 };
    const ok = warpingPendingJobSchema.parse({
      ...base,
      inputs: [
        { kind: 'raw', qualityId: 1, lotId: 3, qtyKg: 40 },
        { kind: 'raw', qualityId: 1, qtyKg: 5 },
        { kind: 'box', boxId: 9, qtyKg: 12.5 },
        { kind: 'no_box', warpingQualityId: 2, qtyKg: 1 },
        { kind: 'no_box', qualityId: 4, qtyKg: 1 },
      ],
    });
    expect(ok.meters).toBeNull();
    expect(warpingPendingJobSchema.safeParse({ ...base, inputs: [{ kind: 'box', boxId: 9, qtyKg: 1 }, { kind: 'box', boxId: 9, qtyKg: 1 }] }).success).toBe(false);
    expect(warpingPendingJobSchema.safeParse({ ...base, inputs: [{ kind: 'no_box', qtyKg: 1 }] }).success).toBe(false);
    expect(warpingPendingJobSchema.safeParse({ taar: 1, panna: 1, inputs: [{ kind: 'raw', qualityId: 1, qtyKg: 1 }] }).success).toBe(false);
  });
  it('beam quality is pre-filled only when the twisted inputs have exactly one warping quality', () => {
    expect(prefillBeamQuality([{ warpingQualityId: 7 }, { warpingQualityId: null }, { warpingQualityId: 7 }])).toBe(7);
    expect(prefillBeamQuality([{ warpingQualityId: 7 }, { warpingQualityId: 8 }])).toBeNull();
    expect(prefillBeamQuality([{ warpingQualityId: null }])).toBeNull();
  });
  it('Sprint 20c: Mark done takes no beam no. / zone (auto numbers, kept in Warping) and an optional remark', () => {
    const b = { taar: 1, panna: 1, meters: 1, warpingQualityId: 1 };
    expect(validateBeam(b)).toBeNull();
    const parsed = warpingJobDoneSchema.parse({ beams: [{ ...b, beamCode: 'X', zone: 'direct', remark: '  knot at 200 m ' }, b] });
    expect(parsed.beams[0]).toEqual({ ...b, remark: 'knot at 200 m' });
    expect(parsed.beams[1].remark).toBeNull();
  });
});

describe('Sprint 20 roles', () => {
  const YARN_PERMS = ['canViewYarn', 'canReceiveYarn', 'canUseYarnInventory', 'canPlanYarn', 'canManageYarnPo', 'canManageYarnMasters'] as const;
  const yarnRights = (role: Parameters<typeof can>[0]) => YARN_PERMS.filter((p) => can(role, p));
  it('Yarn inventory supervisor: the yarn floor only, landing /yarn, English', () => {
    expect(yarnRights('yarn_supervisor')).toEqual(['canViewYarn', 'canReceiveYarn', 'canUseYarnInventory']);
    expect(ROLES.yarn_supervisor.landing).toBe('/yarn');
    expect(ROLES.yarn_supervisor.bilingual).toBeFalsy();
    const others = (Object.keys(ROLES.yarn_supervisor.permissions) as (keyof typeof ROLES.yarn_supervisor.permissions)[]).filter(
      (p) => ROLES.yarn_supervisor.permissions[p] && !YARN_PERMS.includes(p as (typeof YARN_PERMS)[number]),
    );
    expect(others).toEqual([]);
    expect(can('yarn_supervisor', 'canSeeRate')).toBe(false);
  });
  it('production supervisor = the same yarn rights; godown supervisor = none; owners plan too', () => {
    expect(yarnRights('supervisor')).toEqual(yarnRights('yarn_supervisor'));
    expect(yarnRights('godown_supervisor')).toEqual([]);
    expect(yarnRights('jemish')).toEqual([...YARN_PERMS]);
    expect(yarnRights('gaurang')).toEqual([...YARN_PERMS]);
  });
  it('the owners can act as the new role', () => {
    expect(switchableRoles('jemish')).toContain('yarn_supervisor');
  });
});

describe('manual add / remove', () => {
  it('kinds, signs and the Manual movement filter', () => {
    expect(MOVE_KIND_SIGN.manual_add).toBe(1);
    expect(MOVE_KIND_SIGN.manual_remove).toBe(-1);
    expect(MOVE_KIND_LABEL.manual_add).toBe('Added manually');
    expect(MOVE_KIND_LABEL.removed).toBe('Removed manually');
    expect(kindsForFilters(['manual'])).toEqual(['manual_add', 'manual_remove', 'removed']);
  });
  it('add: raw needs a yarn quality, twisted a warping quality; remark optional', () => {
    expect(yarnManualAddSchema.safeParse({ zone: 'direct', item: 'raw', qualityId: 1, qtyKg: 5 }).success).toBe(true);
    expect(yarnManualAddSchema.safeParse({ zone: 'tfo', item: 'twisted', qualityId: 1, qtyKg: 5 }).success).toBe(false);
    expect(yarnManualAddSchema.safeParse({ zone: 'tfo', item: 'twisted', warpingQualityId: 2, qtyKg: 5 }).success).toBe(true);
  });
  it('remove: the remark is required; beams only from beam zones', () => {
    expect(yarnManualRemoveSchema.safeParse({ what: 'raw', zone: 'direct', qualityId: 1, qtyKg: 1 }).success).toBe(false);
    expect(yarnManualRemoveSchema.safeParse({ what: 'raw', zone: 'direct', qualityId: 1, qtyKg: 1, remark: '  ' }).success).toBe(false);
    expect(yarnManualRemoveSchema.safeParse({ what: 'raw', zone: 'direct', qualityId: 1, lotId: null, qtyKg: 1, remark: 'wet' }).success).toBe(true);
    expect(yarnManualRemoveSchema.safeParse({ what: 'beams', zone: 'tfo', beamIds: [1], remark: 'x' }).success).toBe(false);
    expect(yarnManualRemoveSchema.safeParse({ what: 'twisted', zone: 'direct', boxes: [{ boxId: 1, qtyKg: 0.5 }], remark: 'x' }).success).toBe(true);
    expect(yarnManualRemoveSchema.safeParse({ what: 'twisted', zone: 'direct', boxes: [], remark: 'x' }).success).toBe(false);
  });
  it('only the owners may adjust', () => {
    expect(can('jemish', 'canAdjustYarnStock') && can('gaurang', 'canAdjustYarnStock')).toBe(true);
    expect(can('yarn_supervisor', 'canAdjustYarnStock') || can('supervisor', 'canAdjustYarnStock')).toBe(false);
  });
});

describe('Sprint 20c', () => {
  it('part of a pending program can start (whole rolls, not more than it has; older programs without rolls start whole)', () => {
    expect(checkStartRolls(10, null)).toBeNull();
    expect(checkStartRolls(10, 4)).toBeNull();
    expect(checkStartRolls(10, 10)).toBeNull();
    expect(checkStartRolls(10, 11)).toBe('too_many');
    expect(checkStartRolls(10, 0)).toBe('whole');
    expect(checkStartRolls(10, 2.5)).toBe('whole');
    expect(checkStartRolls(null, 3)).toBe('no_rolls');
    expect(tfoPendingStartSchema.parse({ sections: [{ machineId: 1, section: 'A' }] }).rolls).toBeNull();
    expect(tfoPendingStartSchema.parse({ sections: [{ machineId: 1, section: 'A' }], rolls: 4 }).rolls).toBe(4);
  });
  // Sprint 24 (CR-17) supersedes: Withdraw is in every zone (Warping too, beams in Direct + Warping) and needs a purpose.
  it('withdraw works in TFO (raw + whole boxes); beams only where beams are kept', () => {
    expect(withdrawWholeBoxes('tfo')).toBe(true);
    expect(withdrawWholeBoxes('direct')).toBe(false);
    const why = { purpose: 'in_house' as const };
    const box = yarnWithdrawSchema.parse({ what: 'twisted', zone: 'tfo', boxes: [{ boxId: 3 }], ...why });
    expect(box.what === 'twisted' && box.boxes[0].qtyKg).toBeNull();
    expect(yarnWithdrawSchema.safeParse({ what: 'raw', zone: 'tfo', qualityId: 1, lotId: null, qtyKg: 2, ...why }).success).toBe(true);
    expect(yarnWithdrawSchema.safeParse({ what: 'raw', zone: 'warping', qualityId: 1, lotId: null, qtyKg: 2, ...why }).success).toBe(true);
    expect(yarnWithdrawSchema.safeParse({ what: 'beams', zone: 'tfo', beamIds: [1], ...why }).success).toBe(false);
  });
});
