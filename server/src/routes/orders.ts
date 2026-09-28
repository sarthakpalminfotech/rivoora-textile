import { Router } from 'express';
import { sendToProductionSchema } from '@rivoora/shared';
import { ah, parseId } from '../lib/http';
import { requirePermission } from '../middleware/role';
import {
  createOrder,
  getOrder,
  listOrders,
  orderListQuerySchema,
  sendToProduction,
  undoSendToProduction,
} from '../services/orders';

export const ordersRouter = Router();

ordersRouter.get(
  '/',
  ah(async (req, res) => {
    res.json(await listOrders(req.role, orderListQuerySchema.parse(req.query)));
  }),
);

ordersRouter.post(
  '/send-to-production',
  requirePermission('canSendToProduction'),
  ah(async (req, res) => {
    const { orderIds } = sendToProductionSchema.parse(req.body);
    res.json(await sendToProduction(req.role, orderIds));
  }),
);

ordersRouter.get(
  '/:id',
  ah(async (req, res) => {
    res.json(await getOrder(req.role, parseId(req.params.id)));
  }),
);

ordersRouter.post(
  '/',
  requirePermission('canAddOrder'),
  ah(async (req, res) => {
    res.status(201).json(await createOrder(req.role, req.body));
  }),
);

ordersRouter.post(
  '/:id/undo-production',
  requirePermission('canUndoProduction'),
  ah(async (req, res) => {
    const id = parseId(req.params.id);
    await undoSendToProduction(req.role, id);
    res.json(await getOrder(req.role, id));
  }),
);
