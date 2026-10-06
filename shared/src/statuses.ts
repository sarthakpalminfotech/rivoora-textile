import type { RoleKey } from './roles';

/**
 * Central order-status configuration, used by both client and server.
 * Filters, badges, role visibility and the details screen all read from here,
 * so adding a status only means adding an entry below.
 *
 * Gaurang sees every status from "Jobsheet pending" (`ready_production`) onwards, so every status added
 * after it should use `FROM_READY` as `visibleTo`. The supervisor sees no order statuses at all.
 */
export interface StatusConfig {
  key: string;
  label: string;
  /** Position in the workflow. Gaps leave room to insert statuses later. */
  sequence: number;
  badge: { bg: string; text: string; dot: string };
  visibleTo: readonly RoleKey[];
}

const FROM_READY: readonly RoleKey[] = ['jemish', 'gaurang'];

export const ORDER_STATUSES = [
  {
    key: 'pending_production',
    label: 'Pending for production',
    sequence: 10,
    badge: { bg: '#FEF3C7', text: '#92400E', dot: '#F59E0B' },
    visibleTo: ['jemish'],
  },
  {
    // Key kept as `ready_production` so existing data keeps working; only the label changed.
    key: 'ready_production',
    label: 'Jobsheet pending',
    sequence: 20,
    badge: { bg: '#DCFCE7', text: '#166534', dot: '#22C55E' },
    visibleTo: FROM_READY,
  },
  {
    key: 'jobsheet_created',
    label: 'Jobsheet created',
    sequence: 30,
    badge: { bg: '#E0E7FF', text: '#3730A3', dot: '#6366F1' },
    visibleTo: FROM_READY,
  },
  {
    key: 'in_production',
    label: 'In production',
    sequence: 40,
    badge: { bg: '#E0F2FE', text: '#075985', dot: '#0EA5E9' },
    visibleTo: FROM_READY,
  },
  {
    key: 'production_completed',
    label: 'Production completed',
    sequence: 50,
    badge: { bg: '#CCFBF1', text: '#115E59', dot: '#14B8A6' },
    visibleTo: FROM_READY,
  },
  {
    key: 'taka_entry_done',
    label: 'Taka entry done',
    sequence: 60,
    badge: { bg: '#F3E8FF', text: '#6B21A8', dot: '#A855F7' },
    visibleTo: FROM_READY,
  },
  {
    key: 'in_butta_cutting',
    label: 'In butta cutting',
    sequence: 70,
    badge: { bg: '#FFEDD5', text: '#9A3412', dot: '#F97316' },
    visibleTo: FROM_READY,
  },
  {
    key: 'ready_for_mill',
    label: 'Ready for mill',
    sequence: 80,
    badge: { bg: '#FAE8FF', text: '#86198F', dot: '#D946EF' },
    visibleTo: FROM_READY,
  },
  {
    key: 'in_mill',
    label: 'In mill',
    sequence: 90,
    badge: { bg: '#EDE9FE', text: '#5B21B6', dot: '#8B5CF6' },
    visibleTo: FROM_READY,
  },
  {
    key: 'received_from_mill',
    label: 'Received from mill',
    sequence: 100,
    badge: { bg: '#CFFAFE', text: '#155E75', dot: '#06B6D4' },
    visibleTo: FROM_READY,
  },
] as const satisfies readonly StatusConfig[];

export type OrderStatusKey = (typeof ORDER_STATUSES)[number]['key'];

export const STATUS = {
  PENDING_PRODUCTION: 'pending_production',
  READY_PRODUCTION: 'ready_production',
  JOBSHEET_CREATED: 'jobsheet_created',
  IN_PRODUCTION: 'in_production',
  PRODUCTION_COMPLETED: 'production_completed',
  TAKA_ENTRY_DONE: 'taka_entry_done',
  IN_BUTTA_CUTTING: 'in_butta_cutting',
  READY_FOR_MILL: 'ready_for_mill',
  IN_MILL: 'in_mill',
  RECEIVED_FROM_MILL: 'received_from_mill',
} as const satisfies Record<string, OrderStatusKey>;

export const STATUS_KEYS = ORDER_STATUSES.map((s) => s.key) as [OrderStatusKey, ...OrderStatusKey[]];

const byKey = new Map<string, StatusConfig>(ORDER_STATUSES.map((s) => [s.key, s]));

export function getStatus(key: string): StatusConfig {
  return (
    byKey.get(key) ?? {
      key,
      label: key,
      sequence: 0,
      badge: { bg: '#F1F5F9', text: '#334155', dot: '#94A3B8' },
      visibleTo: [],
    }
  );
}

export function isStatusKey(value: unknown): value is OrderStatusKey {
  return typeof value === 'string' && byKey.has(value);
}

export function statusesForRole(role: RoleKey): StatusConfig[] {
  return ORDER_STATUSES.filter((s) => (s.visibleTo as readonly RoleKey[]).includes(role)).sort(
    (a, b) => a.sequence - b.sequence,
  );
}

export function visibleStatusKeys(role: RoleKey): OrderStatusKey[] {
  return statusesForRole(role).map((s) => s.key as OrderStatusKey);
}

export function canRoleSeeStatus(role: RoleKey, status: string): boolean {
  return (getStatus(status).visibleTo as readonly RoleKey[]).includes(role);
}

/** True for Jobsheet pending (`ready_production`) and every later status (jobsheets are allowed from here on). */
export function isReadyOrLater(status: string): boolean {
  return getStatus(status).sequence >= getStatus(STATUS.READY_PRODUCTION).sequence;
}

/* ------------------------------------------------------------------ */
/* Jobsheet statuses (per jobsheet, separate from the order status)     */
/* ------------------------------------------------------------------ */

export interface JobsheetStatusConfig {
  key: string;
  label: string;
  /** Label override per role (the supervisor sees "Sent" as his "Pending"). */
  roleLabels?: Partial<Record<RoleKey, string>>;
  sequence: number;
  badge: { bg: string; text: string; dot: string };
  visibleTo: readonly RoleKey[];
}

const ALL_ROLES: readonly RoleKey[] = ['jemish', 'gaurang', 'supervisor', 'taka_entry'];

/**
 * pending → (send) → sent → (start) → ongoing → (complete / change machine / taka entry) → completed.
 * Pull back: sent → pending. Only Pending jobsheets can be edited or deleted.
 * The Taka entry role sees every status (a jobsheet is completed when its takas are submitted).
 */
export const JOBSHEET_STATUSES = [
  {
    key: 'pending',
    label: 'Pending',
    sequence: 10,
    badge: { bg: '#F1F5F9', text: '#334155', dot: '#94A3B8' },
    visibleTo: [...FROM_READY, 'taka_entry'],
  },
  {
    key: 'sent',
    label: 'Sent to supervisor',
    roleLabels: { supervisor: 'Pending' },
    sequence: 20,
    badge: { bg: '#FEF3C7', text: '#92400E', dot: '#F59E0B' },
    visibleTo: ALL_ROLES,
  },
  {
    key: 'ongoing',
    label: 'Ongoing',
    roleLabels: { supervisor: 'On-loom' },
    sequence: 30,
    badge: { bg: '#DBEAFE', text: '#1E40AF', dot: '#3B82F6' },
    visibleTo: ALL_ROLES,
  },
  {
    key: 'completed',
    label: 'Completed',
    sequence: 40,
    badge: { bg: '#DCFCE7', text: '#166534', dot: '#22C55E' },
    visibleTo: ALL_ROLES,
  },
] as const satisfies readonly JobsheetStatusConfig[];

export type JobsheetStatusKey = (typeof JOBSHEET_STATUSES)[number]['key'];
export const JOBSHEET_STATUS_KEYS = JOBSHEET_STATUSES.map((s) => s.key) as [JobsheetStatusKey, ...JobsheetStatusKey[]];

export const JOBSHEET_STATUS = {
  PENDING: 'pending',
  SENT: 'sent',
  ONGOING: 'ongoing',
  COMPLETED: 'completed',
} as const satisfies Record<string, JobsheetStatusKey>;

export const DEFAULT_JOBSHEET_STATUS: JobsheetStatusKey = JOBSHEET_STATUS.PENDING;

export function getJobsheetStatus(key: string | null | undefined): JobsheetStatusConfig {
  return JOBSHEET_STATUSES.find((s) => s.key === key) ?? JOBSHEET_STATUSES[0];
}

/** The label a role sees for a jobsheet status. */
export function jobsheetStatusLabel(status: string, role: RoleKey): string {
  const s = getJobsheetStatus(status);
  return s.roleLabels?.[role] ?? s.label;
}

export function jobsheetStatusesForRole(role: RoleKey): JobsheetStatusKey[] {
  return JOBSHEET_STATUSES.filter((s) => (s.visibleTo as readonly RoleKey[]).includes(role)).map((s) => s.key);
}

export function canRoleSeeJobsheetStatus(role: RoleKey, status: string): boolean {
  return (getJobsheetStatus(status).visibleTo as readonly RoleKey[]).includes(role);
}

/** An active jobsheet as seen by the order-status rule: its status and how many active takas it has. */
export interface JobsheetStatusInput {
  status: string;
  takaCount?: number;
}

/**
 * The order status that follows from its active jobsheets and takas (for orders that are Jobsheet pending or later):
 * none → Jobsheet pending · all Completed and every one has a taka ("taka entry done" conditions) → Taka entry done,
 * or — by where the takas are, the EARLIEST unfinished stage wins — In butta cutting (a taka at butta cutting / in
 * butta QC) · Ready for mill (every taka waits for the mill) · In mill (nothing before the mill is left and a taka is
 * at / back from the mill, but not all of them are back) · Received from mill (every taka is back from the mill) ·
 * all Completed → Production completed · any Ongoing / Completed → In
 * production · otherwise (all Pending / Sent) → Jobsheet created.
 * Plain status strings are accepted too (no takas). `takaStages` = the stage of every active taka of the order.
 */
export function orderStatusForJobsheets(
  jobsheets: readonly (string | JobsheetStatusInput)[],
  takaStages: readonly string[] = [],
): OrderStatusKey {
  const list = jobsheets.map((j) => (typeof j === 'string' ? { status: j, takaCount: 0 } : j));
  if (list.length === 0) return STATUS.READY_PRODUCTION;
  if (list.every((j) => j.status === JOBSHEET_STATUS.COMPLETED)) {
    if (!list.every((j) => (j.takaCount ?? 0) > 0)) return STATUS.PRODUCTION_COMPLETED;
    if (takaStages.some((s) => s === 'at_butta' || s === 'butta_qc')) return STATUS.IN_BUTTA_CUTTING;
    if (takaStages.length > 0 && takaStages.every((s) => s === 'waiting_mill')) return STATUS.READY_FOR_MILL;
    // Nothing is in butta cutting any more. Takas still `entered` have not been through it yet (earliest stage wins).
    if (!takaStages.includes('entered')) {
      if (takaStages.length > 0 && takaStages.every((s) => s === 'mill_qc' || s === 'ready')) return STATUS.RECEIVED_FROM_MILL;
      if (takaStages.some((s) => s === 'at_mill' || s === 'mill_qc' || s === 'ready')) return STATUS.IN_MILL;
    }
    return STATUS.TAKA_ENTRY_DONE;
  }
  if (list.some((j) => j.status === JOBSHEET_STATUS.ONGOING || j.status === JOBSHEET_STATUS.COMPLETED)) {
    return STATUS.IN_PRODUCTION;
  }
  return STATUS.JOBSHEET_CREATED;
}
