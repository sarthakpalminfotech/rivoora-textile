import { Router } from 'express';
import { ah, paginationSchema, parseId } from '../lib/http';
import { requirePermission } from '../middleware/role';
import {
  createMachine,
  deleteMachine,
  getMachine,
  listMachines,
  updateMachine,
} from '../services/machines';

export const machinesRouter = Router();
// Masters are hidden from roles without master access (the supervisor).
machinesRouter.use(requirePermission('canViewMasters'));
const manage = requirePermission('canManageMachines');

machinesRouter.get(
  '/',
  ah(async (req, res) => {
    res.json(await listMachines(paginationSchema.parse(req.query)));
  }),
);

machinesRouter.get(
  '/:id',
  ah(async (req, res) => {
    res.json(await getMachine(parseId(req.params.id)));
  }),
);

machinesRouter.post(
  '/',
  manage,
  ah(async (req, res) => {
    res.status(201).json(await createMachine(req.body));
  }),
);

machinesRouter.put(
  '/:id',
  manage,
  ah(async (req, res) => {
    res.json(await updateMachine(parseId(req.params.id), req.body));
  }),
);

machinesRouter.delete(
  '/:id',
  manage,
  ah(async (req, res) => {
    await deleteMachine(parseId(req.params.id));
    res.status(204).end();
  }),
);
