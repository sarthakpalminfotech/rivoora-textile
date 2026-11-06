import { Router } from 'express';
import { isAlertType } from '@rivoora/shared';
import { ah } from '../lib/http';
import { requirePermission } from '../middleware/role';
import { listAlerts } from '../services/alerts';

/** Sprint 21: overdue alerts (on screen only — no push / SMS). Jenish, Gaurang, the production supervisor. */
export const alertsRouter = Router();
alertsRouter.use(requirePermission('canViewAlerts'));

alertsRouter.get(
  '/',
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const type = typeof req.query.type === 'string' && isAlertType(req.query.type) ? req.query.type : undefined;
    res.json(await listAlerts(req.role, type));
  }),
);
