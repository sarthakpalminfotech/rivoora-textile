import { Router } from 'express';
import { z } from 'zod';
import { codeSchema } from '@rivoora/shared';
import { ah, paginationSchema, parseId } from '../lib/http';
import { requirePermission } from '../middleware/role';
import {
  addVariation,
  createDesign,
  deleteDesign,
  deleteVariation,
  getDesign,
  isDesignCodeTaken,
  listDesigns,
  updateDesign,
} from '../services/designs';

export const designsRouter = Router();
const manage = requirePermission('canManageMasters');

designsRouter.get(
  '/',
  ah(async (req, res) => {
    res.json(await listDesigns(paginationSchema.parse(req.query)));
  }),
);

designsRouter.get(
  '/check-code',
  ah(async (req, res) => {
    const { code, exceptId } = z
      .object({ code: codeSchema, exceptId: z.coerce.number().int().positive().optional() })
      .parse(req.query);
    res.json({ code, available: !(await isDesignCodeTaken(code, exceptId)) });
  }),
);

designsRouter.get(
  '/:id',
  ah(async (req, res) => {
    res.json(await getDesign(parseId(req.params.id)));
  }),
);

designsRouter.post(
  '/',
  manage,
  ah(async (req, res) => {
    res.status(201).json(await createDesign(req.body));
  }),
);

designsRouter.put(
  '/:id',
  manage,
  ah(async (req, res) => {
    res.json(await updateDesign(parseId(req.params.id), req.body));
  }),
);

designsRouter.delete(
  '/:id',
  manage,
  ah(async (req, res) => {
    await deleteDesign(parseId(req.params.id));
    res.status(204).end();
  }),
);

designsRouter.get(
  '/:id/variations',
  ah(async (req, res) => {
    res.json((await getDesign(parseId(req.params.id))).variations);
  }),
);

designsRouter.post(
  '/:id/variations',
  manage,
  ah(async (req, res) => {
    res.status(201).json(await addVariation(parseId(req.params.id), req.body));
  }),
);

designsRouter.delete(
  '/:id/variations/:variationId',
  manage,
  ah(async (req, res) => {
    await deleteVariation(parseId(req.params.id), parseId(req.params.variationId, 'variation id'));
    res.status(204).end();
  }),
);
