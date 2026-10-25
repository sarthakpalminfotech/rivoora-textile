import { Router } from 'express';
import { z } from 'zod';
import { yarnPoListQuerySchema } from '@rivoora/shared';
import { ah, parseId } from '../lib/http';
import { requirePermission } from '../middleware/role';
import {
  cancelYarnPo,
  checkPoNo,
  closeYarnPo,
  createYarnPo,
  getYarnPo,
  getYarnPoPrint,
  listYarnPos,
  receiveYarn,
  updateYarnPo,
} from '../services/yarn-po';

/**
 * Sprint 17 — Yarn POs. View: `canViewYarn` (Jenish, Gaurang, the Supervisor, the Godown supervisor). Create / edit /
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

yarnPosRouter.get(
  '/check-no',
  manage,
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const q = z
      .object({ no: z.coerce.number().int().min(1).max(999_999_999), exceptId: z.coerce.number().int().positive().optional() })
      .parse(req.query);
    res.json(await checkPoNo(q.no, q.exceptId));
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
