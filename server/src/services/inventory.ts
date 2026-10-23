import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  addInventoryPcs,
  blouseBucket,
  isBlouseFilter,
  matchesBlouse,
  type BlouseCounts,
  type BlouseFilter,
  type BlouseOption,
  type FreeStockFigures,
  type FreeStockTaka,
  type ItemFreeStock,
  type AssignTargetOrder,
  canReceiveFreeStock,
  type InventoryPcs,
  compareInventoryItems,
  compareTakaNo,
  DAMAGE_TYPES,
  EMPTY_INVENTORY_PCS,
  inventoryKey,
  NO_DESIGN_KEY,
  orderInventoryPcs,
  parseInventoryKey,
  totalInGodown,
  visibleStatusKeys,
  type DamagedItemCard,
  type DamagedItemDetail,
  type DamagedTakaRow,
  type InventoryFigures,
  type InventoryItemCard,
  type InventoryItemDetail,
  type InventoryItemHeader,
  type InventoryOrderRow,
  type InventorySummary,
  type OrderStatusKey,
  type Paginated,
  type RoleKey,
  type TakaStage,
} from '@rivoora/shared';
import { db } from '../db/client';
import { customers, designVariations, designs, jobsheets, materials, orders, takas } from '../db/schema';
import { badRequest, notFound } from '../lib/errors';
import { likePattern, paginationSchema } from '../lib/http';
import { parseDamagesJson, takaDamagesJson } from './taka-shared';
import { takaNotFree, takaOrderId } from './free-stock';

/**
 * Inventory (Jenish / Gaurang): design-wise pcs. The rows are loaded with a few aggregate queries (one per table,
 * grouped per order / jobsheet / stage — never per item) and folded through the shared `orderInventoryPcs`, so the
 * numbers can never drift from the order dashboard. Only pcs orders count; the rest is reported as "left out".
 */

/* ------------------------------------------------------------------ */
/* loading                                                              */
/* ------------------------------------------------------------------ */

interface OrderPcs {
  orderId: number;
  orderNo: number;
  orderDate: string;
  status: OrderStatusKey;
  customerName: string;
  designId: number | null;
  variationId: number | null;
  blouseOption: BlouseOption | null;
  /** Sprint 15: on hold (shown with a badge; cannot receive free stock). */
  isOnHold: boolean;
  key: string;
  pcs: InventoryFigures;
}

/** `?blouse=` - All, With blouse, Without blouse, Not set (anything else = All). */
const blouseParam = z
  .string()
  .optional()
  .transform((v): BlouseFilter => (isBlouseFilter(v) ? v : 'all'));

/** Orders the role may see, optionally narrowed to one item (design / variation / without design). */
function orderScope(role: RoleKey, key?: string): SQL {
  const conds: SQL[] = [inArray(orders.status, visibleStatusKeys(role))];
  if (key) {
    const parts = parseInventoryKey(key);
    if (!parts) throw badRequest('Invalid inventory item');
    if (parts.kind === 'variation') conds.push(eq(orders.variationId, parts.id));
    else if (parts.kind === 'design') conds.push(and(eq(orders.designId, parts.id), sql`${orders.variationId} IS NULL`)!);
    else conds.push(and(sql`${orders.designId} IS NULL`, sql`${orders.variationId} IS NULL`)!);
  }
  return and(...conds)!;
}

/** Pcs figures of every pcs order in scope, plus how many non-pcs orders were left out. */
async function loadOrderPcs(role: RoleKey, key?: string): Promise<{ list: OrderPcs[]; excluded: number }> {
  const scope = orderScope(role, key);
  const [orderRows, sheetRows, takaRows] = await db.batch([
    db
      .select({
        orderId: orders.id,
        orderNo: orders.orderNo,
        orderDate: orders.orderDate,
        status: orders.status,
        unit: orders.unit,
        quantity: orders.quantity,
        designId: orders.designId,
        variationId: orders.variationId,
        blouseOption: orders.blouseOption,
        isOnHold: orders.isOnHold,
        isClosed: orders.isClosed,
        customerName: customers.name,
        // Sprint 16: pcs still to come on open pcs POs ("at outside weaver") — In making.
        pendingOutsidePcs: sql<number>`COALESCE((SELECT SUM(MAX(p.quantity - p.received_qty, 0)) FROM outside_pos p WHERE p.order_id = "orders"."id" AND p.unit = 'pcs' AND p.status IN ('open', 'partly_received')), 0)`,
      })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .where(scope),
    db
      .select({
        orderId: jobsheets.orderId,
        id: jobsheets.id,
        status: jobsheets.status,
        frames: jobsheets.frames,
        completedFrames: jobsheets.completedFrames,
      })
      .from(jobsheets)
      .innerJoin(orders, eq(orders.id, jobsheets.orderId))
      .where(and(scope, eq(orders.unit, 'pcs'), eq(jobsheets.isDeleted, false), eq(jobsheets.isExternal, false))),
    db
      .select({
        // Sprint 13: a taka counts for the order it is allocated to (else its own); free stock counts for none.
        orderId: takaOrderId,
        jobsheetId: takas.jobsheetId,
        stage: takas.stage,
        count: sql<number>`COUNT(*)`,
        pcs: sql<number | null>`SUM(COALESCE(${takas.actualPcs}, ${takas.pcs}))`,
        withoutPcs: sql<number>`SUM(CASE WHEN COALESCE(${takas.actualPcs}, ${takas.pcs}) IS NULL THEN 1 ELSE 0 END)`,
        // OPEN damaged pcs (pcs − resolved_pcs of open damages) — only godown stock counts them (see the shared function).
        damagedPcs: sql<number | null>`SUM((SELECT COALESCE(SUM(MAX(d.pcs - d.resolved_pcs, 0)), 0) FROM taka_damages d WHERE d.taka_id = "takas"."id" AND d.is_deleted = 0 AND d.status = 'open'))`,
      })
      .from(takas)
      .innerJoin(jobsheets, eq(jobsheets.id, takas.jobsheetId))
      .innerJoin(orders, eq(orders.id, takaOrderId))
      .where(and(scope, takaNotFree, eq(orders.unit, 'pcs'), eq(takas.isDeleted, false), eq(jobsheets.isDeleted, false)))
      .groupBy(takaOrderId, takas.jobsheetId, takas.stage),
  ]);

  const sheetsByOrder = new Map<number, typeof sheetRows>();
  for (const j of sheetRows) sheetsByOrder.set(j.orderId, [...(sheetsByOrder.get(j.orderId) ?? []), j]);
  const takasByOrder = new Map<number, typeof takaRows>();
  for (const t of takaRows) takasByOrder.set(t.orderId, [...(takasByOrder.get(t.orderId) ?? []), t]);

  const list: OrderPcs[] = [];
  let excluded = 0;
  for (const o of orderRows) {
    const pcs = orderInventoryPcs(
      // Sprint 16: a CLOSED order orders nothing any more (its free stock is counted as free stock).
      { unit: o.unit, quantity: o.isClosed ? 0 : o.quantity },
      sheetsByOrder.get(o.orderId) ?? [],
      (takasByOrder.get(o.orderId) ?? []).map((t) => ({
        jobsheetId: t.jobsheetId,
        stage: t.stage,
        count: Number(t.count),
        pcs: t.pcs === null ? null : Number(t.pcs),
        withoutPcs: Number(t.withoutPcs),
        damagedPcs: t.damagedPcs === null ? 0 : Number(t.damagedPcs),
      })),
      o.isClosed ? 0 : Number(o.pendingOutsidePcs),
    );
    if (!pcs) {
      excluded += 1;
      continue;
    }
    list.push({
      orderId: o.orderId,
      orderNo: o.orderNo,
      orderDate: o.orderDate,
      status: o.status,
      customerName: o.customerName,
      designId: o.designId,
      variationId: o.variationId,
      blouseOption: o.blouseOption,
      isOnHold: o.isOnHold,
      key: inventoryKey(o),
      pcs,
    });
  }
  return { list, excluded };
}

/** Sums per item key. */
function groupByItem(list: readonly OrderPcs[]): Map<string, InventoryFigures> {
  const map = new Map<string, InventoryFigures>();
  for (const o of list) map.set(o.key, addInventoryPcs(map.get(o.key) ?? EMPTY_INVENTORY_PCS, o.pcs));
  return map;
}

/* ------------------------------------------------------------------ */
/* free stock (Sprint 13)                                               */
/* ------------------------------------------------------------------ */

interface FreeRow extends FreeStockTaka {
  key: string;
}

/**
 * Every free-stock taka of pcs orders (optionally one item). The item and the blouse option come from the ORIGIN order.
 * Not narrowed by the role's visible order statuses: Dhruvil (Move to inventory) uses it too.
 */
async function loadFreeStock(key?: string): Promise<FreeRow[]> {
  const conds: SQL[] = [];
  if (key) {
    const parts = parseInventoryKey(key);
    if (!parts) throw badRequest('Invalid inventory item');
    if (parts.kind === 'variation') conds.push(eq(orders.variationId, parts.id));
    else if (parts.kind === 'design') conds.push(and(eq(orders.designId, parts.id), sql`${orders.variationId} IS NULL`)!);
    else conds.push(and(sql`${orders.designId} IS NULL`, sql`${orders.variationId} IS NULL`)!);
  }
  const rows = await db
    .select({
      id: takas.id,
      takaNo: takas.takaNo,
      stage: takas.stage,
      pcs: sql<number | null>`COALESCE(${takas.actualPcs}, ${takas.pcs})`,
      meters: takas.meters,
      fromOrderId: orders.id,
      fromOrderNo: orders.orderNo,
      reason: takas.freeStockReason,
      freeStockAt: takas.freeStockAt,
      isDamaged: takas.isDamaged,
      damagedPcs: sql<number | null>`(SELECT COALESCE(SUM(MAX(d.pcs - d.resolved_pcs, 0)), 0) FROM taka_damages d WHERE d.taka_id = "takas"."id" AND d.is_deleted = 0 AND d.status = 'open')`,
      blouseOption: orders.blouseOption,
      designId: orders.designId,
      variationId: orders.variationId,
    })
    .from(takas)
    .innerJoin(jobsheets, eq(jobsheets.id, takas.jobsheetId))
    .innerJoin(orders, eq(orders.id, takas.orderId))
    .where(and(eq(takas.isFreeStock, true), eq(takas.isDeleted, false), eq(jobsheets.isDeleted, false), eq(orders.unit, 'pcs'), ...conds))
    .orderBy(takas.id);
  return rows.map(({ designId, variationId, damagedPcs, ...r }) => ({
    ...r,
    key: inventoryKey({ designId, variationId }),
    damagedPcs: Number(damagedPcs ?? 0),
  }));
}

const EMPTY_FREE: FreeStockFigures = { ready: 0, making: 0, damaged: 0, total: 0 };

/** Free figures of some takas: ready = `final`; making = every other stage; damaged = open damaged pcs on the ready ones. */
function freeFigures(rows: readonly FreeRow[]): FreeStockFigures {
  const f = { ...EMPTY_FREE };
  for (const t of rows) {
    const pcs = t.pcs ?? 0;
    if (t.stage === 'final') {
      f.ready += pcs;
      f.damaged += t.damagedPcs;
    } else f.making += pcs;
  }
  f.total = f.ready + f.making;
  return f;
}

const freeByKey = (rows: readonly FreeRow[]): Map<string, FreeRow[]> => {
  const map = new Map<string, FreeRow[]>();
  for (const r of rows) map.set(r.key, [...(map.get(r.key) ?? []), r]);
  return map;
};

/** pcs of STOCK per blouse bucket (made or being made + free) — the Add order panel's "With blouse 120 · Without 80" line. */
function blouseStockOf(list: readonly OrderPcs[], free: readonly FreeRow[]): BlouseCounts {
  const counts: BlouseCounts = {};
  for (const o of list) {
    const b = blouseBucket(o.blouseOption);
    counts[b] = (counts[b] ?? 0) + o.pcs.inMaking + o.pcs.inGodown + o.pcs.readyDispatch + o.pcs.inRefinish;
  }
  for (const t of free) {
    const b = blouseBucket(t.blouseOption);
    counts[b] = (counts[b] ?? 0) + (t.pcs ?? 0);
  }
  return counts;
}

/** pcs per blouse bucket: ordered pcs of the orders + free pcs (unfiltered - the toggle's counts). */
function blouseCountsOf(list: readonly OrderPcs[], free: readonly FreeRow[]): BlouseCounts {
  const counts: BlouseCounts = {};
  for (const o of list) {
    const b = blouseBucket(o.blouseOption);
    counts[b] = (counts[b] ?? 0) + o.pcs.ordered;
  }
  for (const t of free) {
    const b = blouseBucket(t.blouseOption);
    counts[b] = (counts[b] ?? 0) + (t.pcs ?? 0);
  }
  return counts;
}

/* ------------------------------------------------------------------ */
/* item headers                                                         */
/* ------------------------------------------------------------------ */

const WITHOUT_DESIGN: InventoryItemHeader = { key: NO_DESIGN_KEY, code: null, name: null, variationOf: null, quality: null, thumbUrl: null, imageUrl: null };

/** Headers (code, name, image, quality) of the given item keys — two queries however many items there are. */
async function loadHeaders(keys: readonly string[]): Promise<Map<string, InventoryItemHeader>> {
  const designIds: number[] = [];
  const variationIds: number[] = [];
  for (const k of keys) {
    const p = parseInventoryKey(k);
    if (p?.kind === 'design') designIds.push(p.id);
    else if (p?.kind === 'variation') variationIds.push(p.id);
  }
  const headers = new Map<string, InventoryItemHeader>();
  if (keys.includes(NO_DESIGN_KEY)) headers.set(NO_DESIGN_KEY, WITHOUT_DESIGN);
  const [designRows, variationRows] = await db.batch([
    db
      .select({ id: designs.id, code: designs.code, name: designs.name, thumbUrl: designs.thumbUrl, imageUrl: designs.imageUrl, quality: materials.name })
      .from(designs)
      .leftJoin(materials, eq(materials.id, designs.materialId))
      .where(designIds.length ? inArray(designs.id, designIds) : sql`0`),
    db
      .select({
        id: designVariations.id,
        code: designVariations.code,
        thumbUrl: designVariations.thumbUrl,
        imageUrl: designVariations.imageUrl,
        baseCode: designs.code,
        baseName: designs.name,
        baseThumbUrl: designs.thumbUrl,
        baseImageUrl: designs.imageUrl,
        quality: materials.name,
      })
      .from(designVariations)
      .innerJoin(designs, eq(designs.id, designVariations.designId))
      .leftJoin(materials, eq(materials.id, designs.materialId))
      .where(variationIds.length ? inArray(designVariations.id, variationIds) : sql`0`),
  ]);
  for (const d of designRows) {
    headers.set(`d-${d.id}`, { key: `d-${d.id}`, code: d.code, name: d.name, variationOf: null, quality: d.quality, thumbUrl: d.thumbUrl, imageUrl: d.imageUrl });
  }
  for (const v of variationRows) {
    headers.set(`v-${v.id}`, {
      key: `v-${v.id}`,
      code: v.code,
      name: v.baseName,
      variationOf: v.baseCode,
      quality: v.quality,
      thumbUrl: v.thumbUrl ?? v.baseThumbUrl,
      imageUrl: v.imageUrl ?? v.baseImageUrl,
    });
  }
  return headers;
}

async function loadHeader(key: string): Promise<InventoryItemHeader> {
  const header = (await loadHeaders([key])).get(key);
  if (!header) throw notFound('Design');
  return header;
}

const searchMatches = (h: InventoryItemHeader, term: string) => {
  const t = term.toLowerCase();
  return [h.code, h.name, h.variationOf].some((v) => v?.toLowerCase().includes(t));
};

/* ------------------------------------------------------------------ */
/* summary + All designs                                                */
/* ------------------------------------------------------------------ */

/** GET /inventory/summary */
export async function getInventorySummary(role: RoleKey, query: unknown = {}): Promise<InventorySummary> {
  const blouse = blouseParam.parse((query as { blouse?: unknown } | null)?.blouse);
  const [{ list: all, excluded }, freeAll] = await Promise.all([loadOrderPcs(role), loadFreeStock()]);
  const list = all.filter((o) => matchesBlouse(blouse, o.blouseOption));
  const free = freeAll.filter((t) => matchesBlouse(blouse, t.blouseOption));
  const totals = list.reduce((sum, o) => addInventoryPcs(sum, o.pcs), EMPTY_INVENTORY_PCS);
  return { totals, freePcs: freeFigures(free).total, totalInGodown: totalInGodown(totals), excludedOrders: excluded };
}

export const INVENTORY_KPI_KEYS = ['godown', 'ready', 'making', 'damaged', 'refinish', 'free'] as const;

export const inventoryListQuerySchema = paginationSchema.extend({
  /** Comma-separated KPI filters; an item is kept when it has pcs in ANY of them. */
  kpi: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').filter((k) => (INVENTORY_KPI_KEYS as readonly string[]).includes(k)) : [])),
  blouse: blouseParam,
});

function paginate<T>(items: T[], page: number, limit: number): Paginated<T> {
  const start = (page - 1) * limit;
  return { items: items.slice(start, start + limit), page, limit, total: items.length, hasMore: start + limit < items.length };
}

const kpiPcs = (p: InventoryPcs, k: string, freePcs = 0) =>
  k === 'godown'
    ? totalInGodown(p)
    : k === 'ready'
      ? p.readyDispatch
      : k === 'making'
        ? p.inMaking
        : k === 'damaged'
          ? p.damaged
          : k === 'free'
            ? freePcs
            : p.inRefinish;

/** GET /inventory/items?search=&page=&limit= */
export async function listInventoryItems(role: RoleKey, query: unknown): Promise<Paginated<InventoryItemCard>> {
  const { page, limit, search, kpi, blouse } = inventoryListQuerySchema.parse(query);
  const [{ list: all }, freeAll] = await Promise.all([loadOrderPcs(role), loadFreeStock()]);
  const list = all.filter((o) => matchesBlouse(blouse, o.blouseOption));
  const freeMap = freeByKey(freeAll.filter((t) => matchesBlouse(blouse, t.blouseOption)));
  const grouped = groupByItem(list);
  const headers = await loadHeaders([...grouped.keys()]);
  const cards: InventoryItemCard[] = [];
  for (const [key, pcs] of grouped) {
    const header = headers.get(key);
    if (!header || pcs.ordered <= 0) continue; // items with nothing ordered are not shown
    if (search && !searchMatches(header, search)) continue;
    const freePcs = freeFigures(freeMap.get(key) ?? []).total;
    if (kpi.length && !kpi.some((k) => kpiPcs(pcs, k, freePcs) > 0)) continue;
    cards.push({ ...header, pcs, freePcs });
  }
  cards.sort((a, b) =>
    compareInventoryItems(
      { key: a.key, code: a.code, inMaking: a.pcs.inMaking, ready: a.pcs.readyDispatch },
      { key: b.key, code: b.code, inMaking: b.pcs.inMaking, ready: b.pcs.readyDispatch },
    ),
  );
  return paginate(cards, page, limit);
}

/** GET /inventory/items/:key */
export async function getInventoryItem(role: RoleKey, key: string, query: unknown = {}): Promise<InventoryItemDetail> {
  const blouse = blouseParam.parse((query as { blouse?: unknown } | null)?.blouse);
  const header = await loadHeader(key);
  const [{ list: all }, freeAll] = await Promise.all([loadOrderPcs(role, key), loadFreeStock(key)]);
  const list = all.filter((o) => matchesBlouse(blouse, o.blouseOption));
  const free = freeAll.filter((t) => matchesBlouse(blouse, t.blouseOption));
  return {
    ...header,
    pcs: groupByItem(list).get(key) ?? EMPTY_INVENTORY_PCS,
    free: freeFigures(free),
    blouseCounts: blouseCountsOf(all, freeAll),
    blouseStock: blouseStockOf(all, freeAll),
  };
}

/** GET /inventory/items/:key/free-stock?blouse= - the free takas of an item (also for Dhruvil: Add from free stock). */
export async function getItemFreeStock(key: string, query: unknown = {}): Promise<ItemFreeStock> {
  const blouse = blouseParam.parse((query as { blouse?: unknown } | null)?.blouse);
  await loadHeader(key);
  const all = await loadFreeStock(key);
  const free = all.filter((t) => matchesBlouse(blouse, t.blouseOption));
  const counts: BlouseCounts = {};
  for (const t of all) {
    const b = blouseBucket(t.blouseOption);
    counts[b] = (counts[b] ?? 0) + (t.pcs ?? 0);
  }
  return {
    figures: freeFigures(free),
    takas: free.sort((a, b) => compareTakaNo(a.takaNo, b.takaNo)).map(({ key: _k, ...t }) => t),
    blouseCounts: counts,
  };
}

/** GET /inventory/items/:key/assign-targets - orders of the item that can receive free stock (Assign to order). */
export async function listAssignTargets(role: RoleKey, key: string): Promise<AssignTargetOrder[]> {
  await loadHeader(key);
  const { list } = await loadOrderPcs(role, key);
  const rows = list.length
    ? await db
        .select({ id: orders.id, orderType: orders.orderType })
        .from(orders)
        .where(inArray(orders.id, list.map((o) => o.orderId)))
    : [];
  const typeOf = new Map(rows.map((r) => [r.id, r.orderType]));
  return list
    .filter((o) => canReceiveFreeStock(o.status) && !o.isOnHold)
    .sort((a, b) => b.orderNo - a.orderNo)
    .map((o) => ({
      orderId: o.orderId,
      orderNo: o.orderNo,
      customerName: o.customerName,
      orderType: typeOf.get(o.orderId) ?? 'pcs_to_pcs',
      status: o.status,
      orderedPcs: o.pcs.ordered,
      blouseOption: o.blouseOption,
    }));
}

export const itemOrdersQuerySchema = z.object({
  /** Only orders that have ready-for-dispatch / in-making / ready-for-order (final, in the godown) pcs of this item. */
  filter: z.enum(['ready', 'making', 'godown']).optional().catch(undefined),
  blouse: blouseParam,
  search: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => v || undefined),
});

/** GET /inventory/items/:key/orders?search= — newest first; search = order number or taka number. */
export async function listInventoryItemOrders(role: RoleKey, key: string, query: unknown): Promise<InventoryOrderRow[]> {
  const { search, filter, blouse } = itemOrdersQuerySchema.parse(query);
  await loadHeader(key);
  const { list: all } = await loadOrderPcs(role, key);
  const list = all.filter((o) => matchesBlouse(blouse, o.blouseOption));
  let matching: Set<number> | null = null;
  if (search) {
    const term = search.replace(/^#/, '');
    const ids = list.map((o) => o.orderId);
    const byTaka = ids.length
      ? await db
          .selectDistinct({ orderId: takaOrderId })
          .from(takas)
          .where(
            and(
              inArray(takaOrderId, ids),
              takaNotFree,
              eq(takas.isDeleted, false),
              sql`(${takas.takaNo} LIKE ${likePattern(term)} ESCAPE '\\' OR ${takas.weaverTakaNo} LIKE ${likePattern(term)} ESCAPE '\\')`,
            ),
          )
      : [];
    const asNo = /^\d+$/.test(term) ? Number(term) : -1;
    matching = new Set([...byTaka.map((r) => r.orderId), ...list.filter((o) => o.orderNo === asNo).map((o) => o.orderId)]);
  }
  return list
    .filter((o) => !matching || matching.has(o.orderId))
    .filter((o) => !filter || (filter === 'ready' ? o.pcs.readyDispatch : filter === 'godown' ? o.pcs.inGodown : o.pcs.inMaking) > 0)
    .sort((a, b) => b.orderNo - a.orderNo)
    .map((o) => ({
      orderId: o.orderId,
      orderNo: o.orderNo,
      customerName: o.customerName,
      status: o.status,
      orderedPcs: o.pcs.ordered,
      readyPcs: o.pcs.readyDispatch,
      godownPcs: o.pcs.inGodown,
      makingPcs: o.pcs.inMaking,
      orderDate: o.orderDate,
      blouseOption: o.blouseOption,
      isOnHold: o.isOnHold,
    }));
}

/* ------------------------------------------------------------------ */
/* Damaged                                                              */
/* ------------------------------------------------------------------ */

/** GET /inventory/damaged?search=&page=&limit= — items with open damaged pcs in the godown or pcs in refinish. */
export async function listDamagedItems(role: RoleKey, query: unknown): Promise<Paginated<DamagedItemCard>> {
  const { page, limit, search } = inventoryListQuerySchema.parse(query);
  const [{ list }, freeAll] = await Promise.all([loadOrderPcs(role), loadFreeStock()]);
  const grouped = groupByItem(list);
  // Free stock keeps its damage and refinish pcs: they show here too (an item may have only free damaged pcs).
  const freeMap = freeByKey(freeAll);
  for (const key of freeMap.keys()) if (!grouped.has(key)) grouped.set(key, EMPTY_INVENTORY_PCS);
  const headers = await loadHeaders([...grouped.keys()]);
  const cards: DamagedItemCard[] = [];
  for (const [key, pcs] of grouped) {
    const header = headers.get(key);
    const free = freeMap.get(key) ?? [];
    const damaged = pcs.damaged + freeFigures(free).damaged;
    const inRefinish = pcs.inRefinish + free.filter((t) => t.stage === 'refinish').reduce((n, t) => n + (t.pcs ?? 0), 0);
    if (!header || (damaged <= 0 && inRefinish <= 0)) continue;
    if (search && !searchMatches(header, search)) continue;
    cards.push({ ...header, damaged, inRefinish, lastClearedAt: null });
  }
  cards.sort((a, b) => b.damaged - a.damaged || b.inRefinish - a.inRefinish || (a.code ?? '').localeCompare(b.code ?? '', undefined, { numeric: true }));
  return paginate(cards, page, limit);
}

interface DamagedTakaFull extends DamagedTakaRow {
  /** Types the taka has an open damage of (same as `types`; kept for readability). */
  open: number;
}

/** The takas listed under a damaged item: godown stock with an open damage, plus everything in refinish. */
async function loadDamagedTakas(role: RoleKey, key: string): Promise<DamagedTakaFull[]> {
  const scope = orderScope(role, key);
  const rows = await db
    .select({
      id: takas.id,
      takaNo: takas.takaNo,
      stage: takas.stage,
      createdAt: takas.createdAt,
      isFreeStock: takas.isFreeStock,
      orderId: orders.id,
      orderNo: orders.orderNo,
      damagesJson: takaDamagesJson,
    })
    .from(takas)
    .innerJoin(jobsheets, eq(jobsheets.id, takas.jobsheetId))
    .innerJoin(orders, eq(orders.id, takas.orderId))
    .where(
      and(
        scope,
        eq(orders.unit, 'pcs'),
        eq(takas.isDeleted, false),
        eq(jobsheets.isDeleted, false),
        sql`(${takas.stage} = 'refinish' OR (${takas.stage} IN ('final', 'ready_dispatch') AND EXISTS (SELECT 1 FROM taka_damages d WHERE d.taka_id = "takas"."id" AND d.is_deleted = 0 AND d.status = 'open')))`,
      ),
    );
  const out: DamagedTakaFull[] = [];
  for (const r of rows) {
    const open = parseDamagesJson(r.damagesJson).filter((d) => d.status === 'open');
    const types = DAMAGE_TYPES.filter((t) => open.some((d) => d.foundAt === t));
    out.push({
      id: r.id,
      takaNo: r.takaNo,
      orderId: r.orderId,
      orderNo: r.orderNo,
      stage: r.stage as TakaStage,
      recordedAt: open.length ? open.map((d) => d.createdAt).sort().at(-1)! : r.createdAt,
      types,
      names: [...new Set(open.map((d) => d.damageName).filter((n): n is string => !!n))],
      isRefinish: r.stage === 'refinish',
      isFreeStock: r.isFreeStock,
      open: open.length,
    });
  }
  return out;
}

/** GET /inventory/damaged/:key */
export async function getDamagedItem(role: RoleKey, key: string): Promise<DamagedItemDetail> {
  const header = await loadHeader(key);
  const [{ list }, rows, freeRows] = await Promise.all([loadOrderPcs(role, key), loadDamagedTakas(role, key), loadFreeStock(key)]);
  const pcs = groupByItem(list).get(key) ?? EMPTY_INVENTORY_PCS;
  return {
    ...header,
    damaged: pcs.damaged + freeFigures(freeRows).damaged,
    inRefinish: pcs.inRefinish + freeRows.filter((t) => t.stage === 'refinish').reduce((n, t) => n + (t.pcs ?? 0), 0),
    lastClearedAt: null,
    typeCounts: DAMAGE_TYPES.map((type) => ({ type, count: rows.filter((r) => r.types.includes(type)).length })),
    totalTakas: rows.length,
    refinishTakas: rows.filter((r) => r.isRefinish).length,
  };
}

export const damagedTakasQuerySchema = z.object({
  type: z
    .enum(DAMAGE_TYPES)
    .or(z.literal(''))
    .optional()
    .transform((v) => v || undefined),
  refinish: z
    .enum(['1', 'true', '0', 'false', ''])
    .optional()
    .transform((v) => v === '1' || v === 'true'),
  search: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => v || undefined),
});

/** GET /inventory/damaged/:key/takas?type=&refinish=&search= */
export async function listDamagedTakas(role: RoleKey, key: string, query: unknown): Promise<DamagedTakaRow[]> {
  const { type, refinish, search } = damagedTakasQuerySchema.parse(query);
  await loadHeader(key);
  const term = search?.replace(/^#/, '').toLowerCase();
  return (await loadDamagedTakas(role, key))
    .filter((t) => (!type || t.types.includes(type)) && (!refinish || t.isRefinish))
    .filter((t) => !term || t.takaNo.toLowerCase().includes(term) || String(t.orderNo) === term || t.names.some((n) => n.toLowerCase().includes(term)))
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt) || compareTakaNo(a.takaNo, b.takaNo))
    .map(({ open: _open, ...row }) => row);
}
