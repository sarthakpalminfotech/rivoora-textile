import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import {
  buttaReceiveSchema,
  challanCreateSchema,
  challanLabel,
  compareTakaNo,
  CHALLAN_COUNTER,
  parseChallanNo,
  takaStageLabel,
  type ButtaListQuery,
  type ButtaPendingOrder,
  type ButtaPendingOrderPage,
  type ButtaPendingOrderTakas,
  type ChallanCreateResult,
  type ChallanDetail,
  type ChallanListQuery,
  type ChallanOrderGroup,
  type ChallanPage,
  type ChallanPrintData,
  type ReceiveResponse,
  type ReceiveResult,
  type RoleKey,
} from '@rivoora/shared';
import { db, type Tx } from '../db/client';
import {
  buttaChallanTakas,
  buttaChallans,
  buttaParties,
  counters,
  designVariations,
  designs,
  jobsheets,
  materials,
  orders,
  takas,
} from '../db/schema';
import { badRequest, conflict, notFound } from '../lib/errors';
import { likePattern } from '../lib/http';
import { chunk, recomputeOrdersStatus, writeTakaEvents, type TakaEventInput } from './taka-ops';

/**
 * Butta cutting: Send (pending orders → challan), the challan list / details / print data, Receive.
 * Every multi-row write is ONE transaction with conditional updates on the current taka stage and ends with
 * `recomputeOrderStatus` for every touched order. Nothing here ever returns a client name or a rate.
 */

const now = () => new Date().toISOString();

const designCodeSql = sql<string | null>`COALESCE(${designVariations.code}, ${designs.code})`;
const designThumbSql = sql<string | null>`CASE WHEN ${designVariations.id} IS NOT NULL THEN ${designVariations.thumbUrl} ELSE ${designs.thumbUrl} END`;
const designImageSql = sql<string | null>`CASE WHEN ${designVariations.id} IS NOT NULL THEN ${designVariations.imageUrl} ELSE ${designs.imageUrl} END`;

/** 21-07-2026 14:05 in Indian time (messages are built on the server). */
function formatIst(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}-${get('month')}-${get('year')} ${get('hour')}:${get('minute')}`;
}

/* ------------------------------------------------------------------ */
/* Send → Pending                                                       */
/* ------------------------------------------------------------------ */

const pendingTakaWhere = and(eq(takas.stage, 'entered'), eq(takas.isDeleted, false), eq(jobsheets.isDeleted, false));

const pendingOrderColumns = {
  orderId: orders.id,
  orderNo: orders.orderNo,
  designCode: designCodeSql,
  thumbUrl: designThumbSql,
  imageUrl: designImageSql,
  quality: materials.name,
  takaCount: sql<number>`COUNT(*)`,
  totalMeters: sql<number>`COALESCE(SUM(${takas.meters}), 0)`,
};

function toPendingOrder(r: {
  orderId: number;
  orderNo: number;
  designCode: string | null;
  thumbUrl: string | null;
  imageUrl: string | null;
  quality: string | null;
  takaCount: number;
  totalMeters: number;
}): ButtaPendingOrder {
  return { ...r, takaCount: Number(r.takaCount), totalMeters: Math.round(Number(r.totalMeters) * 100) / 100 };
}

/** GET /butta/pending-orders — orders with takas waiting for butta cutting (one aggregate query). */
export async function listPendingOrders(q: ButtaListQuery): Promise<ButtaPendingOrderPage> {
  let search: SQL | undefined;
  if (q.search) {
    const term = q.search.replace(/^#/, '');
    const p = likePattern(term);
    const orderNo = /^\d+$/.test(term) ? Number(term) : null;
    search = sql`(${orders.orderNo} = ${orderNo ?? -1} OR ${designCodeSql} LIKE ${p} ESCAPE '\\' OR ${orders.id} IN (SELECT t2.order_id FROM takas t2 WHERE t2.is_deleted = 0 AND t2.stage = 'entered' AND t2.taka_no LIKE ${p} ESCAPE '\\'))`;
  }
  const [items, [{ total }]] = await db.batch([
    db
      .select(pendingOrderColumns)
      .from(takas)
      .innerJoin(jobsheets, eq(jobsheets.id, takas.jobsheetId))
      .innerJoin(orders, eq(orders.id, takas.orderId))
      .innerJoin(materials, eq(materials.id, orders.materialId))
      .leftJoin(designs, eq(designs.id, orders.designId))
      .leftJoin(designVariations, eq(designVariations.id, orders.variationId))
      .where(and(pendingTakaWhere, search))
      .groupBy(orders.id)
      .orderBy(asc(orders.orderNo))
      .limit(q.limit)
      .offset((q.page - 1) * q.limit),
    db
      .select({ total: sql<number>`COUNT(DISTINCT ${orders.id})` })
      .from(takas)
      .innerJoin(jobsheets, eq(jobsheets.id, takas.jobsheetId))
      .innerJoin(orders, eq(orders.id, takas.orderId))
      .leftJoin(designs, eq(designs.id, orders.designId))
      .leftJoin(designVariations, eq(designVariations.id, orders.variationId))
      .where(and(pendingTakaWhere, search)),
  ]);
  const count = Number(total);
  return { items: items.map(toPendingOrder), page: q.page, limit: q.limit, total: count, hasMore: q.page * q.limit < count };
}

/** GET /butta/pending-orders/:orderId/takas */
export async function listPendingOrderTakas(orderId: number): Promise<ButtaPendingOrderTakas> {
  const [orderRows, takaRows] = await db.batch([
    db
      .select(pendingOrderColumns)
      .from(takas)
      .innerJoin(jobsheets, eq(jobsheets.id, takas.jobsheetId))
      .innerJoin(orders, eq(orders.id, takas.orderId))
      .innerJoin(materials, eq(materials.id, orders.materialId))
      .leftJoin(designs, eq(designs.id, orders.designId))
      .leftJoin(designVariations, eq(designVariations.id, orders.variationId))
      .where(and(pendingTakaWhere, eq(orders.id, orderId)))
      .groupBy(orders.id),
    db
      .select({ id: takas.id, takaNo: takas.takaNo, meters: takas.meters, pcs: takas.pcs, isDamaged: takas.isDamaged })
      .from(takas)
      .innerJoin(jobsheets, eq(jobsheets.id, takas.jobsheetId))
      .where(and(pendingTakaWhere, eq(takas.orderId, orderId))),
  ]);
  if (!orderRows[0]) throw notFound('Order with takas waiting for butta cutting');
  return { order: toPendingOrder(orderRows[0]), takas: takaRows.sort((a, b) => compareTakaNo(a.takaNo, b.takaNo)) };
}

/* ------------------------------------------------------------------ */
/* Send → create the challan                                            */
/* ------------------------------------------------------------------ */

/** Reserves the next challan number inside the transaction. Numbers are never handed out twice. */
async function allocateChallanNo(tx: Tx): Promise<number> {
  const [row] = await tx
    .insert(counters)
    .values({ name: CHALLAN_COUNTER, value: 1 })
    .onConflictDoUpdate({ target: counters.name, set: { value: sql`${counters.value} + 1` } })
    .returning({ value: counters.value });
  return row.value;
}

/**
 * POST /butta/challans — one transaction: the next number, the challan, its takas (meters / pcs at the time of
 * sending), takas → `at_butta` (conditional on `entered`; anything that changed meanwhile → 409 with the list and
 * nothing is saved), `sent_butta` events, and the status of every touched order.
 */
export async function createChallan(role: RoleKey, input: unknown): Promise<ChallanCreateResult> {
  const data = challanCreateSchema.parse(input);
  return db.transaction(async (tx) => {
    const [party] = await tx
      .select({ id: buttaParties.id, name: buttaParties.name })
      .from(buttaParties)
      .where(and(eq(buttaParties.id, data.partyId), eq(buttaParties.isDeleted, false)));
    if (!party) throw badRequest('This butta party no longer exists. Pick it again.', 'partyId');

    const rows: { id: number; takaNo: string; meters: number | null; pcs: number | null; stage: string; orderId: number }[] = [];
    for (const part of chunk(data.takaIds)) {
      rows.push(
        ...(await tx
          .select({ id: takas.id, takaNo: takas.takaNo, meters: takas.meters, pcs: takas.pcs, stage: takas.stage, orderId: takas.orderId })
          .from(takas)
          .innerJoin(jobsheets, eq(jobsheets.id, takas.jobsheetId))
          .where(and(inArray(takas.id, part), eq(takas.isDeleted, false), eq(jobsheets.isDeleted, false)))),
      );
    }
    const found = new Map(rows.map((r) => [r.id, r]));
    const bad = data.takaIds.flatMap((id) => {
      const r = found.get(id);
      if (!r) return [`#${id} (no longer exists)`];
      return r.stage === 'entered' ? [] : [`${r.takaNo} (${takaStageLabel(r.stage)})`];
    });
    if (bad.length) {
      throw conflict(
        `${bad.length} taka${bad.length === 1 ? ' was' : 's were'} changed meanwhile and can't be sent: ${bad.slice(0, 20).join(', ')}${bad.length > 20 ? ' …' : ''}. Refresh the list and try again.`,
      );
    }

    const at = now();
    const challanNo = await allocateChallanNo(tx);
    const [challan] = await tx
      .insert(buttaChallans)
      .values({
        challanNo,
        partyId: party.id,
        challanDate: data.challanDate,
        ewayNo: data.ewayNo,
        createdBy: role,
        createdAt: at,
        updatedAt: at,
      })
      .returning({ id: buttaChallans.id });
    for (const part of chunk(rows, 100)) {
      await tx
        .insert(buttaChallanTakas)
        .values(part.map((r) => ({ challanId: challan.id, takaId: r.id, orderId: r.orderId, meters: r.meters, pcs: r.pcs, createdAt: at, updatedAt: at })));
    }
    for (const part of chunk(data.takaIds)) {
      const moved = await tx
        .update(takas)
        .set({ stage: 'at_butta' })
        .where(and(inArray(takas.id, part), eq(takas.stage, 'entered')))
        .returning({ id: takas.id });
      if (moved.length !== part.length) throw conflict("Some takas were changed meanwhile and can't be sent. Refresh the list and try again.");
    }
    await writeTakaEvents(
      tx,
      role,
      rows.map((r): TakaEventInput => ({ takaId: r.id, event: 'sent_butta', challanId: challan.id, note: `${challanLabel(challanNo)} · ${party.name}` })),
    );
    await recomputeOrdersStatus(tx, role, rows.map((r) => r.orderId));
    const totalMeters = Math.round(rows.reduce((s, r) => s + (r.meters ?? 0), 0) * 100) / 100;
    return { challanId: challan.id, challanNo, totalTakas: rows.length, totalMeters };
  });
}

/* ------------------------------------------------------------------ */
/* Challan list                                                         */
/* ------------------------------------------------------------------ */

// Stats over every row of the challan (a cancelled challan keeps its takas for the record).
const rowsOf = sql`FROM butta_challan_takas ct WHERE ct.challan_id = "butta_challans"."id"`;
const totalTakasSql = sql<number>`(SELECT COUNT(*) ${rowsOf})`;
const totalMetersSql = sql<number>`(SELECT COALESCE(SUM(ct.meters), 0) ${rowsOf})`;
const receivedSql = sql<number>`(SELECT COUNT(*) ${rowsOf} AND ct.received_at IS NOT NULL)`;

export async function listChallans(q: ChallanListQuery): Promise<ChallanPage> {
  const conds: (SQL | undefined)[] = [];
  if (q.filter === 'open') conds.push(eq(buttaChallans.status, 'active'), sql`${receivedSql} < ${totalTakasSql}`);
  if (q.filter === 'received') conds.push(eq(buttaChallans.status, 'active'), sql`${totalTakasSql} > 0 AND ${receivedSql} = ${totalTakasSql}`);
  if (q.search) {
    const term = q.search.replace(/^#/, '');
    const p = likePattern(term);
    const challanNo = parseChallanNo(term);
    const orderNo = /^\d+$/.test(term) ? Number(term) : null;
    conds.push(
      sql`(${buttaChallans.challanNo} = ${challanNo ?? -1}
        OR ${buttaParties.name} LIKE ${p} ESCAPE '\\'
        OR EXISTS (SELECT 1 ${rowsOf} AND ct.order_id IN (SELECT o.id FROM orders o WHERE o.order_no = ${orderNo ?? -1}))
        OR EXISTS (SELECT 1 ${rowsOf} AND ct.taka_id IN (SELECT t.id FROM takas t WHERE t.taka_no LIKE ${p} ESCAPE '\\')))`,
    );
  }
  const where = and(...conds);
  const [items, [{ total }]] = await db.batch([
    db
      .select({
        id: buttaChallans.id,
        challanNo: buttaChallans.challanNo,
        status: buttaChallans.status,
        partyName: buttaParties.name,
        challanDate: buttaChallans.challanDate,
        ewayNo: buttaChallans.ewayNo,
        totalTakas: totalTakasSql,
        totalMeters: totalMetersSql,
        receivedCount: receivedSql,
        createdAt: buttaChallans.createdAt,
      })
      .from(buttaChallans)
      .innerJoin(buttaParties, eq(buttaParties.id, buttaChallans.partyId))
      .where(where)
      .orderBy(desc(buttaChallans.challanNo))
      .limit(q.limit)
      .offset((q.page - 1) * q.limit),
    db
      .select({ total: sql<number>`COUNT(*)` })
      .from(buttaChallans)
      .innerJoin(buttaParties, eq(buttaParties.id, buttaChallans.partyId))
      .where(where),
  ]);
  const count = Number(total);
  return {
    filter: q.filter,
    items: items.map((r) => ({
      ...r,
      totalTakas: Number(r.totalTakas),
      totalMeters: Math.round(Number(r.totalMeters) * 100) / 100,
      receivedCount: Number(r.receivedCount),
    })),
    page: q.page,
    limit: q.limit,
    total: count,
    hasMore: q.page * q.limit < count,
  };
}

/* ------------------------------------------------------------------ */
/* Challan details + print data                                         */
/* ------------------------------------------------------------------ */

async function loadChallan(id: number) {
  const [header, rows] = await db.batch([
    db
      .select({
        id: buttaChallans.id,
        challanNo: buttaChallans.challanNo,
        status: buttaChallans.status,
        challanDate: buttaChallans.challanDate,
        ewayNo: buttaChallans.ewayNo,
        createdBy: buttaChallans.createdBy,
        createdAt: buttaChallans.createdAt,
        cancelledAt: buttaChallans.cancelledAt,
        partyId: buttaParties.id,
        partyName: buttaParties.name,
        partyAddress: buttaParties.address,
        partyMobile: buttaParties.mobile,
        partyGstin: buttaParties.gstin,
      })
      .from(buttaChallans)
      .innerJoin(buttaParties, eq(buttaParties.id, buttaChallans.partyId))
      .where(eq(buttaChallans.id, id)),
    db
      .select({
        id: takas.id,
        takaNo: takas.takaNo,
        isDamaged: takas.isDamaged,
        meters: buttaChallanTakas.meters,
        pcs: buttaChallanTakas.pcs,
        receivedAt: buttaChallanTakas.receivedAt,
        qcDoneAt: buttaChallanTakas.qcDoneAt,
        orderId: orders.id,
        orderNo: orders.orderNo,
        designCode: designCodeSql,
        thumbUrl: designThumbSql,
        imageUrl: designImageSql,
        quality: materials.name,
      })
      .from(buttaChallanTakas)
      .innerJoin(takas, eq(takas.id, buttaChallanTakas.takaId))
      .innerJoin(orders, eq(orders.id, buttaChallanTakas.orderId))
      .innerJoin(materials, eq(materials.id, orders.materialId))
      .leftJoin(designs, eq(designs.id, orders.designId))
      .leftJoin(designVariations, eq(designVariations.id, orders.variationId))
      .where(eq(buttaChallanTakas.challanId, id)),
  ]);
  const challan = header[0];
  if (!challan) throw notFound('Challan');
  return { challan, rows };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** GET /butta/challans/:id — grouped by order; "in butta cutting" rows first, received rows below. */
export async function getChallan(id: number): Promise<ChallanDetail> {
  const { challan, rows } = await loadChallan(id);
  const groups = new Map<number, ChallanOrderGroup>();
  for (const r of rows) {
    let g = groups.get(r.orderId);
    if (!g) {
      g = {
        orderId: r.orderId,
        orderNo: r.orderNo,
        designCode: r.designCode,
        thumbUrl: r.thumbUrl,
        imageUrl: r.imageUrl,
        quality: r.quality,
        takaCount: 0,
        totalMeters: 0,
        takas: [],
      };
      groups.set(r.orderId, g);
    }
    g.takaCount += 1;
    g.totalMeters = round2(g.totalMeters + (r.meters ?? 0));
    g.takas.push({
      id: r.id,
      takaNo: r.takaNo,
      meters: r.meters,
      pcs: r.pcs,
      receivedAt: r.receivedAt,
      qcDone: r.qcDoneAt !== null,
      isDamaged: r.isDamaged,
    });
  }
  const orderGroups = [...groups.values()].sort((a, b) => a.orderNo - b.orderNo);
  for (const g of orderGroups) {
    g.takas.sort((a, b) => Number(a.receivedAt !== null) - Number(b.receivedAt !== null) || compareTakaNo(a.takaNo, b.takaNo));
  }
  const receivedCount = rows.filter((r) => r.receivedAt !== null).length;
  return {
    id: challan.id,
    challanNo: challan.challanNo,
    status: challan.status,
    party: { id: challan.partyId, name: challan.partyName, address: challan.partyAddress, mobile: challan.partyMobile, gstin: challan.partyGstin },
    challanDate: challan.challanDate,
    ewayNo: challan.ewayNo,
    createdBy: challan.createdBy,
    createdAt: challan.createdAt,
    cancelledAt: challan.cancelledAt,
    totalTakas: rows.length,
    totalMeters: round2(rows.reduce((s, r) => s + (r.meters ?? 0), 0)),
    receivedCount,
    pendingCount: challan.status === 'cancelled' ? 0 : rows.length - receivedCount,
    canCancel: challan.status === 'active' && receivedCount === 0,
    orders: orderGroups,
  };
}

/** GET /butta/challans/:id/print — no order number and no client; meters at the time of sending. */
export async function getChallanPrint(id: number): Promise<ChallanPrintData> {
  const { challan, rows } = await loadChallan(id);
  const sorted = [...rows].sort((a, b) => a.orderNo - b.orderNo || compareTakaNo(a.takaNo, b.takaNo));
  return {
    challanNo: challan.challanNo,
    status: challan.status,
    challanDate: challan.challanDate,
    ewayNo: challan.ewayNo,
    party: { name: challan.partyName, address: challan.partyAddress, mobile: challan.partyMobile, gstin: challan.partyGstin },
    qualities: [...new Set(sorted.map((r) => r.quality))],
    takas: sorted.map((r) => ({ takaNo: r.takaNo, meters: r.meters })),
  };
}

/* ------------------------------------------------------------------ */
/* Cancel a challan                                                     */
/* ------------------------------------------------------------------ */

/**
 * Only while NOTHING was received: all takas go back to `entered`, the challan is marked cancelled (its number is
 * never reused), `challan_cancelled` events are written and the statuses recomputed.
 */
export async function cancelChallan(role: RoleKey, id: number): Promise<{ challanId: number; challanNo: number }> {
  return db.transaction(async (tx) => {
    const [challan] = await tx
      .select({ id: buttaChallans.id, challanNo: buttaChallans.challanNo, status: buttaChallans.status })
      .from(buttaChallans)
      .where(eq(buttaChallans.id, id));
    if (!challan) throw notFound('Challan');
    if (challan.status === 'cancelled') throw conflict('This challan is already cancelled.');
    const rows = await tx
      .select({ id: buttaChallanTakas.id, takaId: buttaChallanTakas.takaId, orderId: buttaChallanTakas.orderId, receivedAt: buttaChallanTakas.receivedAt })
      .from(buttaChallanTakas)
      .where(and(eq(buttaChallanTakas.challanId, id), eq(buttaChallanTakas.isActive, true)));
    if (rows.some((r) => r.receivedAt !== null)) {
      throw conflict("This challan can't be cancelled because some of its takas were already received.");
    }
    const at = now();
    // Conditional on the current stage: a taka that moved on meanwhile stops the whole cancel.
    for (const part of chunk(rows.map((r) => r.takaId))) {
      const back = await tx
        .update(takas)
        .set({ stage: 'entered' })
        .where(and(inArray(takas.id, part), eq(takas.stage, 'at_butta')))
        .returning({ id: takas.id });
      if (back.length !== part.length) throw conflict('Some takas changed meanwhile. Refresh and try again.');
    }
    await tx.update(buttaChallanTakas).set({ isActive: false, updatedAt: at }).where(eq(buttaChallanTakas.challanId, id));
    await tx.update(buttaChallans).set({ status: 'cancelled', cancelledAt: at, cancelledBy: role }).where(eq(buttaChallans.id, id));
    await writeTakaEvents(
      tx,
      role,
      rows.map((r): TakaEventInput => ({ takaId: r.takaId, event: 'challan_cancelled', challanId: id, note: `${challanLabel(challan.challanNo)} cancelled` })),
    );
    await recomputeOrdersStatus(tx, role, rows.map((r) => r.orderId));
    return { challanId: id, challanNo: challan.challanNo };
  });
}

/* ------------------------------------------------------------------ */
/* Receive                                                              */
/* ------------------------------------------------------------------ */

/**
 * POST /butta/receive — `{ takaNo }` (the Taka number screen) or `{ takaIds }` (ticked rows on a challan).
 * A taka is received only from `at_butta`: → `butta_qc`, `received_at` / `received_by` on its challan row, a
 * `received_butta` event, and the order status. Every taka gets a result (alerts are built from them).
 */
export async function receiveTakas(role: RoleKey, input: unknown): Promise<ReceiveResponse> {
  const data = buttaReceiveSchema.parse(input);
  return db.transaction(async (tx) => {
    const wanted: ({ takaNo: string } | { id: number })[] = data.takaNo !== undefined ? [{ takaNo: data.takaNo.trim() }] : data.takaIds!.map((id) => ({ id }));
    const results: ReceiveResult[] = [];
    const orderIds: number[] = [];
    const events: TakaEventInput[] = [];
    for (const w of wanted) {
      const [row] = await tx
        .select({
          id: takas.id,
          takaNo: takas.takaNo,
          stage: takas.stage,
          orderId: takas.orderId,
          orderNo: orders.orderNo,
          ctId: buttaChallanTakas.id,
          challanId: buttaChallanTakas.challanId,
          challanNo: buttaChallans.challanNo,
          meters: buttaChallanTakas.meters,
          receivedAt: buttaChallanTakas.receivedAt,
        })
        .from(takas)
        .innerJoin(orders, eq(orders.id, takas.orderId))
        .leftJoin(buttaChallanTakas, and(eq(buttaChallanTakas.takaId, takas.id), eq(buttaChallanTakas.isActive, true)))
        .leftJoin(buttaChallans, eq(buttaChallans.id, buttaChallanTakas.challanId))
        .where(and(eq(takas.isDeleted, false), 'takaNo' in w ? eq(takas.takaNo, w.takaNo) : eq(takas.id, w.id)))
        .limit(1);
      const label = 'takaNo' in w ? w.takaNo : String(w.id);
      const base = { takaId: row?.id ?? null, takaNo: row?.takaNo ?? label, orderNo: row?.orderNo ?? null, challanId: row?.challanId ?? null, challanNo: row?.challanNo ?? null, meters: row?.meters ?? null, receivedAt: row?.receivedAt ?? null };
      if (!row) {
        results.push({ ...base, ok: false, code: 'not_found', message: `Taka ${label} not found` });
        continue;
      }
      if (row.receivedAt) {
        results.push({ ...base, ok: false, code: 'already_received', message: `Taka ${row.takaNo} was already received on ${formatIst(row.receivedAt)}` });
        continue;
      }
      if (row.stage !== 'at_butta' || row.ctId === null) {
        results.push({
          ...base,
          ok: false,
          code: 'not_sent',
          message:
            row.stage === 'entered'
              ? `Taka ${row.takaNo} was not sent for butta cutting`
              : `Taka ${row.takaNo} was not sent for butta cutting (it is at: ${takaStageLabel(row.stage)})`,
        });
        continue;
      }
      const at = now();
      const moved = await tx
        .update(takas)
        .set({ stage: 'butta_qc' })
        .where(and(eq(takas.id, row.id), eq(takas.stage, 'at_butta')))
        .returning({ id: takas.id });
      const marked = moved.length
        ? await tx
            .update(buttaChallanTakas)
            .set({ receivedAt: at, receivedBy: role, updatedAt: at })
            .where(and(eq(buttaChallanTakas.id, row.ctId), sql`${buttaChallanTakas.receivedAt} IS NULL`))
            .returning({ id: buttaChallanTakas.id })
        : [];
      if (!moved.length || !marked.length) {
        results.push({ ...base, ok: false, code: 'changed', message: `Taka ${row.takaNo} was just changed. Try again.` });
        continue;
      }
      events.push({ takaId: row.id, event: 'received_butta', challanId: row.challanId, note: row.challanNo ? challanLabel(row.challanNo) : null });
      orderIds.push(row.orderId);
      results.push({ ...base, ok: true, code: 'received', message: `Taka ${row.takaNo} received`, receivedAt: at });
    }
    await writeTakaEvents(tx, role, events);
    await recomputeOrdersStatus(tx, role, orderIds);
    return { results, received: results.filter((r) => r.ok).length };
  });
}

/** POST /butta/receive/:takaId/undo — only before Butta QC is done: back to `at_butta`, received fields cleared. */
export async function undoReceive(role: RoleKey, takaId: number): Promise<ReceiveResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: takas.id,
        takaNo: takas.takaNo,
        stage: takas.stage,
        orderId: takas.orderId,
        orderNo: orders.orderNo,
        ctId: buttaChallanTakas.id,
        challanId: buttaChallanTakas.challanId,
        challanNo: buttaChallans.challanNo,
        meters: buttaChallanTakas.meters,
      })
      .from(takas)
      .innerJoin(orders, eq(orders.id, takas.orderId))
      .leftJoin(buttaChallanTakas, and(eq(buttaChallanTakas.takaId, takas.id), eq(buttaChallanTakas.isActive, true)))
      .leftJoin(buttaChallans, eq(buttaChallans.id, buttaChallanTakas.challanId))
      .where(and(eq(takas.id, takaId), eq(takas.isDeleted, false)));
    if (!row) throw notFound('Taka');
    if (row.stage !== 'butta_qc' || row.ctId === null) {
      throw conflict(
        row.stage === 'at_butta'
          ? `Taka ${row.takaNo} is not received.`
          : `Taka ${row.takaNo} can't be un-received any more: its butta QC is already done.`,
      );
    }
    const moved = await tx
      .update(takas)
      .set({ stage: 'at_butta' })
      .where(and(eq(takas.id, takaId), eq(takas.stage, 'butta_qc')))
      .returning({ id: takas.id });
    if (!moved.length) throw conflict(`Taka ${row.takaNo} was just changed. Refresh and try again.`);
    await tx.update(buttaChallanTakas).set({ receivedAt: null, receivedBy: null }).where(eq(buttaChallanTakas.id, row.ctId));
    await writeTakaEvents(tx, role, [{ takaId, event: 'receive_undone', challanId: row.challanId, note: row.challanNo ? challanLabel(row.challanNo) : null }]);
    await recomputeOrdersStatus(tx, role, [row.orderId]);
    return {
      takaId,
      takaNo: row.takaNo,
      ok: true,
      code: 'received',
      message: `Taka ${row.takaNo} is back at butta cutting`,
      orderNo: row.orderNo,
      challanId: row.challanId,
      challanNo: row.challanNo,
      meters: row.meters,
      receivedAt: null,
    };
  });
}
