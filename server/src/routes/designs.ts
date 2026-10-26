import { Router } from 'express';
import { z } from 'zod';
import { codeSchema } from '@rivoora/shared';
import { ah, parseId } from '../lib/http';
import { requirePermission } from '../middleware/role';
import {
  createDesign,
  createDesignsBulk,
  deleteDesign,
  getDesign,
  isDesignCodeTaken,
  listDesigns,
  listQualityGroups,
  takenDesignCodes,
  updateDesign,
} from '../services/designs';

export const designsRouter = Router();
// Sprint 18: the design library — Jenish / Gaurang (manage) and Dhruvil (view only). Hidden from every other role.
designsRouter.use(requirePermission('canViewDesignLibrary'));
const manage = requirePermission('canManageDesigns');

designsRouter.get(
  '/',
  ah(async (req, res) => {
    res.json(await listDesigns(req.query));
  }),
);

/** The library's first level: one group per quality (+ "No quality"), with counts and the newest designs. */
designsRouter.get(
  '/qualities',
  ah(async (req, res) => {
    res.json(await listQualityGroups(req.query));
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

/** "Upload many": which of these codes are already used (`?codes=D1,D2`) — the review page's live check. */
designsRouter.get(
  '/check-codes',
  ah(async (req, res) => {
    const { codes } = z.object({ codes: z.string().max(4000).default('') }).parse(req.query);
    const list = codes.split(',').map((c) => c.trim()).filter(Boolean).slice(0, 200);
    res.json({ taken: [...(await takenDesignCodes(list))] });
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

designsRouter.post(
  '/bulk',
  manage,
  ah(async (req, res) => {
    res.status(201).json(await createDesignsBulk(req.body));
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
