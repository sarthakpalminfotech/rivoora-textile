import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request context. The auth middleware stores the REAL logged-in user here so the history writers (taka events,
 * jobsheet events, order status history, new dispatch rows) can record `user_id` without every service call having to
 * pass it along. Outside a request (seed, scripts) there is no user and `currentUserId()` is null.
 */
interface RequestContext {
  userId: number | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const runWithUser = <T>(userId: number | null, fn: () => T): T => storage.run({ userId }, fn);

export const currentUserId = (): number | null => storage.getStore()?.userId ?? null;
