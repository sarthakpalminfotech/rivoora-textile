// Role permissions live in the shared package so the server enforces the same rules.
// Mirrored on the server in server/src/config/roles.ts.
export { ROLES, ROLE_KEYS, DEFAULT_ROLE, ROLE_HEADER, ACT_AS_HEADER, can, isRoleKey, landingRoute } from '@rivoora/shared';
export type { RoleKey, RoleConfig, RolePermissions } from '@rivoora/shared';
