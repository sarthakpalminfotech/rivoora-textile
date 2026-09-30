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

/** "3 takas (1 damage)" — also stored as the note of takas_entered / takas_edited events. */
export function takaSummary(takas: readonly { isDamaged: boolean }[]): string {
  const n = takas.length;
  const damaged = takas.filter((t) => t.isDamaged).length;
  const base = `${n} taka${n === 1 ? '' : 's'}`;
  return damaged ? `${base} (${damaged} damage)` : base;
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
