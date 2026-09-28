import type { RoleKey } from './roles';

/**
 * Central order-status configuration, used by both client and server.
 * Filters, badges, role visibility and the details screen all read from here,
 * so adding a status only means adding an entry below.
 *
 * Gaurang sees every status from "Ready for production" onwards, so every
 * status added after `ready_production` should use `FROM_READY` as `visibleTo`.
 */
export interface StatusConfig {
  key: string;
  label: string;
  /** Position in the workflow. Gaps leave room to insert statuses later. */
  sequence: number;
  badge: { bg: string; text: string; dot: string };
  visibleTo: readonly RoleKey[];
}

const ALL_ROLES: readonly RoleKey[] = ['jemish', 'gaurang'];
const FROM_READY: readonly RoleKey[] = ALL_ROLES;

export const ORDER_STATUSES = [
  {
    key: 'pending_production',
    label: 'Pending for production',
    sequence: 10,
    badge: { bg: '#FEF3C7', text: '#92400E', dot: '#F59E0B' },
    visibleTo: ['jemish'],
  },
  {
    key: 'ready_production',
    label: 'Ready for production',
    sequence: 20,
    badge: { bg: '#DCFCE7', text: '#166534', dot: '#22C55E' },
    visibleTo: FROM_READY,
  },
  // Future statuses (e.g. in_production … completed) go here.
] as const satisfies readonly StatusConfig[];

export type OrderStatusKey = (typeof ORDER_STATUSES)[number]['key'];

export const STATUS = {
  PENDING_PRODUCTION: 'pending_production',
  READY_PRODUCTION: 'ready_production',
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
