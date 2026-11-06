/**
 * Sprint 23 (CR-23) — financial year (India: 1 April – 31 March), Asia/Kolkata time. Every automatic number restarts at
 * 1 each FY; the year is shown only on TFO / Palti box numbers ("15 (26-27)"). Pure helpers, IST-safe: a date is turned
 * into its Indian calendar day first, so a record made at 11:45 pm IST on 31 March (18:15 UTC) is still in the old FY
 * and one made just after midnight IST on 1 April (18:30 UTC on 31 March) is in the new one.
 */

const IST_OFFSET_MIN = 330;

/** The Indian calendar day (year, month 1-12) of an instant or a yyyy-MM-dd string. */
export function istYearMonth(value: string | Date): { year: number; month: number } {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    // A plain calendar day is already a local date.
    return { year: Number(value.slice(0, 4)), month: Number(value.slice(5, 7)) };
  }
  const d = typeof value === 'string' ? new Date(value) : value;
  const shifted = new Date(d.getTime() + IST_OFFSET_MIN * 60_000);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1 };
}

/** `fyOf('2027-03-31')` → "2026-27", `fyOf('2027-04-01')` → "2027-28". */
export function fyOf(value: string | Date): string {
  const { year, month } = istYearMonth(value);
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** "2026-27" → "26-27" (the form printed on box stickers). */
export function fyShort(fy: string): string {
  return /^\d{4}-\d{2}$/.test(fy) ? `${fy.slice(2, 4)}-${fy.slice(5, 7)}` : fy;
}

/** The FY of `now` (defaults to the real clock). */
export function currentFy(now: Date = new Date()): string {
  return fyOf(now);
}

export const isFy = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}$/.test(v) && (Number(v.slice(0, 4)) + 1) % 100 === Number(v.slice(5, 7));

/** First day (yyyy-MM-dd) of a FY: "2026-27" → "2026-04-01". */
export const fyStartDate = (fy: string): string => `${fy.slice(0, 4)}-04-01`;

/** FYs sort as text ("2026-27" < "2027-28"); true when `a` is a later year than `b`. */
export const fyIsAfter = (a: string, b: string): boolean => a > b;

/**
 * The name of the counter row for a numbered thing in a FY. Up to and including the start FY the old global counter keeps
 * going (nothing renumbered, no jump); each later FY gets its own row `"<key>:<fy>"` starting at 1.
 */
export function counterNameFor(key: string, fy: string, startFy: string): string {
  return fyIsAfter(fy, startFy) ? `${key}:${fy}` : key;
}

/** The FY the live data's numbering started in (numbers restart at the first 1 April after this FY). */
export const NUMBERING_START_FY = '2026-27';

/** "6245 · Order #26 · 2026-27" — one candidate of the "Which one?" picker (the year only where numbers can repeat). */
export function numberWithFy(no: string | number, fy: string | null | undefined): string {
  return fy ? `${no} · ${fy}` : String(no);
}
