import type { ApiErrorBody, UploadResult } from '@rivoora/shared';
import { ROLE_HEADER } from '@/config/roles';
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
  const headers: Record<string, string> = { [ROLE_HEADER]: roleStore.get(), Accept: 'application/json' };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let res: Response;
  try {
    res = await fetch(`/api${path}${buildQuery(query)}`, { method, headers, body: payload, signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError('Could not reach the server. Check your connection and try again.', 0);
  }

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
  delete: <T = void>(path: string) => request<T>('DELETE', path),
  upload(file: File, folder: 'designs' | 'notes'): Promise<UploadResult> {
    const form = new FormData();
    form.append('file', file);
    return request<UploadResult>('POST', `/uploads${buildQuery({ folder })}`, { body: form });
  },
};

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}
