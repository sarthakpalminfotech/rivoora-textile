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
  updateOrder,
} from '../services/orders';
import { addSingleJobsheet, generateJobsheets, listOrderJobsheets, sendJobsheets } from '../services/jobsheets';
import { listOrderChallans } from '../services/challans';
import { listOrderTakas } from '../services/takas';
import { sendBackTakas } from '../services/rework';
import { getDashboardItems, getOrderDamages, getOrderDashboard } from '../services/dashboard';

export const ordersRouter = Router();
// The supervisor opens orders read only (writes below need their own permissions); the Taka entry role has no access.
ordersRouter.use(requirePermission('canViewOrders', 'canViewProductionOrders'));

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

/** Edit an order (Jemish / Gaurang) — returns the updated order detail. */
ordersRouter.put(
  '/:id',
  requirePermission('canEditOrder'),
  ah(async (req, res) => {
    res.json(await updateOrder(req.role, parseId(req.params.id), req.body));
  }),
);

ordersRouter.post(
  '/:id/takas/send-back',
  requirePermission('canReworkTakas'),
  ah(async (req, res) => {
    res.json(await sendBackTakas(req.role, parseId(req.params.id), req.body));
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

/** Takas of the order, grouped by jobsheet. */
ordersRouter.get(
  '/:id/takas',
  requirePermission('canViewTakas'),
  ah(async (req, res) => {
    res.json(await listOrderTakas(req.role, parseId(req.params.id)));
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

/** Order dashboard: counts only (the pure `buildOrderDashboard` over one batched round trip). */
ordersRouter.get(
  '/:id/dashboard',
  ah(async (req, res) => {
    res.json(await getOrderDashboard(req.role, parseId(req.params.id)));
  }),
);

/** The items of one sub-stage (jobsheet rows, or takas grouped by jobsheet). */
ordersRouter.get(
  '/:id/dashboard/items',
  ah(async (req, res) => {
    res.json(await getDashboardItems(req.role, parseId(req.params.id), req.query));
  }),
);

/** Docs → Challans: every butta / mill challan that holds a taka of this order (cancelled ones included). */
ordersRouter.get(
  '/:id/challans',
  requirePermission('canViewTakas'),
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await listOrderChallans(req.role, parseId(req.params.id)));
  }),
);

/** Damaged takas of the order + counts per damage type (Damages tab). */
ordersRouter.get(
  '/:id/damages',
  requirePermission('canViewTakas'),
  ah(async (req, res) => {
    res.json(await getOrderDamages(req.role, parseId(req.params.id), req.query));
  }),
);
