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
import { addSingleJobsheet, generateJobsheets, listOrderJobsheets, sendJobsheets } from '../services/jobsheets';

export const ordersRouter = Router();
// The supervisor has no access to orders at all.
ordersRouter.use(requirePermission('canViewOrders'));

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

ordersRouter.get(
  '/:id/jobsheets',
  ah(async (req, res) => {
    res.json(await listOrderJobsheets(req.role, parseId(req.params.id)));
  }),
);

ordersRouter.post(
  '/:id/jobsheets/generate',
  requirePermission('canManageJobsheets'),
  ah(async (req, res) => {
    res.status(201).json(await generateJobsheets(req.role, parseId(req.params.id), req.body));
  }),
);

ordersRouter.post(
  '/:id/jobsheets',
  requirePermission('canManageJobsheets'),
  ah(async (req, res) => {
    res.status(201).json(await addSingleJobsheet(req.role, parseId(req.params.id), req.body));
  }),
);

/** Send Pending jobsheets to the supervisor (Pending → Sent). */
ordersRouter.post(
  '/:id/jobsheets/send',
  requirePermission('canManageJobsheets'),
  ah(async (req, res) => {
    res.json(await sendJobsheets(req.role, parseId(req.params.id), req.body));
  }),
);
