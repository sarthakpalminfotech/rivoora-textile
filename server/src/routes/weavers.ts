import { Router } from 'express';
import { z } from 'zod';
import { ah, paginationSchema, parseId } from '../lib/http';
import { requirePermission } from '../middleware/role';
import { createWeaver, deleteWeaver, getWeaver, listWeavers, suggestCode, updateWeaver } from '../services/weavers';

/** Sprint 16: Weaver master (outside weavers) — Jenish, Gaurang (`canManageWeavers`). The PO form reads `/lookup/weavers`. */
export const weaversRouter = Router();
weaversRouter.use(requirePermission('canManageWeavers'));

weaversRouter.get(
  '/',
  ah(async (req, res) => {
    res.json(await listWeavers(paginationSchema.parse(req.query)));
  }),
);

weaversRouter.get(
  '/suggest-code',
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await suggestCode(z.object({ name: z.string().trim().max(120).default('') }).parse(req.query).name));
  }),
);

weaversRouter.get(
  '/:id',
  ah(async (req, res) => {
    res.json(await getWeaver(parseId(req.params.id)));
  }),
);

weaversRouter.post(
  '/',
  ah(async (req, res) => {
    res.status(201).json(await createWeaver(req.body));
  }),
);

weaversRouter.put(
  '/:id',
  ah(async (req, res) => {
    res.json(await updateWeaver(parseId(req.params.id), req.body));
  }),
);

weaversRouter.delete(
  '/:id',
  ah(async (req, res) => {
    await deleteWeaver(parseId(req.params.id));
    res.status(204).end();
  }),
);
