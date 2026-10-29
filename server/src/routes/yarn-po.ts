import { Router } from 'express';
import { yarnPoListQuerySchema } from '@rivoora/shared';
import { ah, parseId } from '../lib/http';
import { requirePermission } from '../middleware/role';
import {
  cancelYarnPo,
  closeYarnPo,
  createYarnPo,
  getYarnPo,
  getYarnPoPrint,
  listYarnPos,
  receiveYarn,
  updateYarnPo,
} from '../services/yarn-po';

/**
 * Sprint 17 — Yarn POs. View: `canViewYarn` (Jenish, Gaurang, the production + Yarn inventory supervisors). Create / edit /
 * close / cancel / print: `canManageYarnPo` (Jenish, Gaurang). Receive a challan: `canReceiveYarn`.
 */
export const yarnPosRouter = Router();
const view = requirePermission('canViewYarn');
const manage = requirePermission('canManageYarnPo');

yarnPosRouter.get(
  '/',
  view,
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await listYarnPos(req.role, yarnPoListQuerySchema.parse(req.query)));
  }),
);

yarnPosRouter.post(
  '/',
  manage,
  ah(async (req, res) => {
    res.status(201).json(await createYarnPo(req.role, req.body));
  }),
);

yarnPosRouter.get(
  '/:id',
  view,
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await getYarnPo(req.role, parseId(req.params.id)));
  }),
);

yarnPosRouter.get(
  '/:id/print',
  manage,
  ah(async (req, res) => {
    res.json(await getYarnPoPrint(parseId(req.params.id)));
  }),
);

yarnPosRouter.put(
  '/:id',
  manage,
  ah(async (req, res) => {
    res.json(await updateYarnPo(req.role, parseId(req.params.id), req.body));
  }),
);

yarnPosRouter.post(
  '/:id/close',
  manage,
  ah(async (req, res) => {
    res.json(await closeYarnPo(req.role, parseId(req.params.id)));
  }),
);

yarnPosRouter.post(
  '/:id/cancel',
  manage,
  ah(async (req, res) => {
    res.json(await cancelYarnPo(req.role, parseId(req.params.id)));
  }),
);

yarnPosRouter.post(
  '/:id/receipts',
  requirePermission('canReceiveYarn'),
  ah(async (req, res) => {
    res.status(201).json(await receiveYarn(req.role, parseId(req.params.id), req.body));
  }),
);
