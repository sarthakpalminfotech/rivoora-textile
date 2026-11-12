import { Router } from 'express';
import { isDashboardKey, type DashboardKey } from '@rivoora/shared';
import { notFound } from '../lib/errors';
import { ah } from '../lib/http';
import { requirePermission } from '../middleware/role';
import { assertDashboard, dashboardCards, enabledFlags } from '../services/insights';
import { getDashboardSettings, getLayout, resetLayout, saveDashboardSettings, saveLayout } from '../services/insights/layout';

/**
 * Sprint 25 (C11 / C12) — the insight dashboards. Read-only cards for the roles that may open a dashboard (owner: Jenish +
 * Gaurang; partner: Gaurang + Jenish; supervisor: the supervisor + both owners); Arrange / Reset and the settings need
 * `canArrangeDashboards` (Jenish + Gaurang).
 */
export const dashboardRouter = Router();
dashboardRouter.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

const keyOf = (raw: string): DashboardKey => {
  if (!isDashboardKey(raw)) throw notFound('Dashboard');
  return raw;
};

dashboardRouter.get(
  '/:key/cards',
  ah(async (req, res) => {
    res.json(await dashboardCards(req.role, req.userId ?? null, keyOf(req.params.key), req.query));
  }),
);

dashboardRouter.get(
  '/:key/layout',
  ah(async (req, res) => {
    const key = keyOf(req.params.key);
    assertDashboard(req.role, key);
    res.json({ ...(await getLayout(key)), flags: await enabledFlags() });
  }),
);

dashboardRouter.put(
  '/:key/layout',
  requirePermission('canArrangeDashboards'),
  ah(async (req, res) => {
    const key = keyOf(req.params.key);
    assertDashboard(req.role, key);
    res.json({ ...(await saveLayout(key, req.body)), flags: await enabledFlags() });
  }),
);

dashboardRouter.delete(
  '/:key/layout',
  requirePermission('canArrangeDashboards'),
  ah(async (req, res) => {
    const key = keyOf(req.params.key);
    assertDashboard(req.role, key);
    res.json({ ...(await resetLayout(key)), flags: await enabledFlags() });
  }),
);

/** Settings → Dashboard: working hours per day (loom utilisation). */
export const dashboardSettingsRouter = Router();
dashboardSettingsRouter.use(requirePermission('canArrangeDashboards'));
dashboardSettingsRouter.get('/', ah(async (_req, res) => res.json(await getDashboardSettings())));
dashboardSettingsRouter.put('/', ah(async (req, res) => res.json(await saveDashboardSettings(req.body))));
