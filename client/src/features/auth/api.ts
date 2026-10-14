import type { AuthSession } from '@rivoora/shared';
import { api, ApiError } from '@/lib/api';
import { authStore } from '@/lib/auth-store';
import { queryClient } from '@/lib/query-client';

/** Page load: who am I? A 401 just means "not logged in" (the login screen shows); other errors are surfaced. */
export async function loadSession(): Promise<'in' | 'out' | 'error'> {
  try {
    const { user } = await api.get<AuthSession>('/auth/me');
    authStore.signIn(user);
    return 'in';
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      authStore.signOut();
      return 'out';
    }
    return 'error';
  }
}

export async function login(phone: string, password: string): Promise<void> {
  const { user } = await api.post<AuthSession>('/auth/login', { phone, password });
  queryClient.clear();
  authStore.signIn(user);
}

export async function logout(): Promise<void> {
  try {
    await api.post('/auth/logout');
  } catch {
    /* the cookie may already be gone — log out locally either way */
  }
  queryClient.clear();
  authStore.signOut();
}
