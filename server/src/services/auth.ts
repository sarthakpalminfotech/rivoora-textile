import { and, eq, gt, lt } from 'drizzle-orm';
import { loginSchema, SESSION_DAYS, type AuthUser, type RoleKey } from '@rivoora/shared';
import { db } from '../db/client';
import { sessions, users } from '../db/schema';
import { HttpError } from '../lib/errors';
import { hashToken, newSessionToken, verifyPassword } from '../lib/password';

/** Sessions + login. Sessions are looked up by the SHA-256 of the cookie token; only the hash is stored. */

export const SESSION_COOKIE = 'rivoora_session';
const WRONG = 'Wrong number or password';
const DAY_MS = 24 * 60 * 60 * 1000;
const TOUCH_EVERY_MS = 5 * 60 * 1000;

/* ---------------- rate limiting (in memory; per server instance) ---------------- */

// 5 wrong passwords per phone, and 30 per IP (a whole workshop can share one address).
const MAX_FAILS_PHONE = 5;
const MAX_FAILS_IP = 30;
const WINDOW_MS = 15 * 60 * 1000;
const fails = new Map<string, { count: number; first: number }>();

function failState(key: string) {
  const cur = fails.get(key);
  if (cur && Date.now() - cur.first > WINDOW_MS) {
    fails.delete(key);
    return undefined;
  }
  return cur;
}

/** Throws 429 once a phone or an IP failed 5 times in 15 minutes. */
function assertNotLimited(phone: string, ip: string) {
  for (const key of [`p:${phone}`, `i:${ip}`]) {
    const cur = failState(key);
    if (cur && cur.count >= (key.startsWith('p:') ? MAX_FAILS_PHONE : MAX_FAILS_IP)) {
      const minutes = Math.max(1, Math.ceil((cur.first + WINDOW_MS - Date.now()) / 60000));
      throw new HttpError(429, `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
    }
  }
}

function recordFailure(phone: string, ip: string) {
  for (const key of [`p:${phone}`, `i:${ip}`]) {
    const cur = failState(key);
    if (cur) cur.count += 1;
    else fails.set(key, { count: 1, first: Date.now() });
  }
}

function clearFailures(phone: string, ip: string) {
  fails.delete(`p:${phone}`);
  fails.delete(`i:${ip}`);
}

/* ---------------- login / session ---------------- */

export interface LoginResult {
  user: AuthUser;
  token: string;
  maxAgeMs: number;
}

export async function login(input: unknown, ip: string): Promise<LoginResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) throw new HttpError(400, WRONG);
  const { phone, password } = parsed.data;
  assertNotLimited(phone, ip);

  const [user] = await db.select().from(users).where(and(eq(users.phone, phone), eq(users.isActive, true)));
  // Verify against a dummy hash when the phone is unknown, so both failures cost the same.
  const ok = user ? await verifyPassword(password, user.passwordHash) : (await verifyPassword(password, 'scrypt$00$00'), false);
  if (!user || !ok) {
    recordFailure(phone, ip);
    throw new HttpError(401, WRONG);
  }
  clearFailures(phone, ip);

  const token = newSessionToken();
  const now = new Date();
  const maxAgeMs = SESSION_DAYS * DAY_MS;
  await db.insert(sessions).values({
    id: hashToken(token),
    userId: user.id,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + maxAgeMs).toISOString(),
    lastSeenAt: now.toISOString(),
  });
  await db.update(users).set({ lastLoginAt: now.toISOString() }).where(eq(users.id, user.id));
  // Opportunistic cleanup of expired sessions.
  await db.delete(sessions).where(lt(sessions.expiresAt, now.toISOString()));
  return { user: { id: user.id, name: user.name, role: user.role as RoleKey }, token, maxAgeMs };
}

/** The active user behind a cookie token, or null (unknown / expired session, deactivated user). */
export async function userForToken(token: string | undefined): Promise<AuthUser | null> {
  if (!token || token.length !== 64) return null;
  const id = hashToken(token);
  const nowIso = new Date().toISOString();
  const [row] = await db
    .select({ userId: users.id, name: users.name, role: users.role, lastSeenAt: sessions.lastSeenAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, nowIso), eq(users.isActive, true)));
  if (!row) return null;
  if (Date.now() - new Date(row.lastSeenAt).getTime() > TOUCH_EVERY_MS) {
    await db.update(sessions).set({ lastSeenAt: nowIso }).where(eq(sessions.id, id));
  }
  return { id: row.userId, name: row.name, role: row.role as RoleKey };
}

export async function logout(token: string | undefined): Promise<void> {
  if (!token) return;
  await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
}

/** Password change / deactivation: the user is logged out everywhere. */
export async function deleteUserSessions(userId: number): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}
