import { Router } from 'express';
import { dispatchedListQuerySchema } from '@rivoora/shared';
import { ah, parseId } from '../lib/http';
import { requirePermission } from '../middleware/role';
import { createGoodsReturn, editDispatchChallan, getDispatchChallan, getDispatchedOrder, listDispatchedOrders, undoDispatch } from '../services/dispatch';

/** Dispatch challans (DC-n): one challan (any revision), the print data and goods return. */
export const dispatchRouter = Router();
dispatchRouter.use(requirePermission('canDispatch'));

dispatchRouter.get(
  '/challans/:id',
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await getDispatchChallan(parseId(req.params.id, 'challan id')));
  }),
);

dispatchRouter.get(
  '/challans/:id/print',
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await getDispatchChallan(parseId(req.params.id, 'challan id')));
  }),
);

// Sprint 21: undo a dispatch (the whole latest challan, with a reason) and edit the header of an active challan.
dispatchRouter.post(
  '/challans/:id/undo',
  requirePermission('canUndoDispatch'),
  ah(async (req, res) => {
    res.json(await undoDispatch(req.role, parseId(req.params.id, 'challan id'), req.body));
  }),
);
dispatchRouter.put(
  '/challans/:id',
  requirePermission('canUndoDispatch'),
  ah(async (req, res) => {
    res.json(await editDispatchChallan(req.role, parseId(req.params.id, 'challan id'), req.body));
  }),
);

dispatchRouter.post(
  '/challans/:id/goods-return',
  requirePermission('canGoodsReturn'),
  ah(async (req, res) => {
    res.status(201).json(await createGoodsReturn(req.role, parseId(req.params.id, 'challan id'), req.body));
  }),
);

/** The Dispatched module: orders with dispatch challans, newest dispatch first. */
export const dispatchedRouter = Router();
dispatchedRouter.use(requirePermission('canDispatch'));

dispatchedRouter.get(
  '/',
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await listDispatchedOrders(req.role, dispatchedListQuerySchema.parse(req.query)));
  }),
);

dispatchedRouter.get(
  '/:orderId',
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await getDispatchedOrder(req.role, parseId(req.params.orderId, 'order id')));
  }),
);
