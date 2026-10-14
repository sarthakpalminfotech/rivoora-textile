import { Router } from 'express';
import { TAKA_NEXT_NUMBERS_MAX, takaCheckQuerySchema } from '@rivoora/shared';
import { ah, parseId } from '../lib/http';
import { requirePermission } from '../middleware/role';
import { db } from '../db/client';
import { peekTakaNumbers } from '../services/taka-ops';
import { checkTakaNo, getTakaDamagesDetail, getTakaDetail, takaByNo } from '../services/takas';

/** Taka lookups: the live number check, find-by-number (Receive / Butta QC) and the taka details drawer. */
export const takasRouter = Router();

/** Live uniqueness check while typing (taka entry, Edit takas): numbers are unique across the whole system. */
takasRouter.get(
  '/check',
  requirePermission('canEnterTakas', 'canEditTakas'),
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await checkTakaNo(takaCheckQuerySchema.parse(req.query).no));
  }),
);

/** The numbers the next takas would get (Taka entry shows them before saving; they are confirmed on save). */
takasRouter.get(
  '/next-numbers',
  requirePermission('canEnterTakas'),
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const count = Math.min(TAKA_NEXT_NUMBERS_MAX, Math.max(1, Number(req.query.count) || 1));
    res.json({ numbers: await peekTakaNumbers(db, count) });
  }),
);

/** The one active taka with this number (Receive and Butta QC). Restricted view for the godown / QC roles. */
takasRouter.get(
  '/by-no/:no',
  requirePermission('canUseButtaModule', 'canButtaQc', 'canEditTakas', 'canMillQc', 'canUseGodownOrders'),
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await takaByNo(req.role, req.params.no ?? ''));
  }),
);

/** The damage details screen: every damage of the taka with pcs, photos and its own timeline (Jemish / Gaurang). */
takasRouter.get(
  '/:id/damages',
  requirePermission('canEditTakas', 'canUseGodownOrders', 'canViewProductionOrders'),
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await getTakaDamagesDetail(req.role, parseId(req.params.id)));
  }),
);

/** Taka details + damages + history (the taka drawer on the order's Takas tab). */
takasRouter.get(
  '/:id',
  requirePermission('canEditTakas', 'canViewProductionOrders'),
  ah(async (req, res) => {
    res.json(await getTakaDetail(req.role, parseId(req.params.id)));
  }),
);
