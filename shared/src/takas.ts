/**
 * Takas: the numbered cloth pieces a jobsheet's cloth is cut into at the Taka entry desk.
 * Pure helpers shared by the server (validation) and the client (inline errors, summaries, QR scanning).
 */

import { DAMAGE_TYPE_LABEL, isDamageType, nextTakaStage, type TakaStage } from './pipeline';

/**
 * Taka numbers: digits with single `-` or `/` separators between them (`6245`, `6245-1`, `62/45`), optionally
 * - after ONE capital letter at the end, the part a split makes (`1101A`, see `splitBase`), and
 * - Sprint 16: behind a 1–4 letter capital prefix = an outside weaver's short code (`S1101`) or `FG` (FG purchase).
 * Stored as text so leading zeros are kept.
 */
export const TAKA_NO_MAX_LENGTH = 15;
/** Prefix (weaver code / FG, 0–4 capitals) + digits with - / + an optional split letter (1101A, S1101, S1101A, FG25). */
export const TAKA_NO_REGEX = /^[A-Z]{0,4}\d+([-/]\d+)*[A-Z]?$/;

/*
 * Damage types live in `pipeline.ts` (DAMAGE_TYPES / DAMAGE_TYPE_LABEL / DAMAGE_TYPE_CONFIG) = WHERE the damage was
 * found. Everything found at taka entry is machine damage; butta / mill damage are recorded by later sprints.
 * WHAT the damage is = a damage name from the Damage master (`takas.damage_id`).
 */

/** Upper limits so a stuck key can't submit thousands of rows. */
export const MAX_TAKAS_PER_SUBMIT = 200;
export const MAX_TAKAS_PER_JOBSHEET = 500;

/** System-generated taka numbers (Taka entry) count up from here; numbers already in use are skipped. */
export const TAKA_NO_START = 11;
/** Rows shown on a fresh Taka entry screen. */
export const TAKA_ENTRY_DEFAULT_ROWS = 3;
/** Max rows requested from GET /takas/next-numbers. */
export const TAKA_NEXT_NUMBERS_MAX = 50;

export type TakaNoError = 'required' | 'format' | 'too_long' | 'duplicate' | 'already_entered' | 'already_used';

/**
 * While typing / pasting: keeps digits, `-` and `/` only, drops a leading separator, collapses repeated
 * separators (the first one typed wins) and caps the length. A trailing separator stays (the next digit follows).
 */
export function cleanTakaNo(value: string): string {
  const kept = value.replace(/[^\dA-Z/-]/g, '');
  // Sprint 16: up to 4 capital letters at the very start survive (a weaver's short code, `FG`).
  const prefix = /^[A-Z]{1,4}/.exec(kept)?.[0] ?? '';
  const rest = kept.slice(prefix.length);
  // A capital letter survives only as the last character right after a digit (the split-part suffix).
  const suffix = /\d[A-Z]$/.test(rest) ? rest.slice(-1) : '';
  const base = rest
    .replace(/[A-Z]/g, '')
    .replace(/^[-/]+/, '')
    .replace(/([-/])[-/]+/g, '$1');
  return (prefix + base + suffix).slice(0, TAKA_NO_MAX_LENGTH);
}

/** The letter prefix of a taka number ("S1101A" → "S", "1101" → ""). */
export const takaNoPrefix = (takaNo: string): string => /^[A-Z]{1,4}(?=\d)/.exec(takaNo.trim())?.[0] ?? '';

export function takaNoError(value: string): Exclude<TakaNoError, 'duplicate' | 'already_entered' | 'already_used'> | null {
  const v = value.trim();
  if (!v) return 'required';
  if (v.length > TAKA_NO_MAX_LENGTH) return 'too_long';
  if (!TAKA_NO_REGEX.test(v)) return 'format';
  return null;
}

/**
 * Validates the taka numbers of a submit. Empty rows are ignored when `ignoreEmpty` is set (the entry screen);
 * otherwise they are an error (the edit form). Duplicates are checked within the list, against `existing` (numbers
 * already saved on the same jobsheet) and against `used` (numbers already used ANYWHERE in the system — since
 * Sprint 7 a taka number never repeats across jobsheets, orders or years; the value is where it is used).
 * Returns one error (or null) per row, in the same order. The first occurrence of a duplicate is valid.
 */
export function validateTakaNumbers(
  values: readonly string[],
  existing: readonly string[] = [],
  { ignoreEmpty = false, used }: { ignoreEmpty?: boolean; used?: ReadonlyMap<string, string> | null } = {},
): (TakaNoError | null)[] {
  const saved = new Set(existing.map((v) => v.trim()));
  const seen = new Set<string>();
  return values.map((raw) => {
    const v = raw.trim();
    if (!v && ignoreEmpty) return null;
    const err = takaNoError(v);
    if (err) return err;
    if (saved.has(v)) return 'already_entered';
    if (used?.has(v)) return 'already_used';
    if (seen.has(v)) return 'duplicate';
    seen.add(v);
    return null;
  });
}

export const hasTakaErrors = (errors: readonly (TakaNoError | null)[]) => errors.some((e) => e !== null);

/** English + Hindi messages for the inline field errors. */
export const TAKA_ERROR_TEXT: Record<TakaNoError, { en: string; hi: string }> = {
  required: { en: 'Enter the taka number', hi: 'टाका नंबर लिखें' },
  format: { en: 'Use digits, - or / (letters only as a short code at the start)', hi: 'सिर्फ अंक, - या / लिखें' },
  too_long: { en: `At most ${TAKA_NO_MAX_LENGTH} characters`, hi: `ज़्यादा से ज़्यादा ${TAKA_NO_MAX_LENGTH} अक्षर` },
  duplicate: { en: 'Typed twice', hi: 'दो बार लिखा है' },
  already_entered: { en: 'Already entered for this jobsheet', hi: 'इस जॉबशीट में पहले से है' },
  already_used: { en: 'Already used', hi: 'पहले से है' },
};

/** "Taka 6245 is already used (Order #26 (319)) / टाका 6245 पहले से है" — `ref` = where it is used, when known. */
export function takaUsedText(takaNo: string, ref?: string | null): { en: string; hi: string } {
  return {
    en: `Taka ${takaNo} is already used${ref ? ` (Order ${ref})` : ''}`,
    hi: `टाका ${takaNo} पहले से है`,
  };
}

/* ------------------------------------------------------------------ */
/* Meters per taka (optional)                                           */
/* ------------------------------------------------------------------ */

/** Meters are optional, > 0, at most 9999.99 (two decimals). */
export const TAKA_METERS_MAX = 9999.99;

/** Keeps what can form a meters value while typing: digits, one dot, at most 4 + 2 digits. */
export function cleanMeters(value: string): string {
  const v = value.replace(',', '.').replace(/[^\d.]/g, '');
  const [int = '', ...rest] = v.split('.');
  const dec = rest.join('');
  return v.includes('.') ? `${int.slice(0, 4)}.${dec.slice(0, 2)}` : int.slice(0, 4);
}

export type MetersError = 'invalid' | 'zero' | 'too_big';

/** The meters typed in a field: `null` when empty, a number, or an error. */
export function parseMeters(value: string): { meters: number | null; error: MetersError | null } {
  const v = value.trim();
  if (!v || v === '.') return { meters: null, error: v === '.' ? 'invalid' : null };
  if (!/^\d{0,4}(\.\d{0,2})?$/.test(v)) return { meters: null, error: 'invalid' };
  const n = Number(v);
  if (!Number.isFinite(n)) return { meters: null, error: 'invalid' };
  if (n <= 0) return { meters: null, error: 'zero' };
  if (n > TAKA_METERS_MAX) return { meters: null, error: 'too_big' };
  return { meters: Math.round(n * 100) / 100, error: null };
}

export const METERS_ERROR_TEXT: Record<MetersError, { en: string; hi: string }> = {
  invalid: { en: 'Enter meters like 105 or 105.5', hi: 'मीटर ऐसे लिखें: 105 या 105.5' },
  zero: { en: 'Meters must be more than 0', hi: 'मीटर 0 से ज़्यादा हों' },
  too_big: { en: `At most ${TAKA_METERS_MAX} m`, hi: `ज़्यादा से ज़्यादा ${TAKA_METERS_MAX} मीटर` },
};

/** "105.5 m" (up to two decimals, no trailing zeros). */
export function formatMeters(meters: number): string {
  return `${meters.toLocaleString('en-IN', { maximumFractionDigits: 2 })} m`;
}

/** Sum of the meters entered (takas without meters are skipped); `null` when none has meters. */
export function totalMeters(takas: readonly { meters?: number | null }[]): number | null {
  const withMeters = takas.filter((t) => t.meters != null);
  if (!withMeters.length) return null;
  return Math.round(withMeters.reduce((sum, t) => sum + t.meters!, 0) * 100) / 100;
}

/* ------------------------------------------------------------------ */
/* Pcs per taka (required on every new or edited taka)                  */
/* ------------------------------------------------------------------ */

export const TAKA_PCS_MAX = 9999;

/** Keeps digits only, at most 4 (the number keypad field). */
export function cleanPcs(value: string): string {
  return value.replace(/\D/g, '').slice(0, String(TAKA_PCS_MAX).length);
}

export type PcsError = 'required' | 'invalid' | 'zero' | 'too_big';

/** The pcs typed in a field: a whole number 1–9999, or an error (empty = `required`). */
export function parsePcs(value: string): { pcs: number | null; error: PcsError | null } {
  const v = value.trim();
  if (!v) return { pcs: null, error: 'required' };
  if (!/^\d+$/.test(v)) return { pcs: null, error: 'invalid' };
  const n = Number(v);
  if (n < 1) return { pcs: null, error: 'zero' };
  if (n > TAKA_PCS_MAX) return { pcs: null, error: 'too_big' };
  return { pcs: n, error: null };
}

export const PCS_ERROR_TEXT: Record<PcsError, { en: string; hi: string }> = {
  required: { en: 'Enter the pcs', hi: 'पीस लिखें' },
  invalid: { en: 'Use a whole number', hi: 'पूरा अंक लिखें' },
  zero: { en: 'Pcs must be at least 1', hi: 'कम से कम 1 पीस' },
  too_big: { en: `At most ${TAKA_PCS_MAX} pcs`, hi: `ज़्यादा से ज़्यादा ${TAKA_PCS_MAX} पीस` },
};

/** "12 pcs" */
export function formatPcs(pcs: number): string {
  return `${pcs.toLocaleString('en-IN')} pcs`;
}

/** Sum of the pcs entered (older takas without pcs are skipped); `null` when none has pcs. */
export function totalPcs(takas: readonly { pcs?: number | null }[]): number | null {
  const withPcs = takas.filter((t) => t.pcs != null);
  if (!withPcs.length) return null;
  return withPcs.reduce((sum, t) => sum + t.pcs!, 0);
}

/* ------------------------------------------------------------------ */
/* Damages (a list per taka)                                            */
/* ------------------------------------------------------------------ */

export const DAMAGE_NAME_MAX_LENGTH = 80;

export const DAMAGE_STATUSES = ['open', 'resolved'] as const;
export type DamageStatus = (typeof DAMAGE_STATUSES)[number];

/** Where a damage was resolved (`taka_damages.resolved_stage`). */
export const RESOLVED_STAGE_LABEL: Record<string, string> = { butta_qc: 'butta QC', mill_qc: 'mill QC', godown: 'the godown', split: 'a split', inventory: 'Marked fresh in inventory' };

/** The fields of one damage row that the labels need. */
export interface DamageLike {
  foundAt: string;
  damageName?: string | null;
  /** Damaged pcs when the damage was recorded. */
  pcs?: number | null;
  /** How many of those pcs were resolved (a partial resolve keeps the damage open with fewer open pcs). */
  resolvedPcs?: number | null;
  status?: string;
  resolvedStage?: string | null;
}

/** Pcs of a damage that are still damaged: `pcs − resolvedPcs` (0 once resolved; null when the damage has no pcs). */
export function damageOpenPcs(d: Pick<DamageLike, 'pcs' | 'resolvedPcs' | 'status'>): number | null {
  if (d.pcs == null) return null;
  if (d.status === 'resolved') return 0;
  return Math.max(0, d.pcs - (d.resolvedPcs ?? 0));
}

/**
 * "Machine damage · Hole · 2 pcs" — where the damage was found (`found_at`) + what it is (the Damage master name) +
 * the damaged pcs. Older damage without a name or pcs shows just "Machine damage". Sprint 19: pass `meters` instead
 * for a meter-order damage ("Machine damage · Hole · 5.5 m") — at most one of `pcs` / `meters` is ever shown.
 */
export function damageLabel(foundAt: string | null | undefined, damageName?: string | null, pcs?: number | null, meters?: number | null): string {
  const where = DAMAGE_TYPE_LABEL[isDamageType(foundAt) ? foundAt : 'machine'];
  const qty = pcs != null ? `${pcs} pcs` : meters != null ? formatMeters(meters) : null;
  return [where, damageName, qty].filter(Boolean).join(' · ');
}

/**
 * The label of a damage row: an OPEN damage shows its open pcs, with "(2 resolved)" when partly resolved; a resolved
 * damage shows its original pcs.
 */
export function damageLabelOf(d: DamageLike): string {
  const resolved = d.resolvedPcs ?? 0;
  if (d.status === 'resolved' || d.pcs == null) return damageLabel(d.foundAt, d.damageName, d.pcs);
  const label = damageLabel(d.foundAt, d.damageName, damageOpenPcs(d));
  return resolved > 0 ? `${label} (${resolved} resolved)` : label;
}

/** "Resolved 3 of 3 pcs" / "Resolved 2 of 3 · 1 pcs still damaged" / null when nothing was resolved. */
export function damageResolveSummary(d: Pick<DamageLike, 'pcs' | 'resolvedPcs' | 'status'>): string | null {
  const total = d.pcs;
  const resolved = d.status === 'resolved' && total != null ? total : (d.resolvedPcs ?? 0);
  if (total == null) return d.status === 'resolved' ? 'Resolved' : null;
  if (resolved <= 0) return null;
  return resolved >= total ? `Resolved ${total} of ${total} pcs` : `Resolved ${resolved} of ${total} · ${total - resolved} pcs still damaged`;
}

/** "Resolved at butta QC" (grey) for a resolved damage, `null` for an open one. */
export function damageResolvedText(d: Pick<DamageLike, 'status' | 'resolvedStage'>): string | null {
  if (d.status !== 'resolved') return null;
  const at = d.resolvedStage ? RESOLVED_STAGE_LABEL[d.resolvedStage] : null;
  if (d.resolvedStage === 'inventory') return 'Marked fresh in inventory';
  return at ? `Resolved at ${at}` : 'Resolved';
}

/** A taka with at least one OPEN damage is damaged; one whose damages are ALL resolved is "Fresh". */
export const hasOpenDamage = (damages: readonly Pick<DamageLike, 'status'>[]) => damages.some((d) => d.status !== 'resolved');
export const isFreshAfterDamage = (damages: readonly Pick<DamageLike, 'status'>[]) => damages.length > 0 && !hasOpenDamage(damages);

/** Damaged pcs: a whole number from 1 to the taka's pcs. */
export type DamagePcsError = 'required' | 'invalid' | 'zero' | 'too_big';

export function parseDamagePcs(value: string, takaPcs: number | null): { pcs: number | null; error: DamagePcsError | null } {
  const v = value.trim();
  if (!v) return { pcs: null, error: 'required' };
  if (!/^\d+$/.test(v)) return { pcs: null, error: 'invalid' };
  const n = Number(v);
  if (n < 1) return { pcs: null, error: 'zero' };
  if (n > (takaPcs ?? TAKA_PCS_MAX)) return { pcs: null, error: 'too_big' };
  return { pcs: n, error: null };
}

export function damagePcsErrorText(error: DamagePcsError, takaPcs: number | null): { en: string; hi: string } {
  const max = takaPcs ?? TAKA_PCS_MAX;
  switch (error) {
    case 'required':
      return { en: 'Enter the damaged pcs', hi: 'खराब पीस लिखें' };
    case 'invalid':
      return { en: 'Use a whole number', hi: 'पूरा अंक लिखें' };
    case 'zero':
      return { en: 'Pcs must be at least 1', hi: 'कम से कम 1 पीस' };
    case 'too_big':
      return { en: `At most ${max} pcs (the taka's pcs)`, hi: `ज़्यादा से ज़्यादा ${max} पीस` };
  }
}

/* ------------------------------------------------------------------ */
/* Sprint 19: damaged metres (the meter twin of damaged pcs)            */
/* ------------------------------------------------------------------ */

/** Damaged metres: more than 0, up to the taka's metres, 2 decimals. */
export type DamageMetersError = 'required' | 'invalid' | 'zero' | 'too_big';

export function parseDamageMeters(value: string, takaMeters: number | null): { meters: number | null; error: DamageMetersError | null } {
  const v = value.trim();
  if (!v) return { meters: null, error: 'required' };
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return { meters: null, error: 'invalid' };
  const n = Number(v);
  if (n <= 0) return { meters: null, error: 'zero' };
  if (n > (takaMeters ?? TAKA_METERS_MAX)) return { meters: null, error: 'too_big' };
  return { meters: Math.round(n * 100) / 100, error: null };
}

export function damageMetersErrorText(error: DamageMetersError, takaMeters: number | null): { en: string; hi: string } {
  const max = takaMeters ?? TAKA_METERS_MAX;
  switch (error) {
    case 'required':
      return { en: 'Enter the damaged metres', hi: 'खराब मीटर लिखें' };
    case 'invalid':
      return { en: 'Use a number like 5 or 5.5', hi: 'ऐसे लिखें: 5 या 5.5' };
    case 'zero':
      return { en: 'Metres must be more than 0', hi: 'मीटर 0 से ज़्यादा हों' };
    case 'too_big':
      return { en: `At most ${max} m (the taka's metres)`, hi: `ज़्यादा से ज़्यादा ${max} मीटर` };
  }
}

/** Sprint 19 §2.4: meters entered vs expected (completedMeters ?? meters) × sections — warn when the gap is > 2%. */
export const TAKA_METERS_MISMATCH_PCT = 0.02;

/** "Meters entered: 95. Expected about 100 m (50 m × 2 sections)." or null when within the tolerance / no expected value. */
export function metersMismatchNote(entered: number, assignedMeters: number, sections: number): string | null {
  const expected = Math.round(assignedMeters * sections * 100) / 100;
  if (expected <= 0) return null;
  const diff = Math.abs(entered - expected);
  if (diff / expected <= TAKA_METERS_MISMATCH_PCT) return null;
  const enteredFmt = entered.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const expectedFmt = expected.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  return `Meters entered: ${enteredFmt}. Expected about ${expectedFmt} m (${assignedMeters.toLocaleString('en-IN', { maximumFractionDigits: 2 })} m × ${sections} section${sections === 1 ? '' : 's'}).`;
}

/* ------------------------------------------------------------------ */
/* Where a new taka goes after taka entry                               */
/* ------------------------------------------------------------------ */

/**
 * @deprecated Sprint 16: the ORDER's steps decide (`nextTakaStage(order, 'taka_entry')`); the design only pre-fills the
 * Butta tick. Kept for older callers / tests: the old design rule for an order with Production + Mill.
 */
export function initialTakaStage(design: { buttaCutting: boolean } | null | undefined): TakaStage {
  return nextTakaStage({ hasButta: !design || design.buttaCutting, hasMill: true }, 'taka_entry');
}

/* ------------------------------------------------------------------ */
/* Summaries + sorting                                                  */
/* ------------------------------------------------------------------ */

/** "3 takas (1 damage) · 315.5 m · 36 pcs" — also stored as the note of takas_entered / takas_edited events. */
export function takaSummary(takas: readonly { isDamaged: boolean; meters?: number | null; pcs?: number | null }[]): string {
  const n = takas.length;
  const damaged = takas.filter((t) => t.isDamaged).length;
  const base = `${n} taka${n === 1 ? '' : 's'}`;
  const parts = [damaged ? `${base} (${damaged} damage)` : base];
  const meters = totalMeters(takas);
  if (meters !== null) parts.push(formatMeters(meters));
  const pcs = totalPcs(takas);
  if (pcs !== null) parts.push(formatPcs(pcs));
  return parts.join(' · ');
}

/**
 * Sorts taka numbers part by part numerically ("62/9" < "62/10" < "63"), then as text so "007" and "7" keep a
 * stable order.
 */
export function compareTakaNo(a: string, b: string): number {
  // Sprint 16: numbers with a letter prefix (a weaver's code / FG) sort after ours, grouped by prefix.
  const xa = takaNoPrefix(a);
  const xb = takaNoPrefix(b);
  if (xa !== xb) return xa === '' ? -1 : xb === '' ? 1 : xa.localeCompare(xb);
  // The split-part letter ("1101A") sorts right after its parent ("1101").
  const pa = a.slice(xa.length).replace(/[A-Z]$/, '').split(/[-/]/).map(Number);
  const pb = b.slice(xb.length).replace(/[A-Z]$/, '').split(/[-/]/).map(Number);
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return pa.length - pb.length || a.localeCompare(b);
}

/* ------------------------------------------------------------------ */
/* QR code on the printed jobsheet                                      */
/* ------------------------------------------------------------------ */

/** `${base}/j/${jobsheetNo}` — the content of the QR code printed on a jobsheet. */
export function jobsheetQrUrl(baseUrl: string, jobsheetNo: number): string {
  return `${baseUrl.replace(/\/+$/, '')}/j/${jobsheetNo}`;
}

/**
 * The jobsheet number in a scanned QR, or null when it isn't one of ours.
 * Accepts any http(s) host (so codes survive a domain change) whose path is exactly `/j/<digits>`
 * (an optional trailing slash, query or hash is ignored).
 */
export function parseJobsheetQr(text: string): number | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const m = /^\/j\/(\d{1,9})\/?$/.exec(url.pathname);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/* ------------------------------------------------------------------ */
/* Actual pcs (godown) + splitting a taka (Sprint 9)                    */
/* ------------------------------------------------------------------ */

/** Expected pcs = `pcs`; actual pcs = what the godown supervisor counted (`actualPcs`), else the expected pcs. */
export function takaActualPcs(t: { pcs?: number | null; actualPcs?: number | null }): number | null {
  return t.actualPcs ?? t.pcs ?? null;
}

/**
 * Sprint 19: the meters twin of `takaActualPcs` — expected meters = `meters`; actual meters = what the godown
 * supervisor corrected (`actualMeters`), else the expected meters. Every place that reads `t.meters` for a
 * "final/current" quantity after the godown stage should prefer this instead.
 */
export function takaActualMeters(t: { meters?: number | null; actualMeters?: number | null }): number | null {
  return t.actualMeters ?? t.meters ?? null;
}

/** Sum of the actual pcs of the takas (null when none has any pcs). */
export function totalActualPcs(takas: readonly { pcs?: number | null; actualPcs?: number | null }[]): number | null {
  const withPcs = takas.map(takaActualPcs).filter((n): n is number => n !== null);
  return withPcs.length ? withPcs.reduce((sum, n) => sum + n, 0) : null;
}

/** "+2" / "−4" / "0" — a pcs difference (actual − expected) for the row and the summary line. */
export function formatPcsDiff(diff: number): string {
  if (diff === 0) return '0';
  return diff > 0 ? `+${diff}` : `−${Math.abs(diff)}`;
}

const SPLIT_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const MAX_SPLIT_PARTS = SPLIT_LETTERS.length + 1;

/** The number a split part is built on: "1101A" → "1101" (a split of a split keeps the same base). */
export const splitBase = (takaNo: string) => takaNo.trim().replace(/[A-Z]$/, '');

/**
 * The next free letter number for a split: 1101 → 1101A, then 1101B … `taken` = every number already in use (the
 * other parts in the form and the order's takas). Null when A–Z are all used or the number would be too long.
 */
export function nextSplitNumber(parent: string, taken: Iterable<string>): string | null {
  const used = new Set([...taken].map((n) => n.trim()));
  const base = splitBase(parent);
  for (const letter of SPLIT_LETTERS) {
    const candidate = `${base}${letter}`;
    if (candidate.length > TAKA_NO_MAX_LENGTH) return null;
    if (!used.has(candidate)) return candidate;
  }
  return null;
}

/**
 * Meters of each split part: parent meters × part pcs ÷ total pcs, rounded to 2 decimals; the LAST part takes the
 * remainder so the parts always add up to the parent's meters. Null meters stay null.
 */
export function splitMeters(parentMeters: number | null, partPcs: readonly number[]): (number | null)[] {
  if (parentMeters === null) return partPcs.map(() => null);
  const total = partPcs.reduce((s, n) => s + n, 0);
  if (total <= 0) return partPcs.map(() => null);
  const out: number[] = [];
  let given = 0;
  partPcs.forEach((pcs, i) => {
    if (i === partPcs.length - 1) {
      out.push(Math.round((parentMeters - given) * 100) / 100);
    } else {
      const m = Math.round(((parentMeters * pcs) / total) * 100) / 100;
      out.push(m);
      given = Math.round((given + m) * 100) / 100;
    }
  });
  return out;
}

export interface SplitPartDraft {
  takaNo: string;
  /** The pcs typed for the part; null while empty. */
  pcs: number | null;
}

export type SplitRowError = 'pcs_required' | 'number_required' | 'number_format' | 'duplicate' | 'already_used';

export interface SplitValidation {
  /** One entry per part (null = fine). */
  rows: (SplitRowError | null)[];
  total: number;
  /** actual − total (0 when the parts add up). */
  diff: number;
  /** At least two parts, every part valid, the total equals the actual pcs. */
  ok: boolean;
}

/**
 * Validates a split: every part needs a number (valid + unique in the form + not used anywhere else) and pcs ≥ 1,
 * and the pcs must add up to the taka's actual pcs. `used` = numbers in use in the system; the first part keeps the
 * parent's own number, so it is never checked against `used`.
 */
export function validateSplit(parts: readonly SplitPartDraft[], actualPcs: number, used?: ReadonlySet<string> | null): SplitValidation {
  const seen = new Set<string>();
  const rows = parts.map((p, i): SplitRowError | null => {
    const no = p.takaNo.trim();
    if (!no) return 'number_required';
    if (takaNoError(no) !== null) return 'number_format';
    if (seen.has(no)) return 'duplicate';
    seen.add(no);
    if (i > 0 && used?.has(no)) return 'already_used';
    if (p.pcs === null || p.pcs < 1) return 'pcs_required';
    return null;
  });
  const total = parts.reduce((s, p) => s + (p.pcs ?? 0), 0);
  const diff = actualPcs - total;
  return { rows, total, diff, ok: parts.length >= 2 && rows.every((r) => r === null) && diff === 0 };
}

export const SPLIT_ERROR_TEXT: Record<SplitRowError, string> = {
  pcs_required: 'Enter the pcs (at least 1)',
  number_required: 'Enter the taka number',
  number_format: 'Use digits, - or / (and a capital letter at the end)',
  duplicate: 'Typed twice',
  already_used: 'Already used',
};

/**
 * Sprint 15: the text sent with a shared damage photo (WhatsApp):
 * "Damage: Mill damage · Hole · 2 pcs | Taka 1101 | Order #26" (+ " (319)" when the jobsheet number is known).
 */
export function damageShareMessage(p: { damage: string; takaNo: string; orderNo: number; jobsheetNo?: number | null }): string {
  const order = `Order #${p.orderNo}${p.jobsheetNo != null ? ` (${p.jobsheetNo})` : ''}`;
  return `Damage: ${p.damage} | Taka ${p.takaNo} | ${order}`;
}

/** wa.me fallback link for desktops / browsers that cannot share files. */
export const whatsappShareUrl = (text: string): string => `https://wa.me/?text=${encodeURIComponent(text)}`;

/* ------------------------------------------------------------------ */
/* Sprint 16: outside weavers' taka numbers                             */
/* ------------------------------------------------------------------ */

/** A weaver's short code: 1–4 capital letters, unique among active weavers. `FG` is reserved (FG purchase). */
export const WEAVER_CODE_REGEX = /^[A-Z]{1,4}$/;
export const RESERVED_WEAVER_CODES: readonly string[] = ['FG'];
/** The prefix of an FG purchase taka that came without our number (FG1101). */
export const FG_TAKA_PREFIX = 'FG';

/** Keeps capital letters only (typed lowercase is upper-cased), at most 4. */
export const cleanWeaverCode = (value: string): string => value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);

export type WeaverCodeError = 'required' | 'format' | 'reserved';
export function weaverCodeError(code: string): WeaverCodeError | null {
  const v = code.trim();
  if (!v) return 'required';
  if (!WEAVER_CODE_REGEX.test(v)) return 'format';
  if (RESERVED_WEAVER_CODES.includes(v)) return 'reserved';
  return null;
}
export const WEAVER_CODE_ERROR_TEXT: Record<WeaverCodeError, string> = {
  required: 'Enter the short code',
  format: 'Use 1 to 4 letters (A–Z)',
  reserved: 'FG is reserved for FG purchases',
};

/**
 * The short code suggested from a weaver's name: the first letter of each word (up to 4), else the first letter;
 * a code that is taken gets letters of the name added, then A, B, C … ("Shree Textiles" → "ST", "Shree" → "S").
 */
export function suggestWeaverCode(name: string, taken: Iterable<string> = []): string {
  const used = new Set([...taken].map((c) => c.toUpperCase()));
  const words = name.toUpperCase().replace(/[^A-Z\s]/g, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const initials = words.map((w) => w[0]).join('').slice(0, 4);
  const letters = words.join('');
  const candidates = [initials, letters.slice(0, 1), letters.slice(0, 2), letters.slice(0, 3), letters.slice(0, 4)];
  for (const c of candidates) if (c && !used.has(c) && !RESERVED_WEAVER_CODES.includes(c)) return c;
  const base = initials.slice(0, 3);
  for (const l of SPLIT_LETTERS) {
    const c = `${base}${l}`;
    if (!used.has(c) && !RESERVED_WEAVER_CODES.includes(c)) return c;
  }
  return initials;
}

/** Weaver taka numbers are numeric (digits with - or /), like ours. */
export const WEAVER_TAKA_NO_REGEX = /^\d+([-/]\d+)*$/;
export const cleanWeaverTakaNo = (value: string): string =>
  value
    .replace(/[^\d/-]/g, '')
    .replace(/^[-/]+/, '')
    .replace(/([-/])[-/]+/g, '$1')
    .slice(0, TAKA_NO_MAX_LENGTH - 4);

/**
 * The system number of a taka received from outside: OUR number when it was typed, else the weaver's short code + the
 * weaver's number (Shree Textiles, code S + 1101 → S1101; FG purchases use `FG`).
 */
export function outsideTakaNumber(code: string, weaverTakaNo: string, ourTakaNo?: string | null): string {
  const own = ourTakaNo?.trim();
  return own ? own : `${code}${weaverTakaNo.trim()}`;
}

/** The fields `printTakaNo` needs. */
export interface PrintableTaka {
  takaNo: string;
  weaverTakaNo?: string | null;
  /** Our number was typed for it (the system number is ours, not code + weaver number). */
  hasOwnNumber?: boolean | null;
}

/**
 * The number PRINTED on challans (butta / mill / delivery): our number when we gave one, else the weaver's exact number
 * (1101, not S1101); a split part prints the weaver number + its letter (1101A). Production takas print their own number.
 */
export function printTakaNo(t: PrintableTaka): string {
  if (t.hasOwnNumber || !t.weaverTakaNo) return t.takaNo;
  return t.weaverTakaNo;
}

/**
 * The weaver number of a split part: the parent's weaver number + the part's letter ("1101" + S1101B → "1101B").
 * Null when the parent has no weaver number.
 */
export function splitWeaverTakaNo(parentWeaverNo: string | null | undefined, partTakaNo: string): string | null {
  if (!parentWeaverNo) return null;
  const letter = /[A-Z]$/.exec(partTakaNo.trim())?.[0] ?? '';
  return `${parentWeaverNo.replace(/[A-Z]$/, '')}${letter}`;
}

export type OutsideRowError =
  | 'weaver_required'
  | 'weaver_format'
  | 'weaver_duplicate'
  | 'weaver_used'
  | 'own_format'
  | 'own_duplicate'
  | 'system_used';

export const OUTSIDE_ROW_ERROR_TEXT: Record<OutsideRowError, string> = {
  weaver_required: 'Enter the weaver taka number',
  weaver_format: 'Use digits, - or / only',
  weaver_duplicate: 'Typed twice',
  weaver_used: 'This weaver already sent this taka number',
  own_format: 'Use digits, - or / (letters only as a short code at the start)',
  own_duplicate: 'Our number typed twice',
  system_used: 'Already used — type our number for this taka',
};

/**
 * Validates the taka numbers of a receipt (outside weaver or FG lump): weaver numbers are required, numeric and unique in
 * the form and for the weaver (`usedWeaverNos`); our numbers are optional, valid and unique; the resulting SYSTEM number
 * (ours, else code + weaver number) must not be used anywhere (`usedSystemNos`). One error (or null) per row.
 */
export function validateOutsideRows(
  rows: readonly { weaverTakaNo: string; ourTakaNo?: string | null }[],
  code: string,
  { usedWeaverNos, usedSystemNos }: { usedWeaverNos?: ReadonlySet<string> | null; usedSystemNos?: ReadonlySet<string> | null } = {},
): (OutsideRowError | null)[] {
  const seenWeaver = new Set<string>();
  const seenSystem = new Set<string>();
  return rows.map((r) => {
    const w = r.weaverTakaNo.trim();
    if (!w) return 'weaver_required';
    if (!WEAVER_TAKA_NO_REGEX.test(w)) return 'weaver_format';
    if (seenWeaver.has(w)) return 'weaver_duplicate';
    seenWeaver.add(w);
    if (usedWeaverNos?.has(w)) return 'weaver_used';
    const own = r.ourTakaNo?.trim() ?? '';
    if (own && takaNoError(own) !== null) return 'own_format';
    const system = outsideTakaNumber(code, w, own);
    if (seenSystem.has(system)) return own ? 'own_duplicate' : 'weaver_duplicate';
    seenSystem.add(system);
    if (system.length > TAKA_NO_MAX_LENGTH) return own ? 'own_format' : 'weaver_format';
    if (usedSystemNos?.has(system)) return 'system_used';
    return null;
  });
}
