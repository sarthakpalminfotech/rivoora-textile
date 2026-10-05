import { Router } from 'express';
import { ah, paginationSchema, parseId } from '../lib/http';
import { requirePermission } from '../middleware/role';
import { createButtaParty, deleteButtaParty, getButtaParty, listButtaParties, updateButtaParty } from '../services/butta-parties';

/** Butta parties master (Jemish, Gaurang — `canManageButtaParties`). The Send dialog reads `/lookup/butta-parties`. */
export const buttaPartiesRouter = Router();
buttaPartiesRouter.use(requirePermission('canManageButtaParties'));

buttaPartiesRouter.get(
  '/',
  ah(async (req, res) => {
    res.json(await listButtaParties(paginationSchema.parse(req.query)));
  }),
);

buttaPartiesRouter.get(
  '/:id',
  ah(async (req, res) => {
    res.json(await getButtaParty(parseId(req.params.id)));
  }),
);

buttaPartiesRouter.post(
  '/',
  ah(async (req, res) => {
    res.status(201).json(await createButtaParty(req.body));
  }),
);

buttaPartiesRouter.put(
  '/:id',
  ah(async (req, res) => {
    res.json(await updateButtaParty(parseId(req.params.id), req.body));
  }),
);

buttaPartiesRouter.delete(
  '/:id',
  ah(async (req, res) => {
    await deleteButtaParty(parseId(req.params.id));
    res.status(204).end();
  }),
);
