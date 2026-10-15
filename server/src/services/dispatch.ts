import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import {
  can,
  compareTakaNo,
  DISPATCH_COUNTER,
  dispatchChallanLabel,
  dispatchedListQuerySchema,
  dispatchLines,
  dispatchSchema,
  dispatchTotals,
  goodsReturnSchema,
  lumpGrDamagePcsOk,
  lumpRevisionTakas,
  parseDispatchChallanNo,
  reducePcsAcrossRows,
  returnLot,
  takaActualPcs,
  validatePcsGr,
  GR_ERROR_TEXT,
  type DispatchChallanDetail,
  type DispatchChallanListItem,
  type DispatchedListQuery,
  type DispatchedOrderCard,
  type DispatchedOrderDetail,
  type DispatchedOrderPage,
  type DispatchResult,
  type GoodsReturnResult,
  type OrderReturnSummary,
  type OrderStatusKey,
  type RoleKey,
} from '@rivoora/shared';
import { db, type Tx } from '../db/client';
import {
  counters,
  customerBrokers,
  customers,
  designVariations,
  designs,
  dispatchChallanTakas,
  dispatchChallans,
  goodsReturnTakas,
  goodsReturns,
  jobsheets,
  materials,
  orders,
  takas,
} from '../db/schema';
import { badRequest, conflict, notFound } from '../lib/errors';
import { currentUserId } from '../lib/request-context';
import { likePattern } from '../lib/http';
import { addNewDamages, assertNewDamages } from './qc-shared';
import { allocateTakaNumbers, chunk, recomputeOrdersStatus, refreshIsDamaged, writeTakaEvents, type TakaEventInput } from './taka-ops';
import { freeStockFields, takaInOrder, takaInOrderRaw } from './free-stock';

/**
 * Dispatch (Dhruvil): a dispatch takes ALL the takas of an order that are ready for dispatch onto one challan (DC-n),
 * and a goods return (GR) revises that challan (DC-n R1…) and puts the returned goods back into the godown.
 * Every write is one transaction with conditional stage updates and ends with the order status recompute.
 */

const now = () => new Date().toISOString();
const round2 = (n: number) => Math.round(n * 100) / 100;

const designCodeSql = sql<string | null>`COALESCE(${designVariations.code}, ${designs.code})`;
const designThumbSql = sql<string | null>`CASE WHEN ${designVariations.id} IS NOT NULL THEN ${designVariations.thumbUrl} ELSE ${designs.thumbUrl} END`;
const designImageSql = sql<string | null>`CASE WHEN ${designVariations.id} IS NOT NULL THEN ${designVariations.imageUrl} ELSE ${designs.imageUrl} END`;

/* ------------------------------------------------------------------ */
/* Create the dispatch                                                  */
/* ------------------------------------------------------------------ */

async function allocateDispatchNo(tx: Tx): Promise<number> {
  const [row] = await tx
    .insert(counters)
    .values({ name: DISPATCH_COUNTER, value: 1 })
    .onConflictDoUpdate({ target: counters.name, set: { value: sql`${counters.value} + 1` } })
    .returning({ value: counters.value });
  return row.value;
}

/** POST /godown/orders/:orderId/dispatch — every taka of the order that is ready for dispatch goes on one new challan. */
export async function createDispatch(role: RoleKey, orderId: number, input: unknown): Promise<DispatchResult> {
  const data = dispatchSchema.parse(input);
  return db.transaction(async (tx) => {
    const [order] = await tx.select({ id: orders.id }).from(orders).where(eq(orders.id, orderId));
    if (!order) throw notFound('Order');
    const ready = await tx
      .select({ id: takas.id, takaNo: takas.takaNo, meters: takas.meters, pcs: takas.pcs, actualPcs: takas.actualPcs })
      .from(takas)
      .innerJoin(jobsheets, eq(jobsheets.id, takas.jobsheetId))
      .where(and(takaInOrder(orderId), eq(takas.stage, 'ready_dispatch'), eq(takas.isDeleted, false), eq(jobsheets.isDeleted, false)));
    if (!ready.length) throw conflict('There are no takas ready for dispatch on this order.');
    ready.sort((a, b) => compareTakaNo(a.takaNo, b.takaNo));

    const at = now();
    const challanNo = await allocateDispatchNo(tx);
    const [challan] = await tx
      .insert(dispatchChallans)
      .values({
        challanNo,
        revision: 0,
        orderId,
        challanDate: data.challanDate,
        transport: data.transport,
        lrNo: data.lrNo,
        ewayNo: data.ewayNo,
        createdBy: role,
        createdByUserId: currentUserId(),
        createdAt: at,
        updatedAt: at,
      })
      .returning({ id: dispatchChallans.id });
    const rows = ready.map((t) => ({ takaId: t.id, takaNo: t.takaNo, meters: t.meters, pcs: takaActualPcs(t) ?? 0 }));
    for (const part of chunk(rows, 100)) {
      await tx.insert(dispatchChallanTakas).values(part.map((r) => ({ challanId: challan.id, ...r, createdAt: at })));
    }
    for (const part of chunk(ready.map((t) => t.id))) {
      const moved = await tx
        .update(takas)
        .set({ stage: 'dispatched' })
        .where(and(inArray(takas.id, part), eq(takas.stage, 'ready_dispatch')))
        .returning({ id: takas.id });
      if (moved.length !== part.length) throw conflict('Some takas changed meanwhile. Refresh and try again.');
    }
    const label = dispatchChallanLabel(challanNo);
    await writeTakaEvents(
      tx,
      role,
      rows.map((r): TakaEventInput => ({ takaId: r.takaId, event: 'dispatched', dispatchChallanId: challan.id, note: `${label} · ${r.pcs} pcs` })),
    );
    await recomputeOrdersStatus(tx, role, [orderId]);
    const totals = dispatchTotals(rows);
    return { challanId: challan.id, challanNo, orderId, takas: totals.takas, pcs: totals.pcs, meters: totals.meters };
  });
}

/* ------------------------------------------------------------------ */
/* Challan detail / print                                               */
/* ------------------------------------------------------------------ */

/** GET /dispatch/challans/:id (any revision). Also the data of the print page. */
export async function getDispatchChallan(id: number): Promise<DispatchChallanDetail> {
  const [[row], takaRows] = await db.batch([
    db
      .select({
        id: dispatchChallans.id,
        challanNo: dispatchChallans.challanNo,
        revision: dispatchChallans.revision,
        parentChallanId: dispatchChallans.parentChallanId,
        status: dispatchChallans.status,
        challanDate: dispatchChallans.challanDate,
        transport: dispatchChallans.transport,
        lrNo: dispatchChallans.lrNo,
        ewayNo: dispatchChallans.ewayNo,
        createdAt: dispatchChallans.createdAt,
        orderId: orders.id,
        orderNo: orders.orderNo,
        orderType: orders.orderType,
        blouseOption: orders.blouseOption,
        orderStatus: orders.status,
        quality: materials.name,
        designCode: designCodeSql,
        thumbUrl: designThumbSql,
        customerName: customers.name,
        customerAddress: sql<string | null>`TRIM(COALESCE(${customers.address}, '') || CASE WHEN ${customers.city} IS NOT NULL AND ${customers.city} <> '' THEN ', ' || ${customers.city} ELSE '' END)`,
        customerPhone: customers.phone,
        customerGstin: customers.gstNumber,
        brokerName: customerBrokers.name,
      })
      .from(dispatchChallans)
      .innerJoin(orders, eq(orders.id, dispatchChallans.orderId))
      .innerJoin(materials, eq(materials.id, orders.materialId))
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .leftJoin(customerBrokers, eq(customerBrokers.id, orders.brokerId))
      .leftJoin(designs, eq(designs.id, orders.designId))
      .leftJoin(designVariations, eq(designVariations.id, orders.variationId))
      .where(eq(dispatchChallans.id, id)),
    db
      .select({ id: dispatchChallanTakas.id, takaId: dispatchChallanTakas.takaId, takaNo: dispatchChallanTakas.takaNo, meters: dispatchChallanTakas.meters, pcs: dispatchChallanTakas.pcs })
      .from(dispatchChallanTakas)
      .where(eq(dispatchChallanTakas.challanId, id))
      .orderBy(asc(dispatchChallanTakas.id)),
  ]);
  if (!row) throw notFound('Dispatch challan');
  const list = takaRows.sort((a, b) => compareTakaNo(a.takaNo, b.takaNo));
  const totals = dispatchTotals(list);
  return {
    id: row.id,
    challanNo: row.challanNo,
    revision: row.revision,
    label: dispatchChallanLabel(row.challanNo, row.revision),
    replacesLabel: row.revision > 0 ? dispatchChallanLabel(row.challanNo, row.revision - 1) : null,
    status: row.status,
    challanDate: row.challanDate,
    transport: row.transport,
    lrNo: row.lrNo,
    ewayNo: row.ewayNo,
    order: {
      orderId: row.orderId,
      orderNo: row.orderNo,
      orderType: row.orderType,
      blouseOption: row.blouseOption,
      status: row.orderStatus as OrderStatusKey,
      quality: row.quality,
      designCode: row.designCode,
      thumbUrl: row.thumbUrl,
    },
    customer: { name: row.customerName, address: row.customerAddress || null, phone: row.customerPhone, gstin: row.customerGstin },
    brokerName: row.brokerName,
    takas: list.map((t) => ({ id: t.id, takaId: t.takaId, takaNo: t.takaNo, meters: t.meters, pcs: t.pcs })),
    lines: dispatchLines(list.map((t) => ({ quality: row.quality, design: row.designCode, pcs: t.pcs }))),
    totals,
    createdAt: row.createdAt,
  };
}

/* ------------------------------------------------------------------ */
/* Dispatched module                                                    */
/* ------------------------------------------------------------------ */

const orderDispatchedPcs = sql<number>`COALESCE((SELECT SUM(COALESCE(t.actual_pcs, t.pcs, 0)) FROM takas t WHERE ${takaInOrderRaw('t', '"orders"."id"')} AND t.is_deleted = 0 AND t.stage = 'dispatched'), 0)`;
const latestChallanId = sql<number>`(SELECT MAX(c.id) FROM dispatch_challans c WHERE c.order_id = "orders"."id")`;

/** GET /dispatched — orders that have dispatch challans, newest dispatch first. Server-side search. */
export async function listDispatchedOrders(role: RoleKey, q: DispatchedListQuery): Promise<DispatchedOrderPage> {
  const parsed = dispatchedListQuerySchema.parse(q);
  let search: SQL | undefined;
  const statusFilter = parsed.status ? eq(orders.status, parsed.status) : undefined;
  if (parsed.search) {
    const term = parsed.search.replace(/^#/, '');
    const p = likePattern(term);
    const orderNo = /^\d+$/.test(term) ? Number(term) : -1;
    const dc = parseDispatchChallanNo(term);
    search = sql`(${orders.orderNo} = ${orderNo}
      OR ${customers.name} LIKE ${p} ESCAPE '\\'
      OR ${customerBrokers.name} LIKE ${p} ESCAPE '\\'
      OR ${materials.name} LIKE ${p} ESCAPE '\\'
      OR ${designCodeSql} LIKE ${p} ESCAPE '\\'
      OR ${dc ? sql`EXISTS (SELECT 1 FROM dispatch_challans c WHERE c.order_id = "orders"."id" AND c.challan_no = ${dc.no})` : sql`0`}
      OR EXISTS (SELECT 1 FROM dispatch_challan_takas ct JOIN dispatch_challans c ON c.id = ct.challan_id WHERE c.order_id = "orders"."id" AND ct.taka_no LIKE ${p} ESCAPE '\\'))`;
  }
  const base = db
    .select({
      orderId: orders.id,
      orderNo: orders.orderNo,
      blouseOption: orders.blouseOption,
      customerName: customers.name,
      designCode: designCodeSql,
      thumbUrl: designThumbSql,
      imageUrl: designImageSql,
      quality: materials.name,
      status: orders.status,
      orderedPcs: orders.quantity,
      dispatchedPcs: orderDispatchedPcs,
      latestId: latestChallanId,
    })
    .from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .innerJoin(materials, eq(materials.id, orders.materialId))
    .leftJoin(customerBrokers, eq(customerBrokers.id, orders.brokerId))
    .leftJoin(designs, eq(designs.id, orders.designId))
    .leftJoin(designVariations, eq(designVariations.id, orders.variationId))
    .where(and(sql`EXISTS (SELECT 1 FROM dispatch_challans c WHERE c.order_id = "orders"."id")`, statusFilter, search));
  const [items, [{ total }]] = await db.batch([
    base.orderBy(desc(latestChallanId)).limit(parsed.limit).offset((parsed.page - 1) * parsed.limit),
    db
      .select({ total: sql<number>`COUNT(*)` })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .innerJoin(materials, eq(materials.id, orders.materialId))
      .leftJoin(customerBrokers, eq(customerBrokers.id, orders.brokerId))
      .leftJoin(designs, eq(designs.id, orders.designId))
      .leftJoin(designVariations, eq(designVariations.id, orders.variationId))
      .where(and(sql`EXISTS (SELECT 1 FROM dispatch_challans c WHERE c.order_id = "orders"."id")`, statusFilter, search)),
  ]);
  const ids = items.map((i) => i.latestId);
  const latest = ids.length
    ? await db
        .select({ id: dispatchChallans.id, challanNo: dispatchChallans.challanNo, revision: dispatchChallans.revision, challanDate: dispatchChallans.challanDate })
        .from(dispatchChallans)
        .where(inArray(dispatchChallans.id, ids))
    : [];
  const byId = new Map(latest.map((l) => [l.id, l]));
  const count = Number(total);
  void role;
  const cards: DispatchedOrderCard[] = items.map(({ latestId, ...r }) => {
    const l = byId.get(latestId);
    return {
      ...r,
      status: r.status as OrderStatusKey,
      dispatchedPcs: Number(r.dispatchedPcs),
      latestChallanLabel: l ? dispatchChallanLabel(l.challanNo, l.revision) : '',
      latestChallanDate: l?.challanDate ?? '',
    };
  });
  return { items: cards, page: parsed.page, limit: parsed.limit, total: count, hasMore: parsed.page * parsed.limit < count };
}

/** GET /dispatched/:orderId — header + every dispatch challan (all revisions) of the order. */
export async function getDispatchedOrder(role: RoleKey, orderId: number): Promise<DispatchedOrderDetail> {
  const [[order], challanRows] = await db.batch([
    db
      .select({
        orderId: orders.id,
        orderNo: orders.orderNo,
        orderType: orders.orderType,
        blouseOption: orders.blouseOption,
        status: orders.status,
        customerName: customers.name,
        designCode: designCodeSql,
        thumbUrl: designThumbSql,
        imageUrl: designImageSql,
        quality: materials.name,
        orderedPcs: orders.quantity,
        dispatchedPcs: orderDispatchedPcs,
      })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .innerJoin(materials, eq(materials.id, orders.materialId))
      .leftJoin(designs, eq(designs.id, orders.designId))
      .leftJoin(designVariations, eq(designVariations.id, orders.variationId))
      .where(eq(orders.id, orderId)),
    db
      .select({
        id: dispatchChallans.id,
        challanNo: dispatchChallans.challanNo,
        revision: dispatchChallans.revision,
        status: dispatchChallans.status,
        challanDate: dispatchChallans.challanDate,
        takas: sql<number>`(SELECT COUNT(*) FROM dispatch_challan_takas ct WHERE ct.challan_id = "dispatch_challans"."id")`,
        pcs: sql<number>`(SELECT COALESCE(SUM(ct.pcs), 0) FROM dispatch_challan_takas ct WHERE ct.challan_id = "dispatch_challans"."id")`,
        meters: sql<number>`(SELECT COALESCE(SUM(ct.meters), 0) FROM dispatch_challan_takas ct WHERE ct.challan_id = "dispatch_challans"."id")`,
      })
      .from(dispatchChallans)
      .where(eq(dispatchChallans.orderId, orderId))
      .orderBy(desc(dispatchChallans.challanNo), desc(dispatchChallans.revision)),
  ]);
  if (!order || challanRows.length === 0) throw notFound('Dispatch');
  const mayReturn = can(role, 'canGoodsReturn');
  const challans: DispatchChallanListItem[] = challanRows.map((c) => ({
    id: c.id,
    challanNo: c.challanNo,
    revision: c.revision,
    label: dispatchChallanLabel(c.challanNo, c.revision),
    status: c.status,
    challanDate: c.challanDate,
    takas: Number(c.takas),
    pcs: Number(c.pcs),
    meters: round2(Number(c.meters)),
    canGoodsReturn: mayReturn && c.status === 'active' && Number(c.pcs) > 0,
  }));
  return { ...order, status: order.status as OrderStatusKey, dispatchedPcs: Number(order.dispatchedPcs), challans, returned: await getOrderReturnSummary(orderId) };
}

/* ------------------------------------------------------------------ */
/* Goods return (GR)                                                    */
/* ------------------------------------------------------------------ */

/** What came back on this order in total (null when there was no goods return) + the latest challan revision. */
export async function getOrderReturnSummary(orderId: number): Promise<OrderReturnSummary | null> {
  const [sum] = await db
    .select({
      n: sql<number>`COUNT(*)`,
      takas: sql<number>`COALESCE(SUM(${goodsReturns.returnedTakas}), 0)`,
      pcs: sql<number>`COALESCE(SUM(${goodsReturns.returnedPcs}), 0)`,
      lastChallanId: sql<number | null>`MAX(${goodsReturns.newChallanId})`,
    })
    .from(goodsReturns)
    .innerJoin(dispatchChallans, eq(dispatchChallans.id, goodsReturns.challanId))
    .where(eq(dispatchChallans.orderId, orderId));
  if (!sum || Number(sum.n) === 0 || sum.lastChallanId === null) return null;
  const [latest] = await db
    .select({ id: dispatchChallans.id, challanNo: dispatchChallans.challanNo, revision: dispatchChallans.revision })
    .from(dispatchChallans)
    .where(eq(dispatchChallans.id, sum.lastChallanId));
  if (!latest) return null;
  return { takas: Number(sum.takas), pcs: Number(sum.pcs), challanId: latest.id, challanLabel: dispatchChallanLabel(latest.challanNo, latest.revision) };
}

/** POST /dispatch/challans/:id/goods-return */
export async function createGoodsReturn(role: RoleKey, challanId: number, input: unknown): Promise<GoodsReturnResult> {
  const data = goodsReturnSchema.parse(input);
  return db.transaction(async (tx) => {
    const [challan] = await tx.select().from(dispatchChallans).where(eq(dispatchChallans.id, challanId));
    if (!challan) throw notFound('Dispatch challan');
    if (challan.status !== 'active') throw conflict('This challan was already revised. Open the latest revision to return goods.');
    const [order] = await tx
      .select({ id: orders.id, orderType: orders.orderType })
      .from(orders)
      .where(eq(orders.id, challan.orderId));
    const rows = await tx.select().from(dispatchChallanTakas).where(eq(dispatchChallanTakas.challanId, challanId)).orderBy(asc(dispatchChallanTakas.id));
    if (!rows.length) throw conflict('There is nothing left on this challan to return.');

    const lump = 'returns' in data;
    if (lump !== (order.orderType === 'lump')) {
      throw badRequest(order.orderType === 'lump' ? 'Tick the returned takas.' : 'Enter the returned pcs.');
    }

    const at = now();
    const label = dispatchChallanLabel(challan.challanNo, challan.revision);
    const events: TakaEventInput[] = [];
    const touched: number[] = [];
    let returnedTakas = 0;
    let returnedPcs = 0;
    let damagedPcs = 0;
    let remaining: { takaId: number; takaNo: string; meters: number | null; pcs: number | null }[] = [];
    const returnedForGr: { takaId: number; pcs: number | null; damagedPcs: number }[] = [];

    if ('returns' in data) {
      /* ---- lump: the ticked takas come back as final takas and go straight to FREE STOCK (Sprint 13) ---- */
      const ids = data.returns.map((r) => r.takaId);
      if (new Set(ids).size !== ids.length) throw badRequest('A taka is ticked twice.');
      const onChallan = new Map(rows.map((r) => [r.takaId, r]));
      for (const id of ids) if (!onChallan.has(id)) throw badRequest('One of the returned takas is not on this challan.');
      const takaInfo = new Map(
        (await tx.select({ id: takas.id, stage: takas.stage, orderId: takas.orderId, pcs: takas.pcs, actualPcs: takas.actualPcs }).from(takas).where(inArray(takas.id, ids))).map((t) => [t.id, t]),
      );
      for (const [i, r] of data.returns.entries()) {
        const row = onChallan.get(r.takaId)!;
        const info = takaInfo.get(r.takaId);
        if (!info || info.stage !== 'dispatched') throw conflict(`Taka ${row.takaNo} is no longer dispatched. Refresh and try again.`);
        const max = row.pcs ?? takaActualPcs(info) ?? 9999;
        r.damages.forEach((d, j) => {
          if (!lumpGrDamagePcsOk(max, d.pcs)) throw badRequest(`A damage can't have more pcs than the taka (${max}).`, `returns.${i}.damages.${j}.pcs`);
        });
        assertNewDamages(r.damages, max, `returns.${i}.damages`);
      }
      for (const [i, r] of data.returns.entries()) {
        const row = onChallan.get(r.takaId)!;
        const moved = await tx
          .update(takas)
          .set({
            stage: 'final',
            returnedAt: at,
            returnedFromChallanId: challanId,
            godownCheckedAt: null,
            godownCheckedBy: null,
            ...freeStockFields(role, at, 'goods_return'),
          })
          .where(and(eq(takas.id, r.takaId), eq(takas.stage, 'dispatched')))
          .returning({ id: takas.id });
        if (!moved.length) throw conflict(`Taka ${row.takaNo} changed meanwhile. Refresh and try again.`);
        const damaged = r.damages.reduce((n, d) => n + d.pcs, 0);
        events.push({ takaId: r.takaId, event: 'goods_returned', dispatchChallanId: challanId, note: `Returned from ${label}${damaged ? ` · ${damaged} pcs damaged` : ''} · now free stock` });
        events.push(...(await addNewDamages(tx, role, r.takaId, r.damages, 'goods_return', at, `returns.${i}.damages`)));
        touched.push(r.takaId);
        returnedTakas += 1;
        returnedPcs += row.pcs ?? 0;
        damagedPcs += damaged;
        returnedForGr.push({ takaId: r.takaId, pcs: row.pcs, damagedPcs: damaged });
      }
      remaining = lumpRevisionTakas(
        rows.map((r) => ({ id: r.takaId, takaId: r.takaId, takaNo: r.takaNo, meters: r.meters, pcs: r.pcs })),
        ids,
      );
    } else {
      /* ---- pcs to pcs: no taka numbers — a "return lot" taka, and the challan's pcs are reduced ---- */
      const challanPcs = rows.reduce((n, r) => n + (r.pcs ?? 0), 0);
      const err = validatePcsGr({ challanPcs, returnedPcs: data.returnedPcs, damagedPcs: data.damagedPcs, hasDamageName: Boolean(data.damage) });
      if (err) throw badRequest(GR_ERROR_TEXT[err], err === 'returned_range' ? 'returnedPcs' : 'damagedPcs');
      const lot = returnLot(data.returnedPcs, data.damagedPcs);
      const damage = data.damage && lot.damagedPcs > 0 ? { ...data.damage, pcs: lot.damagedPcs } : null;
      if (damage) assertNewDamages([damage], lot.pcs, 'damage');

      const reduced = reducePcsAcrossRows(rows.map((r) => ({ id: r.takaId, pcs: r.pcs })), data.returnedPcs);
      // The dispatched takas give the returned pcs back: their actual pcs shrink, so the order's pcs stay right.
      const takaInfo = new Map(
        (await tx.select({ id: takas.id, pcs: takas.pcs, actualPcs: takas.actualPcs, stage: takas.stage }).from(takas).where(inArray(takas.id, rows.map((r) => r.takaId)))).map((t) => [t.id, t]),
      );
      for (const r of reduced) {
        if (r.after === r.before) continue;
        const info = takaInfo.get(r.id);
        if (!info || info.stage !== 'dispatched') throw conflict('Some takas changed meanwhile. Refresh and try again.');
        await tx.update(takas).set({ actualPcs: r.after }).where(and(eq(takas.id, r.id), eq(takas.stage, 'dispatched')));
        events.push({ takaId: r.id, event: 'goods_returned', dispatchChallanId: challanId, note: `${r.before - r.after} pcs returned from ${label} (pcs ${r.before} → ${r.after})` });
      }
      remaining = rows
        .map((r) => ({ takaId: r.takaId, takaNo: r.takaNo, meters: r.meters, pcs: reduced.find((x) => x.id === r.takaId)!.after }))
        .filter((r) => (r.pcs ?? 0) > 0);

      const [first] = rows;
      const [firstTaka] = await tx.select({ jobsheetId: takas.jobsheetId }).from(takas).where(eq(takas.id, first.takaId));
      const [no] = await allocateTakaNumbers(tx, 1);
      const [lotTaka] = await tx
        .insert(takas)
        .values({
          jobsheetId: firstTaka.jobsheetId,
          orderId: challan.orderId,
          takaNo: no,
          meters: null,
          pcs: lot.pcs,
          stage: 'final',
          isReturnLot: true,
          returnedAt: at,
          returnedFromChallanId: challanId,
          hasBeenToMill: true,
          ...freeStockFields(role, at, 'goods_return'),
          enteredBy: role,
          createdAt: at,
          updatedAt: at,
        })
        .returning({ id: takas.id });
      events.push({ takaId: lotTaka.id, event: 'goods_returned', dispatchChallanId: challanId, note: `Return lot · ${lot.pcs} pcs returned from ${label}${lot.damagedPcs ? ` · ${lot.damagedPcs} pcs damaged` : ''} · now free stock` });
      if (damage) events.push(...(await addNewDamages(tx, role, lotTaka.id, [damage], 'goods_return', at, 'damage')));
      touched.push(lotTaka.id);
      returnedTakas = 1;
      returnedPcs = lot.pcs;
      damagedPcs = lot.damagedPcs;
      returnedForGr.push({ takaId: lotTaka.id, pcs: lot.pcs, damagedPcs: lot.damagedPcs });
    }

    // The revision: the same challan number, everything that was not returned. The old revision is kept (Revised).
    const revision = challan.revision + 1;
    const [next] = await tx
      .insert(dispatchChallans)
      .values({
        challanNo: challan.challanNo,
        revision,
        parentChallanId: challanId,
        orderId: challan.orderId,
        challanDate: challan.challanDate,
        transport: challan.transport,
        lrNo: challan.lrNo,
        ewayNo: challan.ewayNo,
        createdBy: role,
        createdByUserId: currentUserId(),
        createdAt: at,
        updatedAt: at,
      })
      .returning({ id: dispatchChallans.id });
    for (const part of chunk(remaining, 100)) {
      await tx.insert(dispatchChallanTakas).values(part.map((r) => ({ challanId: next.id, takaId: r.takaId, takaNo: r.takaNo, meters: r.meters, pcs: r.pcs, createdAt: at })));
    }
    await tx.update(dispatchChallans).set({ status: 'revised', updatedAt: at }).where(eq(dispatchChallans.id, challanId));

    const [gr] = await tx
      .insert(goodsReturns)
      .values({
        challanId,
        newChallanId: next.id,
        returnDate: data.date,
        note: data.note,
        role,
        userId: currentUserId(),
        returnedTakas,
        returnedPcs,
        damagedPcs,
        createdAt: at,
      })
      .returning({ id: goodsReturns.id });
    await tx.insert(goodsReturnTakas).values(returnedForGr.map((r) => ({ goodsReturnId: gr.id, takaId: r.takaId, pcs: r.pcs, damagedPcs: r.damagedPcs })));

    await refreshIsDamaged(tx, touched);
    await writeTakaEvents(tx, role, events);
    await recomputeOrdersStatus(tx, role, [challan.orderId]);
    return {
      goodsReturnId: gr.id,
      challanId: next.id,
      label: dispatchChallanLabel(challan.challanNo, revision),
      returnedTakas,
      returnedPcs,
      damagedPcs,
      orderId: challan.orderId,
    };
  });
}
