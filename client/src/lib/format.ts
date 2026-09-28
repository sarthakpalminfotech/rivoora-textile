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
