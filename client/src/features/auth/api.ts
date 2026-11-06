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

/** The device location, high accuracy, 10 s (QC login + heartbeat). null = denied / unavailable. */
export function getDeviceLocation(): Promise<{ lat: number; lng: number; accuracy: number } | null> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    );
  });
}

/**
 * Log in. A QC user needs the device location: the first try goes without it; when the server answers "location needed"
 * (403, field location_required) the browser is asked for it and the login is sent again with it (or with `locationDenied`).
 */
export async function login(phone: string, password: string, onLocating?: (on: boolean) => void): Promise<void> {
  let session: AuthSession;
  try {
    session = await api.post<AuthSession>('/auth/login', { phone, password });
  } catch (err) {
    if (!(err instanceof ApiError) || err.field !== 'location_required') throw err;
    onLocating?.(true);
    const location = await getDeviceLocation();
    onLocating?.(false);
    session = await api.post<AuthSession>('/auth/login', location ? { phone, password, location } : { phone, password, locationDenied: true });
  }
  const { user } = session;
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
