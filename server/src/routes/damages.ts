import { Router } from 'express';
import { ah, paginationSchema, parseId } from '../lib/http';
import { requirePermission } from '../middleware/role';
import { createDamage, deleteDamage, getDamage, listDamages, updateDamage } from '../services/damages';

/** Damage master (what a damage is). Read with the masters; writes need `canManageDamages` (Jemish, Gaurang). */
export const damagesRouter = Router();
damagesRouter.use(requirePermission('canViewMasters'));
const manage = requirePermission('canManageDamages');

damagesRouter.get(
  '/',
  ah(async (req, res) => {
    res.json(await listDamages(paginationSchema.parse(req.query)));
  }),
);

damagesRouter.get(
  '/:id',
  ah(async (req, res) => {
    res.json(await getDamage(parseId(req.params.id)));
  }),
);

damagesRouter.post(
  '/',
  manage,
  ah(async (req, res) => {
    res.status(201).json(await createDamage(req.body));
  }),
);

damagesRouter.put(
  '/:id',
  manage,
  ah(async (req, res) => {
    res.json(await updateDamage(parseId(req.params.id), req.body));
  }),
);

damagesRouter.delete(
  '/:id',
  manage,
  ah(async (req, res) => {
    await deleteDamage(parseId(req.params.id));
    res.status(204).end();
  }),
);
