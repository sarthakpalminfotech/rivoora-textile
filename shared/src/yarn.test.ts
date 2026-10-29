import { describe, expect, it } from 'vitest';
import {
  amountPaise,
  balanceKey,
  balancesFromMoves,
  beamAvailableIn,
  beamsByZone,
  canMoveBeams,
  checkTake,
  cleanKgText,
  duplicateQualityIndex,
  formatKg,
  gramsToKg,
  hasKgPrecision,
  kgToGrams,
  kindsForFilters,
  MOVE_KIND_SIGN,
  notEnoughText,
  overReceiptLines,
  overReceiptText,
  parseKgText,
  programResultLine,
  ratePaise,
  receiptHasQuantity,
  runningSectionsText,
  tfoSectionLabel,
  transferTargets,
  validateBeam,
  validateProgramIssue,
  validateProgramStop,
  validateTransfer,
  validateWarpingInputs,
  validateWithdraw,
  warpingInputsSummary,
  yarnPoCanCancel,
  yarnPoCanClose,
  yarnPoCanEditAll,
  yarnPoCanReceive,
  yarnPoLineFigures,
  yarnPoStatusFor,
  yarnPoTotals,
  zoneTotals,
  type StockMoveLike,
} from './yarn';
import { tfoProgramStopSchema, yarnPoInputSchema, yarnReceiptInputSchema, yarnTransferSchema, yarnWithdrawSchema } from './yarnSchemas';

const move = (zone: StockMoveLike['zone'], item: StockMoveLike['item'], qualityId: number, qtyG: number): StockMoveLike => ({ zone, item, qualityId, qtyG });

describe('kg rounding', () => {
  it('converts kg to whole grams without float drift', () => {
    expect(kgToGrams(1.005)).toBe(1005);
    expect(kgToGrams(0.1 + 0.2)).toBe(300);
    expect(kgToGrams(12.345)).toBe(12345);
    expect(kgToGrams(-2.5)).toBe(-2500);
    expect(gramsToKg(12345)).toBe(12.345);
  });

  it('sums many small receipts exactly', () => {
    const g = Array.from({ length: 1000 }, () => kgToGrams(0.1)).reduce((s, v) => s + v, 0);
    expect(g).toBe(100_000);
    expect(formatKg(g)).toBe('100 kg');
  });

  it('accepts at most 3 decimals', () => {
    expect(hasKgPrecision(1.234)).toBe(true);
    expect(hasKgPrecision(1.2345)).toBe(false);
    expect(parseKgText('12.5')).toBe(12500);
    expect(parseKgText('.250')).toBe(250);
    expect(parseKgText('12.')).toBe(12000);
    expect(parseKgText('1.2345')).toBeNull();
    expect(parseKgText('abc')).toBeNull();
    expect(parseKgText('')).toBeNull();
    expect(cleanKgText('1,25.1239kg')).toBe('1.251');
  });

  it('formats kg the Indian way', () => {
    expect(formatKg(1_234_567_500)).toBe('12,34,567.5 kg');
  });
});

describe('amounts', () => {
  it('rate in paise × grams, rounded to the paisa', () => {
    expect(ratePaise(245.5)).toBe(24550);
    expect(ratePaise(0.29)).toBe(29);
    expect(amountPaise(kgToGrams(100), ratePaise(245.5))).toBe(2_455_000);
    expect(amountPaise(kgToGrams(1.333), ratePaise(10))).toBe(1333);
    expect(amountPaise(kgToGrams(0.005), ratePaise(1))).toBe(1); // 0.5 paisa rounds up
  });

  it('PO totals add up the lines', () => {
    const t = yarnPoTotals([
      { qtyG: 100_000, ratePaise: 20_000, receivedG: 40_000 },
      { qtyG: 50_500, ratePaise: 31_050, receivedG: 0 },
    ]);
    expect(t.orderedG).toBe(150_500);
    expect(t.receivedG).toBe(40_000);
    expect(t.pendingG).toBe(110_500);
    expect(t.amountPaise).toBe(2_000_000 + amountPaise(50_500, 31_050));
  });
});

describe('ledger balances', () => {
  const moves = [
    move('direct', 'raw', 1, 100_000),
    move('direct', 'raw', 1, -30_000),
    move('tfo', 'raw', 1, 30_000),
    move('tfo', 'raw', 1, -25_000),
    move('tfo', 'twisted', 1, 24_200),
    move('direct', 'raw', 2, 5_000),
  ];

  it('balance = sum of signed moves per zone + item + quality', () => {
    const b = balancesFromMoves(moves);
    expect(b.get(balanceKey('direct', 'raw', 1))).toBe(70_000);
    expect(b.get(balanceKey('tfo', 'raw', 1))).toBe(5_000);
    expect(b.get(balanceKey('tfo', 'twisted', 1))).toBe(24_200);
    expect(b.get(balanceKey('warping', 'raw', 1))).toBeUndefined();
  });

  it('zone totals', () => {
    expect(zoneTotals(moves, 'direct')).toEqual({ rawG: 75_000, twistedG: 0 });
    expect(zoneTotals(moves)).toEqual({ rawG: 80_000, twistedG: 24_200 });
  });

  it('every kind has one sign', () => {
    expect(MOVE_KIND_SIGN.receipt).toBe(1);
    expect(MOVE_KIND_SIGN.transfer_out).toBe(-1);
    expect(MOVE_KIND_SIGN.tfo_issue).toBe(-1);
    expect(MOVE_KIND_SIGN.tfo_output).toBe(1);
    expect(MOVE_KIND_SIGN.tfo_return).toBe(1);
    expect(MOVE_KIND_SIGN.warping_issue).toBe(-1);
  });

  it('movement filters map to ledger kinds', () => {
    expect(kindsForFilters(['tfo'])).toEqual(['tfo_issue', 'tfo_output', 'tfo_return']);
    expect(kindsForFilters(['withdraw', 'warping'])).toEqual(['withdraw', 'consumed', 'warping_issue', 'beam_created']);
  });
});

describe('no negative stock', () => {
  it('a take can never exceed the balance', () => {
    expect(checkTake(10_000, 10_000)).toBeNull();
    expect(checkTake(10_000, 10_001)).toBe('not_enough');
    expect(checkTake(0, 1)).toBe('not_enough');
    expect(checkTake(10_000, 0)).toBe('zero');
    expect(checkTake(10_000, -5)).toBe('zero');
    expect(notEnoughText({ availableG: 12_500, item: 'raw', qualityName: '75D', zone: 'tfo' })).toBe('Only 12.5 kg of raw yarn 75D in TFO');
  });

  it('transfer', () => {
    expect(validateTransfer({ from: 'direct', to: 'tfo', what: 'raw', availableG: 5_000, qtyG: 5_000 })).toBeNull();
    expect(validateTransfer({ from: 'direct', to: 'tfo', what: 'raw', availableG: 5_000, qtyG: 5_001 })).toBe('not_enough');
    expect(validateTransfer({ from: 'tfo', to: 'tfo', what: 'twisted', availableG: 5_000, qtyG: 1 })).toBe('same_zone');
  });

  it('withdraw', () => {
    expect(validateWithdraw({ zone: 'direct', what: 'twisted', availableG: 1_000, qtyG: 1_000 })).toBeNull();
    expect(validateWithdraw({ zone: 'direct', what: 'twisted', availableG: 999, qtyG: 1_000 })).toBe('not_enough');
  });

  it('TFO issue', () => {
    expect(validateProgramIssue({ sectionBusy: false, availableG: 50_000, rawG: 50_000, tpm: 600 })).toBeNull();
    expect(validateProgramIssue({ sectionBusy: false, availableG: 49_999, rawG: 50_000, tpm: 600 })).toBe('not_enough');
    expect(validateProgramIssue({ sectionBusy: true, availableG: 50_000, rawG: 1, tpm: 600 })).toBe('busy');
    expect(validateProgramIssue({ sectionBusy: false, availableG: 50_000, rawG: 1, tpm: 0 })).toBe('tpm');
  });

  it('warping issue adds up rows of the same quality', () => {
    const avail = (item: string, q: number) => (item === 'raw' && q === 1 ? 10_000 : item === 'twisted' && q === 1 ? 4_000 : 0);
    expect(validateWarpingInputs([{ item: 'raw', qualityId: 1, qtyG: 6_000 }, { item: 'twisted', qualityId: 1, qtyG: 4_000 }], avail)).toBeNull();
    expect(validateWarpingInputs([{ item: 'raw', qualityId: 1, qtyG: 6_000 }, { item: 'raw', qualityId: 1, qtyG: 4_001 }], avail)).toEqual({ index: 1, error: 'not_enough' });
    expect(validateWarpingInputs([{ item: 'raw', qualityId: 2, qtyG: 1 }], avail)).toEqual({ index: 0, error: 'not_enough' });
    expect(validateWarpingInputs([], avail)).toEqual({ index: -1, error: 'none' });
    expect(warpingInputsSummary([{ item: 'raw', qtyG: 6_000 }, { item: 'twisted', qtyG: 4_000 }])).toBe('Raw 6 kg · Twisted 4 kg');
  });
});

describe('TFO programs', () => {
  it('labels sections 1A / 1B', () => {
    expect(tfoSectionLabel(3, 'A')).toBe('3A');
    expect(runningSectionsText(3, 5)).toBe('3 of 10 running');
  });

  it('stop: twisted may differ from raw; returned raw ≤ issued', () => {
    expect(validateProgramStop({ rawG: 50_000, twistedG: 48_200, returnedG: 1_000 })).toBeNull();
    expect(validateProgramStop({ rawG: 50_000, twistedG: 51_000, returnedG: 0 })).toBeNull();
    expect(validateProgramStop({ rawG: 50_000, twistedG: 10_000, returnedG: 50_001 })).toBe('returned_too_much');
    expect(validateProgramStop({ rawG: 50_000, twistedG: 0, returnedG: 0 })).toBe('nothing');
    expect(validateProgramStop({ rawG: 50_000, twistedG: 0, returnedG: 50_000 })).toBeNull();
    expect(programResultLine({ rawG: 50_000, twistedG: 48_200, returnedG: 1_000 })).toBe('Raw 50 kg → twisted 48.2 kg · returned 1 kg');
  });

  it('issue then stop with a returned raw kg balances the TFO zone', () => {
    const moves = [
      move('tfo', 'raw', 1, 60_000), // transfer in
      move('tfo', 'raw', 1, -50_000), // tfo_issue
      move('tfo', 'twisted', 2, 48_200), // tfo_output (output quality 2)
      move('tfo', 'raw', 1, 1_000), // tfo_return
    ];
    const b = balancesFromMoves(moves);
    expect(b.get(balanceKey('tfo', 'raw', 1))).toBe(11_000);
    expect(b.get(balanceKey('tfo', 'twisted', 2))).toBe(48_200);
  });

  it('stop schema (Sprint 20 boxes): returned is optional, kg keep 3 decimals', () => {
    const box = { boxNo: 'B1', rolls: 4, grossKg: 50, netKg: 48.2, avgKg: 12.05 };
    expect(tfoProgramStopSchema.parse({ warpingQualityId: 1, boxes: [box] }).returnedRawKg).toBe(0);
    expect(() => tfoProgramStopSchema.parse({ warpingQualityId: 1, boxes: [{ ...box, netKg: 1.2345 }] })).toThrow();
  });
});

describe('beams', () => {
  it('move only between Direct consumption and Warping', () => {
    expect(canMoveBeams('direct', 'warping')).toBe(true);
    expect(canMoveBeams('warping', 'direct')).toBe(true);
    expect(canMoveBeams('direct', 'tfo')).toBe(false);
    expect(canMoveBeams('tfo', 'warping')).toBe(false);
    expect(transferTargets('direct', 'beams')).toEqual(['warping']);
    expect(transferTargets('direct', 'raw')).toEqual(['tfo', 'warping']);
    expect(validateTransfer({ from: 'warping', to: 'tfo', what: 'beams', beamIds: [1] })).toBe('beams_zone');
    expect(validateTransfer({ from: 'warping', to: 'direct', what: 'beams', beamIds: [] })).toBe('no_beams');
    expect(validateTransfer({ from: 'warping', to: 'direct', what: 'beams', beamIds: [1, 2], beamsInZone: new Set([1]) })).toBe('beam_not_here');
    expect(validateTransfer({ from: 'warping', to: 'direct', what: 'beams', beamIds: [1], beamsInZone: new Set([1]) })).toBeNull();
    expect(yarnTransferSchema.safeParse({ what: 'beams', from: 'tfo', to: 'direct', beamIds: [1] }).success).toBe(false);
  });

  it('consume: only an in-stock beam of the zone', () => {
    expect(beamAvailableIn({ status: 'in_stock', zone: 'direct' }, 'direct')).toBe(true);
    expect(beamAvailableIn({ status: 'consumed', zone: 'direct' }, 'direct')).toBe(false);
    expect(beamAvailableIn({ status: 'in_stock', zone: 'warping' }, 'direct')).toBe(false);
    expect(validateWithdraw({ zone: 'direct', what: 'beams', beamIds: [4], beamsInZone: new Set([4]) })).toBeNull();
    expect(validateWithdraw({ zone: 'tfo', what: 'beams', beamIds: [4] })).toBe('beams_zone');
    expect(yarnWithdrawSchema.safeParse({ what: 'beams', zone: 'warping', beamIds: [4] }).success).toBe(false);
  });

  it('a warping job → several beams in different zones', () => {
    const out = [
      { beamCode: 'B-1', taar: 4800, panna: 52, meters: 1200, warpingQualityId: 1, zone: 'direct' },
      { beamCode: 'B-2', taar: 4800, panna: 52, meters: 1150.5, warpingQualityId: 1, zone: 'warping' },
    ];
    expect(out.map((b) => validateBeam(b))).toEqual([null, null]);
    expect(beamsByZone(out)).toEqual({ direct: 1, warping: 1 });
    expect(validateBeam({ ...out[0], taar: 10.5 })).toBe('taar');
    expect(validateBeam({ ...out[0], zone: 'tfo' })).toBe('zone');
    expect(validateBeam({ ...out[0], meters: 0 })).toBe('meters');
  });
});

describe('Yarn PO', () => {
  it('statuses follow partial receipts', () => {
    expect(yarnPoStatusFor({ status: 'open', orderedG: 100_000, receivedG: 0 })).toBe('open');
    expect(yarnPoStatusFor({ status: 'open', orderedG: 100_000, receivedG: 40_000 })).toBe('partly_received');
    expect(yarnPoStatusFor({ status: 'partly_received', orderedG: 100_000, receivedG: 100_000 })).toBe('received');
    expect(yarnPoStatusFor({ status: 'partly_received', orderedG: 100_000, receivedG: 120_000 })).toBe('received');
    expect(yarnPoStatusFor({ status: 'closed', orderedG: 100_000, receivedG: 40_000 })).toBe('closed');
    expect(yarnPoStatusFor({ status: 'cancelled', orderedG: 100_000, receivedG: 0 })).toBe('cancelled');
  });

  it('what can be done in each state', () => {
    expect(yarnPoCanEditAll({ status: 'open', receivedG: 0 })).toBe(true);
    expect(yarnPoCanEditAll({ status: 'partly_received', receivedG: 1 })).toBe(false);
    expect(yarnPoCanCancel({ status: 'open', receivedG: 0 })).toBe(true);
    expect(yarnPoCanCancel({ status: 'partly_received', receivedG: 1 })).toBe(false);
    expect(yarnPoCanClose({ status: 'partly_received', receivedG: 1 })).toBe(true);
    expect(yarnPoCanClose({ status: 'open', receivedG: 0 })).toBe(false);
    expect(yarnPoCanReceive('received')).toBe(false);
    expect(yarnPoCanReceive('partly_received')).toBe(true);
  });

  it('line figures: pending never negative; over-receipt shown separately', () => {
    const f = yarnPoLineFigures({ qtyG: 100_000, ratePaise: 10_000 }, 120_000);
    expect(f.pendingG).toBe(0);
    expect(f.overG).toBe(20_000);
    expect(f.progress).toBe(1);
    expect(yarnPoLineFigures({ qtyG: 100_000, ratePaise: 10_000 }, 25_000).progress).toBe(0.25);
  });

  it('over-receipt is a warning, not a block', () => {
    const lines = [
      { qualityName: '75D', pendingG: 10_000, qtyG: 12_000 },
      { qualityName: '150D', pendingG: 10_000, qtyG: 10_000 },
    ];
    expect(overReceiptLines(lines)).toEqual([0]);
    expect(overReceiptText(lines)).toBe('2 kg more than pending on 75D');
    expect(receiptHasQuantity([{ qtyG: 0 }, { qtyG: 0 }])).toBe(false);
    const parsed = yarnReceiptInputSchema.safeParse({
      challanNo: '55',
      date: '2026-10-26',
      lots: [{ poLineId: 1, lotNo: 'LOT1', qtyKg: 12, allocations: [{ zone: 'tfo', qtyKg: 12 }] }],
    });
    expect(parsed.success).toBe(true);
    // allocations can't exceed the lot's kg
    expect(
      yarnReceiptInputSchema.safeParse({
        challanNo: '55',
        date: '2026-10-26',
        lots: [{ poLineId: 1, lotNo: 'LOT1', qtyKg: 10, allocations: [{ zone: 'tfo', qtyKg: 12 }] }],
      }).success,
    ).toBe(false);
    // unallocated kg is fine — it goes to Direct consumption
    expect(
      yarnReceiptInputSchema.safeParse({
        challanNo: '55',
        date: '2026-10-26',
        lots: [{ poLineId: 1, lotNo: 'LOT1', qtyKg: 12, allocations: [] }],
      }).success,
    ).toBe(true);
  });

  it('one line per quality', () => {
    expect(duplicateQualityIndex([{ qualityId: 1 }, { qualityId: 2 }, { qualityId: 1 }])).toBe(2);
    const base = { poDate: '2026-10-26', partyId: 1 };
    expect(yarnPoInputSchema.safeParse({ ...base, lines: [{ qualityId: 1, qtyKg: 10, rate: 200 }] }).success).toBe(true);
    const dup = yarnPoInputSchema.safeParse({ ...base, lines: [{ qualityId: 1, qtyKg: 10, rate: 200 }, { qualityId: 1, qtyKg: 5, rate: 210 }] });
    expect(dup.success).toBe(false);
    if (!dup.success) expect(dup.error.issues[0].path.join('.')).toBe('lines.1.qualityId');
    expect(yarnPoInputSchema.safeParse({ ...base, lines: [{ qualityId: 1, qtyKg: 10.0001, rate: 200 }] }).success).toBe(false);
    expect(yarnPoInputSchema.safeParse({ ...base, lines: [] }).success).toBe(false);
  });
});
