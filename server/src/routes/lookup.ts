import { Router } from 'express';
import { z } from 'zod';
import { ah, parseId } from '../lib/http';
import { requirePermission } from '../middleware/role';
import { lookupBrokers, lookupCustomers } from '../services/customers';
import { lookupParties } from '../services/parties';
import { lookupDamages } from '../services/damages';
import { lookupMachines } from '../services/machines';
import { lookupMaterials } from '../services/materials';
import { lookupWeavers } from '../services/weavers';
import { lookupYarnParties, lookupYarnQualities } from '../services/yarn-masters';

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

/** Damage names for the damage popup: Jenish, Gaurang (edit takas), the Taka entry role and Butta QC. */
lookupRouter.get(
  '/damages',
  requirePermission('canViewMasters', 'canEnterTakas', 'canEditTakas', 'canButtaQc', 'canMillQc', 'canUseGodownOrders', 'canReceiveOutside'),
  ah(async (req, res) => {
    res.set('Cache-Control', 'private, max-age=10');
    res.json(await lookupDamages(querySchema.parse(req.query).search));
  }),
);

/** Butta parties for the Send dialog (Jenish, Gaurang, Godown supervisor). */
lookupRouter.get(
  '/butta-parties',
  requirePermission('canManageButtaParties', 'canUseButtaModule'),
  ah(async (req, res) => {
    res.set('Cache-Control', 'private, max-age=10');
    res.json(await lookupParties('butta', querySchema.parse(req.query).search));
  }),
);

/** Mill parties for the Send dialog (Jenish, Gaurang, Godown supervisor). */
lookupRouter.get(
  '/mill-parties',
  requirePermission('canManageMillParties', 'canUseMillModule'),
  ah(async (req, res) => {
    res.set('Cache-Control', 'private, max-age=10');
    res.json(await lookupParties('mill', querySchema.parse(req.query).search));
  }),
);

/** Sprint 16: outside weavers for the PO form (Jenish, Gaurang). */
lookupRouter.get(
  '/weavers',
  requirePermission('canManageWeavers', 'canCreateOutsidePo', 'canReceiveOutside'),
  ah(async (req, res) => {
    res.set('Cache-Control', 'private, max-age=10');
    res.json(await lookupWeavers(querySchema.parse(req.query).search));
  }),
);

lookupRouter.get(
  '/materials',
  // + the godown supervisor: the Quality filter of Butta cutting / Mill (names only).
  requirePermission('canViewMasters', 'canViewProductionOrders', 'canUseButtaModule', 'canUseMillModule', 'canCreateOutsidePo'),
  ah(async (req, res) => {
    res.set('Cache-Control', 'private, max-age=10');
    res.json(await lookupMaterials(querySchema.parse(req.query).search));
  }),
);

// Machine pickers: jobsheet forms (office), Start / Change machine (supervisor) and the Loom filter of Butta cutting /
// Mill (godown supervisor). Not the Taka entry role.
lookupRouter.get(
  '/machines',
  requirePermission('canViewMasters', 'canRunJobsheets', 'canUseButtaModule', 'canUseMillModule'),
  ah(async (req, res) => {
    res.set('Cache-Control', 'private, max-age=10');
    res.json(await lookupMachines(querySchema.parse(req.query).search));
  }),
);

/** Sprint 17: yarn parties for the Yarn PO form and the PO list filter. */
lookupRouter.get(
  '/yarn-parties',
  requirePermission('canManageYarnMasters', 'canManageYarnPo', 'canViewYarn'),
  ah(async (req, res) => {
    res.set('Cache-Control', 'private, max-age=10');
    res.json(await lookupYarnParties(querySchema.parse(req.query).search));
  }),
);

/** Sprint 17: yarn qualities (PO lines, receipts, transfers, TFO programs, warping, beams). */
lookupRouter.get(
  '/yarn-qualities',
  requirePermission('canManageYarnMasters', 'canManageYarnPo', 'canUseYarnInventory', 'canReceiveYarn', 'canViewYarn'),
  ah(async (req, res) => {
    res.set('Cache-Control', 'private, max-age=10');
    res.json(await lookupYarnQualities(querySchema.parse(req.query).search));
  }),
);
