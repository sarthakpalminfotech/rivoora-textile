import { Router } from 'express';
import { ah, paginationSchema, parseId } from '../lib/http';
import { requirePermission } from '../middleware/role';
import {
  createMaterial,
  deleteMaterial,
  getMaterial,
  listMaterials,
  updateMaterial,
} from '../services/materials';

export const materialsRouter = Router();
const manage = requirePermission('canManageMasters');

materialsRouter.get(
  '/',
  ah(async (req, res) => {
    res.json(await listMaterials(paginationSchema.parse(req.query)));
  }),
);

materialsRouter.get(
  '/:id',
  ah(async (req, res) => {
    res.json(await getMaterial(parseId(req.params.id)));
  }),
);

materialsRouter.post(
  '/',
  manage,
  ah(async (req, res) => {
    res.status(201).json(await createMaterial(req.body));
  }),
);

materialsRouter.put(
  '/:id',
  manage,
  ah(async (req, res) => {
    res.json(await updateMaterial(parseId(req.params.id), req.body));
  }),
);

materialsRouter.delete(
  '/:id',
  manage,
  ah(async (req, res) => {
    await deleteMaterial(parseId(req.params.id));
    res.status(204).end();
  }),
);
