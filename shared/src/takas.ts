/**
 * Takas: the numbered cloth pieces a jobsheet's cloth is cut into at the Taka entry desk.
 * Pure helpers shared by the server (validation) and the client (inline errors, summaries, QR scanning).
 */

import { DAMAGE_TYPE_LABEL, isDamageType, type TakaStage } from './pipeline';

/**
 * Taka numbers: digits with single `-` or `/` separators between them (`6245`, `6245-1`, `62/45`), no letters.
 * Stored as text so leading zeros are kept.
 */
export const TAKA_NO_MAX_LENGTH = 15;
export const TAKA_NO_REGEX = /^\d+([-/]\d+)*$/;

/*
 * Damage types live in `pipeline.ts` (DAMAGE_TYPES / DAMAGE_TYPE_LABEL / DAMAGE_TYPE_CONFIG) = WHERE the damage was
 * found. Everything found at taka entry is machine damage; butta / mill damage are recorded by later sprints.
 * WHAT the damage is = a damage name from the Damage master (`takas.damage_id`).
 */

/** Upper limits so a stuck key can't submit thousands of rows. */
export const MAX_TAKAS_PER_SUBMIT = 200;
export const MAX_TAKAS_PER_JOBSHEET = 500;

export type TakaNoError = 'required' | 'format' | 'too_long' | 'duplicate' | 'already_entered' | 'already_used';

/**
 * While typing / pasting: keeps digits, `-` and `/` only, drops a leading separator, collapses repeated
 * separators (the first one typed wins) and caps the length. A trailing separator stays (the next digit follows).
 */
export function cleanTakaNo(value: string): string {
  return value
    .replace(/[^\d/-]/g, '')
    .replace(/^[-/]+/, '')
    .replace(/([-/])[-/]+/g, '$1')
    .slice(0, TAKA_NO_MAX_LENGTH);
}

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
  format: { en: 'Use digits, - or / only', hi: 'सिर्फ अंक, - या / लिखें' },
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
export const RESOLVED_STAGE_LABEL: Record<string, string> = { butta_qc: 'butta QC', mill_qc: 'mill QC' };

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
 * the damaged pcs. Older damage without a name or pcs shows just "Machine damage".
 */
export function damageLabel(foundAt: string | null | undefined, damageName?: string | null, pcs?: number | null): string {
  const where = DAMAGE_TYPE_LABEL[isDamageType(foundAt) ? foundAt : 'machine'];
  return [where, damageName, pcs != null ? `${pcs} pcs` : null].filter(Boolean).join(' · ');
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
/* Where a new taka goes after taka entry                               */
/* ------------------------------------------------------------------ */

/**
 * The stage a taka starts in: `entered` (waiting for butta cutting) when the order's design goes for butta cutting —
 * or the order has no design — and `waiting_mill` when the design skips butta cutting.
 */
export function initialTakaStage(design: { buttaCutting: boolean } | null | undefined): TakaStage {
  return !design || design.buttaCutting ? 'entered' : 'waiting_mill';
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
  const pa = a.split(/[-/]/).map(Number);
  const pb = b.split(/[-/]/).map(Number);
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
