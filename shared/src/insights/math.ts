import { addDays, daysBetween } from './period';
import type { CardUnit, Change } from './types';

/**
 * Sprint 25 — the pure maths behind the insight cards. The server loads rows, these decide; the tests pin them down.
 */

export const sum = (xs: readonly number[]) => xs.reduce((s, x) => s + (Number.isFinite(x) ? x : 0), 0);

export function median(xs: readonly number[]): number | null {
  const v = xs.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Nearest-rank percentile (p in 0–100) — "90th percentile days". */
export function percentile(xs: readonly number[], p: number): number | null {
  const v = xs.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!v.length) return null;
  const rank = Math.max(1, Math.ceil((p / 100) * v.length));
  return v[Math.min(v.length, rank) - 1];
}

/** % change from `prev` to `cur` (null when there is no previous value to compare with). */
export function pctChange(cur: number, prev: number): number | null {
  if (!Number.isFinite(prev) || prev === 0) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

export const change = (cur: number, prev: number, label: string, upIsGood = true): Change => ({ pct: pctChange(cur, prev), label, upIsGood });

/** a ÷ b × 100, or null when b is 0. */
export const pct = (a: number, b: number): number | null => (b > 0 ? (a / b) * 100 : null);

/**
 * The ±10 % rule (Gaurang + supervisor cards): an item is listed only when the actual differs from the expected by
 * MORE than the tolerance, either way. Exactly 10 % is not listed.
 */
export const TOLERANCE = 0.1;
export function beyondTolerance(actual: number, expected: number, tolerance = TOLERANCE): boolean {
  if (!(expected > 0)) return actual > 0;
  return Math.abs(actual - expected) / expected > tolerance + 1e-9;
}
/** Signed difference in % ("−14 %", "+22 %"). */
export const diffPct = (actual: number, expected: number) => (expected > 0 ? ((actual - expected) / expected) * 100 : null);

/** Share of the top `n` values in the total (0–100), and which keys they are. */
export function topShare<K>(values: readonly { key: K; value: number }[], n = 3): { share: number | null; top: { key: K; value: number }[]; total: number } {
  const total = sum(values.map((v) => v.value));
  const top = values
    .filter((v) => v.value > 0)
    .slice()
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
  return { share: total > 0 ? (sum(top.map((t) => t.value)) / total) * 100 : null, top, total };
}

/**
 * "Clients gone quiet": a client's usual gap = the median of its last 5 gaps between orders (needs ≥ 2 orders). Quiet =
 * days since the last order > usual gap × 1.5 (passed by more than 50 %).
 */
export function quietClient(orderDays: readonly string[], today: string): { usualGap: number; daysSince: number; lastDay: string } | null {
  const days = [...new Set(orderDays)].sort();
  if (days.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < days.length; i++) gaps.push(daysBetween(days[i - 1], days[i]));
  const usualGap = median(gaps.slice(-5));
  if (usualGap === null || usualGap <= 0) return null;
  const lastDay = days[days.length - 1];
  const daysSince = daysBetween(lastDay, today);
  return daysSince > usualGap * 1.5 ? { usualGap, daysSince, lastDay } : null;
}

/** Age buckets of the QC / rework backlog: 0–1 d, 2–3 d, > 3 d. */
export const AGE_BUCKETS = ['0–1 d', '2–3 d', '> 3 d'] as const;
export function ageBucket(days: number): (typeof AGE_BUCKETS)[number] {
  return days <= 1 ? AGE_BUCKETS[0] : days <= 3 ? AGE_BUCKETS[1] : AGE_BUCKETS[2];
}

/** Whole days from an instant to now (never negative). */
export const ageDays = (from: string, now: Date) => Math.max(0, Math.floor((now.getTime() - new Date(from).getTime()) / 86_400_000));

/* ---------- where the days go ---------- */

/** The order steps "Where the days go" splits an order's time into (order statuses grouped). */
export const STAGE_GROUPS = [
  { key: 'jobsheet_pending', label: 'Jobsheet pending', statuses: ['pending_production', 'ready_production'] },
  { key: 'production', label: 'Production', statuses: ['jobsheet_created', 'in_production', 'production_completed', 'taka_entry_done', 'outside_production', 'awaiting_goods'] },
  { key: 'butta', label: 'Butta cutting', statuses: ['in_butta_cutting', 'ready_for_mill'] },
  { key: 'mill', label: 'Mill', statuses: ['in_mill', 'received_from_mill'] },
  { key: 'godown', label: 'Godown', statuses: ['mill_qc_done', 'in_godown'] },
  { key: 'dispatch', label: 'Dispatch', statuses: ['ready_for_dispatch', 'partly_dispatched'] },
] as const;
export type StageGroupKey = (typeof STAGE_GROUPS)[number]['key'];
const groupOf = (status: string): StageGroupKey | null => STAGE_GROUPS.find((g) => (g.statuses as readonly string[]).includes(status))?.key ?? null;

/**
 * Days an order spent in each step: from each status change to the next one (the last status runs until `endAt`, i.e. now
 * for open orders). `changes` = the order's status history, any order; `start` = when it was booked (its first status).
 */
export function stageDurations(p: { start: string; firstStatus: string; changes: readonly { at: string; to: string }[]; endAt: string }): Partial<Record<StageGroupKey, number>> {
  const steps = [{ at: p.start, to: p.firstStatus }, ...[...p.changes].sort((a, b) => a.at.localeCompare(b.at))];
  const out: Partial<Record<StageGroupKey, number>> = {};
  for (let i = 0; i < steps.length; i++) {
    const g = groupOf(steps[i].to);
    if (!g) continue;
    const end = i + 1 < steps.length ? steps[i + 1].at : p.endAt;
    const ms = new Date(end).getTime() - new Date(steps[i].at).getTime();
    if (ms > 0) out[g] = (out[g] ?? 0) + ms / 86_400_000;
  }
  return out;
}

/** The average per step over many orders (only orders that spent time in a step count for it). */
export function averageStages(list: readonly Partial<Record<StageGroupKey, number>>[]): { key: StageGroupKey; label: string; days: number; orders: number }[] {
  return STAGE_GROUPS.map((g) => {
    const vals = list.map((d) => d[g.key]).filter((v): v is number => v !== undefined && v > 0);
    return { key: g.key, label: g.label, days: vals.length ? sum(vals) / vals.length : 0, orders: vals.length };
  });
}

/* ---------- loom hours ---------- */

/** Hours of [start, end] inside [from, to] (instants). */
export function overlapHours(start: string, end: string, from: string, to: string): number {
  const a = Math.max(new Date(start).getTime(), new Date(from).getTime());
  const b = Math.min(new Date(end).getTime(), new Date(to).getTime());
  return b > a ? (b - a) / 3_600_000 : 0;
}

/** Utilisation = running hours ÷ available hours (days × working hours per day), capped at 100 %. */
export function utilisation(runningHours: number, days: number, hoursPerDay: number): number | null {
  const available = days * hoursPerDay;
  return available > 0 ? Math.min(100, (runningHours / available) * 100) : null;
}

/* ---------- dispatch expected ---------- */

/** Estimated week (1–4) a taka will be dispatched in, from where it is now. */
export function dispatchWeek(stage: string): 1 | 2 | 3 | 4 | null {
  if (stage === 'ready_dispatch') return 1;
  if (stage === 'final') return 2;
  if (stage === 'at_mill' || stage === 'mill_qc' || stage === 'refinish') return 3;
  if (stage === 'at_butta' || stage === 'butta_qc' || stage === 'waiting_mill' || stage === 'rework_butta' || stage === 'entered') return 4;
  return null;
}

/** "Week of 16 Nov" labels for the next 4 weeks from today (Monday-based). */
export function nextWeeks(today: string, n = 4): { from: string; label: string }[] {
  const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  const monday = addDays(today, -dow);
  return Array.from({ length: n }, (_, i) => {
    const from = addDays(monday, i * 7);
    return { from, label: i === 0 ? 'This week' : `Wk of ${Number(from.slice(8, 10))} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(from.slice(5, 7)) - 1]}` };
  });
}

/* ---------- text ---------- */

const inr0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

/** ₹ in the Indian way: "₹ 4,820", "₹ 4.8 L", "₹ 1.25 Cr". */
export function rupeesShort(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (a >= 1e7) return `${sign}₹ ${inr2.format(a / 1e7)} Cr`;
  if (a >= 1e5) return `${sign}₹ ${inr2.format(Number((a / 1e5).toFixed(2)))} L`;
  return `${sign}₹ ${inr0.format(a)}`;
}

/** A quantity in the Indian way with its unit ("1,240 pcs", "860.5 m", "12.3 %", "4.2 days"). */
export function formatValue(v: number | null | undefined, unit: CardUnit): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  switch (unit) {
    case 'rs':
      return rupeesShort(v);
    case 'pct':
      return `${inr2.format(Number(v.toFixed(1)))} %`;
    case 'm':
      return `${inr2.format(v)} m`;
    case 'kg':
      return `${inr2.format(Number(v.toFixed(2)))} kg`;
    case 'days':
      return `${inr2.format(Number(v.toFixed(1)))} ${Math.abs(v - 1) < 1e-9 ? 'day' : 'days'}`;
    case 'hours':
      return `${inr0.format(v)} h`;
    case 'count':
      return inr0.format(v);
    default:
      return `${inr0.format(v)} ${v === 1 ? UNIT_ONE[unit] : unit}`;
  }
}
const UNIT_ONE: Partial<Record<CardUnit, string>> = { pcs: 'pc', takas: 'taka', orders: 'order', frames: 'frame', jobsheets: 'jobsheet', sections: 'section', beams: 'beam' };

/** The number alone (for big figures) and the unit beside it. */
export function splitValue(v: number | null | undefined, unit: CardUnit): { num: string; unit: string } {
  const text = formatValue(v, unit);
  if (unit === 'rs') return { num: text.replace('₹ ', ''), unit: '₹' };
  if (unit === 'count') return { num: text, unit: '' };
  const i = text.lastIndexOf(' ');
  return i > 0 ? { num: text.slice(0, i), unit: text.slice(i + 1) } : { num: text, unit: '' };
}
