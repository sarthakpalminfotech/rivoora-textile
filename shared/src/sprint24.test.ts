import { describe, expect, it } from 'vitest';
import {
  boxGroupKey,
  boxNoWithFy,
  checkHoldRolls,
  holdRollsText,
  lotQualityClashText,
  paltiTotals,
  partRollsLimit,
  tfoProgramLabel,
  UNITS_PER_KG,
  warpingFormulaText,
  warpingKgUsed,
  warpingLeftover,
  withdrawWholeBoxes,
} from './yarn';
import { paltiCreateSchema, tfoProgramHoldSchema, yarnWithdrawSchema } from './yarnSchemas';

const KG = UNITS_PER_KG;

describe('Sprint 24 · CR-24 warping leftover', () => {
  // 1,000 m × 75 denier × 2,400 taar ÷ 9,000,000 = 20 kg used.
  const base = { meters: 1000, denier: 75, taar: 2400, issuedG: 26.5 * KG };

  it('kg used = meters × denier × taar ÷ 9,000,000', () => {
    expect(warpingKgUsed(1000, 75, 2400)).toBe(20);
    expect(warpingFormulaText(1000, 75, 2400)).toContain('= 20 kg');
  });

  it('two programs: half and half over the LAST two (latest stop first; the odd unit to the latest)', () => {
    const r = warpingLeftover({
      ...base,
      issuedG: 26.5 * KG + 1,
      programs: [
        { id: 10, stoppedAt: '2026-11-01T10:00:00Z' },
        { id: 12, stoppedAt: '2026-11-05T10:00:00Z' },
        { id: 11, stoppedAt: '2026-11-03T10:00:00Z' },
        { id: 12, stoppedAt: '2026-11-05T10:00:00Z' },
      ],
      inputs: [{ g: 10 * KG }, { g: 16.5 * KG }],
    });
    expect(r.usedG).toBe(20 * KG);
    expect(r.remainingG).toBe(6.5 * KG + 1);
    expect(r.splits).toEqual([
      { kind: 'program', programId: 12, g: 3.25 * KG + 1 },
      { kind: 'program', programId: 11, g: 3.25 * KG },
    ]);
  });

  it('one program gets all of it', () => {
    const r = warpingLeftover({ ...base, programs: [{ id: 7, stoppedAt: '2026-11-01T00:00:00Z' }], inputs: [{ g: 26.5 * KG }] });
    expect(r.splits).toEqual([{ kind: 'program', programId: 7, g: 6.5 * KG }]);
  });

  it('raw only (no program): back to the inputs by their kg, rounding to the last', () => {
    const r = warpingLeftover({ ...base, issuedG: 30 * KG, programs: [], inputs: [{ g: 10 * KG }, { g: 20 * KG }] });
    expect(r.remainingG).toBe(10 * KG);
    expect(r.splits.reduce((s, x) => s + x.g, 0)).toBe(10 * KG);
    expect(r.splits[0]).toEqual({ kind: 'input', index: 0, g: Math.floor((10 * KG) / 3) });
    expect(r.splits[1].kind === 'input' && r.splits[1].index).toBe(1);
  });

  it('used more than issued: remaining 0, over shown, nothing goes back', () => {
    const r = warpingLeftover({ ...base, issuedG: 18 * KG, programs: [{ id: 1, stoppedAt: null }], inputs: [{ g: 18 * KG }] });
    expect(r.remainingG).toBe(0);
    expect(r.overG).toBe(2 * KG);
    expect(r.splits).toEqual([]);
  });
});

describe('Sprint 24 · CR-20 hold rolls', () => {
  it('made + left must equal the rolls started, made ≥ already boxed', () => {
    expect(checkHoldRolls({ started: 12, done: 0, made: 6, left: 6 })).toBeNull();
    expect(checkHoldRolls({ started: 12, done: 0, made: 6, left: 5 })).toBe('sum');
    expect(checkHoldRolls({ started: 12, done: 8, made: 6, left: 6 })).toBe('below_done');
    expect(checkHoldRolls({ started: 12, done: 0, made: 1.5, left: 10.5 })).toBe('whole');
  });
  it('the made part can box up to made − boxed (On hold) or started − boxed (Running)', () => {
    expect(partRollsLimit({ status: 'on_hold', rolls: 12, rollsMade: 6, rollsDone: 2 })).toBe(4);
    expect(partRollsLimit({ status: 'running', rolls: 12, rollsMade: 6, rollsDone: 2 })).toBe(10);
    expect(partRollsLimit({ status: 'running', rolls: null, rollsMade: null, rollsDone: 0 })).toBeNull();
    expect(holdRollsText({ rolls: 12, rollsMade: 6 })).toBe('6 / 12 rolls made · 6 left');
  });
  it('the hold schema keeps an optional reason of 3–300 characters', () => {
    expect(tfoProgramHoldSchema.safeParse({ rollsMade: 6, rollsLeft: 6, reason: 'ok' }).success).toBe(false);
    expect(tfoProgramHoldSchema.parse({ rollsMade: 6, rollsLeft: 6, reason: '  ' }).reason).toBeNull();
  });
});

describe('Sprint 24 · CR-17 withdraw purpose', () => {
  const raw = { what: 'raw', zone: 'warping', qualityId: 1, lotId: null, qtyKg: 2 } as const;
  it('every zone; Sell needs a party, rate optional; in-house drops party / rate', () => {
    expect(withdrawWholeBoxes('warping')).toBe(true);
    expect(yarnWithdrawSchema.safeParse(raw).success).toBe(false);
    expect(yarnWithdrawSchema.safeParse({ ...raw, purpose: 'sell' }).success).toBe(false);
    const sell = yarnWithdrawSchema.parse({ ...raw, purpose: 'sell', partyName: 'Ramesh', rate: 120.5 });
    expect(sell.partyName).toBe('Ramesh');
    expect(sell.rate).toBe(120.5);
    const own = yarnWithdrawSchema.parse({ ...raw, purpose: 'in_house', partyName: 'x', rate: 5 });
    expect(own.partyName).toBeNull();
    expect(own.rate).toBeNull();
    expect(yarnWithdrawSchema.safeParse({ what: 'beams', zone: 'warping', beamIds: [1], purpose: 'in_house' }).success).toBe(true);
  });
});

describe('Sprint 24 · boxes', () => {
  it('box numbers show the FY in brackets', () => {
    expect(boxNoWithFy('15', '2026-27')).toBe('15 (26-27)');
    expect(boxNoWithFy('15', null)).toBe('15');
  });
  it('pickers group by program; Palti boxes under Palti; P-12 labels', () => {
    expect(boxGroupKey({ kind: 'tfo', programId: 12 })).toBe('p-12');
    expect(boxGroupKey({ kind: 'remaining', programId: 12 })).toBe('p-12');
    expect(boxGroupKey({ kind: 'palti', programId: 1 })).toBe('palti');
    expect(tfoProgramLabel(12)).toBe('P-12');
  });
  it('CR-16: the quality clash text names the lot and its quality', () => {
    expect(lotQualityClashText('245', '75D Poly')).toBe('Lot 245 of this party is 75D Poly — check the quality or the lot number');
  });
});

describe('Sprint 24 · CR-25 Palti', () => {
  it('waste = inputs − net; net may not be more than the inputs', () => {
    expect(paltiTotals([4 * KG, 6 * KG], 9.5 * KG)).toEqual({ inputG: 10 * KG, wasteG: 0.5 * KG, overG: 0 });
    expect(paltiTotals([4 * KG], 5 * KG).overG).toBe(1 * KG);
  });
  it('the Palti body needs inputs and a net kg', () => {
    const ok = paltiCreateSchema.safeParse({
      date: '2026-11-12',
      inputs: [{ zone: 'warping', kind: 'box', boxId: 3, qtyKg: 2 }],
      output: { warpingQualityId: 1, netKg: 2, zone: 'tfo' },
    });
    expect(ok.success).toBe(true);
    expect(paltiCreateSchema.safeParse({ date: '2026-11-12', inputs: [], output: { warpingQualityId: 1, netKg: 2, zone: 'tfo' } }).success).toBe(false);
  });
});
