import { Router } from 'express';
import { buttaListQuerySchema, challanListQuerySchema, type ChallanKind } from '@rivoora/shared';
import { ah, parseId } from '../lib/http';
import { requirePermission } from '../middleware/role';
import {
  cancelChallan,
  createChallan,
  getChallan,
  getChallanPrint,
  getKindCounts,
  listChallans,
  listPendingOrders,
  listPendingOrderTakas,
  receiveTakas,
  undoReceive,
} from '../services/challans';

/**
 * Challan module of one kind (butta cutting at `/butta`, the mill at `/mill` — one router, mounted twice). Jemish,
 * Gaurang and the Godown supervisor; never returns a client name or a rate.
 */
export function challansRouter(kind: ChallanKind): Router {
  const router = Router();
  router.use(requirePermission(kind === 'butta' ? 'canUseButtaModule' : 'canUseMillModule'));

  router.get(
    '/counts',
    ah(async (_req, res) => {
      res.set('Cache-Control', 'no-store');
      res.json(await getKindCounts(kind));
    }),
  );

  router.get(
    '/pending-orders',
    ah(async (req, res) => {
      res.json(await listPendingOrders(kind, buttaListQuerySchema.parse(req.query)));
    }),
  );

  router.get(
    '/pending-orders/:orderId/takas',
    ah(async (req, res) => {
      res.set('Cache-Control', 'no-store');
      res.json(await listPendingOrderTakas(kind, parseId(req.params.orderId, 'order id')));
    }),
  );

  router.post(
    '/challans',
    ah(async (req, res) => {
      res.status(201).json(await createChallan(kind, req.role, req.body));
    }),
  );

  router.get(
    '/challans',
    ah(async (req, res) => {
      res.set('Cache-Control', 'no-store');
      res.json(await listChallans(kind, challanListQuerySchema.parse(req.query)));
    }),
  );

  router.get(
    '/challans/:id',
    ah(async (req, res) => {
      res.set('Cache-Control', 'no-store');
      res.json(await getChallan(kind, parseId(req.params.id)));
    }),
  );

  router.get(
    '/challans/:id/print',
    ah(async (req, res) => {
      res.json(await getChallanPrint(kind, parseId(req.params.id)));
    }),
  );

  router.post(
    '/challans/:id/cancel',
    requirePermission('canCancelChallan'),
    ah(async (req, res) => {
      res.json(await cancelChallan(kind, req.role, parseId(req.params.id)));
    }),
  );

  router.post(
    '/receive',
    ah(async (req, res) => {
      res.json(await receiveTakas(kind, req.role, req.body));
    }),
  );

  router.post(
    '/receive/:takaId/undo',
    ah(async (req, res) => {
      res.json(await undoReceive(kind, req.role, parseId(req.params.takaId, 'taka id')));
    }),
  );

  return router;
}
