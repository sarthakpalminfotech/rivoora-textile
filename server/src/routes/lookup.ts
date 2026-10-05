import { Router } from 'express';
import { z } from 'zod';
import { ah, parseId } from '../lib/http';
import { requirePermission } from '../middleware/role';
import { lookupBrokers, lookupCustomers } from '../services/customers';
import { lookupDamages } from '../services/damages';
import { lookupMachines } from '../services/machines';
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
  requirePermission('canViewMasters'),
  ah(async (req, res) => {
    res.set('Cache-Control', 'private, max-age=10');
    res.json(await lookupCustomers(querySchema.parse(req.query).search));
  }),
);

/** The brokers of one customer (Broker field of the order form). */
lookupRouter.get(
  '/customers/:id/brokers',
  requirePermission('canViewMasters'),
  ah(async (req, res) => {
    res.set('Cache-Control', 'private, max-age=10');
    res.json(await lookupBrokers(parseId(req.params.id)));
  }),
);

/** Damage names for the damage popup: Jemish, Gaurang (edit takas) and the Taka entry role. */
lookupRouter.get(
  '/damages',
  requirePermission('canViewMasters', 'canEnterTakas', 'canEditTakas'),
  ah(async (req, res) => {
    res.set('Cache-Control', 'private, max-age=10');
    res.json(await lookupDamages(querySchema.parse(req.query).search));
  }),
);

lookupRouter.get(
  '/materials',
  requirePermission('canViewMasters'),
  ah(async (req, res) => {
    res.set('Cache-Control', 'private, max-age=10');
    res.json(await lookupMaterials(querySchema.parse(req.query).search));
  }),
);

// Machine pickers: jobsheet forms (office) and Start / Change machine (supervisor). Not the Taka entry role.
lookupRouter.get(
  '/machines',
  requirePermission('canViewMasters', 'canRunJobsheets'),
  ah(async (req, res) => {
    res.set('Cache-Control', 'private, max-age=10');
    res.json(await lookupMachines(querySchema.parse(req.query).search));
  }),
);
