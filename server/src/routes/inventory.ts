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
  listDispatchedItemOrders,
  listInventoryItemOrders,
  listInventoryItems,
  resolveInventoryKey,
} from '../services/inventory';
import { addStock, listRemovableTakas, listStockAdjustments, removeStock } from '../services/stock-adjust';
import { getDamagedLot, listDamagedFreeTakas, listDamagedLots, sellDamagedLot } from '../services/damaged-lots';
import { getDesignQuantities, listQualityCards, listQualityDesigns } from '../services/stock-qualities';

/** Inventory (Jenish / Gaurang): design-wise pcs and damaged stock. Live numbers — never cached. */
export const inventoryRouter = Router();
inventoryRouter.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
// Sprint 18: an old `v-<variationId>` item key is answered as the design the variation became (the screen redirects).
inventoryRouter.param('key', (req, _res, next, key: string) => {
  resolveInventoryKey(key).then((resolved) => {
    req.params.key = resolved;
    next();
  }, next);
});
// Sprint 13: Dhruvil (Add from free stock) reads the free stock of an item without the Inventory permission.
inventoryRouter.get(
  '/items/:key/free-stock',
  requirePermission('canViewInventory', 'canMoveToInventory'),
  ah(async (req, res) => res.json(await getItemFreeStock(req.params.key, req.query))),
);
inventoryRouter.use(requirePermission('canViewInventory'));

// Sprint 22 (CR-15): Quality → Design → Design details, with pcs AND metres (never mixed).
inventoryRouter.get('/qualities', ah(async (req, res) => res.json(await listQualityCards(req.role, req.query))));
inventoryRouter.get('/qualities/:materialId/designs', ah(async (req, res) => res.json(await listQualityDesigns(req.role, parseId(req.params.materialId, 'quality id'), req.query))));
inventoryRouter.get('/items/:key/quantities', ah(async (req, res) => res.json(await getDesignQuantities(req.role, req.params.key))));
// Sprint 22: manual Add / Remove stock (Jenish, Gaurang) and the Stock adjustments list.
inventoryRouter.post('/stock/add', requirePermission('canAdjustFinishedStock'), ah(async (req, res) => res.status(201).json(await addStock(req.role, req.body))));
inventoryRouter.post('/stock/remove', requirePermission('canAdjustFinishedStock'), ah(async (req, res) => res.json(await removeStock(req.role, req.body))));
inventoryRouter.get(
  '/stock/removable',
  requirePermission('canAdjustFinishedStock'),
  ah(async (req, res) => res.json(await listRemovableTakas(parseId(String(req.query.designId), 'design id'), parseId(String(req.query.materialId), 'quality id')))),
);
inventoryRouter.get('/stock-adjustments', ah(async (req, res) => res.json(await listStockAdjustments(req.query))));
// Sprint 22 (C9): damaged free stock sold in a lot (registered before /damaged/:key).
inventoryRouter.get('/damaged/lots', ah(async (req, res) => res.json(await listDamagedLots(req.role, req.query))));
inventoryRouter.get('/damaged/lots/:id', ah(async (req, res) => res.json(await getDamagedLot(req.role, parseId(req.params.id, 'lot id')))));
inventoryRouter.get(
  '/damaged/free-takas',
  requirePermission('canAdjustFinishedStock'),
  ah(async (req, res) => {
    const n = (v: unknown) => (typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : undefined);
    res.json(await listDamagedFreeTakas({ materialId: n(req.query.materialId), designId: n(req.query.designId), type: typeof req.query.type === 'string' ? req.query.type : undefined }));
  }),
);
inventoryRouter.post('/damaged/lots', requirePermission('canAdjustFinishedStock'), ah(async (req, res) => res.status(201).json(await sellDamagedLot(req.role, req.body))));
inventoryRouter.get('/summary', ah(async (req, res) => res.json(await getInventorySummary(req.role, req.query))));
inventoryRouter.get('/items', ah(async (req, res) => res.json(await listInventoryItems(req.role, req.query))));
inventoryRouter.get('/items/:key', ah(async (req, res) => res.json(await getInventoryItem(req.role, req.params.key, req.query))));
inventoryRouter.get('/items/:key/orders', ah(async (req, res) => res.json(await listInventoryItemOrders(req.role, req.params.key, req.query))));
inventoryRouter.get('/items/:key/dispatched', ah(async (req, res) => res.json(await listDispatchedItemOrders(req.role, req.params.key))));
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
