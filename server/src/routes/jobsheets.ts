import { Router } from 'express';
import { z } from 'zod';
import { ah, csv, parseId } from '../lib/http';
import { requirePermission } from '../middleware/role';
import { deleteJobsheet, getJobsheet, printJobsheets, updateJobsheet } from '../services/jobsheets';

export const jobsheetsRouter = Router();

const printQuerySchema = z.object({
  ids: z
    .string({ required_error: 'ids is required' })
    .transform((v) => [...new Set(csv(v).map(Number))])
    .refine((ids) => ids.length > 0 && ids.every((n) => Number.isInteger(n) && n > 0), 'Invalid ids')
    .refine((ids) => ids.length <= 500, 'At most 500 jobsheets at a time'),
});

// Before '/:id' so "print" isn't parsed as an id.
jobsheetsRouter.get(
  '/print',
  ah(async (req, res) => {
    res.json(await printJobsheets(req.role, printQuerySchema.parse(req.query).ids));
  }),
);

jobsheetsRouter.get(
  '/:id',
  ah(async (req, res) => {
    res.json(await getJobsheet(req.role, parseId(req.params.id)));
  }),
);

jobsheetsRouter.put(
  '/:id',
  requirePermission('canManageJobsheets'),
  ah(async (req, res) => {
    res.json(await updateJobsheet(req.role, parseId(req.params.id), req.body));
  }),
);

jobsheetsRouter.delete(
  '/:id',
  requirePermission('canManageJobsheets'),
  ah(async (req, res) => {
    res.json(await deleteJobsheet(req.role, parseId(req.params.id)));
  }),
);
