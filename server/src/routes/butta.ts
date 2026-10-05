import { Router } from 'express';
import { buttaListQuerySchema, challanListQuerySchema } from '@rivoora/shared';
import { ah, parseId } from '../lib/http';
import { requirePermission } from '../middleware/role';
import {
  cancelChallan,
  createChallan,
  getChallan,
  getChallanPrint,
  listChallans,
  listPendingOrders,
  listPendingOrderTakas,
  receiveTakas,
  undoReceive,
} from '../services/butta';

/** Butta cutting module: Jemish, Gaurang and the Godown supervisor (never returns a client name or a rate). */
export const buttaRouter = Router();
buttaRouter.use(requirePermission('canUseButtaModule'));

buttaRouter.get(
  '/pending-orders',
  ah(async (req, res) => {
    res.json(await listPendingOrders(buttaListQuerySchema.parse(req.query)));
  }),
);

buttaRouter.get(
  '/pending-orders/:orderId/takas',
  ah(async (req, res) => {
    res.json(await listPendingOrderTakas(parseId(req.params.orderId, 'order id')));
  }),
);

buttaRouter.post(
  '/challans',
  ah(async (req, res) => {
    res.status(201).json(await createChallan(req.role, req.body));
  }),
);

buttaRouter.get(
  '/challans',
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await listChallans(challanListQuerySchema.parse(req.query)));
  }),
);

buttaRouter.get(
  '/challans/:id',
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await getChallan(parseId(req.params.id)));
  }),
);

buttaRouter.get(
  '/challans/:id/print',
  ah(async (req, res) => {
    res.json(await getChallanPrint(parseId(req.params.id)));
  }),
);

buttaRouter.post(
  '/challans/:id/cancel',
  requirePermission('canCancelChallan'),
  ah(async (req, res) => {
    res.json(await cancelChallan(req.role, parseId(req.params.id)));
  }),
);

buttaRouter.post(
  '/receive',
  ah(async (req, res) => {
    res.json(await receiveTakas(req.role, req.body));
  }),
);

buttaRouter.post(
  '/receive/:takaId/undo',
  ah(async (req, res) => {
    res.json(await undoReceive(req.role, parseId(req.params.takaId, 'taka id')));
  }),
);
