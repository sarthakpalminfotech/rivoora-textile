import { Router } from 'express';
import { ah, parseId } from '../lib/http';
import { requirePermission } from '../middleware/role';
import { cancelGrant, createGrant, deleteLocation, getLoginLimits, listLoginLog, saveLocation, saveSettings } from '../services/login-limits';

/** Sprint 23 (C10): Settings → QC login limits — Jenish + Gaurang (`canManageLoginLimits`). */
export const loginLimitsRouter = Router();
loginLimitsRouter.use(requirePermission('canManageLoginLimits'));
loginLimitsRouter.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

loginLimitsRouter.get('/', ah(async (_req, res) => res.json(await getLoginLimits())));
loginLimitsRouter.put('/settings', ah(async (req, res) => res.json(await saveSettings(req.body))));
loginLimitsRouter.post('/locations', ah(async (req, res) => res.status(201).json(await saveLocation(null, req.body))));
loginLimitsRouter.put('/locations/:id', ah(async (req, res) => res.json(await saveLocation(parseId(req.params.id), req.body))));
loginLimitsRouter.delete('/locations/:id', ah(async (req, res) => {
  await deleteLocation(parseId(req.params.id));
  res.json({ ok: true });
}));
loginLimitsRouter.post('/grants', ah(async (req, res) => res.status(201).json(await createGrant(req.body))));
loginLimitsRouter.post('/grants/:id/cancel', ah(async (req, res) => {
  await cancelGrant(parseId(req.params.id));
  res.json({ ok: true });
}));
loginLimitsRouter.get('/log', ah(async (_req, res) => res.json(await listLoginLog())));
