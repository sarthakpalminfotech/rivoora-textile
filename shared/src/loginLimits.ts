/**
 * Sprint 23 (C10) — QC login limits. The QC role may log in only at an allowed LOCATION and only inside the login HOURS
 * (default 8:30 am – 7:20 pm, Asia/Kolkata); at the end time the session ends by itself. Jenish and Gaurang change the
 * settings and can give one QC person EXTRA TIME. Nobody else is limited (also not Jenish / Gaurang "viewing as QC").
 * Pure rules shared by server and client.
 */
import { z } from 'zod';
import type { RoleKey } from './roles';

export const LIMITED_ROLE: RoleKey = 'qc';
export const isLoginLimited = (role: string): boolean => role === LIMITED_ROLE;

export const DEFAULT_FROM_TIME = '08:30';
export const DEFAULT_TO_TIME = '19:20';
export const DEFAULT_RADIUS_M = 200;
/** The device's reported accuracy is allowed on top of the radius, but never more than this. */
export const ACCURACY_CAP_M = 100;
export const HEARTBEAT_MS = 5 * 60_000;
/** The device left every allowed location for this many heartbeats in a row → the session ends. */
export const OUTSIDE_STRIKES_LIMIT = 2;
/** A toast warns this long before the login time ends. */
export const END_WARNING_MS = 10 * 60_000;
export const LOG_DAYS = 30;

/** `error.field` of the 403 that asks the login screen to read the device location and send the login again. */
export const LOCATION_REQUIRED_FIELD = 'location_required';

/** Machine-readable `error.field` of the 401 that ends a session; the client shows the bilingual text. */
export const SESSION_ENDED_FIELD = 'session_ended';

export const MSG_LOGIN_PLACE = 'Login allowed only at the factory / लॉगिन केवल फैक्ट्री में';
export const MSG_LOGIN_LOCATION_NEEDED =
  'Allow location to log in: tap the lock icon next to the address, set Location to Allow, then try again. / लॉगिन के लिए लोकेशन की अनुमति दें: एड्रेस के पास ताले के निशान पर टैप करें, Location को Allow करें, फिर कोशिश करें।';
export const MSG_TIME_OVER = 'Your login time is over / आपका लॉगिन समय समाप्त हो गया';
export const msgLoginHours = (from: string, to: string) => `Login allowed ${timeLabel(from)} – ${timeLabel(to)} / लॉगिन ${timeLabelHi(from)} – ${timeLabelHi(to)}`;

/* ---------------- time (IST) ---------------- */

const IST_MS = 330 * 60_000;

/** "08:30" → minutes since midnight (510); null when not a valid HH:mm. */
export function timeToMinutes(t: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
export const isTime = (t: string) => timeToMinutes(t) !== null;

/** "8:30 am" / "7:20 pm". */
export function timeLabel(t: string): string {
  const mins = timeToMinutes(t);
  if (mins === null) return t;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}
/** "सुबह 8:30" / "शाम 7:20". */
export function timeLabelHi(t: string): string {
  const mins = timeToMinutes(t);
  if (mins === null) return t;
  const h = Math.floor(mins / 60);
  const part = h < 12 ? 'सुबह' : h < 16 ? 'दोपहर' : h < 20 ? 'शाम' : 'रात';
  return `${part} ${h % 12 === 0 ? 12 : h % 12}:${String(mins % 60).padStart(2, '0')}`;
}

/** The Indian calendar day, weekday (1 = Monday … 7 = Sunday) and minutes-since-midnight of an instant. */
export function istParts(d: Date): { ymd: string; weekday: number; minutes: number } {
  const s = new Date(d.getTime() + IST_MS);
  const wd = s.getUTCDay();
  return {
    ymd: s.toISOString().slice(0, 10),
    weekday: wd === 0 ? 7 : wd,
    minutes: s.getUTCHours() * 60 + s.getUTCMinutes(),
  };
}

/** The instant of `HH:mm` on the Indian day `ymd`. */
export function istInstant(ymd: string, hhmm: string): Date {
  return new Date(`${ymd}T${hhmm}:00+05:30`);
}

/* ---------------- settings, grants, the allowed window ---------------- */

export interface LoginHours {
  fromTime: string;
  toTime: string;
  /** 1 = Monday … 7 = Sunday. */
  days: number[];
}
export const DEFAULT_LOGIN_HOURS: LoginHours = { fromTime: DEFAULT_FROM_TIME, toTime: DEFAULT_TO_TIME, days: [1, 2, 3, 4, 5, 6, 7] };

export interface LoginGrant {
  /** yyyy-MM-dd (Indian day) the extra time is for. */
  grantDate: string;
  /** HH:mm — the person may work until this time that day. */
  untilTime: string;
}

/**
 * Until when may a QC person be logged in at `now`? `null` = not allowed right now. Inside the hours (on an allowed day)
 * the end is the end time — or a later grant of the day; outside the hours an active grant of today lets him in until
 * its time.
 */
export function allowedUntil(now: Date, hours: LoginHours, grants: readonly LoginGrant[]): Date | null {
  const p = istParts(now);
  const from = timeToMinutes(hours.fromTime);
  const to = timeToMinutes(hours.toTime);
  let until: Date | null = null;
  if (from !== null && to !== null && hours.days.includes(p.weekday) && p.minutes >= from && p.minutes < to) {
    until = istInstant(p.ymd, hours.toTime);
  }
  for (const g of grants) {
    if (g.grantDate !== p.ymd) continue;
    const end = istInstant(p.ymd, g.untilTime);
    if (end.getTime() > now.getTime() && (!until || end.getTime() > until.getTime())) until = end;
  }
  return until;
}

/* ---------------- location ---------------- */

export interface GeoPoint {
  lat: number;
  lng: number;
  /** Reported accuracy of the fix in metres. */
  accuracy?: number | null;
}
export interface AllowedLocation {
  id?: number;
  name: string;
  latitude: number;
  longitude: number;
  radiusM: number;
}

/** Great-circle distance in metres. */
export function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface LocationCheck {
  inside: boolean;
  /** Distance to the nearest allowed location (null when none is configured). */
  distanceM: number | null;
  nearest: string | null;
}

/** Inside any allowed place: distance ≤ radius + the reported accuracy (capped at 100 m extra). No places → not enforced. */
export function checkLocation(point: GeoPoint | null, places: readonly AllowedLocation[]): LocationCheck {
  if (places.length === 0) return { inside: true, distanceM: null, nearest: null };
  if (!point) return { inside: false, distanceM: null, nearest: null };
  const slack = Math.min(Math.max(point.accuracy ?? 0, 0), ACCURACY_CAP_M);
  let best: { d: number; name: string; ok: boolean } | null = null;
  for (const p of places) {
    const d = haversineMeters(point, { lat: p.latitude, lng: p.longitude });
    const ok = d <= p.radiusM + slack;
    if (!best || (ok && !best.ok) || (ok === best.ok && d < best.d)) best = { d, name: p.name, ok };
  }
  return { inside: !!best?.ok, distanceM: best ? Math.round(best.d) : null, nearest: best?.name ?? null };
}

/* ---------------- request schemas ---------------- */

export const geoPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100_000).nullish(),
});

/** PUT /login-limits/settings */
export const loginHoursSchema = z
  .object({
    enabled: z.boolean().default(true),
    fromTime: z.string().refine(isTime, 'Use a time like 08:30'),
    toTime: z.string().refine(isTime, 'Use a time like 19:20'),
    days: z.array(z.number().int().min(1).max(7)).min(1, 'Pick at least one day').max(7),
  })
  .refine((v) => (timeToMinutes(v.fromTime) ?? 0) < (timeToMinutes(v.toTime) ?? 0), { message: 'The end time must be after the start time', path: ['toTime'] });
export type LoginHoursInput = z.input<typeof loginHoursSchema>;

/** POST|PUT /login-limits/locations */
export const loginLocationSchema = z.object({
  name: z.string({ required_error: 'Enter a name' }).trim().min(1, 'Enter a name').max(80),
  latitude: z.number({ required_error: 'Enter the latitude', invalid_type_error: 'Enter the latitude' }).min(-90, 'Latitude is −90 to 90').max(90, 'Latitude is −90 to 90'),
  longitude: z.number({ required_error: 'Enter the longitude', invalid_type_error: 'Enter the longitude' }).min(-180, 'Longitude is −180 to 180').max(180, 'Longitude is −180 to 180'),
  radiusM: z.number().int('Use a whole number').min(20, 'At least 20 m').max(5000, 'At most 5000 m').default(DEFAULT_RADIUS_M),
  isActive: z.boolean().default(true),
});
export type LoginLocationInput = z.input<typeof loginLocationSchema>;

/** POST /login-limits/grants */
export const loginGrantSchema = z.object({
  userId: z.number({ required_error: 'Pick the person' }).int().positive('Pick the person'),
  grantDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the date'),
  untilTime: z.string().refine(isTime, 'Use a time like 21:00'),
  reason: z.string({ required_error: 'Write the reason' }).trim().min(3, 'Write at least 3 characters').max(300),
});
export type LoginGrantInput = z.input<typeof loginGrantSchema>;

/* ---------------- DTOs ---------------- */

export interface LoginLimitsSettings {
  enabled: boolean;
  fromTime: string;
  toTime: string;
  days: number[];
}
export interface LoginLocationDto extends AllowedLocation {
  id: number;
  isActive: boolean;
}
export interface LoginGrantDto {
  id: number;
  userId: number;
  userName: string;
  grantDate: string;
  untilTime: string;
  reason: string;
  status: 'active' | 'cancelled';
  /** Active and not yet over. */
  live: boolean;
  createdByName: string | null;
  createdAt: string;
}
export interface LoginChangeDto {
  id: number;
  kind: string;
  note: string;
  userName: string | null;
  createdAt: string;
}
export interface LoginLimitsData {
  settings: LoginLimitsSettings;
  locations: LoginLocationDto[];
  grants: LoginGrantDto[];
  changes: LoginChangeDto[];
  qcUsers: { id: number; name: string }[];
}
export interface LoginLogEntry {
  id: number;
  at: string;
  event: 'login_refused' | 'forced_logout' | 'heartbeat_outside';
  userName: string | null;
  phone: string | null;
  reason: string;
  distanceM: number | null;
}
