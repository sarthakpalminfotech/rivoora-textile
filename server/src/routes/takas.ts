import { Router } from 'express';
import { TAKA_NEXT_NUMBERS_MAX, takaCheckQuerySchema, takaLookupQuerySchema } from '@rivoora/shared';
import { lookupTakas } from '../services/taka-lookup';
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
  requirePermission('canEnterTakas', 'canEditTakas', 'canReceiveOutside'),
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await checkTakaNo(takaCheckQuerySchema.parse(req.query).no));
  }),
);

/** The numbers the next takas would get (Taka entry shows them before saving; they are confirmed on save). */
takasRouter.get(
  '/next-numbers',
  // Sprint 16: + the receipt form's "Add our taka numbers".
  requirePermission('canEnterTakas', 'canReceiveOutside'),
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const count = Math.min(TAKA_NEXT_NUMBERS_MAX, Math.max(1, Number(req.query.count) || 1));
    res.json({ numbers: await peekTakaNumbers(db, count) });
  }),
);

/**
 * Sprint 16: every active taka whose number OR outside weaver number is this one — the "Which one?" picker of the
 * receive / QC / split / GR screens. Restricted fields only (taka, weaver, order number, stage).
 */
takasRouter.get(
  '/lookup',
  requirePermission('canUseButtaModule', 'canUseMillModule', 'canButtaQc', 'canMillQc', 'canEditTakas', 'canUseGodownOrders', 'canReceiveOutside', 'canDispatch'),
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await lookupTakas(db, takaLookupQuerySchema.parse(req.query).no));
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

/** The damage details screen: every damage of the taka with pcs, photos and its own timeline (Jenish / Gaurang). */
takasRouter.get(
  '/:id/damages',
  requirePermission('canEditTakas', 'canUseGodownOrders', 'canViewProductionOrders', 'canViewGodownOrders'),
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await getTakaDamagesDetail(req.role, parseId(req.params.id)));
  }),
);

/** Taka details + damages + history (the taka drawer on the order's Takas tab). */
takasRouter.get(
  '/:id',
  requirePermission('canEditTakas', 'canViewProductionOrders', 'canViewGodownOrders'),
  ah(async (req, res) => {
    res.json(await getTakaDetail(req.role, parseId(req.params.id)));
  }),
);
