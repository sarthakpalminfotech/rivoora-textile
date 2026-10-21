import { Router } from 'express';
import { takaListQuerySchema } from '@rivoora/shared';
import { ah } from '../lib/http';
import { requirePermission } from '../middleware/role';
import { listTakaJobsheets } from '../services/takas';

/** The Taka entry role's modules. */
export const takaRouter = Router();
takaRouter.use(requirePermission('canUseTakaModules'));

/** The Taka entry Jobsheets list: every jobsheet, tab Taka pending / Done + counts. */
takaRouter.get(
  '/jobsheets',
  ah(async (req, res) => {
    res.json(await listTakaJobsheets(req.role, takaListQuerySchema.parse(req.query)));
  }),
);
