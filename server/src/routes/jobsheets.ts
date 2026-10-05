import { Router } from 'express';
import { z } from 'zod';
import { jobsheetListQuerySchema, supervisorOrderListQuerySchema } from '@rivoora/shared';
import { ah, csv, parseId } from '../lib/http';
import { requirePermission } from '../middleware/role';
import {
  changeMachine,
  completeJobsheet,
  deleteJobsheet,
  getJobsheet,
  jobsheetByNo,
  listSupervisorJobsheets,
  listSupervisorOrders,
  printJobsheets,
  pullBackJobsheet,
  startJobsheet,
  updateJobsheet,
} from '../services/jobsheets';
import { editTakas, enterTakas } from '../services/takas';

export const jobsheetsRouter = Router();
// The godown supervisor and Butta QC roles have no access to jobsheets at all.
jobsheetsRouter.use(requirePermission('canViewOrders', 'canViewJobsheetsModule', 'canUseTakaModules'));
const manage = requirePermission('canManageJobsheets');
const run = requirePermission('canRunJobsheets');

const printQuerySchema = z.object({
  ids: z
    .string({ required_error: 'ids is required' })
    .transform((v) => [...new Set(csv(v).map(Number))])
    .refine((ids) => ids.length > 0 && ids.every((n) => Number.isInteger(n) && n > 0), 'Invalid ids')
    .refine((ids) => ids.length <= 500, 'At most 500 jobsheets at a time'),
});

/** The supervisor's Jobsheets module. */
jobsheetsRouter.get(
  '/',
  requirePermission('canViewJobsheetsModule'),
  ah(async (req, res) => {
    res.json(await listSupervisorJobsheets(req.role, jobsheetListQuerySchema.parse(req.query)));
  }),
);

/** The supervisor's Order view: jobsheets grouped by order (number + design + counts only). */
jobsheetsRouter.get(
  '/orders',
  requirePermission('canViewJobsheetsModule'),
  ah(async (req, res) => {
    res.json(await listSupervisorOrders(req.role, supervisorOrderListQuerySchema.parse(req.query)));
  }),
);

// Before '/:id' so "print" isn't parsed as an id.
jobsheetsRouter.get(
  '/print',
  requirePermission('canPrintJobsheets'),
  ah(async (req, res) => {
    res.json(await printJobsheets(req.role, printQuerySchema.parse(req.query).ids));
  }),
);

/** Jobsheet number (from a scanned QR) → id. Any role that can open jobsheets; 404 if not visible for the role. */
jobsheetsRouter.get(
  '/by-no/:no',
  ah(async (req, res) => {
    res.json(await jobsheetByNo(req.role, parseId(req.params.no, 'jobsheet number')));
  }),
);

/** Role-aware: the supervisor gets no order details and a 404 for Pending jobsheets. */
jobsheetsRouter.get(
  '/:id',
  ah(async (req, res) => {
    res.json(await getJobsheet(req.role, parseId(req.params.id)));
  }),
);

jobsheetsRouter.put(
  '/:id',
  manage,
  ah(async (req, res) => {
    res.json(await updateJobsheet(req.role, parseId(req.params.id), req.body));
  }),
);

jobsheetsRouter.delete(
  '/:id',
  manage,
  ah(async (req, res) => {
    res.json(await deleteJobsheet(req.role, parseId(req.params.id)));
  }),
);

jobsheetsRouter.post(
  '/:id/pull-back',
  manage,
  ah(async (req, res) => {
    res.json(await pullBackJobsheet(req.role, parseId(req.params.id)));
  }),
);

jobsheetsRouter.post(
  '/:id/start',
  run,
  ah(async (req, res) => {
    res.json(await startJobsheet(req.role, parseId(req.params.id), req.body));
  }),
);

jobsheetsRouter.post(
  '/:id/complete',
  run,
  ah(async (req, res) => {
    res.json(await completeJobsheet(req.role, parseId(req.params.id), req.body));
  }),
);

jobsheetsRouter.post(
  '/:id/change-machine',
  run,
  ah(async (req, res) => {
    res.status(201).json(await changeMachine(req.role, parseId(req.params.id), req.body));
  }),
);

/** Taka entry: add takas (completes the jobsheet if it isn't yet). */
jobsheetsRouter.post(
  '/:id/takas',
  requirePermission('canEnterTakas'),
  ah(async (req, res) => {
    res.status(201).json(await enterTakas(req.role, parseId(req.params.id), req.body));
  }),
);

/** Jemish / Gaurang: edit the whole taka set of a jobsheet + its note. */
jobsheetsRouter.put(
  '/:id/takas',
  requirePermission('canEditTakas'),
  ah(async (req, res) => {
    res.json(await editTakas(req.role, parseId(req.params.id), req.body));
  }),
);
