import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import {
  addDual,
  addQty,
  DISPATCHED_ORDER_STATUSES,
  dualIsEmpty,
  emptyDual,
  emptyQty,
  inventoryKey,
  NO_DESIGN_KEY,
  orderInventoryMeters,
  orderInventoryPcs,
  parseInventoryKey,
  visibleStatusKeys,
  type DesignQuantities,
  type DualStock,
  type QualityCard,
  type StockDesignCard,
  type OrderStatusKey,
  type RoleKey,
  type StockQty,
} from '@rivoora/shared';
import { z } from 'zod';
import { db } from '../db/client';
import { designs, jobsheets, materials, orders, takas } from '../db/schema';
import { badRequest, notFound } from '../lib/errors';
import { takaNotFree, takaOrderId } from './free-stock';

/**
 * Sprint 22 (CR-15) — the stock read model behind the Inventory home (Quality → Design → Design details).
 * One figure set per (quality, design), in BOTH units but never mixed: pcs and metres. Ordered / in making / ready come
 * from the open orders (hidden Manual-stock holder orders and fully dispatched orders are left out), free stock from the
 * free-stock takas (their ORIGIN order gives the quality and design — for Manual stock that is its holder order).
 */

export interface StockCell {
  materialId: number;
  /** `d-<id>` | `none` */
  key: string;
  fgTypes: Set<string>;
  dual: DualStock;
}

const fgTypeParam = z
  .string()
  .optional()
  .transform((v) => (v === 'saree' || v === 'suit' ? v : undefined));
export const qualityQuerySchema = z.object({
  search: z.string().trim().max(60).optional(),
  flag: z.enum(['free', 'damaged']).optional().catch(undefined),
  fgType: fgTypeParam,
  sort: z.enum(['free', 'code']).optional().catch(undefined),
});

/** Loads every (quality, design) cell for the role. */
export async function loadStockCells(role: RoleKey): Promise<Map<string, StockCell>> {
  const scope = and(
    inArray(orders.status, visibleStatusKeys(role)),
    notInArray(orders.status, DISPATCHED_ORDER_STATUSES as OrderStatusKey[]),
    eq(orders.isStockHolder, false),
  )!;
  const [orderRows, sheetRows, takaRows, freeRows] = await db.batch([
    db
      .select({
        orderId: orders.id,
        materialId: orders.materialId,
        designId: orders.designId,
        unit: orders.unit,
        quantity: orders.quantity,
        isClosed: orders.isClosed,
        fgType: orders.fgType,
      })
      .from(orders)
      .where(and(scope, inArray(orders.unit, ['pcs', 'meters']))),
    db
      .select({
        orderId: jobsheets.orderId,
        id: jobsheets.id,
        status: jobsheets.status,
        frames: jobsheets.frames,
        completedFrames: jobsheets.completedFrames,
        meters: jobsheets.meters,
        completedMeters: jobsheets.completedMeters,
        sections: jobsheets.sections,
      })
      .from(jobsheets)
      .innerJoin(orders, eq(orders.id, jobsheets.orderId))
      .where(and(scope, eq(jobsheets.isDeleted, false), eq(jobsheets.isExternal, false))),
    db
      .select({
        orderId: takaOrderId,
        jobsheetId: takas.jobsheetId,
        stage: takas.stage,
        count: sql<number>`COUNT(*)`,
        pcs: sql<number | null>`SUM(COALESCE(${takas.actualPcs}, ${takas.pcs}))`,
        withoutPcs: sql<number>`SUM(CASE WHEN COALESCE(${takas.actualPcs}, ${takas.pcs}) IS NULL THEN 1 ELSE 0 END)`,
        meters: sql<number | null>`SUM(COALESCE(${takas.actualMeters}, ${takas.meters}))`,
        damagedPcs: sql<number | null>`SUM((SELECT COALESCE(SUM(MAX(d.pcs - d.resolved_pcs, 0)), 0) FROM taka_damages d WHERE d.taka_id = "takas"."id" AND d.is_deleted = 0 AND d.status = 'open'))`,
        damagedMeters: sql<number | null>`SUM((SELECT COALESCE(SUM(MAX(COALESCE(d.meters, 0) - d.resolved_meters, 0)), 0) FROM taka_damages d WHERE d.taka_id = "takas"."id" AND d.is_deleted = 0 AND d.status = 'open'))`,
      })
      .from(takas)
      .innerJoin(jobsheets, eq(jobsheets.id, takas.jobsheetId))
      .innerJoin(orders, eq(orders.id, takaOrderId))
      .where(and(scope, takaNotFree, eq(takas.isDeleted, false), eq(jobsheets.isDeleted, false)))
      .groupBy(takaOrderId, takas.jobsheetId, takas.stage),
    // free stock: the ORIGIN order gives quality, design, unit
    db
      .select({
        materialId: orders.materialId,
        designId: orders.designId,
        unit: orders.unit,
        fgType: orders.fgType,
        pcs: sql<number>`COALESCE(SUM(COALESCE(${takas.actualPcs}, ${takas.pcs}, 0)), 0)`,
        meters: sql<number>`COALESCE(SUM(COALESCE(${takas.actualMeters}, ${takas.meters}, 0)), 0)`,
        damagedPcs: sql<number>`COALESCE(SUM((SELECT COALESCE(SUM(MAX(d.pcs - d.resolved_pcs, 0)), 0) FROM taka_damages d WHERE d.taka_id = "takas"."id" AND d.is_deleted = 0 AND d.status = 'open')), 0)`,
        damagedMeters: sql<number>`COALESCE(SUM((SELECT COALESCE(SUM(MAX(COALESCE(d.meters, 0) - d.resolved_meters, 0)), 0) FROM taka_damages d WHERE d.taka_id = "takas"."id" AND d.is_deleted = 0 AND d.status = 'open')), 0)`,
      })
      .from(takas)
      .innerJoin(orders, eq(orders.id, takas.orderId))
      .innerJoin(jobsheets, eq(jobsheets.id, takas.jobsheetId))
      .where(and(eq(takas.isFreeStock, true), eq(takas.isDeleted, false), eq(jobsheets.isDeleted, false)))
      .groupBy(orders.materialId, orders.designId, orders.unit, orders.fgType),
  ]);

  const sheetsBy = new Map<number, typeof sheetRows>();
  for (const j of sheetRows) sheetsBy.set(j.orderId, [...(sheetsBy.get(j.orderId) ?? []), j]);
  const takasBy = new Map<number, typeof takaRows>();
  for (const t of takaRows) takasBy.set(t.orderId, [...(takasBy.get(t.orderId) ?? []), t]);

  const cells = new Map<string, StockCell>();
  const cellOf = (materialId: number, designId: number | null, fgType: string): StockCell => {
    const key = inventoryKey({ designId });
    const id = `${materialId}|${key}`;
    let c = cells.get(id);
    if (!c) {
      c = { materialId, key, fgTypes: new Set(), dual: emptyDual() };
      cells.set(id, c);
    }
    c.fgTypes.add(fgType);
    return c;
  };

  for (const o of orderRows) {
    const sheets = sheetsBy.get(o.orderId) ?? [];
    const rows = takasBy.get(o.orderId) ?? [];
    const quantity = o.isClosed ? 0 : o.quantity;
    const cell = cellOf(o.materialId, o.designId, o.fgType);
    if (o.unit === 'pcs') {
      const p = orderInventoryPcs(
        { unit: 'pcs', quantity },
        sheets,
        rows.map((t) => ({ jobsheetId: t.jobsheetId, stage: t.stage, count: Number(t.count), pcs: t.pcs === null ? null : Number(t.pcs), withoutPcs: Number(t.withoutPcs), damagedPcs: t.damagedPcs === null ? 0 : Number(t.damagedPcs) })),
        0,
      );
      if (p) {
        const q: StockQty = { ...emptyQty(), ordered: p.ordered, inMaking: p.inMaking, ready: p.inGodown + p.readyDispatch, refinish: p.inRefinish, damaged: p.damaged };
        cell.dual.pcs = addQty(cell.dual.pcs, q);
      }
    } else {
      const q = orderInventoryMeters(
        { unit: 'meters', quantity },
        sheets,
        rows.map((t) => ({ jobsheetId: t.jobsheetId, stage: t.stage, count: Number(t.count), meters: t.meters === null ? null : Number(t.meters), damagedMeters: t.damagedMeters === null ? 0 : Number(t.damagedMeters) })),
      );
      if (q) cell.dual.meters = addQty(cell.dual.meters, q);
    }
  }
  for (const f of freeRows) {
    const cell = cellOf(f.materialId, f.designId, f.fgType);
    if (f.unit === 'meters') {
      cell.dual.meters = addQty(cell.dual.meters, { ...emptyQty(), free: Number(f.meters), damaged: Number(f.damagedMeters) });
    } else {
      cell.dual.pcs = addQty(cell.dual.pcs, { ...emptyQty(), free: Number(f.pcs), damaged: Number(f.damagedPcs) });
    }
  }
  for (const [id, c] of cells) if (dualIsEmpty(c.dual)) cells.delete(id);
  return cells;
}


const passes = (c: StockCell, flag: 'free' | 'damaged' | undefined, fgType: string | undefined) => {
  if (fgType && !c.fgTypes.has(fgType)) return false;
  if (flag === 'free') return c.dual.pcs.free > 0 || c.dual.meters.free > 0;
  if (flag === 'damaged') return c.dual.pcs.damaged > 0 || c.dual.meters.damaged > 0;
  return true;
};

/** GET /inventory/qualities — one card per quality that has stock or open order quantity. */
export async function listQualityCards(role: RoleKey, query: unknown): Promise<QualityCard[]> {
  const q = qualityQuerySchema.parse(query ?? {});
  const cells = [...(await loadStockCells(role)).values()].filter((c) => passes(c, q.flag, q.fgType));
  const matIds = [...new Set(cells.map((c) => c.materialId))];
  if (!matIds.length) return [];
  const names = new Map((await db.select({ id: materials.id, name: materials.name }).from(materials).where(inArray(materials.id, matIds))).map((m) => [m.id, m.name]));
  const designIds = [...new Set(cells.map((c) => parseInventoryKey(c.key)).flatMap((p) => (p && p.kind === 'design' ? [p.id] : [])))];
  const codes = new Map(
    designIds.length ? (await db.select({ id: designs.id, code: designs.code }).from(designs).where(inArray(designs.id, designIds))).map((d) => [`d-${d.id}`, d.code]) : [],
  );
  const by = new Map<number, QualityCard & { codes: string[] }>();
  for (const c of cells) {
    const cur = by.get(c.materialId) ?? { materialId: c.materialId, name: names.get(c.materialId) ?? '—', designs: 0, dual: emptyDual(), codes: [] };
    cur.designs += 1;
    cur.dual = addDual(cur.dual, c.dual);
    cur.codes.push(codes.get(c.key) ?? '');
    by.set(c.materialId, cur);
  }
  let list = [...by.values()];
  if (q.search) {
    const t = q.search.toLowerCase();
    list = list.filter((x) => x.name.toLowerCase().includes(t) || x.codes.some((code) => code.toLowerCase().includes(t)));
  }
  return list.sort((a, b) => a.name.localeCompare(b.name)).map(({ codes: _codes, ...rest }) => rest);
}

/** GET /inventory/qualities/:materialId/designs */
export async function listQualityDesigns(role: RoleKey, materialId: number, query: unknown): Promise<{ quality: string; items: StockDesignCard[] }> {
  const q = qualityQuerySchema.parse(query ?? {});
  const [mat] = await db.select({ name: materials.name }).from(materials).where(eq(materials.id, materialId));
  if (!mat) throw notFound('Quality');
  const cells = [...(await loadStockCells(role)).values()].filter((c) => c.materialId === materialId && passes(c, q.flag, q.fgType));
  const ids = cells.flatMap((c) => {
    const p = parseInventoryKey(c.key);
    return p && p.kind === 'design' ? [p.id] : [];
  });
  const dRows = ids.length ? await db.select({ id: designs.id, code: designs.code, name: designs.name, thumbUrl: designs.thumbUrl, imageUrl: designs.imageUrl }).from(designs).where(inArray(designs.id, ids)) : [];
  const byId = new Map(dRows.map((d) => [`d-${d.id}`, d]));
  let items: StockDesignCard[] = cells.map((c) => {
    const d = byId.get(c.key);
    const p = parseInventoryKey(c.key);
    return {
      key: c.key,
      designId: p && p.kind === 'design' ? p.id : null,
      code: d?.code ?? null,
      name: d?.name ?? null,
      thumbUrl: d?.thumbUrl ?? null,
      imageUrl: d?.imageUrl ?? null,
      materialId,
      quality: mat.name,
      dual: c.dual,
    };
  });
  if (q.search) {
    const t = q.search.toLowerCase();
    items = items.filter((i) => (i.code ?? 'without design').toLowerCase().includes(t) || (i.name ?? '').toLowerCase().includes(t));
  }
  const free = (i: StockDesignCard) => i.dual.pcs.free + i.dual.meters.free;
  items.sort((a, b) => {
    if ((a.key === NO_DESIGN_KEY) !== (b.key === NO_DESIGN_KEY)) return a.key === NO_DESIGN_KEY ? 1 : -1;
    if (q.sort !== 'code' && free(a) !== free(b)) return free(b) - free(a);
    return (a.code ?? '').localeCompare(b.code ?? '', undefined, { numeric: true });
  });
  return { quality: mat.name, items };
}

/** GET /inventory/items/:key/quantities — the big tiles on the design details (both units, never mixed). */
export async function getDesignQuantities(role: RoleKey, key: string): Promise<DesignQuantities> {
  const parts = parseInventoryKey(key);
  if (!parts || parts.kind === 'legacy_variation') throw badRequest('Invalid inventory item');
  const cells = [...(await loadStockCells(role)).values()].filter((c) => c.key === key);
  const names = new Map(
    cells.length ? (await db.select({ id: materials.id, name: materials.name }).from(materials).where(inArray(materials.id, cells.map((c) => c.materialId)))).map((m) => [m.id, m.name]) : [],
  );
  return {
    key,
    dual: cells.reduce((s, c) => addDual(s, c.dual), emptyDual()),
    byQuality: cells.map((c) => ({ materialId: c.materialId, quality: names.get(c.materialId) ?? '—', dual: c.dual })),
  };
}

