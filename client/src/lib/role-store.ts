import { DEFAULT_ROLE, isRoleKey, type RoleKey } from '@/config/roles';

const STORAGE_KEY = 'rivoora.role';

function read(): RoleKey {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isRoleKey(v) ? v : DEFAULT_ROLE;
  } catch {
    return DEFAULT_ROLE;
  }
}

let current: RoleKey = read();
const listeners = new Set<() => void>();

/** Tiny external store so both React and the API client read the same role. */
export const roleStore = {
  get: () => current,
  set(role: RoleKey) {
    if (role === current) return;
    current = role;
    try {
      localStorage.setItem(STORAGE_KEY, role);
    } catch {
      /* storage unavailable — keep in memory only */
    }
    listeners.forEach((l) => l());
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
