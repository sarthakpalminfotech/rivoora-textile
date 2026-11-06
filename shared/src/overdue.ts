/**
 * Sprint 21 (CR-11 + C5) — overdue alerts. Pure rules (the server feeds the rows, the screens show the result).
 * A clock starts when a stage begins; the alert shows once the stage has lasted LONGER than its limit. Alerts are
 * shown on screen only (no push / SMS) and computed on request — nothing is stored.
 */
import type { RoleKey } from './roles';

/** All limits in one place so they can change later. Days. */
export const OVERDUE_LIMITS = {
  /** A jobsheet on the loom (from `started_at`) until it is completed. */
  productionDays: 3,
  /** Per taka on a butta challan (from the challan date) until it is received. */
  buttaDays: 3,
  /** Per taka on a mill challan (from the challan date) until it is received. */
  millDays: 8,
  /** The whole order, from the first jobsheet going on the loom until it is fully dispatched or closed. */
  wholeOrderDays: { jemish: 25, gaurang: 20, supervisor: 20 } as Partial<Record<RoleKey, number>>,
} as const;

export const ALERT_TYPES = ['production', 'butta', 'mill', 'whole_order', 'sent_short'] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

export const ALERT_TYPE_LABEL: Record<AlertType, string> = {
  production: 'Production overdue',
  butta: 'Butta cutting overdue',
  mill: 'Mill overdue',
  whole_order: 'Whole order overdue',
  sent_short: 'Order sent short',
};

/** Which roles see which alert type. The supervisor never sees "sent short" (no quantities of dispatch). */
export const ALERT_ROLES: Record<AlertType, readonly RoleKey[]> = {
  production: ['jemish', 'gaurang', 'supervisor'],
  butta: ['jemish', 'gaurang', 'supervisor'],
  mill: ['jemish', 'gaurang', 'supervisor'],
  whole_order: ['jemish', 'gaurang', 'supervisor'],
  sent_short: ['jemish', 'gaurang'],
};

export const isAlertType = (v: unknown): v is AlertType => typeof v === 'string' && (ALERT_TYPES as readonly string[]).includes(v);

/** Whole days between two instants (a partial day does not count). */
export function wholeDays(from: string | Date, now: Date): number {
  const start = typeof from === 'string' ? new Date(from) : from;
  const ms = now.getTime() - start.getTime();
  return ms > 0 ? Math.floor(ms / 86_400_000) : 0;
}

/** True once the stage has lasted LONGER than the limit (exactly the limit is still on time). */
export function isOverdue(from: string | Date, now: Date, limitDays: number): boolean {
  const start = typeof from === 'string' ? new Date(from) : from;
  return now.getTime() - start.getTime() > limitDays * 86_400_000;
}

export interface OverdueAlert {
  type: AlertType;
  orderId: number;
  orderNo: number;
  designCode: string | null;
  /** "Jobsheet 319 on loom 7", "GSM-12 · 5 takas", "MIL-4 · 3 takas", "In production", "Sent 90 of 100 pcs". */
  stage: string;
  startedAt: string;
  /** Whole days since the start. */
  days: number;
  limitDays: number;
  /** Days beyond the limit (0 for "sent short"). */
  overBy: number;
  /** Where to look: the order, the challan … */
  link: string;
}

/* ---------------- inputs (what the server loads) ---------------- */

export interface AlertJobsheetInput {
  jobsheetNo: number;
  jobsheetId: number;
  orderId: number;
  orderNo: number;
  designCode: string | null;
  startedAt: string;
  machineNo?: number | null;
}
export interface AlertChallanInput {
  kind: 'butta' | 'mill';
  challanId: number;
  /** "GSM-12" / "MIL-4" */
  label: string;
  /** yyyy-MM-dd */
  challanDate: string;
  orderId: number;
  orderNo: number;
  designCode: string | null;
  /** Takas of this order on the challan not yet received (or lost). */
  pendingTakas: number;
}
export interface AlertOrderInput {
  orderId: number;
  orderNo: number;
  designCode: string | null;
  /** The first real jobsheet's `started_at` (null: nothing started yet). */
  firstStartedAt: string | null;
  status: string;
  ordered: number;
  dispatched: number;
  unit: 'pcs' | 'meters' | string;
}

export interface AlertInput {
  jobsheets: readonly AlertJobsheetInput[];
  challans: readonly AlertChallanInput[];
  orders: readonly AlertOrderInput[];
}

const FINISHED_STATUSES = ['dispatched', 'returned', 'closed'];

/** Builds every alert the role may see, most overdue first. */
export function buildOverdueAlerts(input: AlertInput, role: RoleKey, now: Date): OverdueAlert[] {
  const out: OverdueAlert[] = [];
  const sees = (t: AlertType) => ALERT_ROLES[t].includes(role);

  if (sees('production')) {
    for (const j of input.jobsheets) {
      if (!isOverdue(j.startedAt, now, OVERDUE_LIMITS.productionDays)) continue;
      const days = wholeDays(j.startedAt, now);
      out.push({
        type: 'production',
        orderId: j.orderId,
        orderNo: j.orderNo,
        designCode: j.designCode,
        stage: `Jobsheet ${j.jobsheetNo} on the loom${j.machineNo ? ` ${j.machineNo}` : ''}`,
        startedAt: j.startedAt,
        days,
        limitDays: OVERDUE_LIMITS.productionDays,
        overBy: Math.max(0, days - OVERDUE_LIMITS.productionDays),
        link: `/orders/${j.orderId}?tab=jobsheets`,
      });
    }
  }

  for (const c of input.challans) {
    const type: AlertType = c.kind === 'butta' ? 'butta' : 'mill';
    if (!sees(type) || c.pendingTakas <= 0) continue;
    const limit = c.kind === 'butta' ? OVERDUE_LIMITS.buttaDays : OVERDUE_LIMITS.millDays;
    // The challan date is a calendar day: the clock starts at the start of that day (IST).
    const started = `${c.challanDate}T00:00:00+05:30`;
    if (!isOverdue(started, now, limit)) continue;
    const days = wholeDays(started, now);
    out.push({
      type,
      orderId: c.orderId,
      orderNo: c.orderNo,
      designCode: c.designCode,
      stage: `${c.label} · ${c.pendingTakas} ${c.pendingTakas === 1 ? 'taka' : 'takas'}`,
      startedAt: started,
      days,
      limitDays: limit,
      overBy: Math.max(0, days - limit),
      link: `/${c.kind}/challans/${c.challanId}`,
    });
  }

  const wholeLimit = OVERDUE_LIMITS.wholeOrderDays[role];
  if (sees('whole_order') && wholeLimit !== undefined) {
    for (const o of input.orders) {
      if (!o.firstStartedAt || FINISHED_STATUSES.includes(o.status) || !isOverdue(o.firstStartedAt, now, wholeLimit)) continue;
      const days = wholeDays(o.firstStartedAt, now);
      out.push({
        type: 'whole_order',
        orderId: o.orderId,
        orderNo: o.orderNo,
        designCode: o.designCode,
        stage: 'Order not finished',
        startedAt: o.firstStartedAt,
        days,
        limitDays: wholeLimit,
        overBy: Math.max(0, days - wholeLimit),
        link: `/orders/${o.orderId}`,
      });
    }
  }

  if (sees('sent_short')) {
    for (const o of input.orders) {
      if ((o.status !== 'dispatched' && o.status !== 'closed') || o.dispatched <= 0 || o.dispatched >= o.ordered) continue;
      const unit = o.unit === 'meters' ? 'm' : 'pcs';
      out.push({
        type: 'sent_short',
        orderId: o.orderId,
        orderNo: o.orderNo,
        designCode: o.designCode,
        stage: `Sent ${o.dispatched.toLocaleString('en-IN')} of ${o.ordered.toLocaleString('en-IN')} ${unit}`,
        startedAt: o.firstStartedAt ?? '',
        days: 0,
        limitDays: 0,
        overBy: 0,
        link: `/orders/${o.orderId}`,
      });
    }
  }

  return out.sort((a, b) => b.overBy - a.overBy || a.orderNo - b.orderNo);
}

export function alertCounts(alerts: readonly OverdueAlert[]): Record<AlertType, number> {
  const counts = Object.fromEntries(ALERT_TYPES.map((t) => [t, 0])) as Record<AlertType, number>;
  for (const a of alerts) counts[a.type] += 1;
  return counts;
}
