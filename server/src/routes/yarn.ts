import { Router } from 'express';
import {
  beamsQuerySchema,
  checkBoxNoQuerySchema,
  checkLotNoQuerySchema,
  isYarnZone,
  tfoProgramsQuerySchema,
  warpingJobsQuerySchema,
  yarnBoxesQuerySchema,
  yarnLotsQuerySchema,
  yarnMovesQuerySchema,
} from '@rivoora/shared';
import { notFound } from '../lib/errors';
import { ah, parseId } from '../lib/http';
import { requirePermission } from '../middleware/role';
import { checkBoxNo, checkLotNo, createTransfer, createWithdrawal, listBeams, listBoxStock, listLotStock, listMoves, yarnSummary, yarnZone } from '../services/yarn-stock';
import {
  cancelPendingProgram,
  createPendingPrograms,
  getProgram,
  listPendingPrograms,
  listPrograms,
  startPendingProgram,
  stopProgram,
  tfoBoard,
  updatePendingProgram,
} from '../services/yarn-tfo';
import { finishWarpingJob, getWarpingJob, listWarpingJobs, startWarpingJob } from '../services/yarn-warping';

/**
 * Sprint 17 — Yarn inventory (`canUseYarnInventory`: Jenish, Gaurang, the Supervisor, the Godown supervisor — all may
 * transfer, withdraw, run TFO programs and warping). Not linked to orders, so the hold guard never applies.
 */
export const yarnRouter = Router();
yarnRouter.use(requirePermission('canUseYarnInventory'));

yarnRouter.get(
  '/summary',
  ah(async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await yarnSummary());
  }),
);

yarnRouter.get(
  '/zones/:zone',
  ah(async (req, res) => {
    if (!isYarnZone(req.params.zone)) throw notFound('Zone');
    res.set('Cache-Control', 'no-store');
    res.json(await yarnZone(req.params.zone));
  }),
);

yarnRouter.get(
  '/moves',
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await listMoves(yarnMovesQuerySchema.parse(req.query)));
  }),
);

yarnRouter.get(
  '/beams',
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await listBeams(beamsQuerySchema.parse(req.query)));
  }),
);

/** Sprint 20 — raw lots (+ "No lot") with stock of one quality in one zone, for the lot picker. */
yarnRouter.get(
  '/lots',
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const q = yarnLotsQuerySchema.parse(req.query);
    res.json(await listLotStock(q.zone, q.qualityId));
  }),
);

/** Sprint 20 — the live "lot no. is free for this party" check, used on the Receive screen. */
yarnRouter.get(
  '/lots/check',
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const q = checkLotNoQuerySchema.parse(req.query);
    res.json(await checkLotNo(q.partyId, q.lotNo));
  }),
);

/** Sprint 20 — boxes for the box pickers (and, eventually, zone stock screens). */
yarnRouter.get(
  '/boxes',
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await listBoxStock(yarnBoxesQuerySchema.parse(req.query)));
  }),
);

/** Sprint 20 — the live "box no. is free" check, used on the Stop screen. */
yarnRouter.get(
  '/boxes/check',
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await checkBoxNo(checkBoxNoQuerySchema.parse(req.query).boxNo));
  }),
);

yarnRouter.post(
  '/transfers',
  ah(async (req, res) => {
    res.status(201).json(await createTransfer(req.role, req.body));
  }),
);

yarnRouter.post(
  '/withdrawals',
  ah(async (req, res) => {
    res.status(201).json(await createWithdrawal(req.role, req.body));
  }),
);

/* ---------- TFO ---------- */

yarnRouter.get(
  '/tfo/board',
  ah(async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await tfoBoard());
  }),
);

yarnRouter.get(
  '/tfo/programs',
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await listPrograms(tfoProgramsQuerySchema.parse(req.query)));
  }),
);

yarnRouter.get(
  '/tfo/programs/:id',
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await getProgram(parseId(req.params.id)));
  }),
);

/* Sprint 20 — pending programs: owners create (`canPlanYarn`); the floor edits / cancels / starts. */

yarnRouter.get(
  '/tfo/pending',
  ah(async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await listPendingPrograms());
  }),
);

yarnRouter.post(
  '/tfo/pending',
  requirePermission('canPlanYarn'),
  ah(async (req, res) => {
    res.status(201).json(await createPendingPrograms(req.role, req.body));
  }),
);

yarnRouter.put(
  '/tfo/pending/:id',
  ah(async (req, res) => {
    res.json(await updatePendingProgram(req.role, parseId(req.params.id), req.body));
  }),
);

yarnRouter.post(
  '/tfo/pending/:id/cancel',
  ah(async (req, res) => {
    res.json(await cancelPendingProgram(req.role, parseId(req.params.id)));
  }),
);

yarnRouter.post(
  '/tfo/pending/:id/start',
  ah(async (req, res) => {
    res.status(201).json(await startPendingProgram(req.role, parseId(req.params.id), req.body));
  }),
);

yarnRouter.post(
  '/tfo/programs/:id/stop',
  ah(async (req, res) => {
    res.json(await stopProgram(req.role, parseId(req.params.id), req.body));
  }),
);

/* ---------- warping ---------- */

yarnRouter.get(
  '/warping/jobs',
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await listWarpingJobs(warpingJobsQuerySchema.parse(req.query)));
  }),
);

yarnRouter.get(
  '/warping/jobs/:id',
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await getWarpingJob(parseId(req.params.id)));
  }),
);

yarnRouter.post(
  '/warping/jobs',
  ah(async (req, res) => {
    res.status(201).json(await startWarpingJob(req.role, req.body));
  }),
);

yarnRouter.post(
  '/warping/jobs/:id/done',
  ah(async (req, res) => {
    res.json(await finishWarpingJob(req.role, parseId(req.params.id), req.body));
  }),
);
