import { Router } from 'express';
import { ah } from '../lib/http';
import { requirePermission } from '../middleware/role';
import { getMachineView } from '../services/machine-view';

export const machineViewRouter = Router();

machineViewRouter.get(
  '/',
  requirePermission('canViewMachineView'),
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await getMachineView(req.role));
  }),
);
