import { sql, type SQL } from 'drizzle-orm';
import { can, periodRange, type CardPayload, type PeriodKey, type PeriodRange, type RoleKey } from '@rivoora/shared';
import { db } from '../../db/client';

/**
 * Sprint 25 — the request context of one dashboard batch: who asks (rates / clients), the clock (IST day), the period, and a
 * memo so cards that need the same rows load them once per request.
 */
export interface InsightCtx {
  role: RoleKey;
  userId: number | null;
  now: Date;
  /** Today, IST (`yyyy-MM-dd`). */
  today: string;
  period: PeriodRange;
  seesRate: boolean;
  seesClient: boolean;
  workingHours: number;
  memo<T>(key: string, load: () => Promise<T>): Promise<T>;
}

export function makeCtx(p: { role: RoleKey; userId: number | null; now: Date; period: PeriodKey; workingHours: number }): InsightCtx {
  const cache = new Map<string, Promise<unknown>>();
  const period = periodRange(p.period, p.now);
  return {
    role: p.role,
    userId: p.userId,
    now: p.now,
    today: period.to,
    period,
    seesRate: can(p.role, 'canSeeRate'),
    seesClient: can(p.role, 'canSeeClient'),
    workingHours: p.workingHours,
    memo<T>(key: string, load: () => Promise<T>) {
      if (!cache.has(key)) cache.set(key, load());
      return cache.get(key) as Promise<T>;
    },
  };
}

/** A raw read (aggregates are easiest as SQL); numbers come back as numbers. */
export const rows = <T>(q: SQL) => db.all<T>(q);

/** IST day of a timestamp column in SQL. */
export const istDaySql = (col: string) => sql.raw(`date(${col}, '+330 minutes')`);

/** A card with nothing to show yet. */
export const emptyCard = (id: string, empty: string, periodLabel: string | null = null): CardPayload => ({ id, periodLabel, body: null, empty });

/** A money card for a role that may not see rates. */
export const hiddenCard = (id: string): CardPayload => ({ id, periodLabel: null, body: null, hidden: 'Rates are hidden for your role' });

/** Orders list link with URL filters (the list understands q, status, party, material, kind, from, to). */
export function ordersHref(f: { q?: string; status?: string[]; party?: number[]; material?: number[]; kind?: string[]; from?: string; to?: string } = {}): string {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.status?.length) p.set('status', f.status.join(','));
  if (f.party?.length) p.set('party', f.party.join(','));
  if (f.material?.length) p.set('material', f.material.join(','));
  if (f.kind?.length) p.set('kind', f.kind.join(','));
  if (f.from) p.set('from', f.from);
  if (f.to) p.set('to', f.to);
  const s = p.toString();
  return s ? `/orders?${s}` : '/orders';
}

export const orderHref = (id: number, tab?: string) => `/orders/${id}${tab ? `?tab=${tab}` : ''}`;
