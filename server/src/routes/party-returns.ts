import { Router } from 'express';
import { ah, parseId } from '../lib/http';
import { requirePermission } from '../middleware/role';
import {
  completePartyReturn,
  createPartyReturn,
  getPartyReturn,
  listDispatchedTakasOfParty,
  listPartyReturns,
  lookupReturnParties,
  savePartyReturnLines,
  updatePartyReturn,
} from '../services/party-returns';

/** Sprint 22 (CR-13 + C8): goods return against the party — Dhruvil, Jenish, Gaurang. */
export const partyReturnsRouter = Router();
partyReturnsRouter.use(requirePermission('canGoodsReturn'));
partyReturnsRouter.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

partyReturnsRouter.get('/customers', ah(async (req, res) => res.json(await lookupReturnParties(typeof req.query.search === 'string' ? req.query.search.trim() || undefined : undefined))));
partyReturnsRouter.get(
  '/dispatched-takas',
  ah(async (req, res) => res.json(await listDispatchedTakasOfParty(parseId(String(req.query.customerId), 'party id'), typeof req.query.search === 'string' ? req.query.search.trim() || undefined : undefined))),
);
partyReturnsRouter.get('/', ah(async (req, res) => res.json(await listPartyReturns(req.query))));
partyReturnsRouter.post('/', ah(async (req, res) => res.status(201).json(await createPartyReturn(req.role, req.body))));
partyReturnsRouter.get('/:id', ah(async (req, res) => res.json(await getPartyReturn(parseId(req.params.id)))));
partyReturnsRouter.put('/:id', ah(async (req, res) => res.json(await updatePartyReturn(req.role, parseId(req.params.id), req.body))));
partyReturnsRouter.put('/:id/lines', ah(async (req, res) => res.json(await savePartyReturnLines(parseId(req.params.id), req.body))));
partyReturnsRouter.post('/:id/complete', ah(async (req, res) => res.json(await completePartyReturn(req.role, parseId(req.params.id)))));
