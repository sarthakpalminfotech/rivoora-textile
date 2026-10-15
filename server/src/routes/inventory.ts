import { Router } from 'express';
import { ah, parseId } from '../lib/http';
import { markTakaFresh } from '../services/move';
import { requirePermission } from '../middleware/role';
import {
  getItemFreeStock,
  listAssignTargets,
  getDamagedItem,
  getInventoryItem,
  getInventorySummary,
  listDamagedItems,
  listDamagedTakas,
  listInventoryItemOrders,
  listInventoryItems,
} from '../services/inventory';

/** Inventory (Jenish / Gaurang): design-wise pcs and damaged stock. Live numbers — never cached. */
export const inventoryRouter = Router();
inventoryRouter.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
// Sprint 13: Dhruvil (Add from free stock) reads the free stock of an item without the Inventory permission.
inventoryRouter.get(
  '/items/:key/free-stock',
  requirePermission('canViewInventory', 'canMoveToInventory'),
  ah(async (req, res) => res.json(await getItemFreeStock(req.params.key, req.query))),
);
inventoryRouter.use(requirePermission('canViewInventory'));

inventoryRouter.get('/summary', ah(async (req, res) => res.json(await getInventorySummary(req.role, req.query))));
inventoryRouter.get('/items', ah(async (req, res) => res.json(await listInventoryItems(req.role, req.query))));
inventoryRouter.get('/items/:key', ah(async (req, res) => res.json(await getInventoryItem(req.role, req.params.key, req.query))));
inventoryRouter.get('/items/:key/orders', ah(async (req, res) => res.json(await listInventoryItemOrders(req.role, req.params.key, req.query))));
inventoryRouter.get(
  '/items/:key/assign-targets',
  requirePermission('canMoveToInventory'),
  ah(async (req, res) => res.json(await listAssignTargets(req.role, req.params.key))),
);
inventoryRouter.get('/damaged', ah(async (req, res) => res.json(await listDamagedItems(req.role, req.query))));
inventoryRouter.get('/damaged/:key', ah(async (req, res) => res.json(await getDamagedItem(req.role, req.params.key))));
inventoryRouter.post(
  '/takas/:id/mark-fresh',
  requirePermission('canMarkFresh'),
  ah(async (req, res) => res.json(await markTakaFresh(req.role, parseId(req.params.id, 'taka id')))),
);
inventoryRouter.get('/damaged/:key/takas', ah(async (req, res) => res.json(await listDamagedTakas(req.role, req.params.key, req.query))));
