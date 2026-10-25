import { Router, type RequestHandler } from 'express';
import { ah, paginationSchema, parseId, type PaginationQuery } from '../lib/http';
import { requirePermission } from '../middleware/role';
import {
  createTfoMachine,
  createYarnParty,
  createYarnQuality,
  deleteTfoMachine,
  deleteYarnParty,
  deleteYarnQuality,
  getTfoMachine,
  getYarnParty,
  getYarnQuality,
  listTfoMachines,
  listYarnParties,
  listYarnQualities,
  updateTfoMachine,
  updateYarnParty,
  updateYarnQuality,
} from '../services/yarn-masters';

/**
 * Sprint 17 — Yarn parties, Yarn qualities, TFO machines (Jenish, Gaurang: `canManageYarnMasters`). Adding a party or a
 * quality from the Yarn PO form (the ➕ quick-adds) is also allowed with `canManageYarnPo`. Dropdowns read the
 * `/lookup/yarn-*` endpoints.
 */

interface CrudService<T> {
  list: (query: PaginationQuery) => Promise<unknown>;
  get: (id: number) => Promise<T>;
  create: (input: unknown) => Promise<T>;
  update: (id: number, input: unknown) => Promise<T>;
  remove: (id: number) => Promise<void>;
}

function crudRouter<T>(service: CrudService<T>, createPermission: RequestHandler): Router {
  const router = Router();
  const manage = requirePermission('canManageYarnMasters');
  router.get(
    '/',
    manage,
    ah(async (req, res) => {
      res.json(await service.list(paginationSchema.parse(req.query)));
    }),
  );
  router.get(
    '/:id',
    manage,
    ah(async (req, res) => {
      res.json(await service.get(parseId(req.params.id)));
    }),
  );
  router.post(
    '/',
    createPermission,
    ah(async (req, res) => {
      res.status(201).json(await service.create(req.body));
    }),
  );
  router.put(
    '/:id',
    manage,
    ah(async (req, res) => {
      res.json(await service.update(parseId(req.params.id), req.body));
    }),
  );
  router.delete(
    '/:id',
    manage,
    ah(async (req, res) => {
      await service.remove(parseId(req.params.id));
      res.status(204).end();
    }),
  );
  return router;
}

const quickAdd = requirePermission('canManageYarnMasters', 'canManageYarnPo');

export const yarnPartiesRouter = crudRouter(
  { list: listYarnParties, get: getYarnParty, create: createYarnParty, update: updateYarnParty, remove: deleteYarnParty },
  quickAdd,
);

export const yarnQualitiesRouter = crudRouter(
  { list: listYarnQualities, get: getYarnQuality, create: createYarnQuality, update: updateYarnQuality, remove: deleteYarnQuality },
  quickAdd,
);

export const tfoMachinesRouter = crudRouter(
  { list: listTfoMachines, get: getTfoMachine, create: createTfoMachine, update: updateTfoMachine, remove: deleteTfoMachine },
  requirePermission('canManageYarnMasters'),
);
