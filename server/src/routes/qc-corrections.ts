import { Router } from 'express';
import { ah, parseId } from '../lib/http';
import { requirePermission } from '../middleware/role';
import { cancelRefinish, qcCorrectionsByNo, undoQcResult } from '../services/qc-corrections';

/** Sprint 21 (C6): undo a QC result / cancel a refinish — Jenish, Gaurang, the production supervisor. */
export const qcCorrectionsRouter = Router();
qcCorrectionsRouter.use(requirePermission('canUndoQc'));

qcCorrectionsRouter.get(
  '/taka/:no',
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await qcCorrectionsByNo(req.role, decodeURIComponent(String(req.params.no))));
  }),
);
qcCorrectionsRouter.post(
  '/:takaId/undo-qc',
  ah(async (req, res) => {
    res.json(await undoQcResult(req.role, parseId(req.params.takaId, 'taka id'), req.body));
  }),
);
qcCorrectionsRouter.post(
  '/:takaId/cancel-refinish',
  ah(async (req, res) => {
    res.json(await cancelRefinish(req.role, parseId(req.params.takaId, 'taka id'), req.body));
  }),
);
