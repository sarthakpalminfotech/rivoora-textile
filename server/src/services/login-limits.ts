import { and, asc, desc, eq, gte, inArray } from 'drizzle-orm';
import {
  allowedUntil,
  checkLocation,
  geoPointSchema,
  LOCATION_REQUIRED_FIELD,
  istParts,
  loginGrantSchema,
  loginHoursSchema,
  loginLocationSchema,
  LOG_DAYS,
  msgLoginHours,
  MSG_LOGIN_LOCATION_NEEDED,
  MSG_LOGIN_PLACE,
  MSG_TIME_OVER,
  OUTSIDE_STRIKES_LIMIT,
  SESSION_ENDED_FIELD,
  timeLabel,
  type AllowedLocation,
  type GeoPoint,
  type LoginChangeDto,
  type LoginGrant,
  type LoginGrantDto,
  type LoginLimitsData,
  type LoginLimitsSettings,
  type LoginLocationDto,
  type LoginLogEntry,
} from '@rivoora/shared';
import { db } from '../db/client';
import { loginLimitChanges, loginLimitLog, loginLimitSettings, loginLocations, loginTimeGrants, sessions, users } from '../db/schema';
import { HttpError, notFound } from '../lib/errors';
import { currentUserId } from '../lib/request-context';
import { hashToken } from '../lib/password';

/**
 * Sprint 23 (C10) — QC login limits. Only the QC role is limited: login only at an allowed place and only inside the
 * login hours (default 8:30 am – 7:20 pm, IST), or inside an extra-time grant. The session carries `valid_until` and the
 * client sends a heartbeat with its location every 5 minutes; the server ends the session when the time is over or the
 * device was outside every place for 2 heartbeats in a row. No allowed place configured = the place is not checked.
 */

const now = () => new Date();
const iso = (d: Date) => d.toISOString();

/* ---------------- settings ---------------- */

const toList = (days: string): number[] => days.split(',').map(Number).filter((n) => n >= 1 && n <= 7);

export async function loadSettings(): Promise<LoginLimitsSettings> {
  let [row] = await db.select().from(loginLimitSettings).where(eq(loginLimitSettings.id, 1));
  if (!row) {
    await db.insert(loginLimitSettings).values({ id: 1 }).onConflictDoNothing();
    [row] = await db.select().from(loginLimitSettings).where(eq(loginLimitSettings.id, 1));
  }
  return { enabled: row.enabled, fromTime: row.fromTime, toTime: row.toTime, days: toList(row.days) };
}

async function loadPlaces(): Promise<AllowedLocation[]> {
  const rows = await db.select().from(loginLocations).where(eq(loginLocations.isActive, true));
  return rows.map((r) => ({ id: r.id, name: r.name, latitude: r.latitude, longitude: r.longitude, radiusM: r.radiusM }));
}

async function liveGrants(userId: number, at: Date): Promise<LoginGrant[]> {
  const today = istParts(at).ymd;
  const rows = await db
    .select({ grantDate: loginTimeGrants.grantDate, untilTime: loginTimeGrants.untilTime })
    .from(loginTimeGrants)
    .where(and(eq(loginTimeGrants.userId, userId), eq(loginTimeGrants.status, 'active'), eq(loginTimeGrants.grantDate, today)));
  return rows;
}

async function logEvent(event: 'login_refused' | 'forced_logout' | 'heartbeat_outside', reason: string, who: { userId?: number | null; phone?: string | null }, distanceM: number | null) {
  await db.insert(loginLimitLog).values({ event, reason, userId: who.userId ?? null, phone: who.phone ?? null, distanceM });
}

async function logChange(kind: string, note: string) {
  await db.insert(loginLimitChanges).values({ kind, note, userId: currentUserId() ?? null });
}

/* ---------------- the check itself ---------------- */

export type QcCheck = { ok: true; validUntil: Date | null } | { ok: false; reason: string; distanceM: number | null };

/** Place + time for a QC user at `at`. `validUntil` null = limits are switched off. */
export async function evaluateQc(userId: number, point: GeoPoint | null, at: Date = now()): Promise<QcCheck> {
  const settings = await loadSettings();
  if (!settings.enabled) return { ok: true, validUntil: null };
  const places = await loadPlaces();
  const loc = checkLocation(point, places);
  if (places.length > 0 && !point) return { ok: false, reason: MSG_LOGIN_LOCATION_NEEDED, distanceM: null };
  if (!loc.inside) return { ok: false, reason: MSG_LOGIN_PLACE, distanceM: loc.distanceM };
  const until = allowedUntil(at, settings, await liveGrants(userId, at));
  if (!until) return { ok: false, reason: msgLoginHours(settings.fromTime, settings.toTime), distanceM: loc.distanceM };
  return { ok: true, validUntil: until };
}

/** Login of a QC user: throws 403 (and logs it) or returns when the session must end (null = unlimited). */
export async function checkQcLogin(user: { id: number; phone: string }, rawLocation: unknown, locationDenied = false): Promise<Date | null> {
  const parsed = geoPointSchema.safeParse(rawLocation);
  const point: GeoPoint | null = parsed.success ? { lat: parsed.data.lat, lng: parsed.data.lng, accuracy: parsed.data.accuracy ?? null } : null;
  const res = await evaluateQc(user.id, point);
  // First attempt without a location: not a refusal yet — the login screen asks the browser for it and sends the login again.
  if (!res.ok && !point && !locationDenied && res.reason === MSG_LOGIN_LOCATION_NEEDED) throw new HttpError(403, res.reason, LOCATION_REQUIRED_FIELD);
  if (res.ok) return res.validUntil;
  await logEvent('login_refused', res.reason, { userId: user.id, phone: user.phone }, res.distanceM);
  throw new HttpError(403, res.reason);
}

/* ---------------- sessions: ending + heartbeat ---------------- */

export async function endSession(sessionId: string, reason: string, userId: number, distanceM: number | null = null): Promise<never> {
  await db.update(sessions).set({ endedAt: iso(now()), endedReason: reason }).where(eq(sessions.id, sessionId));
  await logEvent('forced_logout', reason, { userId }, distanceM);
  throw new HttpError(401, reason, SESSION_ENDED_FIELD);
}

/** POST /auth/heartbeat — re-checks time and place of a QC session (everyone else just gets `limit: null`). */
export async function heartbeat(token: string, user: { id: number; role: string }, rawLocation: unknown): Promise<{ validUntil: string | null; outside: boolean }> {
  if (user.role !== 'qc') return { validUntil: null, outside: false };
  const id = hashToken(token);
  const [session] = await db.select().from(sessions).where(eq(sessions.id, id));
  if (!session) throw new HttpError(401, 'Please log in');
  const parsed = geoPointSchema.safeParse(rawLocation);
  const point: GeoPoint | null = parsed.success ? { lat: parsed.data.lat, lng: parsed.data.lng, accuracy: parsed.data.accuracy ?? null } : null;
  const settings = await loadSettings();
  if (!settings.enabled) {
    await db.update(sessions).set({ validUntil: null, lastHeartbeatAt: iso(now()) }).where(eq(sessions.id, id));
    return { validUntil: null, outside: false };
  }
  const at = now();
  const until = allowedUntil(at, settings, await liveGrants(user.id, at));
  if (!until) return endSession(id, MSG_TIME_OVER, user.id);
  const places = await loadPlaces();
  const loc = checkLocation(point, places);
  const outside = places.length > 0 && (!point || !loc.inside);
  const strikes = outside ? session.outsideStrikes + 1 : 0;
  if (outside) {
    await logEvent('heartbeat_outside', point ? 'Left the allowed place' : 'Location not available', { userId: user.id }, loc.distanceM);
    if (strikes >= OUTSIDE_STRIKES_LIMIT) return endSession(id, MSG_LOGIN_PLACE, user.id, loc.distanceM);
  }
  await db
    .update(sessions)
    .set({ validUntil: iso(until), outsideStrikes: strikes, lastHeartbeatAt: iso(at), lastLat: point?.lat ?? null, lastLng: point?.lng ?? null })
    .where(eq(sessions.id, id));
  return { validUntil: iso(until), outside };
}

/* ---------------- Settings screen ---------------- */

const dayName = (n: number) => ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][n];

export async function getLoginLimits(): Promise<LoginLimitsData> {
  const settings = await loadSettings();
  const places = await db.select().from(loginLocations).orderBy(asc(loginLocations.name));
  const locations: LoginLocationDto[] = places.map((r) => ({ id: r.id, name: r.name, latitude: r.latitude, longitude: r.longitude, radiusM: r.radiusM, isActive: r.isActive }));
  const today = istParts(now()).ymd;
  const grantRows = await db
    .select({
      id: loginTimeGrants.id,
      userId: loginTimeGrants.userId,
      userName: users.name,
      grantDate: loginTimeGrants.grantDate,
      untilTime: loginTimeGrants.untilTime,
      reason: loginTimeGrants.reason,
      status: loginTimeGrants.status,
      createdBy: loginTimeGrants.createdByUserId,
      createdAt: loginTimeGrants.createdAt,
    })
    .from(loginTimeGrants)
    .innerJoin(users, eq(users.id, loginTimeGrants.userId))
    .orderBy(desc(loginTimeGrants.grantDate), desc(loginTimeGrants.id))
    .limit(100);
  const creatorIds = [...new Set(grantRows.flatMap((g) => (g.createdBy ? [g.createdBy] : [])))];
  const creators = new Map((creatorIds.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, creatorIds)) : []).map((u) => [u.id, u.name]));
  const grants: LoginGrantDto[] = grantRows.map((g) => ({
    id: g.id,
    userId: g.userId,
    userName: g.userName,
    grantDate: g.grantDate,
    untilTime: g.untilTime,
    reason: g.reason,
    status: g.status,
    live: g.status === 'active' && (g.grantDate > today || (g.grantDate === today && g.untilTime > `${String(Math.floor(istParts(now()).minutes / 60)).padStart(2, '0')}:${String(istParts(now()).minutes % 60).padStart(2, '0')}`)),
    createdByName: g.createdBy ? (creators.get(g.createdBy) ?? null) : null,
    createdAt: g.createdAt,
  }));
  const changeRows = await db
    .select({ id: loginLimitChanges.id, kind: loginLimitChanges.kind, note: loginLimitChanges.note, userName: users.name, createdAt: loginLimitChanges.createdAt })
    .from(loginLimitChanges)
    .leftJoin(users, eq(users.id, loginLimitChanges.userId))
    .orderBy(desc(loginLimitChanges.id))
    .limit(40);
  const qcUsers = await db.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.role, 'qc'), eq(users.isActive, true))).orderBy(asc(users.name));
  return { settings, locations, grants, changes: changeRows as LoginChangeDto[], qcUsers };
}

export async function saveSettings(input: unknown): Promise<LoginLimitsSettings> {
  const data = loginHoursSchema.parse(input);
  const before = await loadSettings();
  const days = [...new Set(data.days)].sort((a, b) => a - b);
  await db
    .update(loginLimitSettings)
    .set({ enabled: data.enabled, fromTime: data.fromTime, toTime: data.toTime, days: days.join(','), updatedAt: iso(now()), updatedByUserId: currentUserId() ?? null })
    .where(eq(loginLimitSettings.id, 1));
  const fmt = (s: LoginLimitsSettings) => `${s.enabled ? 'on' : 'off'} · ${timeLabel(s.fromTime)} – ${timeLabel(s.toTime)} · ${s.days.map(dayName).join(', ')}`;
  await logChange('settings', `Login hours: ${fmt(before)} → ${fmt({ ...data, days })}`);
  return loadSettings();
}

export async function saveLocation(id: number | null, input: unknown): Promise<LoginLocationDto> {
  const data = loginLocationSchema.parse(input);
  if (id) {
    const [before] = await db.select().from(loginLocations).where(eq(loginLocations.id, id));
    if (!before) throw notFound('Location');
    await db.update(loginLocations).set({ name: data.name, latitude: data.latitude, longitude: data.longitude, radiusM: data.radiusM, isActive: data.isActive, updatedAt: iso(now()) }).where(eq(loginLocations.id, id));
    await logChange('location', `Place "${before.name}" (${before.latitude.toFixed(5)}, ${before.longitude.toFixed(5)}, ${before.radiusM} m${before.isActive ? '' : ', off'}) → "${data.name}" (${data.latitude.toFixed(5)}, ${data.longitude.toFixed(5)}, ${data.radiusM} m${data.isActive ? '' : ', off'})`);
    return { id, name: data.name, latitude: data.latitude, longitude: data.longitude, radiusM: data.radiusM, isActive: data.isActive };
  }
  const [row] = await db.insert(loginLocations).values({ name: data.name, latitude: data.latitude, longitude: data.longitude, radiusM: data.radiusM, isActive: data.isActive }).returning({ id: loginLocations.id });
  await logChange('location', `Place added: "${data.name}" (${data.latitude.toFixed(5)}, ${data.longitude.toFixed(5)}, ${data.radiusM} m)`);
  return { id: row.id, name: data.name, latitude: data.latitude, longitude: data.longitude, radiusM: data.radiusM, isActive: data.isActive };
}

export async function deleteLocation(id: number): Promise<void> {
  const [before] = await db.select().from(loginLocations).where(eq(loginLocations.id, id));
  if (!before) throw notFound('Location');
  await db.delete(loginLocations).where(eq(loginLocations.id, id));
  await logChange('location', `Place removed: "${before.name}"`);
}

export async function createGrant(input: unknown): Promise<{ id: number }> {
  const data = loginGrantSchema.parse(input);
  const [u] = await db.select({ id: users.id, name: users.name, role: users.role }).from(users).where(and(eq(users.id, data.userId), eq(users.isActive, true)));
  if (!u || u.role !== 'qc') throw new HttpError(400, 'Pick a QC user', 'userId');
  const [row] = await db
    .insert(loginTimeGrants)
    .values({ userId: data.userId, grantDate: data.grantDate, untilTime: data.untilTime, reason: data.reason, createdByUserId: currentUserId() ?? null })
    .returning({ id: loginTimeGrants.id });
  await logChange('grant', `Extra time for ${u.name}: ${data.grantDate} until ${timeLabel(data.untilTime)} — ${data.reason}`);
  return row;
}

export async function cancelGrant(id: number): Promise<void> {
  const [g] = await db
    .select({ id: loginTimeGrants.id, status: loginTimeGrants.status, grantDate: loginTimeGrants.grantDate, untilTime: loginTimeGrants.untilTime, userName: users.name })
    .from(loginTimeGrants)
    .innerJoin(users, eq(users.id, loginTimeGrants.userId))
    .where(eq(loginTimeGrants.id, id));
  if (!g) throw notFound('Extra time');
  if (g.status === 'cancelled') throw new HttpError(409, 'This extra time is already cancelled.');
  await db.update(loginTimeGrants).set({ status: 'cancelled', cancelledAt: iso(now()), cancelledByUserId: currentUserId() ?? null, updatedAt: iso(now()) }).where(eq(loginTimeGrants.id, id));
  await logChange('grant', `Extra time cancelled for ${g.userName}: ${g.grantDate} until ${timeLabel(g.untilTime)}`);
}

export async function listLoginLog(): Promise<LoginLogEntry[]> {
  const since = iso(new Date(now().getTime() - LOG_DAYS * 86_400_000));
  const rows = await db
    .select({ id: loginLimitLog.id, at: loginLimitLog.createdAt, event: loginLimitLog.event, userName: users.name, phone: loginLimitLog.phone, reason: loginLimitLog.reason, distanceM: loginLimitLog.distanceM })
    .from(loginLimitLog)
    .leftJoin(users, eq(users.id, loginLimitLog.userId))
    .where(gte(loginLimitLog.createdAt, since))
    .orderBy(desc(loginLimitLog.id))
    .limit(500);
  return rows;
}
