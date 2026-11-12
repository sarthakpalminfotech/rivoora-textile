/**
 * Sprint 25 — dashboard periods and day / month buckets. Business days are India days (Asia/Kolkata, UTC+5:30): a taka
 * entered at 00:30 IST counts on that IST day. Dates are `yyyy-MM-dd` text, so they compare as strings.
 */

export const PERIOD_KEYS = ['7d', '30d', '3m', '6m', '12m', 'fy'] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];
export const isPeriodKey = (v: unknown): v is PeriodKey => typeof v === 'string' && (PERIOD_KEYS as readonly string[]).includes(v);
export const DEFAULT_PERIOD: PeriodKey = '30d';

export const PERIOD_SHORT: Record<PeriodKey, string> = { '7d': '7 d', '30d': '30 d', '3m': '3 m', '6m': '6 m', '12m': '12 m', fy: 'This FY' };
export const PERIOD_LABEL: Record<PeriodKey, string> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '3m': 'Last 3 months',
  '6m': 'Last 6 months',
  '12m': 'Last 12 months',
  fy: 'This financial year',
};

const IST_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

/** The IST calendar day of an instant ("2026-11-12"). */
export function istDay(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  return new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);
}

/** `yyyy-MM-dd` + n days. */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (both `yyyy-MM-dd`). */
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

/** "2026-11" */
export const monthOf = (day: string) => day.slice(0, 7);

/** `yyyy-MM` + n months. */
export function addMonths(month: string, n: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, '0')}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Nov" / "Nov 2026" */
export const monthShort = (month: string) => MONTHS[Number(month.slice(5, 7)) - 1] ?? month;
export const monthLong = (month: string) => `${monthShort(month)} ${month.slice(0, 4)}`;

/** The last `n` months up to and including this month (oldest first). */
export function lastMonths(n: number, today: string): string[] {
  const cur = monthOf(today);
  return Array.from({ length: n }, (_, i) => addMonths(cur, i - (n - 1)));
}

export const monthStart = (month: string) => `${month}-01`;
export const monthEnd = (month: string) => addDays(monthStart(addMonths(month, 1)), -1);

export interface PeriodRange {
  key: PeriodKey;
  label: string;
  /** Inclusive IST days. */
  from: string;
  to: string;
  /** Same length just before (for "vs previous period"). */
  prevFrom: string;
  prevTo: string;
  days: number;
}

/** The period's days, ending today (IST). FY = 1 April → today. */
export function periodRange(key: PeriodKey, now: Date): PeriodRange {
  const to = istDay(now);
  let from: string;
  if (key === '7d') from = addDays(to, -6);
  else if (key === '30d') from = addDays(to, -29);
  else if (key === 'fy') {
    const y = Number(to.slice(0, 4));
    from = Number(to.slice(5, 7)) >= 4 ? `${y}-04-01` : `${y - 1}-04-01`;
  } else {
    const months = key === '3m' ? 3 : key === '6m' ? 6 : 12;
    from = addDays(monthStart(addMonths(monthOf(to), -months)), daysBetween(monthStart(monthOf(to)), to) + 1);
  }
  const days = daysBetween(from, to) + 1;
  return { key, label: PERIOD_LABEL[key], from, to, prevFrom: addDays(from, -days), prevTo: addDays(from, -1), days };
}

/** Is an IST day inside [from, to]? */
export const inDays = (day: string | null | undefined, from: string, to: string) => !!day && day >= from && day <= to;
