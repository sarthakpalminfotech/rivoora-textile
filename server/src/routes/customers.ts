import { Router } from 'express';
import { ah, paginationSchema, parseId } from '../lib/http';
import { requirePermission } from '../middleware/role';
import {
  createCustomer,
  deleteCustomer,
  getCustomer,
  listCustomers,
  updateCustomer,
} from '../services/customers';
import { previousDesigns } from '../services/orders';

export const customersRouter = Router();
// Masters are hidden from roles without master access (the supervisor).
customersRouter.use(requirePermission('canViewMasters'));
const manage = requirePermission('canManageMasters');

customersRouter.get(
  '/',
  ah(async (req, res) => {
    res.json(await listCustomers(paginationSchema.parse(req.query)));
  }),
);

customersRouter.get(
  '/:id',
  ah(async (req, res) => {
    res.json(await getCustomer(parseId(req.params.id)));
  }),
);

customersRouter.get(
  '/:id/previous-designs',
  ah(async (req, res) => {
    res.json(await previousDesigns(parseId(req.params.id)));
  }),
);

// The Add Order screen can create customers too, so order creators may add them.
customersRouter.post(
  '/',
  requirePermission('canManageMasters', 'canAddOrder'),
  ah(async (req, res) => {
    res.status(201).json(await createCustomer(req.body));
  }),
);

customersRouter.put(
  '/:id',
  manage,
  ah(async (req, res) => {
    res.json(await updateCustomer(parseId(req.params.id), req.body));
  }),
);

customersRouter.delete(
  '/:id',
  manage,
  ah(async (req, res) => {
    await deleteCustomer(parseId(req.params.id));
    res.status(204).end();
  }),
);
