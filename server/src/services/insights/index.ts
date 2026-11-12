import {
  can,
  cardDef,
  DASHBOARD_PERMISSION,
  DASHBOARDS,
  dashboardCardsQuerySchema,
  isStripId,
  type CardError,
  type CardPayload,
  type DashboardCardsResult,
  type DashboardKey,
  type RoleKey,
} from '@rivoora/shared';
import { forbidden } from '../../lib/errors';
import { makeCtx, type InsightCtx } from './context';
import { getDashboardSettings, stockMatchEnabled } from './layout';
import { OWNER_CARDS } from './owner';
import { PARTNER_CARDS } from './partner';
import { SUPERVISOR_CARDS } from './supervisor';

/**
 * Sprint 25 — GET /dashboard/:key/cards?ids=&period= : one batch per screen. Every card is computed on request from the live
 * rows; one card failing returns `{ error }` for that card only (the screen shows an inline retry), never a failed page.
 */

type Builder = (ctx: InsightCtx) => Promise<CardPayload>;
const BUILDERS: Record<DashboardKey, Record<string, Builder>> = { owner: OWNER_CARDS, partner: PARTNER_CARDS, supervisor: SUPERVISOR_CARDS };

export const canOpenDashboard = (role: RoleKey, dashboard: DashboardKey) => can(role, DASHBOARD_PERMISSION[dashboard]);

export function assertDashboard(role: RoleKey, dashboard: DashboardKey) {
  if (!canOpenDashboard(role, dashboard)) throw forbidden(`The ${DASHBOARDS[dashboard].title.toLowerCase()} is not open for your role`);
}

export async function dashboardCards(role: RoleKey, userId: number | null, dashboard: DashboardKey, query: unknown, now = new Date()): Promise<DashboardCardsResult> {
  assertDashboard(role, dashboard);
  const q = dashboardCardsQuerySchema.parse(query);
  const [settings, stockMatch] = await Promise.all([getDashboardSettings(), stockMatchEnabled()]);
  const ctx = makeCtx({ role, userId, now, period: q.period, workingHours: settings.workingHoursPerDay });
  const builders = BUILDERS[dashboard];
  const ids = [...new Set(q.ids)].filter((id) => {
    if (!builders[id]) return false;
    if (isStripId(dashboard, id)) return true;
    const def = cardDef(dashboard, id);
    return !!def && (!def.flag || (def.flag === 'insight_stock_match' && stockMatch));
  });
  const entries = await Promise.all(
    ids.map(async (id): Promise<[string, CardPayload | CardError]> => {
      try {
        return [id, await builders[id](ctx)];
      } catch (err) {
        console.error(`[dashboard] card ${id} failed:`, err);
        return [id, { id, error: 'This card could not be loaded' }];
      }
    }),
  );
  return {
    dashboard,
    generatedAt: now.toISOString(),
    period: { key: ctx.period.key, label: ctx.period.label, from: ctx.period.from, to: ctx.period.to },
    cards: Object.fromEntries(entries),
  };
}

/** Cards built behind a flag that is on for this install (the screen hides the rest). */
export async function enabledFlags(): Promise<string[]> {
  return (await stockMatchEnabled()) ? ['insight_stock_match'] : [];
}
