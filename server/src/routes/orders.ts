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
import { getOrderMilestones } from '../services/order-milestones';
import { listOrderTakas } from '../services/takas';
import { sendBackTakas } from '../services/rework';
import { addFromFreeStock, moveToInventory } from '../services/inventory-moves';
import { holdOrder, releaseOrder } from '../services/hold-order';
import { getDashboardItems, getOrderDamages, getOrderDashboard } from '../services/dashboard';
import { createFgReceipt, createOutsidePo, listOrderOutside, receiptFormForFg } from '../services/outside';
import { updateOrderSteps } from '../services/order-steps';
import { closeOrder, closePreview } from '../services/close-order';

export const ordersRouter = Router();
// The supervisor opens orders read only (writes below need their own permissions); the Taka entry role has no access.
// Sprint 13: Dhruvil (godown Orders) has no access to the Orders screens but may move stock — these two routes are
// registered before the Orders permission gate and carry their own permission.
/** Takas / pcs leave the order and become free stock. */
ordersRouter.post(
  '/:id/takas/move-to-inventory',
  requirePermission('canMoveToInventory'),
  ah(async (req, res) => {
    res.json(await moveToInventory(req.role, parseId(req.params.id), req.body));
  }),
);

/** Sprint 13: free stock of the same design is assigned to this order. */
ordersRouter.post(
  '/:id/takas/add-from-free-stock',
  requirePermission('canMoveToInventory'),
  ah(async (req, res) => {
    res.json(await addFromFreeStock(req.role, parseId(req.params.id), req.body));
  }),
);

// Sprint 16: outside POs of an order (the Outside production tab) — Jenish / Gaurang.
ordersRouter.get(
  '/:id/outside-pos',
  requirePermission('canCreateOutsidePo'),
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await listOrderOutside(req.role, parseId(req.params.id)));
  }),
);

ordersRouter.post(
  '/:id/outside-pos',
  requirePermission('canCreateOutsidePo'),
  ah(async (req, res) => {
    res.status(201).json(await createOutsidePo(req.role, parseId(req.params.id), req.body));
  }),
);

// Sprint 16: a direct FG purchase's receipts — also the godown supervisor and Dhruvil (no Orders access, so before the gate).
ordersRouter.get(
  '/:id/fg-receipt-form',
  requirePermission('canReceiveOutside'),
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await receiptFormForFg(req.role, parseId(req.params.id)));
  }),
);

ordersRouter.post(
  '/:id/fg-receipts',
  requirePermission('canReceiveOutside'),
  ah(async (req, res) => {
    res.status(201).json(await createFgReceipt(req.role, parseId(req.params.id), req.body));
  }),
);


ordersRouter.use(requirePermission('canViewOrders', 'canViewProductionOrders', 'canViewGodownOrders'));

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

/** Edit an order (Jenish / Gaurang) — returns the updated order detail. */
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

/** Sprint 15: put an order on hold / release it (Jenish only). The hold guard lets both through. */
ordersRouter.post(
  '/:id/hold',
  requirePermission('canHoldOrder'),
  ah(async (req, res) => {
    res.json(await holdOrder(req.role, parseId(req.params.id), req.body));
  }),
);

ordersRouter.post(
  '/:id/release',
  requirePermission('canHoldOrder'),
  ah(async (req, res) => {
    res.json(await releaseOrder(req.role, parseId(req.params.id)));
  }),
);

/** Sprint 16: change the steps (Production · Butta cutting · Mill), with the untick guards. Returns the order. */
ordersRouter.put(
  '/:id/steps',
  requirePermission('canEditOrderSteps'),
  ah(async (req, res) => {
    const id = parseId(req.params.id);
    await updateOrderSteps(req.role, id, req.body);
    res.json(await getOrder(req.role, id));
  }),
);

/** Sprint 16: Close order — what it will do, and doing it. */
ordersRouter.get(
  '/:id/close-preview',
  requirePermission('canCloseOrder'),
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await closePreview(req.role, parseId(req.params.id)));
  }),
);

ordersRouter.post(
  '/:id/close',
  requirePermission('canCloseOrder'),
  ah(async (req, res) => {
    res.json(await closeOrder(req.role, parseId(req.params.id), req.body));
  }),
);

ordersRouter.get(
  '/:id/jobsheets',
  // Not for the godown supervisor: his Orders start at butta cutting (no Jobsheets tab).
  requirePermission('canViewOrders', 'canViewProductionOrders'),
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

/** History → Overview: the raw times of the main steps (the maths is the shared `orderMilestones`). */
ordersRouter.get(
  '/:id/milestones',
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await getOrderMilestones(req.role, parseId(req.params.id)));
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
