import { Router } from 'express';
import { buttaListQuerySchema, challanListQuerySchema, pendingTakasQuerySchema, workFiltersOf, type ChallanKind } from '@rivoora/shared';
import { ah, parseId } from '../lib/http';
import { requirePermission } from '../middleware/role';
import { editChallan, markTakaLost, removeTakaFromChallan, undoTakaLost } from '../services/challan-edit';
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
  setReceivedCount,
  undoReceive,
} from '../services/challans';

/**
 * Challan module of one kind (butta cutting at `/butta`, the mill at `/mill` — one router, mounted twice). Jenish,
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
      res.json(await listPendingOrderTakas(kind, parseId(req.params.orderId, 'order id'), 'send', workFiltersOf(pendingTakasQuerySchema.parse(req.query))));
    }),
  );

  if (kind === 'mill') {
    // The Refinish sub-tab: takas marked for refinish by Mill QC / the godown, going back to the mill.
    router.get(
      '/refinish-orders',
      ah(async (req, res) => {
        res.set('Cache-Control', 'no-store');
        res.json(await listPendingOrders(kind, buttaListQuerySchema.parse(req.query), 'refinish'));
      }),
    );
    router.get(
      '/refinish-orders/:orderId/takas',
      ah(async (req, res) => {
        res.set('Cache-Control', 'no-store');
        res.json(await listPendingOrderTakas(kind, parseId(req.params.orderId, 'order id'), 'refinish', workFiltersOf(pendingTakasQuerySchema.parse(req.query))));
      }),
    );
  }

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

  // Sprint 21 (C3): edit the header, remove an unreceived taka; (C4) Gaurang marks a taka lost / short at the party.
  router.put(
    '/challans/:id',
    requirePermission('canEditChallan'),
    ah(async (req, res) => {
      res.json(await editChallan(kind, req.role, parseId(req.params.id), req.body));
    }),
  );
  router.post(
    '/challans/:id/remove-taka',
    requirePermission('canEditChallan'),
    ah(async (req, res) => {
      res.json(await removeTakaFromChallan(kind, req.role, parseId(req.params.id), req.body));
    }),
  );
  router.post(
    '/challans/:id/mark-lost',
    requirePermission('canMarkLostAtParty'),
    ah(async (req, res) => {
      res.json(await markTakaLost(kind, req.role, parseId(req.params.id), req.body));
    }),
  );
  router.post(
    '/challans/:id/undo-lost',
    requirePermission('canMarkLostAtParty'),
    ah(async (req, res) => {
      res.json(await undoTakaLost(kind, req.role, parseId(req.params.id), req.body));
    }),
  );

  // Mill: the godown supervisor counts how many takas came back (the QC finds out which).
  router.post(
    '/challans/:id/received-count',
    ah(async (req, res) => {
      res.json(await setReceivedCount(kind, req.role, parseId(req.params.id), req.body));
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
