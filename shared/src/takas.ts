/**
 * Takas: the numbered cloth pieces a jobsheet's cloth is cut into at the Taka entry desk.
 * Pure helpers shared by the server (validation) and the client (inline errors, summaries, QR scanning).
 */

/** Taka numbers are digits only, stored as text so leading zeros are kept. */
export const TAKA_NO_MAX_LENGTH = 10;
export const TAKA_NO_REGEX = /^\d{1,10}$/;

/*
 * Damage types live in `pipeline.ts` (DAMAGE_TYPES / DAMAGE_TYPE_LABEL / DAMAGE_TYPE_CONFIG).
 * Everything found at taka entry is machine damage; butta / mill damage are recorded by later sprints.
 */

/** Upper limits so a stuck key can't submit thousands of rows. */
export const MAX_TAKAS_PER_SUBMIT = 200;
export const MAX_TAKAS_PER_JOBSHEET = 500;

export type TakaNoError = 'required' | 'digits' | 'too_long' | 'duplicate' | 'already_entered';

/** Keeps digits only (for typing / pasting into the number keypad fields). */
export function cleanTakaNo(value: string): string {
  return value.replace(/\D/g, '').slice(0, TAKA_NO_MAX_LENGTH);
}

export function takaNoError(value: string): Exclude<TakaNoError, 'duplicate' | 'already_entered'> | null {
  const v = value.trim();
  if (!v) return 'required';
  if (!/^\d+$/.test(v)) return 'digits';
  if (v.length > TAKA_NO_MAX_LENGTH) return 'too_long';
  return null;
}

/**
 * Validates the taka numbers of ONE jobsheet. Empty rows are ignored when `ignoreEmpty` is set (the entry screen);
 * otherwise they are an error (the edit form). Duplicates are checked within the list and against `existing`
 * (numbers already saved on the same jobsheet). Numbers are NOT unique across jobsheets or orders.
 * Returns one error (or null) per row, in the same order. The first occurrence of a duplicate is valid.
 */
export function validateTakaNumbers(
  values: readonly string[],
  existing: readonly string[] = [],
  { ignoreEmpty = false }: { ignoreEmpty?: boolean } = {},
): (TakaNoError | null)[] {
  const saved = new Set(existing.map((v) => v.trim()));
  const seen = new Set<string>();
  return values.map((raw) => {
    const v = raw.trim();
    if (!v && ignoreEmpty) return null;
    const err = takaNoError(v);
    if (err) return err;
    if (saved.has(v)) return 'already_entered';
    if (seen.has(v)) return 'duplicate';
    seen.add(v);
    return null;
  });
}

export const hasTakaErrors = (errors: readonly (TakaNoError | null)[]) => errors.some((e) => e !== null);

/** English + Hindi messages for the inline field errors. */
export const TAKA_ERROR_TEXT: Record<TakaNoError, { en: string; hi: string }> = {
  required: { en: 'Enter the taka number', hi: 'टाका नंबर लिखें' },
  digits: { en: 'Use digits only', hi: 'सिर्फ अंक लिखें' },
  too_long: { en: `At most ${TAKA_NO_MAX_LENGTH} digits`, hi: `ज़्यादा से ज़्यादा ${TAKA_NO_MAX_LENGTH} अंक` },
  duplicate: { en: 'Typed twice', hi: 'दो बार लिखा है' },
  already_entered: { en: 'Already entered for this jobsheet', hi: 'इस जॉबशीट में पहले से है' },
};

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

/** "3 takas (1 damage) · 315.5 m" — also stored as the note of takas_entered / takas_edited events. */
export function takaSummary(takas: readonly { isDamaged: boolean; meters?: number | null }[]): string {
  const n = takas.length;
  const damaged = takas.filter((t) => t.isDamaged).length;
  const base = `${n} taka${n === 1 ? '' : 's'}`;
  const withDamage = damaged ? `${base} (${damaged} damage)` : base;
  const meters = totalMeters(takas);
  return meters === null ? withDamage : `${withDamage} · ${formatMeters(meters)}`;
}

/** Sorts taka numbers numerically (then as text, so "007" and "7" keep a stable order). */
export function compareTakaNo(a: string, b: string): number {
  return Number(a) - Number(b) || a.localeCompare(b);
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
