import { Router } from 'express';
import { z } from 'zod';
import { ah, parseId } from '../lib/http';
import { requirePermission } from '../middleware/role';
import {
  cancelOutsidePo,
  closeOutsidePo,
  createOutsideReceipt,
  getOutsidePo,
  getOutsidePoPrint,
  listReceiveGoods,
  receiptFormForPo,
  updateOutsidePo,
} from '../services/outside';

/**
 * Sprint 16: one outside PO — edit / cancel / close / print (Jenish, Gaurang: `canCreateOutsidePo`) and receiving a
 * weaver's challan against it (also the godown supervisor and Dhruvil: `canReceiveOutside`).
 */
export const outsidePosRouter = Router();
const manage = requirePermission('canCreateOutsidePo');
const receive = requirePermission('canReceiveOutside');

outsidePosRouter.get(
  '/:id',
  requirePermission('canCreateOutsidePo', 'canReceiveOutside'),
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await getOutsidePo(req.role, parseId(req.params.id)));
  }),
);

outsidePosRouter.get(
  '/:id/print',
  requirePermission('canCreateOutsidePo', 'canReceiveOutside'),
  ah(async (req, res) => {
    res.json(await getOutsidePoPrint(req.role, parseId(req.params.id)));
  }),
);

outsidePosRouter.put(
  '/:id',
  manage,
  ah(async (req, res) => {
    res.json(await updateOutsidePo(req.role, parseId(req.params.id), req.body));
  }),
);

outsidePosRouter.post(
  '/:id/cancel',
  manage,
  ah(async (req, res) => {
    res.json(await cancelOutsidePo(req.role, parseId(req.params.id)));
  }),
);

outsidePosRouter.post(
  '/:id/close',
  manage,
  ah(async (req, res) => {
    res.json(await closeOutsidePo(req.role, parseId(req.params.id)));
  }),
);

outsidePosRouter.get(
  '/:id/receipt-form',
  receive,
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await receiptFormForPo(req.role, parseId(req.params.id)));
  }),
);

outsidePosRouter.post(
  '/:id/receipts',
  receive,
  ah(async (req, res) => {
    res.status(201).json(await createOutsideReceipt(req.role, parseId(req.params.id), req.body));
  }),
);

/** Sprint 16: the Receive goods module — open POs + FG orders waiting for goods. */
export const receiveGoodsRouter = Router();
receiveGoodsRouter.use(requirePermission('canReceiveOutside'));

receiveGoodsRouter.get(
  '/',
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const { search } = z.object({ search: z.string().trim().max(100).optional() }).parse(req.query);
    res.json(await listReceiveGoods(req.role, search || undefined));
  }),
);
