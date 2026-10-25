import { Router } from 'express';
import {
  beamsQuerySchema,
  isYarnZone,
  tfoProgramsQuerySchema,
  warpingJobsQuerySchema,
  yarnMovesQuerySchema,
} from '@rivoora/shared';
import { notFound } from '../lib/errors';
import { ah, parseId } from '../lib/http';
import { requirePermission } from '../middleware/role';
import { createTransfer, createWithdrawal, listBeams, listMoves, yarnSummary, yarnZone } from '../services/yarn-stock';
import { getProgram, listPrograms, startProgram, stopProgram, tfoBoard } from '../services/yarn-tfo';
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

yarnRouter.post(
  '/tfo/programs',
  ah(async (req, res) => {
    res.status(201).json(await startProgram(req.role, req.body));
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
