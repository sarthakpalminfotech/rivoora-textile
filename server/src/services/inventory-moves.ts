import { and, eq, inArray, like } from 'drizzle-orm';
import {
  addFromFreeStockSchema,
  canReceiveFreeStock,
  freeStockStage,
  inventoryKey,
  matchesBlouse,
  moveToInventorySchema,
  moveToInventorySelectable,
  nextSplitNumber,
  partialMoveMeters,
  planPcsMove,
  takaActualPcs,
  type AddFromFreeStockResult,
  type BlouseFilter,
  type MoveToInventoryResult,
  type RoleKey,
  type TakaStage,
} from '@rivoora/shared';
import { db, type Tx } from '../db/client';
import { jobsheets, orders, takas } from '../db/schema';
import { badRequest, conflict, notFound } from '../lib/errors';
import { freeStockFields, takaInOrder } from './free-stock';
import { chunk, recomputeOrdersStatus, writeTakaEvents, type TakaEventInput } from './taka-ops';

/**
 * Sprint 13 — Move to inventory (takas / pcs leave their order and become FREE STOCK) and Add from free stock (free
 * stock is assigned to an order again). One transaction per write, conditional stage updates, status recompute.
 * `takas.order_id` always stays the ORIGIN order; `is_free_stock` / `allocated_order_id` decide which order counts it.
 */

const now = () => new Date().toISOString();
const round2 = (n: number) => Math.round(n * 100) / 100;

interface TakaRow {
  id: number;
  takaNo: string;
  stage: TakaStage;
  orderId: number;
  jobsheetId: number;
  pcs: number | null;
  actualPcs: number | null;
  meters: number | null;
  isFreeStock: boolean;
  allocatedOrderId: number | null;
  hasBeenToMill: boolean;
  originOrderId: number | null;
  godownCheckedAt: string | null;
  freeStockAt: string | null;
  freeStockBy: RoleKey | null;
  freeStockReason: 'moved' | 'goods_return' | null;
  parentTakaId: number | null;
}

const takaSelect = {
  id: takas.id,
  takaNo: takas.takaNo,
  stage: takas.stage,
  orderId: takas.orderId,
  jobsheetId: takas.jobsheetId,
  pcs: takas.pcs,
  actualPcs: takas.actualPcs,
  meters: takas.meters,
  isFreeStock: takas.isFreeStock,
  allocatedOrderId: takas.allocatedOrderId,
  hasBeenToMill: takas.hasBeenToMill,
  originOrderId: takas.originOrderId,
  godownCheckedAt: takas.godownCheckedAt,
  freeStockAt: takas.freeStockAt,
  freeStockBy: takas.freeStockBy,
  freeStockReason: takas.freeStockReason,
  parentTakaId: takas.parentTakaId,
};

const total = (rows: readonly Pick<TakaRow, 'pcs' | 'actualPcs'>[]) => rows.reduce((n, t) => n + (takaActualPcs(t) ?? 0), 0);

async function loadOrder(tx: Tx, orderId: number) {
  const [order] = await tx
    .select({
      id: orders.id,
      orderNo: orders.orderNo,
      orderType: orders.orderType,
      unit: orders.unit,
      status: orders.status,
      designId: orders.designId,
      variationId: orders.variationId,
    })
    .from(orders)
    .where(eq(orders.id, orderId));
  if (!order) throw notFound('Order');
  return order;
}

/** Splits `parent` into a kept part (stays) and a moved part (a NEW taka with the next letter number). */
async function splitOffPart(
  tx: Tx,
  role: RoleKey,
  parent: TakaRow,
  movePcs: number,
  keepPcs: number,
  at: string,
  part: Partial<typeof takas.$inferInsert>,
  events: TakaEventInput[],
  noteText: string,
): Promise<number> {
  const base = parent.takaNo.replace(/[A-Z]$/, '');
  const taken = (
    await tx.select({ no: takas.takaNo }).from(takas).where(and(like(takas.takaNo, `${base}%`), eq(takas.isDeleted, false)))
  ).map((r) => r.no);
  const takaNo = nextSplitNumber(parent.takaNo, taken);
  if (!takaNo) throw conflict(`Taka ${parent.takaNo} can't be split any further.`);
  const meters = partialMoveMeters(parent.meters, keepPcs, movePcs);
  const kept = await tx
    .update(takas)
    .set({ pcs: keepPcs, actualPcs: null, meters: meters.keep, updatedAt: at })
    .where(and(eq(takas.id, parent.id), eq(takas.stage, parent.stage)))
    .returning({ id: takas.id });
  if (!kept.length) throw conflict(`Taka ${parent.takaNo} was just changed. Refresh and try again.`);
  const [row] = await tx
    .insert(takas)
    .values({
      jobsheetId: parent.jobsheetId,
      orderId: parent.orderId,
      takaNo,
      meters: meters.move,
      pcs: movePcs,
      parentTakaId: parent.id,
      hasBeenToMill: parent.hasBeenToMill,
      originOrderId: parent.originOrderId,
      enteredBy: role,
      createdAt: at,
      updatedAt: at,
      stage: parent.stage as typeof takas.$inferInsert.stage,
      ...part,
    })
    .returning({ id: takas.id });
  events.push({ takaId: parent.id, event: 'split', note: `split into ${parent.takaNo} (${keepPcs} pcs) and ${takaNo} (${movePcs} pcs) · ${noteText}` });
  events.push({ takaId: row.id, event: 'split', note: `split from ${parent.takaNo}` });
  return row.id;
}

/* ------------------------------------------------------------------ */
/* Move to inventory                                                    */
/* ------------------------------------------------------------------ */

/**
 * POST /orders/:id/takas/move-to-inventory — lump `{ takaIds, note? }` · pcs to pcs `{ pcs, note? }`.
 * Lump: the ticked takas become free stock (any stage that is with us). Pcs to pcs: the system picks takas (final first,
 * then ready for dispatch, largest first), whole while they fit, and splits one taka when it is needed only partly.
 */
export async function moveToInventory(role: RoleKey, orderId: number, input: unknown): Promise<MoveToInventoryResult> {
  const data = moveToInventorySchema.parse(input);
  return db.transaction(async (tx) => {
    const order = await loadOrder(tx, orderId);
    const lump = order.orderType === 'lump';
    if ('takaIds' in data && !lump) throw badRequest('This order is pcs to pcs — enter how many pcs to move.');
    if ('pcs' in data && lump) throw badRequest('This is a lump order — tick the takas to move.');
    if (order.unit !== 'pcs') throw badRequest('Only pcs orders can move stock to the inventory.');

    const at = now();
    const events: TakaEventInput[] = [];
    const note = data.note ? ` · ${data.note}` : '';
    const label = `Order #${order.orderNo} → free stock${note}`;
    const wholeRows: TakaRow[] = [];
    let split = false;
    let movedPcs = 0;
    let movedMeters = 0;
    let movedTakas = 0;

    if ('takaIds' in data) {
      const ids = [...new Set(data.takaIds)];
      for (const part of chunk(ids)) {
        wholeRows.push(
          ...(await tx
            .select(takaSelect)
            .from(takas)
            .innerJoin(jobsheets, eq(jobsheets.id, takas.jobsheetId))
            .where(and(inArray(takas.id, part), takaInOrder(orderId), eq(takas.isDeleted, false), eq(jobsheets.isDeleted, false)))),
        );
      }
      if (wholeRows.length !== ids.length) throw conflict('Some takas were changed meanwhile. Refresh and try again.');
      const blocked = wholeRows.filter((r) => !moveToInventorySelectable(r.stage).selectable);
      if (blocked.length) {
        throw conflict(`These takas can't be moved right now: ${blocked.slice(0, 15).map((b) => `${b.takaNo} (${moveToInventorySelectable(b.stage).reason})`).join(', ')}`);
      }
    } else {
      const candidates: TakaRow[] = await tx
        .select(takaSelect)
        .from(takas)
        .innerJoin(jobsheets, eq(jobsheets.id, takas.jobsheetId))
        .where(and(takaInOrder(orderId), inArray(takas.stage, ['final', 'ready_dispatch']), eq(takas.isDeleted, false), eq(jobsheets.isDeleted, false)));
      const plan = planPcsMove(candidates, data.pcs);
      if (plan.shortBy > 0) {
        const have = data.pcs - plan.shortBy;
        throw badRequest(have > 0 ? `Only ${have} pcs are in the godown for this order.` : 'There are no pcs in the godown for this order.', 'pcs');
      }
      const byId = new Map(candidates.map((c) => [c.id, c]));
      wholeRows.push(...plan.whole.map((id) => byId.get(id)!));
      if (plan.partial) {
        const parent = byId.get(plan.partial.id)!;
        const partId = await splitOffPart(
          tx,
          role,
          parent,
          plan.partial.movePcs,
          plan.partial.keepPcs,
          at,
          { stage: freeStockStage(parent.stage) as typeof takas.$inferInsert.stage, ...freeStockFields(role, at, 'moved') },
          events,
          label,
        );
        events.push({ takaId: partId, event: 'moved_to_inventory', note: `${label} · ${plan.partial.movePcs} pcs` });
        split = true;
        movedPcs += plan.partial.movePcs;
        const [partRow] = await tx.select({ meters: takas.meters }).from(takas).where(eq(takas.id, partId));
        movedMeters += partRow?.meters ?? 0;
        movedTakas += 1;
      }
    }

    // Whole takas: one conditional update per current stage (anything that changed meanwhile stops everything).
    const byStage = new Map<TakaStage, number[]>();
    for (const r of wholeRows) byStage.set(r.stage, [...(byStage.get(r.stage) ?? []), r.id]);
    for (const [stage, ids] of byStage) {
      for (const part of chunk(ids)) {
        const moved = await tx
          .update(takas)
          .set({
            stage: freeStockStage(stage) as typeof takas.$inferInsert.stage,
            godownCheckedAt: null,
            godownCheckedBy: null,
            updatedAt: at,
            ...freeStockFields(role, at, 'moved'),
          })
          .where(and(inArray(takas.id, part), eq(takas.stage, stage as TakaStage), eq(takas.isFreeStock, false)))
          .returning({ id: takas.id });
        if (moved.length !== part.length) throw conflict('Some takas changed meanwhile. Refresh and try again.');
      }
    }
    for (const r of wholeRows) {
      events.push({ takaId: r.id, event: 'moved_to_inventory', note: `${label}${r.stage === 'ready_dispatch' ? ' · back to final' : ''}` });
    }
    movedTakas += wholeRows.length;
    movedPcs += total(wholeRows);
    movedMeters += wholeRows.reduce((n, r) => n + (r.meters ?? 0), 0);

    await writeTakaEvents(tx, role, events);
    // Both the order the takas leave and (for allocated takas) their origin order change.
    await recomputeOrdersStatus(tx, role, [orderId, ...wholeRows.map((r) => r.orderId)]);
    return { orderId, takas: movedTakas, pcs: movedPcs, meters: round2(movedMeters), split };
  });
}

/* ------------------------------------------------------------------ */
/* Add from free stock                                                  */
/* ------------------------------------------------------------------ */

/** Free takas of the same item (design + variation) as the order, with their origin order. */
async function loadFreeCandidates(tx: Tx, order: { designId: number | null; variationId: number | null }, ids?: readonly number[], blouse: BlouseFilter = 'all') {
  const rows = await tx
    .select({ ...takaSelect, originDesignId: orders.designId, originVariationId: orders.variationId, blouseOption: orders.blouseOption })
    .from(takas)
    .innerJoin(orders, eq(orders.id, takas.orderId))
    .innerJoin(jobsheets, eq(jobsheets.id, takas.jobsheetId))
    .where(
      and(
        eq(takas.isFreeStock, true),
        eq(takas.isDeleted, false),
        eq(jobsheets.isDeleted, false),
        ids ? inArray(takas.id, [...ids]) : undefined,
      ),
    );
  const key = inventoryKey(order);
  return rows.filter((r) => inventoryKey({ designId: r.originDesignId, variationId: r.originVariationId }) === key && matchesBlouse(blouse, r.blouseOption));
}

/**
 * POST /orders/:id/takas/add-from-free-stock — lump `{ takaIds }` · pcs to pcs `{ pcs }`. The takas get
 * `allocated_order_id` = this order and stop being free stock; they keep their stage (and count for this order).
 */
export async function addFromFreeStock(role: RoleKey, orderId: number, input: unknown): Promise<AddFromFreeStockResult> {
  const data = addFromFreeStockSchema.parse(input);
  return db.transaction(async (tx) => {
    const order = await loadOrder(tx, orderId);
    if (order.unit !== 'pcs') throw badRequest('Only pcs orders can use free stock.');
    if (!canReceiveFreeStock(order.status)) throw conflict(`Order #${order.orderNo} can't receive stock (it is not in production yet, or already dispatched).`);
    const lump = order.orderType === 'lump';
    if ('takaIds' in data && !lump) throw badRequest('This order is pcs to pcs — enter how many pcs to add.');
    if ('pcs' in data && lump) throw badRequest('This is a lump order — tick the takas to add.');

    const at = now();
    const events: TakaEventInput[] = [];
    const rows: TakaRow[] = [];
    let split = false;
    let addedPcs = 0;
    let addedTakas = 0;
    const assign = { isFreeStock: false, allocatedOrderId: orderId, freeStockAt: null, freeStockBy: null, freeStockReason: null, updatedAt: at } as const;

    if ('takaIds' in data) {
      const ids = [...new Set(data.takaIds)];
      const found = await loadFreeCandidates(tx, order, ids);
      if (found.length !== ids.length) throw conflict('Some takas are no longer free stock (or are a different design). Refresh and try again.');
      rows.push(...found);
    } else {
      // Ready free stock (final) of the item; a taka needed only partly is split.
      const candidates = (await loadFreeCandidates(tx, order, undefined, data.blouse ?? 'all')).filter((c) => c.stage === 'final');
      const plan = planPcsMove(candidates, data.pcs);
      if (plan.shortBy > 0) {
        const have = data.pcs - plan.shortBy;
        throw badRequest(have > 0 ? `Only ${have} pcs of free stock are ready.` : 'There is no ready free stock for this design.', 'pcs');
      }
      const byId = new Map(candidates.map((c) => [c.id, c]));
      rows.push(...plan.whole.map((id) => byId.get(id)!));
      if (plan.partial) {
        const parent = byId.get(plan.partial.id)!;
        const partId = await splitOffPart(tx, role, parent, plan.partial.movePcs, plan.partial.keepPcs, at, { ...assign }, events, `to Order #${order.orderNo}`);
        events.push({ takaId: partId, event: 'allocated_from_free_stock', note: `Order #${order.orderNo} · ${plan.partial.movePcs} pcs` });
        split = true;
        addedPcs += plan.partial.movePcs;
        addedTakas += 1;
      }
    }

    const byStage = new Map<TakaStage, number[]>();
    for (const r of rows) byStage.set(r.stage, [...(byStage.get(r.stage) ?? []), r.id]);
    for (const [stage, ids] of byStage) {
      for (const part of chunk(ids)) {
        const moved = await tx
          .update(takas)
          .set({ ...assign })
          .where(and(inArray(takas.id, part), eq(takas.stage, stage as TakaStage), eq(takas.isFreeStock, true)))
          .returning({ id: takas.id });
        if (moved.length !== part.length) throw conflict('Some takas changed meanwhile. Refresh and try again.');
      }
    }
    for (const r of rows) events.push({ takaId: r.id, event: 'allocated_from_free_stock', note: `Order #${order.orderNo} (made for Order #${r.orderId})` });
    addedTakas += rows.length;
    addedPcs += total(rows);

    await writeTakaEvents(tx, role, events);
    await recomputeOrdersStatus(tx, role, [orderId, ...rows.map((r) => r.orderId)]);
    return { orderId, takas: addedTakas, pcs: addedPcs, split };
  });
}
