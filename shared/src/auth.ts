/**
 * Login helpers shared by server and client: the phone number rule, the default password, the role-switching rule.
 */
import { ROLES, can, isRoleKey, type RoleKey } from './roles';

export const LOGIN_PHONE_REGEX = /^\d{10}$/;
export const SESSION_DAYS = 30;
export const MIN_PASSWORD_LENGTH = 6;
export const MAX_PASSWORD_LENGTH = 100;

/** Digits only, at most 10 — what the phone fields keep while typing. */
export function cleanPhone(value: string): string {
  return value.replace(/\D/g, '').slice(0, 10);
}

export const isValidPhone = (phone: string) => LOGIN_PHONE_REGEX.test(phone);

/** `Rivoora@` + the first 3 digits of the phone number (9999999999 → Rivoora@999). */
export function defaultPassword(phone: string): string {
  return `Rivoora@${phone.replace(/\D/g, '').slice(0, 3)}`;
}

/**
 * The role a request acts with: the logged-in user's own role, or — only for users with `canSwitchRoles` — the role
 * named in X-Act-As. For everyone else the header is ignored (`ignored: true`).
 */
export function resolveActingRole(userRole: RoleKey, actAs: string | undefined | null): { role: RoleKey; ignored: boolean } {
  const wanted = actAs?.trim().toLowerCase();
  if (!wanted || wanted === userRole) return { role: userRole, ignored: false };
  if (!isRoleKey(wanted) || !can(userRole, 'canSwitchRoles')) return { role: userRole, ignored: true };
  return { role: wanted, ignored: false };
}

/** Roles a user may switch to (none unless the role can switch). */
export function switchableRoles(userRole: RoleKey): RoleKey[] {
  return can(userRole, 'canSwitchRoles') ? (Object.keys(ROLES) as RoleKey[]) : [];
}

/** The default users created by the migrate step (only when the phone doesn't exist yet). */
export const DEFAULT_USERS: readonly { name: string; phone: string; role: RoleKey }[] = [
  { name: 'Jenish', phone: '9999999999', role: 'jemish' },
  { name: 'Gaurang', phone: '8888888888', role: 'gaurang' },
  { name: 'Supervisor', phone: '7777777777', role: 'supervisor' },
  { name: 'Taka entry', phone: '6666666666', role: 'taka_entry' },
  { name: 'QC', phone: '5555555555', role: 'qc' },
  { name: 'Godown supervisor', phone: '4444444444', role: 'godown_supervisor' },
  { name: 'Dhruvil', phone: '3333333333', role: 'dhruvil' },
];

export interface AuthUser {
  id: number;
  name: string;
  /** The user's own role (the acting role may differ for Jenish / Gaurang). */
  role: RoleKey;
}
