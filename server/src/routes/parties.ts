import { Router } from 'express';
import type { ChallanKind } from '@rivoora/shared';
import { ah, paginationSchema, parseId } from '../lib/http';
import { requirePermission } from '../middleware/role';
import { createParty, deleteParty, getParty, listParties, updateParty } from '../services/parties';

/**
 * Party master of a challan kind (butta parties / mill parties — one router, mounted twice). Jemish and Gaurang manage
 * them (`canManageButtaParties` / `canManageMillParties`); the Send dialog reads `/lookup/<kind>-parties`.
 */
export function partiesRouter(kind: ChallanKind): Router {
  const router = Router();
  router.use(requirePermission(kind === 'butta' ? 'canManageButtaParties' : 'canManageMillParties'));

  router.get(
    '/',
    ah(async (req, res) => {
      res.json(await listParties(kind, paginationSchema.parse(req.query)));
    }),
  );

  router.get(
    '/:id',
    ah(async (req, res) => {
      res.json(await getParty(kind, parseId(req.params.id)));
    }),
  );

  router.post(
    '/',
    ah(async (req, res) => {
      res.status(201).json(await createParty(kind, req.body));
    }),
  );

  router.put(
    '/:id',
    ah(async (req, res) => {
      res.json(await updateParty(kind, parseId(req.params.id), req.body));
    }),
  );

  router.delete(
    '/:id',
    ah(async (req, res) => {
      await deleteParty(kind, parseId(req.params.id));
      res.status(204).end();
    }),
  );

  return router;
}
