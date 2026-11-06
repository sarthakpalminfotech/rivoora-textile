import type { AuthUser } from '@rivoora/shared';
import { roleStore } from './role-store';

export type AuthState = { status: 'loading' } | { status: 'out' } | { status: 'in'; user: AuthUser };

let state: AuthState = { status: 'loading' };
/** Why the user was signed out (a QC session whose login time ended …) — shown once on the login screen. */
let signedOutMessage: string | null = null;
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
  signOut(message?: string) {
    roleStore.reset();
    signedOutMessage = message ?? null;
    set({ status: 'out' });
  },
  /** The message of the last forced sign-out, once. */
  takeSignedOutMessage(): string | null {
    const m = signedOutMessage;
    signedOutMessage = null;
    return m;
  },
  /** The QC session's end time moved (heartbeat). */
  setLimitUntil(limitUntil: string | null) {
    if (state.status === 'in' && state.user.limitUntil !== limitUntil) set({ status: 'in', user: { ...state.user, limitUntil } });
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
