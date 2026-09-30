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
] as const satisfies readonly StatusConfig[];

export type OrderStatusKey = (typeof ORDER_STATUSES)[number]['key'];

export const STATUS = {
  PENDING_PRODUCTION: 'pending_production',
  READY_PRODUCTION: 'ready_production',
  JOBSHEET_CREATED: 'jobsheet_created',
  IN_PRODUCTION: 'in_production',
  PRODUCTION_COMPLETED: 'production_completed',
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

const ALL_ROLES: readonly RoleKey[] = ['jemish', 'gaurang', 'supervisor'];

/**
 * pending → (send) → sent → (start) → ongoing → (complete / change machine) → completed.
 * Pull back: sent → pending. Only Pending jobsheets can be edited or deleted.
 */
export const JOBSHEET_STATUSES = [
  {
    key: 'pending',
    label: 'Pending',
    sequence: 10,
    badge: { bg: '#F1F5F9', text: '#334155', dot: '#94A3B8' },
    visibleTo: FROM_READY,
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

/**
 * The order status that follows from its active jobsheets (for orders that are Jobsheet pending or later):
 * none → Jobsheet pending · all Completed → Production completed · any Ongoing / Completed → In production ·
 * otherwise (all Pending / Sent) → Jobsheet created.
 */
export function orderStatusForJobsheets(statuses: readonly string[]): OrderStatusKey {
  if (statuses.length === 0) return STATUS.READY_PRODUCTION;
  if (statuses.every((s) => s === JOBSHEET_STATUS.COMPLETED)) return STATUS.PRODUCTION_COMPLETED;
  if (statuses.some((s) => s === JOBSHEET_STATUS.ONGOING || s === JOBSHEET_STATUS.COMPLETED)) return STATUS.IN_PRODUCTION;
  return STATUS.JOBSHEET_CREATED;
}
