import { Router } from 'express';
import { ah, paginationSchema, parseId } from '../lib/http';
import { requirePermission } from '../middleware/role';
import { createUser, getUser, listUsers, resetPassword, updateUser } from '../services/users';

/** The Users master. */
export const usersRouter = Router();
usersRouter.use(requirePermission('canManageUsers'));

usersRouter.get(
  '/',
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await listUsers(paginationSchema.parse(req.query)));
  }),
);

usersRouter.get(
  '/:id',
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await getUser(parseId(req.params.id, 'user id')));
  }),
);

usersRouter.post(
  '/',
  ah(async (req, res) => {
    res.status(201).json(await createUser(req.body));
  }),
);

usersRouter.put(
  '/:id',
  ah(async (req, res) => {
    res.json(await updateUser(req.userId, parseId(req.params.id, 'user id'), req.body));
  }),
);

usersRouter.post(
  '/:id/reset-password',
  ah(async (req, res) => {
    res.json(await resetPassword(parseId(req.params.id, 'user id'), req.body));
  }),
);
