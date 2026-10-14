import type { ApiErrorBody, UploadResult } from '@rivoora/shared';
import { ACT_AS_HEADER } from '@/config/roles';
import { authStore } from './auth-store';
import { roleStore } from './role-store';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public field?: string,
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | (string | number)[] | null | undefined>;

export function buildQuery(query?: Query): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length) params.set(key, value.join(','));
    } else params.set(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

interface RequestOptions {
  query?: Query;
  body?: unknown;
  signal?: AbortSignal;
}

async function request<T>(method: string, path: string, { query, body, signal }: RequestOptions = {}): Promise<T> {
  // The session cookie identifies the user; only a role-switching user (Jemish, Gaurang) acting as another role sends X-Act-As.
  const headers: Record<string, string> = { Accept: 'application/json' };
  const own = authStore.user()?.role;
  if (own && roleStore.get() !== own) headers[ACT_AS_HEADER] = roleStore.get();
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let res: Response;
  try {
    res = await fetch(`/api${path}${buildQuery(query)}`, { method, headers, body: payload, signal, credentials: 'same-origin' });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError('Could not reach the server. Check your connection and try again.', 0);
  }

  // The session ended (expired, logged out elsewhere, user deactivated): show the login screen.
  if (res.status === 401 && path !== '/auth/login' && authStore.user()) authStore.signOut();
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const e = (data as ApiErrorBody | null)?.error;
    throw new ApiError(e?.message ?? `Request failed (${res.status})`, res.status, e?.field);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) => request<T>('GET', path, { query, signal }),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, { body }),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, { body }),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body }),
  delete: <T = void>(path: string) => request<T>('DELETE', path),
  async upload(file: File, folder: 'designs' | 'notes' | 'damages'): Promise<UploadResult> {
    const form = new FormData();
    form.append('file', await shrinkImage(file));
    return request<UploadResult>('POST', `/uploads${buildQuery({ folder })}`, { body: form });
  },
};

const SHRINK_ABOVE_BYTES = 3 * 1024 * 1024;
const SHRINK_MAX_SIDE = 2560;

/**
 * Large photos are scaled down in the browser before upload (the hosted API accepts ≤ 4.5 MB per request;
 * the server stores ≤ 1600px anyway). Formats the browser can't decode (e.g. HEIC) are sent as they are.
 */
async function shrinkImage(file: File): Promise<File> {
  if (file.size <= SHRINK_ABOVE_BYTES || typeof createImageBitmap !== 'function') return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, SHRINK_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}
