/**
 * Sprint 17 — yarn (raw material): Yarn POs, the yarn stock ledger and the three zones (Direct consumption · TFO ·
 * Warping), TFO programs, warping jobs and beams. Pure rules shared by the server and the client. NOT linked to
 * orders, jobsheets or takas.
 *
 * Quantities: yarn is stored and summed as INTEGER GRAMS (`*_g` columns), so totals never drift; the API and the screens
 * speak kg with up to 3 decimals (`kgToGrams` / `gramsToKg` / `formatKg`). Rates are integer paise per kg
 * (`ratePaise`); amounts are paise (`amountPaise`).
 */

/* ------------------------------------------------------------------ */
/* zones, items                                                         */
/* ------------------------------------------------------------------ */

export const YARN_ZONES = ['direct', 'tfo', 'warping'] as const;
export type YarnZone = (typeof YARN_ZONES)[number];

export const isYarnZone = (v: unknown): v is YarnZone => typeof v === 'string' && (YARN_ZONES as readonly string[]).includes(v);

export interface YarnZoneConfig {
  label: string;
  /** One-line description on the zone panel. */
  description: string;
  /** What the zone's second button is called (Withdraw / Run program / Start warping). */
  actionLabel: string;
  /** Beams can be kept here (Direct consumption, Warping). */
  hasBeams: boolean;
  /** Soft accent colours — the zone panels, zone screen headers, TFO running sections. */
  accent: { solid: string; soft: string; text: string; border: string };
}

export const YARN_ZONE_CONFIG: Record<YarnZone, YarnZoneConfig> = {
  direct: {
    label: 'Direct consumption',
    description: 'Raw yarn, twisted yarn and beams used directly',
    actionLabel: 'Withdraw',
    hasBeams: true,
    accent: { solid: '#0F766E', soft: '#F0FDFA', text: '#115E59', border: '#99F6E4' },
  },
  tfo: {
    label: 'TFO',
    description: 'Raw yarn twisted on TFO machines',
    actionLabel: 'New programs',
    hasBeams: false,
    accent: { solid: '#6D28D9', soft: '#F5F3FF', text: '#5B21B6', border: '#DDD6FE' },
  },
  warping: {
    label: 'Warping',
    description: 'Raw and twisted yarn warped into beams',
    actionLabel: 'New warping job',
    hasBeams: true,
    accent: { solid: '#B45309', soft: '#FFFBEB', text: '#92400E', border: '#FDE68A' },
  },
};

/** Zones beams may be kept in (and moved between). */
export const BEAM_ZONES = ['direct', 'warping'] as const;
export type BeamZone = (typeof BEAM_ZONES)[number];
export const isBeamZone = (z: string): z is BeamZone => (BEAM_ZONES as readonly string[]).includes(z);

/** Yarn items in the ledger. */
export const YARN_ITEMS = ['raw', 'twisted'] as const;
export type YarnItem = (typeof YARN_ITEMS)[number];
export const YARN_ITEM_LABEL: Record<YarnItem, string> = { raw: 'Raw yarn', twisted: 'Twisted yarn' };

/**
 * Sprint 20: "No lot" (raw) / "No box" (twisted) — null `lot_id` / `box_id` on the ledger. Pre-Sprint-20 stock and
 * manual additions land here.
 */
export const NO_LOT_LABEL = 'No lot';
export const NO_BOX_LABEL = 'No box';

/** Sprint 20: a pending TFO program / warping job, before a machine / the actual job exists. */
export const YARN_PENDING_STATUSES = ['pending', 'started', 'cancelled'] as const;
export type YarnPendingStatus = (typeof YARN_PENDING_STATUSES)[number];

/** Sprint 20: a TFO output box's lifecycle — stock is its net wt, consumed down to 0 → `used`. */
export const BOX_STATUSES = ['in_stock', 'used'] as const;
export type BoxStatus = (typeof BOX_STATUSES)[number];
export const BOX_STATUS_LABEL: Record<BoxStatus, string> = { in_stock: 'In stock', used: 'Used' };

/** What a transfer / withdraw moves: yarn of one item, or beams. */
export const YARN_STOCK_WHAT = ['raw', 'twisted', 'beams'] as const;
export type YarnStockWhat = (typeof YARN_STOCK_WHAT)[number];
export const YARN_STOCK_WHAT_LABEL: Record<YarnStockWhat, string> = { raw: 'Raw yarn', twisted: 'Twisted yarn', beams: 'Beams' };

/* ------------------------------------------------------------------ */
/* the ledger                                                           */
/* ------------------------------------------------------------------ */

/** Kinds of yarn ledger rows (`yarn_stock_moves.kind`). `qty_g` is signed: + in, − out. */
export const YARN_MOVE_KINDS = [
  'receipt',
  'transfer_in',
  'transfer_out',
  'withdraw',
  'tfo_issue',
  'tfo_output',
  'tfo_return',
  'warping_issue',
  // Sprint 20: owners' manual corrections (remark kept in `note`).
  'manual_add',
  'manual_remove',
  // Sprint 24: Palti (leftover yarn re-wound into a new box) and warping leftover kg back into stock.
  'palti_issue',
  'palti_output',
  'warping_leftover',
] as const;
export type YarnMoveKind = (typeof YARN_MOVE_KINDS)[number];

/** Kinds of beam history rows (`beam_moves.kind`). */
export const BEAM_MOVE_KINDS = ['beam_created', 'transfer_in', 'transfer_out', 'consumed', 'removed'] as const;
export type BeamMoveKind = (typeof BEAM_MOVE_KINDS)[number];

export type MoveKind = YarnMoveKind | BeamMoveKind;

export const MOVE_KIND_LABEL: Record<MoveKind, string> = {
  receipt: 'Receipt',
  transfer_in: 'Transfer in',
  transfer_out: 'Transfer out',
  withdraw: 'Withdraw',
  tfo_issue: 'TFO issue',
  tfo_output: 'TFO output',
  tfo_return: 'TFO return',
  warping_issue: 'Warping issue',
  beam_created: 'Beam created',
  consumed: 'Consumed',
  manual_add: 'Added manually',
  manual_remove: 'Removed manually',
  removed: 'Removed manually',
  palti_issue: 'Palti input',
  palti_output: 'Palti box',
  warping_leftover: 'Warping remaining',
};

/** The sign a kind always has (receipts / outputs add, issues / withdraws take away). */
export const MOVE_KIND_SIGN: Record<YarnMoveKind, 1 | -1> = {
  receipt: 1,
  transfer_in: 1,
  transfer_out: -1,
  withdraw: -1,
  tfo_issue: -1,
  tfo_output: 1,
  tfo_return: 1,
  warping_issue: -1,
  manual_add: 1,
  manual_remove: -1,
  palti_issue: -1,
  palti_output: 1,
  warping_leftover: 1,
};

/** Beam history kinds that take a beam out of a zone (shown as −1 beam). */
export const BEAM_OUT_KINDS: readonly BeamMoveKind[] = ['transfer_out', 'consumed', 'removed'];

/** Movement filter types on the zone screen → the ledger kinds they cover (yarn + beam rows). */
export const MOVE_FILTERS = ['receipt', 'transfer_in', 'transfer_out', 'withdraw', 'tfo', 'warping', 'palti', 'manual'] as const;
export type MoveFilter = (typeof MOVE_FILTERS)[number];
export const MOVE_FILTER_LABEL: Record<MoveFilter, string> = {
  receipt: 'Receipt',
  transfer_in: 'Transfer in',
  transfer_out: 'Transfer out',
  withdraw: 'Withdraw',
  tfo: 'TFO',
  warping: 'Warping',
  palti: 'Palti',
  manual: 'Manual',
};
export const MOVE_FILTER_KINDS: Record<MoveFilter, MoveKind[]> = {
  receipt: ['receipt'],
  transfer_in: ['transfer_in'],
  transfer_out: ['transfer_out'],
  withdraw: ['withdraw', 'consumed'],
  tfo: ['tfo_issue', 'tfo_output', 'tfo_return'],
  warping: ['warping_issue', 'beam_created', 'warping_leftover'],
  palti: ['palti_issue', 'palti_output'],
  manual: ['manual_add', 'manual_remove', 'removed'],
};
export const isMoveFilter = (v: string): v is MoveFilter => (MOVE_FILTERS as readonly string[]).includes(v);

/** The ledger kinds a list of filter types stands for (deduplicated). */
export function kindsForFilters(filters: readonly MoveFilter[]): MoveKind[] {
  return [...new Set(filters.flatMap((f) => MOVE_FILTER_KINDS[f]))];
}

/** What a ledger row points at (`ref_type`). */
export const YARN_REF_TYPES = ['receipt', 'transfer', 'withdrawal', 'program', 'job', 'adjustment', 'palti'] as const;

/** Sprint 20: manual add / remove actions are numbered by this counter (rows of one action share the ref). */
export const YARN_ADJUSTMENT_COUNTER = 'yarn_adjustment_no';
export type YarnRefType = (typeof YARN_REF_TYPES)[number];

/* ------------------------------------------------------------------ */
/* kg / grams / money                                                   */
/* ------------------------------------------------------------------ */

/**
 * Sprint 20b: yarn kg have up to 4 decimals. Every yarn quantity is stored and summed as an INTEGER number of
 * TENTHS OF A GRAM (1 kg = 10,000 units). The `*_g` columns / `*G` DTO fields and the `kgToGrams` / `gramsToKg`
 * helpers keep their names but mean these units (migration 0020 multiplied the older gram values by 10).
 */
export const KG_DECIMALS = 4;
export const UNITS_PER_KG = 10_000;
/** The most kg on one line / one move (a sanity cap, not a business rule). */
export const MAX_KG = 1_000_000;
export const MAX_GRAMS = MAX_KG * UNITS_PER_KG;

/** kg (≤ 4 decimals) → integer units (0.1 g). Rounds half away from zero at the 5th decimal. */
export function kgToGrams(kg: number): number {
  if (!Number.isFinite(kg)) return NaN;
  const g = Math.round(Math.abs(kg) * UNITS_PER_KG + 1e-7);
  return kg < 0 ? -g : g;
}

/** units (0.1 g) → kg. */
export const gramsToKg = (g: number): number => g / UNITS_PER_KG;

/** A kg value has at most 4 decimals (the zod schemas use this). */
export const hasKgPrecision = (kg: number) => Number.isFinite(kg) && Math.abs(kg * UNITS_PER_KG - Math.round(kg * UNITS_PER_KG)) < 1e-5;

/** Typed text → units, or null when it is not a non-negative number with ≤ 4 decimals ("12", "12.5", ".2505"). */
export function parseKgText(text: string): number | null {
  const s = text.trim();
  const m = /^(\d{0,7})(?:\.(\d{0,4}))?$/.exec(s);
  if (!m || (!m[1] && !m[2]) || s === '.') return null;
  return Number(m[1] || '0') * UNITS_PER_KG + Number((m[2] ?? '').padEnd(KG_DECIMALS, '0') || '0');
}

/** Keeps a kg input clean while typing: digits and one dot, at most 4 decimals. */
export function cleanKgText(text: string): string {
  const s = text.replace(/,/g, '.').replace(/[^\d.]/g, '');
  const i = s.indexOf('.');
  if (i < 0) return s.slice(0, 7);
  return `${s.slice(0, Math.min(i, 7))}.${s.slice(i + 1).replace(/\./g, '').slice(0, KG_DECIMALS)}`;
}

/** units → the text a kg input shows ("12.5"). */
export const kgText = (g: number) => String(gramsToKg(g));

const kgFormat = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: KG_DECIMALS });
/** units → "1,234.5" (no unit). */
export const formatKgNumber = (g: number) => kgFormat.format(gramsToKg(g));
/** units → "1,234.5 kg" */
export const formatKg = (g: number) => `${formatKgNumber(g)} kg`;

/** ₹/kg (≤ 2 decimals) → integer paise. */
export function ratePaise(rate: number): number {
  return Math.round(rate * 100 + (rate >= 0 ? 1e-7 : -1e-7));
}
/** The amount of a line in paise: units × paise-per-kg / 10,000, rounded to the paisa. */
export function amountPaise(grams: number, ratePaisePerKg: number): number {
  return Math.round((grams * ratePaisePerKg) / UNITS_PER_KG);
}
export const paiseToRupees = (p: number) => p / 100;

/* ------------------------------------------------------------------ */
/* balances                                                             */
/* ------------------------------------------------------------------ */

export interface StockMoveLike {
  zone: YarnZone;
  item: YarnItem;
  qualityId: number;
  /** signed grams */
  qtyG: number;
}

export const balanceKey = (zone: string, item: string, qualityId: number) => `${zone}|${item}|${qualityId}`;

/** Balance per zone + item + quality = the sum of its signed moves (grams). */
export function balancesFromMoves(moves: readonly StockMoveLike[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of moves) {
    const k = balanceKey(m.zone, m.item, m.qualityId);
    out.set(k, (out.get(k) ?? 0) + m.qtyG);
  }
  return out;
}

/** Totals of a zone (or of every zone): raw / twisted grams. */
export function zoneTotals(moves: readonly StockMoveLike[], zone?: YarnZone): { rawG: number; twistedG: number } {
  let rawG = 0;
  let twistedG = 0;
  for (const m of moves) {
    if (zone && m.zone !== zone) continue;
    if (m.item === 'raw') rawG += m.qtyG;
    else twistedG += m.qtyG;
  }
  return { rawG, twistedG };
}

/** Why a quantity can't be taken out of stock (null = fine). */
export type TakeError = 'zero' | 'too_much' | 'not_enough';
export const TAKE_ERROR_TEXT: Record<TakeError, string> = {
  zero: 'Enter more than 0 kg',
  too_much: `At most ${MAX_KG.toLocaleString('en-IN')} kg`,
  not_enough: 'Not enough stock',
};

/** Taking `wantG` out of a balance of `availableG`: never below zero. */
export function checkTake(availableG: number, wantG: number): TakeError | null {
  if (!Number.isFinite(wantG) || wantG <= 0) return 'zero';
  if (wantG > MAX_GRAMS) return 'too_much';
  if (wantG > availableG) return 'not_enough';
  return null;
}

/** "Only 12.5 kg of raw yarn of 75D in TFO" — the 409 text when stock ran out. */
export function notEnoughText(p: { availableG: number; item: YarnItem; qualityName: string; zone: YarnZone }): string {
  return `Only ${formatKg(Math.max(0, p.availableG))} of ${YARN_ITEM_LABEL[p.item].toLowerCase()} ${p.qualityName} in ${YARN_ZONE_CONFIG[p.zone].label}`;
}

/* ------------------------------------------------------------------ */
/* transfer / withdraw                                                  */
/* ------------------------------------------------------------------ */

export type TransferError = 'same_zone' | 'beams_zone' | 'no_beams' | 'beam_not_here' | TakeError;
export const TRANSFER_ERROR_TEXT: Record<TransferError, string> = {
  same_zone: 'Pick a different zone to move to',
  beams_zone: 'Beams can move only between Direct consumption and Warping',
  no_beams: 'Select at least one beam',
  beam_not_here: 'A selected beam is no longer in this zone',
  ...TAKE_ERROR_TEXT,
};

/** Beams can move only between Direct consumption and Warping. */
export function canMoveBeams(from: YarnZone, to: YarnZone): boolean {
  return from !== to && isBeamZone(from) && isBeamZone(to);
}

/** The zones a transfer out of `from` may go to (beams: only the other beam zone). */
export function transferTargets(from: YarnZone, what: YarnStockWhat): YarnZone[] {
  return YARN_ZONES.filter((z) => z !== from && (what !== 'beams' || canMoveBeams(from, z)));
}

/**
 * A transfer: yarn needs a quantity within the From zone's balance; beams need at least one selected beam that is in
 * stock in the From zone (`beamsInZone` = ids of in-stock beams there).
 */
export function validateTransfer(p: {
  from: YarnZone;
  to: YarnZone;
  what: YarnStockWhat;
  availableG?: number;
  qtyG?: number;
  beamIds?: readonly number[];
  beamsInZone?: ReadonlySet<number>;
}): TransferError | null {
  if (p.from === p.to) return 'same_zone';
  if (p.what === 'beams') {
    if (!canMoveBeams(p.from, p.to)) return 'beams_zone';
    return checkBeams(p.beamIds ?? [], p.beamsInZone);
  }
  return checkTake(p.availableG ?? 0, p.qtyG ?? 0);
}

function checkBeams(ids: readonly number[], inZone?: ReadonlySet<number>): 'no_beams' | 'beam_not_here' | null {
  if (ids.length === 0) return 'no_beams';
  if (inZone && ids.some((id) => !inZone.has(id))) return 'beam_not_here';
  return null;
}

/**
 * Sprint 20c → 24 (CR-17): Withdraw is open in every zone — Direct consumption (yarn, part of a box, beams), TFO (raw
 * yarn, whole boxes) and Warping (raw yarn, whole boxes, beams).
 */
export const WITHDRAW_ZONES = ['direct', 'tfo', 'warping'] as const;
export type WithdrawZone = (typeof WITHDRAW_ZONES)[number];
export const isWithdrawZone = (z: string): z is WithdrawZone => (WITHDRAW_ZONES as readonly string[]).includes(z);
/** In TFO and Warping a box is always withdrawn whole; in Direct consumption part of a box may be taken. */
export const withdrawWholeBoxes = (zone: YarnZone) => zone !== 'direct';

/** Sprint 24 (CR-17): every withdraw says why — sold to a party, or used in-house (older withdrawals = in-house). */
export const WITHDRAW_PURPOSES = ['sell', 'in_house'] as const;
export type WithdrawPurpose = (typeof WITHDRAW_PURPOSES)[number];
export const WITHDRAW_PURPOSE_LABEL: Record<WithdrawPurpose, string> = { sell: 'Sell', in_house: 'Use in-house' };
export const isWithdrawPurpose = (v: string): v is WithdrawPurpose => (WITHDRAW_PURPOSES as readonly string[]).includes(v);

/** Withdraw (Direct consumption): yarn within the balance, or in-stock beams of the zone. */
export function validateWithdraw(p: {
  zone: YarnZone;
  what: YarnStockWhat;
  availableG?: number;
  qtyG?: number;
  beamIds?: readonly number[];
  beamsInZone?: ReadonlySet<number>;
}): TransferError | null {
  if (p.what === 'beams') {
    if (!isBeamZone(p.zone)) return 'beams_zone';
    return checkBeams(p.beamIds ?? [], p.beamsInZone);
  }
  return checkTake(p.availableG ?? 0, p.qtyG ?? 0);
}

/* ------------------------------------------------------------------ */
/* TFO programs                                                         */
/* ------------------------------------------------------------------ */

export const TFO_SECTIONS = ['A', 'B'] as const;
export type TfoSection = (typeof TFO_SECTIONS)[number];
export const TFO_SECTION_LABEL: Record<TfoSection, string> = { A: 'Top', B: 'Bottom' };
/** "3A" */
export const tfoSectionLabel = (machineNo: number, section: TfoSection) => `${machineNo}${section}`;

/** Sprint 20: a program can twist S, Z, or both directions at once ("S + Z"). */
export const TWIST_DIRECTIONS = ['S', 'Z', 'SZ'] as const;
export type TwistDirection = (typeof TWIST_DIRECTIONS)[number];
export const TWIST_DIRECTION_LABEL: Record<TwistDirection, string> = { S: 'S', Z: 'Z', SZ: 'S + Z' };

export type ProgramIssueError = TakeError | 'busy' | 'tpm';
export const PROGRAM_ISSUE_ERROR_TEXT: Record<ProgramIssueError, string> = {
  ...TAKE_ERROR_TEXT,
  busy: 'A program is already running on this section',
  tpm: 'Enter the TPM',
};

/** Starting a program: the section is idle, raw kg within the TFO raw balance, TPM > 0. */
export function validateProgramIssue(p: { sectionBusy: boolean; availableG: number; rawG: number; tpm: number }): ProgramIssueError | null {
  if (p.sectionBusy) return 'busy';
  const take = checkTake(p.availableG, p.rawG);
  if (take) return take;
  if (!Number.isFinite(p.tpm) || p.tpm <= 0) return 'tpm';
  return null;
}

export type ProgramStopError = 'returned_too_much' | 'nothing' | 'too_much';
export const PROGRAM_STOP_ERROR_TEXT: Record<ProgramStopError, string> = {
  returned_too_much: 'Returned raw yarn can’t be more than the raw yarn issued',
  nothing: 'Enter the twisted yarn produced',
  too_much: `At most ${MAX_KG.toLocaleString('en-IN')} kg`,
};

/**
 * Stopping a program: twisted kg is what came off the machine — it may differ from the raw kg issued (not called
 * wastage). Raw yarn returned goes back to TFO raw stock and can't exceed what was issued. Something must come back.
 */
export function validateProgramStop(p: { rawG: number; twistedG: number; returnedG: number }): ProgramStopError | null {
  if (p.twistedG < 0 || p.returnedG < 0) return 'nothing';
  if (p.twistedG > MAX_GRAMS) return 'too_much';
  if (p.returnedG > p.rawG) return 'returned_too_much';
  if (p.twistedG === 0 && p.returnedG === 0) return 'nothing';
  return null;
}

/** "Raw 50 kg → twisted 48.2 kg · returned 1 kg" — both numbers shown side by side, no "wastage". */
export function programResultLine(p: { rawG: number; twistedG: number | null; returnedG: number | null }): string {
  const parts = [`Raw ${formatKg(p.rawG)}`];
  if (p.twistedG !== null) parts.push(`twisted ${formatKg(p.twistedG)}`);
  const line = parts.join(' → ');
  return p.returnedG ? `${line} · returned ${formatKg(p.returnedG)}` : line;
}

/* ---------- Sprint 20: pending programs, reservations, boxes at stop ---------- */

/** The most programs created in one go ("Add another"). */
export const MAX_PENDING_PROGRAMS = 20;
/** The most boxes recorded at one stop. */
export const MAX_BOXES_PER_STOP = 200;
export const BOX_NO_MAX_LENGTH = 30;

/** Stock you can still take: the balance minus what pending programs / warping jobs have reserved (never below 0). */
export const availableAfterReserved = (balanceG: number, reservedG: number) => Math.max(0, balanceG - reservedG);

/** "12.5 kg available · reserved 40 kg" — the picker line under a lot / quality. */
export function availableText(availableG: number, reservedG: number): string {
  return reservedG > 0 ? `${formatKg(availableG)} available · reserved ${formatKg(reservedG)}` : `${formatKg(availableG)} available`;
}

/** Sprint 20b: box numbers are given by the system — counter `yarn_box_no`, starting at 1 (numbers in use are skipped). */
export const BOX_NO_COUNTER = 'yarn_box_no';
/** The most sections one program can run on. */
export const MAX_PROGRAM_SECTIONS = 40;

/** Box numbers compare without case and outer spaces ("b-12" = "B-12 "). */
export const boxNoKey = (no: string) => no.trim().toLowerCase();

/** Sprint 20b: raw kg of a program = rolls × winding kg (units). */
export const rawFromRolls = (rolls: number, windingG: number) => (Number.isInteger(rolls) && rolls > 0 && windingG > 0 ? rolls * windingG : 0);

/**
 * Sprint 20c — start part of a pending program: `startRolls` of its `totalRolls` start now; the rest stays pending
 * (same settings). Null / equal = the whole program. Only programs created with rolls can be split.
 */
export type StartRollsError = 'whole' | 'too_many' | 'no_rolls';
export const START_ROLLS_ERROR_TEXT: Record<StartRollsError, string> = {
  whole: 'Rolls to start is a whole number of at least 1',
  too_many: 'More rolls than the program has',
  no_rolls: 'This older program has no rolls — start it whole',
};
export function checkStartRolls(totalRolls: number | null, startRolls: number | null | undefined): StartRollsError | null {
  if (startRolls === null || startRolls === undefined) return null;
  if (!Number.isInteger(startRolls) || startRolls < 1) return 'whole';
  if (totalRolls === null) return startRolls === undefined ? null : 'no_rolls';
  if (startRolls > totalRolls) return 'too_many';
  return null;
}

/** Sprint 20b: a box's net = gross − roll weight × rolls (units). */
export const boxNetG = (grossG: number, rollWeightG: number, rolls: number) => grossG - rollWeightG * rolls;

/** "600" / "612.5" — TPM without trailing zeros. */
const tpmText = (tpm: number) => String(Number(tpm.toFixed(4)));

/**
 * Sprint 20b: the output (warping) quality of a box is named from the program: "denier/filament RawQuality-TPM-Dir",
 * e.g. "75/36 Poly 75D-600-S" (without denier / filament: "Poly 75D-600-S"). Found case-insensitively in the Warping
 * qualities master, or created there.
 */
export function tfoOutputQualityName(p: { denierFilament: string | null; rawQualityName: string; tpm: number; direction: 'S' | 'Z' }): string {
  const tail = `${p.rawQualityName.trim()}-${tpmText(p.tpm)}-${p.direction}`;
  const df = p.denierFilament?.trim();
  return df ? `${df} ${tail}` : tail;
}

export interface StopBoxLike {
  rolls: number;
  grossG: number;
  /** null / 0 = not entered (optional). */
  avgG?: number | null;
}

export type StopBoxError = 'rolls' | 'gross' | 'net' | 'direction';
export const STOP_BOX_ERROR_TEXT: Record<StopBoxError, string> = {
  rolls: 'Rolls is a whole number of at least 1',
  gross: 'Enter the gross kg',
  net: 'Gross kg must be more than roll weight × rolls',
  direction: 'Pick S or Z',
};

/** One box at Stop, given the stop's common roll weight. */
export function validateStopBox(b: StopBoxLike & { direction?: string | null }, rollWeightG: number, needsDirection = false): StopBoxError | null {
  if (!Number.isInteger(b.rolls) || b.rolls < 1) return 'rolls';
  if (!(b.grossG > 0)) return 'gross';
  if (!(boxNetG(b.grossG, rollWeightG, b.rolls) > 0)) return 'net';
  if (needsDirection && b.direction !== 'S' && b.direction !== 'Z') return 'direction';
  return null;
}

/** Live totals of the Stop screen: boxes, rolls, gross, net (= the TFO output). */
export function stopTotals(boxes: readonly Pick<StopBoxLike, 'rolls' | 'grossG'>[], rollWeightG: number) {
  let rolls = 0;
  let grossG = 0;
  let netG = 0;
  for (const b of boxes) {
    const r = Number.isFinite(b.rolls) ? b.rolls : 0;
    const g = Number.isFinite(b.grossG) ? b.grossG : 0;
    rolls += r;
    grossG += g;
    netG += Math.max(0, boxNetG(g, rollWeightG, r));
  }
  return { boxes: boxes.length, rolls, grossG, netG };
}

/** "3A, 3B, 5A" — the sections a program runs on. */
export const programSectionsLabel = (sections: readonly { machineNo: number; section: TfoSection }[]) =>
  [...sections]
    .sort((a, b) => a.machineNo - b.machineNo || a.section.localeCompare(b.section))
    .map((s) => tfoSectionLabel(s.machineNo, s.section))
    .join(', ');

/** Sections running out of all sections of the active machines: "3 of 10 running". */
export const runningSectionsText = (running: number, machines: number) => `${running} of ${machines * TFO_SECTIONS.length} running`;

/* ------------------------------------------------------------------ */
/* warping, beams                                                       */
/* ------------------------------------------------------------------ */

/** "WJ-1" */
export const warpingJobLabel = (n: number) => `WJ-${n}`;
/** "BM-1" */
export const beamLabel = (n: number) => `BM-${n}`;

export const WARPING_JOB_COUNTER = 'warping_job_no';
export const BEAM_COUNTER = 'beam_no';
export const MAX_WARPING_INPUTS = 30;
export const MAX_BEAMS_PER_JOB = 50;

export const WARPING_STATUSES = ['in_process', 'done'] as const;
export type WarpingStatus = (typeof WARPING_STATUSES)[number];
export const WARPING_STATUS_LABEL: Record<WarpingStatus, string> = { in_process: 'In process', done: 'Done' };

/** Sprint 20: `removed` = taken out by a manual remove (not used on a loom — that is `consumed`). */
export const BEAM_STATUSES = ['in_stock', 'consumed', 'removed'] as const;
export type BeamStatus = (typeof BEAM_STATUSES)[number];
export const BEAM_STATUS_LABEL: Record<BeamStatus, string> = { in_stock: 'In stock', consumed: 'Consumed', removed: 'Removed' };

export interface WarpingInputLike {
  item: YarnItem;
  qualityId: number;
  qtyG: number;
}

/**
 * The inputs of a warping job, added up per item + quality (two rows of the same raw quality count together) and
 * checked against the Warping balances. Returns the index of the first bad row and why, or null.
 */
export function validateWarpingInputs(
  inputs: readonly WarpingInputLike[],
  availableG: (item: YarnItem, qualityId: number) => number,
): { index: number; error: TakeError | 'none' } | null {
  if (inputs.length === 0) return { index: -1, error: 'none' };
  const used = new Map<string, number>();
  for (let i = 0; i < inputs.length; i++) {
    const r = inputs[i];
    if (!(r.qtyG > 0)) return { index: i, error: 'zero' };
    const k = `${r.item}|${r.qualityId}`;
    const total = (used.get(k) ?? 0) + r.qtyG;
    used.set(k, total);
    const err = checkTake(availableG(r.item, r.qualityId), total);
    if (err) return { index: i, error: err };
  }
  return null;
}

/** "Raw 40 kg · Twisted 12.5 kg" */
export function warpingInputsSummary(inputs: readonly { item: YarnItem; qtyG: number }[]): string {
  const raw = inputs.filter((i) => i.item === 'raw').reduce((s, i) => s + i.qtyG, 0);
  const twisted = inputs.filter((i) => i.item === 'twisted').reduce((s, i) => s + i.qtyG, 0);
  const parts: string[] = [];
  if (raw) parts.push(`Raw ${formatKg(raw)}`);
  if (twisted) parts.push(`Twisted ${formatKg(twisted)}`);
  return parts.join(' · ') || '—';
}

/* ---------- Sprint 20: pending warping jobs, typed beam codes ---------- */

/** What one warping input is: raw yarn of a lot, (part of) a TFO box, or "No box" twisted yarn. */
export const WARPING_INPUT_KINDS = ['raw', 'box', 'no_box'] as const;
export type WarpingInputKind = (typeof WARPING_INPUT_KINDS)[number];
export const WARPING_INPUT_KIND_LABEL: Record<WarpingInputKind, string> = { raw: 'Raw', box: 'Box', no_box: 'No box' };

export const MAX_PENDING_JOBS_INPUTS = MAX_WARPING_INPUTS;
export const BEAM_CODE_MAX_LENGTH = 30;
/** Beam codes compare without case and outer spaces. */
export const beamCodeKey = (code: string) => code.trim().toLowerCase();

export type WarpingJobError = 'taar' | 'panna' | 'meters' | 'no_inputs';
export const WARPING_JOB_ERROR_TEXT: Record<WarpingJobError, string> = {
  taar: 'Taar is a whole number of at least 1',
  panna: 'Enter the panna',
  meters: 'Enter the meters, or tick Full meter',
  no_inputs: 'Add at least one input',
};

/** A pending warping job's header: taar, panna, and meters OR "Full meter" (then meters are entered per beam at Done). */
export function validateWarpingJob(p: { taar: number; panna: number; meters: number | null; fullMeter: boolean; inputs: number }): WarpingJobError | null {
  if (p.inputs <= 0) return 'no_inputs';
  if (!Number.isInteger(p.taar) || p.taar < 1) return 'taar';
  if (!(p.panna > 0)) return 'panna';
  if (!p.fullMeter && !(p.meters !== null && p.meters > 0)) return 'meters';
  return null;
}

/**
 * The warping quality pre-filled on each beam at Mark done: the twisted inputs' warping quality when there is exactly
 * one, else nothing (the user picks).
 */
export function prefillBeamQuality(inputs: readonly { warpingQualityId: number | null }[]): number | null {
  const ids = [...new Set(inputs.map((i) => i.warpingQualityId).filter((v): v is number => v !== null))];
  return ids.length === 1 ? ids[0] : null;
}

export interface BeamInputLike {
  taar: number;
  panna: number;
  meters: number;
  warpingQualityId: number;
}
export type BeamInputError = 'taar' | 'panna' | 'meters' | 'quality';
export const BEAM_INPUT_ERROR_TEXT: Record<BeamInputError, string> = {
  taar: 'Taar is a whole number of at least 1',
  panna: 'Enter the panna',
  meters: 'Enter the meters',
  quality: 'Select the warping quality',
};

/**
 * One beam on Mark done. Sprint 20c: the beam no. is given by the system (counter `yarn_beam_code_no` from 1, skipping
 * numbers already used) and every new beam is kept in Warping — move it later with Transfer.
 */
export function validateBeam(b: BeamInputLike): BeamInputError | null {
  if (!Number.isInteger(b.taar) || b.taar < 1) return 'taar';
  if (!(b.panna > 0)) return 'panna';
  if (!(b.meters > 0)) return 'meters';
  if (!Number.isInteger(b.warpingQualityId) || b.warpingQualityId <= 0) return 'quality';
  return null;
}

/** Sprint 20c: the counter behind auto beam numbers ("1", "2", …). `BEAM_COUNTER` stays the internal `beam_no`. */
export const BEAM_CODE_COUNTER = 'yarn_beam_code_no';
/** A beam's remark at most this long. */
export const BEAM_REMARK_MAX_LENGTH = 500;

/** Beams per zone after Mark done (e.g. { direct: 1, warping: 1 }). */
export function beamsByZone(beams: readonly { zone: string }[]): Record<BeamZone, number> {
  const out: Record<BeamZone, number> = { direct: 0, warping: 0 };
  for (const b of beams) if (isBeamZone(b.zone)) out[b.zone] += 1;
  return out;
}

/** A beam can be consumed / moved only while it is in stock in that zone. */
export const beamAvailableIn = (beam: { status: string; zone: string }, zone: YarnZone) => beam.status === 'in_stock' && beam.zone === zone;

/* ------------------------------------------------------------------ */
/* Yarn PO                                                              */
/* ------------------------------------------------------------------ */

/** open → partly_received → received (by what came), or closed (short, by hand) / cancelled (only while nothing came). */
export const YARN_PO_STATUSES = ['open', 'partly_received', 'received', 'closed', 'cancelled'] as const;
export type YarnPoStatus = (typeof YARN_PO_STATUSES)[number];
export const isYarnPoStatus = (v: string): v is YarnPoStatus => (YARN_PO_STATUSES as readonly string[]).includes(v);

export const YARN_PO_STATUS_CONFIG: Record<YarnPoStatus, { label: string; badge: { bg: string; text: string; dot: string } }> = {
  open: { label: 'Open', badge: { bg: '#E0F2FE', text: '#0369A1', dot: '#0284C7' } },
  partly_received: { label: 'Partly received', badge: { bg: '#FEF3C7', text: '#92400E', dot: '#F59E0B' } },
  received: { label: 'Received', badge: { bg: '#DCFCE7', text: '#166534', dot: '#22C55E' } },
  closed: { label: 'Closed', badge: { bg: '#F1F5F9', text: '#475569', dot: '#94A3B8' } },
  cancelled: { label: 'Cancelled', badge: { bg: '#FEE2E2', text: '#991B1B', dot: '#EF4444' } },
};

/** The PO can still receive challans. */
export const yarnPoCanReceive = (status: string) => status === 'open' || status === 'partly_received';

/** The status after receipts; a closed / cancelled PO keeps its status. */
export function yarnPoStatusFor(p: { status: string; orderedG: number; receivedG: number }): YarnPoStatus {
  if (p.status === 'closed' || p.status === 'cancelled') return p.status;
  if (p.receivedG <= 0) return 'open';
  return p.receivedG >= p.orderedG ? 'received' : 'partly_received';
}

/** Full edit (date, PO no, party, lines) only while nothing is received; afterwards only the remark. */
export const yarnPoCanEditAll = (p: { status: string; receivedG: number }) => p.status === 'open' && p.receivedG === 0;
/** Cancel only while nothing is received. */
export const yarnPoCanCancel = (p: { status: string; receivedG: number }) => p.status === 'open' && p.receivedG === 0;
/** Close short by hand once something came but not everything. */
export const yarnPoCanClose = (p: { status: string; receivedG: number }) => p.status === 'partly_received' && p.receivedG > 0;

export interface YarnPoLineFigures {
  orderedG: number;
  receivedG: number;
  /** Still to come (0 once the line is fully received; never negative, also after an over-receipt). */
  pendingG: number;
  /** Received beyond the ordered quantity. */
  overG: number;
  amountPaise: number;
  /** 0–1 for the progress bar (capped at 1). */
  progress: number;
}

export function yarnPoLineFigures(line: { qtyG: number; ratePaise: number }, receivedG: number): YarnPoLineFigures {
  return {
    orderedG: line.qtyG,
    receivedG,
    pendingG: Math.max(0, line.qtyG - receivedG),
    overG: Math.max(0, receivedG - line.qtyG),
    amountPaise: amountPaise(line.qtyG, line.ratePaise),
    progress: line.qtyG > 0 ? Math.min(1, receivedG / line.qtyG) : 0,
  };
}

export interface YarnPoTotals {
  orderedG: number;
  receivedG: number;
  pendingG: number;
  amountPaise: number;
  progress: number;
}

/** PO totals from its lines (pending = the sum of each line's own pending, so an over-receipt doesn't hide another line's shortfall). */
export function yarnPoTotals(lines: readonly { qtyG: number; ratePaise: number; receivedG: number }[]): YarnPoTotals {
  let orderedG = 0;
  let receivedG = 0;
  let pendingG = 0;
  let amount = 0;
  for (const l of lines) {
    const f = yarnPoLineFigures(l, l.receivedG);
    orderedG += f.orderedG;
    receivedG += f.receivedG;
    pendingG += f.pendingG;
    amount += f.amountPaise;
  }
  return { orderedG, receivedG, pendingG, amountPaise: amount, progress: orderedG > 0 ? Math.min(1, receivedG / orderedG) : 0 };
}

/** A receipt needs at least one line with more than 0 kg. */
export const receiptHasQuantity = (lines: readonly { qtyG: number }[]) => lines.some((l) => l.qtyG > 0);

/** Lines of a receipt that bring more than is still pending (an amber warning, not a block). */
export function overReceiptLines(lines: readonly { pendingG: number; qtyG: number }[]): number[] {
  return lines.flatMap((l, i) => (l.qtyG > l.pendingG ? [i] : []));
}

/** "Received 12 kg more than pending on 75D" */
export function overReceiptText(lines: readonly { qualityName: string; pendingG: number; qtyG: number }[]): string | null {
  const over = lines.filter((l) => l.qtyG > l.pendingG);
  if (!over.length) return null;
  return over.map((l) => `${formatKg(l.qtyG - l.pendingG)} more than pending on ${l.qualityName}`).join(' · ');
}

/** The quality lines of a PO: one line per quality. Returns the index of the first repeated quality, or -1. */
export function duplicateQualityIndex(lines: readonly { qualityId: number }[]): number {
  const seen = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    if (seen.has(lines[i].qualityId)) return i;
    seen.add(lines[i].qualityId);
  }
  return -1;
}

export const MAX_PO_LINES = 30;

/** Yarn PO activity kinds (`yarn_po_events.kind`). */
export const YARN_PO_EVENT_KINDS = ['created', 'edited', 'received', 'closed', 'cancelled'] as const;
export type YarnPoEventKind = (typeof YARN_PO_EVENT_KINDS)[number];
export const YARN_PO_EVENT_LABEL: Record<YarnPoEventKind, string> = {
  created: 'PO created',
  edited: 'PO edited',
  received: 'Challan received',
  closed: 'PO closed',
  cancelled: 'PO cancelled',
};

/* ------------------------------------------------------------------ */
/* Sprint 24 — boxes with the FY, TFO hold, warping leftover, Palti     */
/* ------------------------------------------------------------------ */

/**
 * What a `yarn_boxes` row is: `tfo` (made at a TFO stop / part completion), `palti` (leftover yarn re-wound by hand into a
 * new box) or `remaining` (warping leftover kg of a program — rolls 0, gross = net). All of them behave like boxes.
 */
/** Sprint 24 (CR-16): a lot no. this party already has, typed against a PO line of another quality. */
export const lotQualityClashText = (lotNo: string, qualityName: string) => `Lot ${lotNo} of this party is ${qualityName} — check the quality or the lot number`;

export const YARN_BOX_KINDS = ['tfo', 'palti', 'remaining'] as const;
export type YarnBoxKind = (typeof YARN_BOX_KINDS)[number];
export const YARN_BOX_KIND_LABEL: Record<YarnBoxKind, string> = { tfo: 'TFO box', palti: 'Palti box', remaining: 'Remaining' };
export const PALTI_LABEL = 'Palti';

/** "P-12" — a TFO program (programs have no number of their own; the id is shown). */
export const tfoProgramLabel = (id: number) => `P-${id}`;

/** "2026-27" → "26-27" (kept here so yarn.ts stays free of imports; same rule as `fyShort`). */
const fyShortText = (fy: string) => (/^\d{4}-\d{2}$/.test(fy) ? `${fy.slice(2, 4)}-${fy.slice(5, 7)}` : fy);

/**
 * Sprint 24 (CR-18): box numbers show the FY in brackets — "15 (26-27)" — on stickers, box lists and pickers only (every
 * other number stays without the year).
 */
export const boxNoWithFy = (boxNo: string, fy: string | null | undefined) => (fy ? `${boxNo} (${fyShortText(fy)})` : boxNo);

/** How a picker groups boxes: by the TFO program they came from (remaining rows under their program, Palti boxes under "Palti"). */
export const boxGroupKey = (b: { kind: YarnBoxKind; programId: number }) => (b.kind === 'palti' ? 'palti' : `p-${b.programId}`);

/**
 * TFO program statuses (`tfo_programs.status`): Pending (a `tfo_pending_programs` row) → Running ⇄ On hold → Box details
 * pending (stopped, boxes not entered yet) → Completed.
 */
export const TFO_PROGRAM_STATUSES = ['running', 'on_hold', 'box_pending', 'completed'] as const;
export type TfoProgramStatus = (typeof TFO_PROGRAM_STATUSES)[number];
export const TFO_PROGRAM_STATUS_CONFIG: Record<TfoProgramStatus, { label: string; badge: { bg: string; text: string; dot: string } }> = {
  running: { label: 'Running', badge: { bg: '#EDE9FE', text: '#5B21B6', dot: '#7C3AED' } },
  on_hold: { label: 'On hold', badge: { bg: '#FEF3C7', text: '#92400E', dot: '#F59E0B' } },
  box_pending: { label: 'Box details pending', badge: { bg: '#E0F2FE', text: '#075985', dot: '#0284C7' } },
  completed: { label: 'Completed', badge: { bg: '#DCFCE7', text: '#166534', dot: '#22C55E' } },
};

/** `tfo_program_events.kind`. */
export const TFO_PROGRAM_EVENT_KINDS = ['hold', 'resume', 'part_done', 'stop_later', 'boxes_saved', 'stopped'] as const;
export type TfoProgramEventKind = (typeof TFO_PROGRAM_EVENT_KINDS)[number];
export const TFO_PROGRAM_EVENT_LABEL: Record<TfoProgramEventKind, string> = {
  hold: 'Put on hold',
  resume: 'Resumed',
  part_done: 'Made part completed',
  stop_later: 'Stopped · boxes pending',
  boxes_saved: 'Boxes saved',
  stopped: 'Stopped',
};

/** Hold: rolls made so far + rolls left = the rolls started; made can't be less than the rolls already boxed. */
export type HoldRollsError = 'whole' | 'sum' | 'below_done';
export const HOLD_ROLLS_ERROR_TEXT: Record<HoldRollsError, string> = {
  whole: 'Rolls are whole numbers (0 or more)',
  sum: 'Rolls made + rolls left must equal the rolls started',
  below_done: 'Rolls made can’t be less than the rolls already completed with boxes',
};
export function checkHoldRolls(p: { started: number; done: number; made: number; left: number }): HoldRollsError | null {
  if (![p.made, p.left].every((n) => Number.isInteger(n) && n >= 0)) return 'whole';
  if (p.made + p.left !== p.started) return 'sum';
  if (p.made < p.done) return 'below_done';
  return null;
}

/**
 * "Complete made part": the most rolls that can be boxed now — On hold: rolls made − rolls already boxed; Running (after a
 * resume): rolls started − rolls already boxed. null = the program has no rolls (older programs): no limit.
 */
export function partRollsLimit(p: { status: string; rolls: number | null; rollsMade: number | null; rollsDone: number }): number | null {
  if (p.rolls === null) return null;
  const upTo = p.status === 'on_hold' && p.rollsMade !== null ? p.rollsMade : p.rolls;
  return Math.max(0, upTo - p.rollsDone);
}

/** "6 / 12 rolls made · 6 left" */
export function holdRollsText(p: { rolls: number | null; rollsMade: number | null }): string | null {
  if (p.rolls === null || p.rollsMade === null) return null;
  return `${p.rollsMade} / ${p.rolls} rolls made · ${p.rolls - p.rollsMade} left`;
}

/* ---------- warping: kg used and remaining (CR-24) ---------- */

/** kg used = meters × denier × taar ÷ 9,000,000. */
export const WARPING_KG_DIVISOR = 9_000_000;
export const warpingKgUsed = (meters: number, denier: number, taar: number) => (meters * denier * taar) / WARPING_KG_DIVISOR;

export interface WarpingLeftoverInput {
  /** Total metres of all the job's beams. */
  meters: number;
  denier: number;
  taar: number;
  /** Total of the job's inputs (yarn units). */
  issuedG: number;
  /** The TFO programs whose boxes were inputs (any order; `stoppedAt` null = still open). */
  programs: { id: number; stoppedAt: string | null }[];
  /** The job's inputs (yarn units) — the split when no program is involved. */
  inputs: { g: number }[];
}

export type WarpingLeftoverSplit = { kind: 'program'; programId: number; g: number } | { kind: 'input'; index: number; g: number };

export interface WarpingLeftover {
  usedG: number;
  issuedG: number;
  /** issued − used, never below 0. */
  remainingG: number;
  /** used − issued when more was used than issued (the amber warning), else 0. */
  overG: number;
  splits: WarpingLeftoverSplit[];
}

/**
 * Sprint 24 (CR-24) — the remaining kg of a finished warping job: half and half over the LAST TWO TFO programs whose boxes
 * were inputs (latest stop first; the odd unit goes to the latest); one program → all of it; no program (raw yarn only)
 * → back to the inputs, split by their kg. Pure; the server and the Mark done screen both use it.
 */
export function warpingLeftover(p: WarpingLeftoverInput): WarpingLeftover {
  const usedG = Math.round(warpingKgUsed(p.meters, p.denier, p.taar) * UNITS_PER_KG);
  const diff = p.issuedG - usedG;
  const remainingG = Math.max(0, diff);
  const overG = Math.max(0, -diff);
  const splits: WarpingLeftoverSplit[] = [];
  if (remainingG > 0) {
    const programs = [...new Map(p.programs.map((x) => [x.id, x])).values()]
      .sort((a, b) => (b.stoppedAt ?? '9999').localeCompare(a.stoppedAt ?? '9999') || b.id - a.id)
      .slice(0, 2);
    if (programs.length === 2) {
      const second = Math.floor(remainingG / 2);
      splits.push({ kind: 'program', programId: programs[0].id, g: remainingG - second }, { kind: 'program', programId: programs[1].id, g: second });
    } else if (programs.length === 1) {
      splits.push({ kind: 'program', programId: programs[0].id, g: remainingG });
    } else {
      const total = p.inputs.reduce((s, i) => s + Math.max(0, i.g), 0);
      let given = 0;
      p.inputs.forEach((inp, index) => {
        if (inp.g <= 0 || total <= 0) return;
        const g = Math.floor((remainingG * inp.g) / total);
        splits.push({ kind: 'input', index, g });
        given += g;
      });
      // Rounding: whatever is left over goes to the last input.
      const last = splits.length - 1;
      if (last >= 0) splits[last] = { ...splits[last], g: splits[last].g + (remainingG - given) };
    }
  }
  return { usedG, issuedG: p.issuedG, remainingG, overG, splits: splits.filter((s) => s.g > 0) };
}

/** "(1,200 m × 75 denier × 2,400 taar) ÷ 90,00,000 = 24 kg" */
export function warpingFormulaText(meters: number, denier: number, taar: number): string {
  const n = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 4 });
  return `(${n(meters)} m × ${n(denier)} denier × ${n(taar)} taar) ÷ ${n(WARPING_KG_DIVISOR)} = ${formatKg(Math.round(warpingKgUsed(meters, denier, taar) * UNITS_PER_KG))}`;
}

/* ---------- Palti (CR-25) ---------- */

export const MAX_PALTI_INPUTS = 30;

/** Net of a Palti box vs what went in: waste = inputs − net (≥ 0); net may not be more than the inputs. */
export function paltiTotals(inputsG: readonly number[], netG: number): { inputG: number; wasteG: number; overG: number } {
  const inputG = inputsG.reduce((s, g) => s + Math.max(0, g), 0);
  return { inputG, wasteG: Math.max(0, inputG - netG), overG: Math.max(0, netG - inputG) };
}
