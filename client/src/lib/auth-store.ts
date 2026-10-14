import type { AuthUser } from '@rivoora/shared';
import { roleStore } from './role-store';

export type AuthState = { status: 'loading' } | { status: 'out' } | { status: 'in'; user: AuthUser };

let state: AuthState = { status: 'loading' };
const listeners = new Set<() => void>();

function set(next: AuthState) {
  state = next;
  listeners.forEach((l) => l());
}

/** Who is logged in (the session itself lives in an httpOnly cookie the browser sends — never in JS). */
export const authStore = {
  get: () => state,
  user: (): AuthUser | null => (state.status === 'in' ? state.user : null),
  signIn(user: AuthUser) {
    roleStore.init(user.role);
    set({ status: 'in', user });
  },
  signOut() {
    roleStore.reset();
    set({ status: 'out' });
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
