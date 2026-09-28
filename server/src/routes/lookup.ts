import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../lib/http';
import { lookupCustomers } from '../services/customers';
import { lookupMaterials } from '../services/materials';

/** Lightweight id + name endpoints for dropdowns. */
export const lookupRouter = Router();

const querySchema = z.object({
  search: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => v || undefined),
});

lookupRouter.get(
  '/customers',
  ah(async (req, res) => {
    res.set('Cache-Control', 'private, max-age=10');
    res.json(await lookupCustomers(querySchema.parse(req.query).search));
  }),
);

lookupRouter.get(
  '/materials',
  ah(async (req, res) => {
    res.set('Cache-Control', 'private, max-age=10');
    res.json(await lookupMaterials(querySchema.parse(req.query).search));
  }),
);
