/**
 * Central role configuration. The client re-exports this from
 * client/src/config/roles.ts and the server from server/src/config/roles.ts.
 * To add a role: add its key to ROLE_KEYS, give it a config below and
 * add it to `visibleTo` of the statuses it may see (see statuses.ts).
 */
export const ROLE_KEYS = ['jemish', 'gaurang'] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export interface RolePermissions {
  /** Can see the rate of an order (details screen / add form only, never the list). */
  canSeeRate: boolean;
  canAddOrder: boolean;
  canSendToProduction: boolean;
  canUndoProduction: boolean;
  /** Add / edit / delete customers, materials and designs. */
  canManageMasters: boolean;
}

export interface RoleConfig {
  key: RoleKey;
  name: string;
  title: string;
  initials: string;
  permissions: RolePermissions;
}

export const ROLES: Record<RoleKey, RoleConfig> = {
  jemish: {
    key: 'jemish',
    name: 'Jemish',
    title: 'Owner',
    initials: 'J',
    permissions: {
      canSeeRate: true,
      canAddOrder: true,
      canSendToProduction: true,
      canUndoProduction: true,
      canManageMasters: true,
    },
  },
  gaurang: {
    key: 'gaurang',
    name: 'Gaurang',
    title: 'Partner',
    initials: 'G',
    permissions: {
      canSeeRate: true,
      canAddOrder: false,
      canSendToProduction: false,
      canUndoProduction: false,
      canManageMasters: false,
    },
  },
};

export const DEFAULT_ROLE: RoleKey = 'jemish';
export const ROLE_HEADER = 'X-Role';

export function isRoleKey(value: unknown): value is RoleKey {
  return typeof value === 'string' && (ROLE_KEYS as readonly string[]).includes(value);
}

export function can(role: RoleKey, permission: keyof RolePermissions): boolean {
  return ROLES[role].permissions[permission];
}
