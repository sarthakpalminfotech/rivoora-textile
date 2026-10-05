import { Router } from 'express';
import { buttaListQuerySchema } from '@rivoora/shared';
import { ah, parseId } from '../lib/http';
import { requirePermission } from '../middleware/role';
import { listQcPending, submitQc } from '../services/butta-qc';

/** Butta QC role: check the takas received back from butta cutting. */
export const buttaQcRouter = Router();
buttaQcRouter.use(requirePermission('canButtaQc'));

buttaQcRouter.get(
  '/pending',
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await listQcPending(buttaListQuerySchema.parse(req.query)));
  }),
);

buttaQcRouter.post(
  '/:takaId',
  ah(async (req, res) => {
    res.json(await submitQc(req.role, parseId(req.params.takaId, 'taka id'), req.body));
  }),
);
