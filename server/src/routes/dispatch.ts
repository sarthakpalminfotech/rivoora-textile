import { Router } from 'express';
import { dispatchedListQuerySchema } from '@rivoora/shared';
import { ah, parseId } from '../lib/http';
import { requirePermission } from '../middleware/role';
import { createGoodsReturn, getDispatchChallan, getDispatchedOrder, listDispatchedOrders } from '../services/dispatch';

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
