import { Router } from 'express';
import { godownListQuerySchema } from '@rivoora/shared';
import { ah, parseId } from '../lib/http';
import { requirePermission } from '../middleware/role';
import {
  confirmReadyDispatch,
  getGodownDamages,
  getGodownOrder,
  listGodownOrders,
  markGodownDamage,
  patchGodownTaka,
  resolveGodownDamage,
  sendGodownRefinish,
  splitTaka,
} from '../services/godown';

/** Godown Orders module: final takas, tick / actual pcs, split, ready to dispatch. Never returns a client or a rate. */
export const godownRouter = Router();
godownRouter.use(requirePermission('canUseGodownOrders'));

godownRouter.get(
  '/orders',
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await listGodownOrders(godownListQuerySchema.parse(req.query)));
  }),
);

godownRouter.get(
  '/orders/:orderId',
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await getGodownOrder(parseId(req.params.orderId, 'order id')));
  }),
);

godownRouter.get(
  '/orders/:orderId/damages',
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await getGodownDamages(req.role, parseId(req.params.orderId, 'order id')));
  }),
);

godownRouter.post(
  '/orders/:orderId/ready-dispatch',
  ah(async (req, res) => {
    res.json(await confirmReadyDispatch(req.role, parseId(req.params.orderId, 'order id'), req.body));
  }),
);

godownRouter.patch(
  '/takas/:id',
  ah(async (req, res) => {
    res.json(await patchGodownTaka(req.role, parseId(req.params.id, 'taka id'), req.body));
  }),
);

godownRouter.post(
  '/takas/:id/split',
  ah(async (req, res) => {
    res.json(await splitTaka(req.role, parseId(req.params.id, 'taka id'), req.body));
  }),
);

godownRouter.post(
  '/takas/:id/damage',
  ah(async (req, res) => {
    res.json(await markGodownDamage(req.role, parseId(req.params.id, 'taka id'), req.body));
  }),
);

godownRouter.post(
  '/takas/:id/resolve',
  ah(async (req, res) => {
    res.json(await resolveGodownDamage(req.role, parseId(req.params.id, 'taka id'), req.body));
  }),
);

godownRouter.post(
  '/takas/:id/refinish',
  ah(async (req, res) => {
    res.json(await sendGodownRefinish(req.role, parseId(req.params.id, 'taka id'), req.body));
  }),
);
