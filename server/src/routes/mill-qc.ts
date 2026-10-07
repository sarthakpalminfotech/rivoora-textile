import { Router } from 'express';
import { buttaListQuerySchema } from '@rivoora/shared';
import { ah, parseId } from '../lib/http';
import { requirePermission } from '../middleware/role';
import { listMillQcPending, openMillQcTaka, submitMillQc } from '../services/mill-qc';

/** Mill QC role: the last check of the takas that came back from the mill. */
export const millQcRouter = Router();
millQcRouter.use(requirePermission('canMillQc'));

millQcRouter.get(
  '/pending',
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await listMillQcPending(buttaListQuerySchema.parse(req.query)));
  }),
);

millQcRouter.get(
  '/taka/:no',
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await openMillQcTaka(req.role, req.params.no ?? ''));
  }),
);

millQcRouter.post(
  '/:takaId',
  ah(async (req, res) => {
    res.json(await submitMillQc(req.role, parseId(req.params.takaId, 'taka id'), req.body));
  }),
);
