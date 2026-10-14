import { can, DEFAULT_ROLE, isRoleKey, type RoleKey } from '@/config/roles';

const STORAGE_KEY = 'rivoora.role';

function stored(): RoleKey | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isRoleKey(v) ? v : null;
  } catch {
    return null;
  }
}

let current: RoleKey = DEFAULT_ROLE;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/**
 * Tiny external store for the ACTING role (React and the API client read the same one). The logged-in user's own role
 * is the default; only users who can switch roles (Jemish, Gaurang) may act as another one, and their choice is
 * remembered in this browser.
 */
export const roleStore = {
  get: () => current,
  /** Called at login / page load: the user's own role, or the remembered one for a role-switching user. */
  init(userRole: RoleKey) {
    const remembered = stored();
    const next = can(userRole, 'canSwitchRoles') && remembered ? remembered : userRole;
    if (next === current) return;
    current = next;
    notify();
  },
  set(role: RoleKey, userRole: RoleKey) {
    const next = can(userRole, 'canSwitchRoles') ? role : userRole;
    if (next === current) return;
    current = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage unavailable — keep in memory only */
    }
    notify();
  },
  /** Logout: forget the acting role. */
  reset() {
    current = DEFAULT_ROLE;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    notify();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
