import { Router } from 'express';
import { ah, parseId } from '../lib/http';
import { markTakaFresh } from '../services/move';
import { requirePermission } from '../middleware/role';
import {
  getDamagedItem,
  getInventoryItem,
  getInventorySummary,
  listDamagedItems,
  listDamagedTakas,
  listInventoryItemOrders,
  listInventoryItems,
} from '../services/inventory';

/** Inventory (Jemish / Gaurang): design-wise pcs and damaged stock. Live numbers — never cached. */
export const inventoryRouter = Router();
inventoryRouter.use(requirePermission('canViewInventory'));
inventoryRouter.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

inventoryRouter.get('/summary', ah(async (req, res) => res.json(await getInventorySummary(req.role))));
inventoryRouter.get('/items', ah(async (req, res) => res.json(await listInventoryItems(req.role, req.query))));
inventoryRouter.get('/items/:key', ah(async (req, res) => res.json(await getInventoryItem(req.role, req.params.key))));
inventoryRouter.get('/items/:key/orders', ah(async (req, res) => res.json(await listInventoryItemOrders(req.role, req.params.key, req.query))));
inventoryRouter.get('/damaged', ah(async (req, res) => res.json(await listDamagedItems(req.role, req.query))));
inventoryRouter.get('/damaged/:key', ah(async (req, res) => res.json(await getDamagedItem(req.role, req.params.key))));
inventoryRouter.post(
  '/takas/:id/mark-fresh',
  requirePermission('canMarkFresh'),
  ah(async (req, res) => res.json(await markTakaFresh(req.role, parseId(req.params.id, 'taka id')))),
);
inventoryRouter.get('/damaged/:key/takas', ah(async (req, res) => res.json(await listDamagedTakas(req.role, req.params.key, req.query))));
