import { format, isValid, parseISO } from 'date-fns';

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });
const qty = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });

function toDate(value: string | Date): Date | null {
  const d = typeof value === 'string' ? parseISO(value) : value;
  return isValid(d) ? d : null;
}

/** dd-MM-yyyy (Indian style). */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = toDate(value);
  return d ? format(d, 'dd-MM-yyyy') : '—';
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = toDate(value);
  return d ? format(d, 'dd-MM-yyyy, hh:mm a') : '—';
}

/** yyyy-MM-dd for the API. */
export function toApiDate(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}

/** ₹1,25,000.00 */
export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return inr.format(value);
}

/** 250 meters, 12.5 kg */
export function formatQuantity(quantity: number, unit: string): string {
  return `${qty.format(quantity)} ${unit}`;
}

export function formatOrderNo(n: number): string {
  return `#${n}`;
}

/** 09:41 am */
export function formatTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = toDate(value);
  return d ? format(d, 'hh:mm a') : '—';
}

/** Compact duration: "45s", "12m", "2h 10m", "3d 4h". */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

/** Time elapsed since an ISO timestamp, e.g. "2h 10m" (null when unknown). */
export function formatElapsed(since: string | null | undefined, now: number): string | null {
  if (!since) return null;
  const d = toDate(since);
  return d ? formatDuration(now - d.getTime()) : null;
}
