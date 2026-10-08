import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import {
  CHALLAN_KIND_CONFIG,
  canRoleSeeStatus,
  challanCreateSchema,
  challanLabel,
  challanReceiveSchema,
  compareTakaNo,
  parseChallanNo,
  sendableStages,
  takaStageLabel,
  type ButtaListQuery,
  type ChallanCreateResult,
  type ChallanDetail,
  type ChallanKind,
  type ChallanListQuery,
  type ChallanOrderGroup,
  type ChallanPage,
  type ChallanPendingOrder,
  type ChallanPendingOrderPage,
  type ChallanPendingOrderTakas,
  type ChallanPrintData,
  type OrderChallans,
  type ReceiveResponse,
  type ReceiveResult,
  type RoleKey,
  type TakaEventKind,
  type TakaStage,
} from '@rivoora/shared';
import { db, type Tx } from '../db/client';
import {
  buttaParties,
  challanTakas,
  challans,
  counters,
  designVariations,
  designs,
  jobsheets,
  materials,
  millParties,
  orders,
  takas,
} from '../db/schema';
import { badRequest, conflict, notFound } from '../lib/errors';
import { likePattern } from '../lib/http';
import { chunk, recomputeOrdersStatus, writeTakaEvents, type TakaEventInput } from './taka-ops';

/**
 * Butta cutting AND the mill: Send (pending orders → challan), the challan list / details / print data, Receive.
 * One engine, parameterised by the challan `kind` (see CHALLAN_KIND_CONFIG in shared): which taka stage is "ready to
 * send", which stages the takas move to, the number prefix / counter and the party master. Every multi-row write is
 * ONE transaction with conditional updates on the current taka stage and ends with `recomputeOrderStatus` for every
 * touched order. Nothing here ever returns a client name or a rate.
 */

const now = () => new Date().toISOString();

/** The taka events a kind writes when takas are sent / received. */
const KIND_EVENTS: Record<ChallanKind, { sent: TakaEventKind; received: TakaEventKind }> = {
  butta: { sent: 'sent_butta', received: 'received_butta' },
  mill: { sent: 'sent_mill', received: 'received_mill' },
};

/** The party master table of a kind (same columns). */
const partyTable = (kind: ChallanKind) => (kind === 'butta' ? buttaParties : millParties);

const designCodeSql = sql<string | null>`COALESCE(${designVariations.code}, ${designs.code})`;
const designThumbSql = sql<string | null>`CASE WHEN ${designVariations.id} IS NOT NULL THEN ${designVariations.thumbUrl} ELSE ${designs.thumbUrl} END`;
const designImageSql = sql<string | null>`CASE WHEN ${designVariations.id} IS NOT NULL THEN ${designVariations.imageUrl} ELSE ${designs.imageUrl} END`;
/** The party name of a challan, from the master of its kind (outer table written explicitly — see the Drizzle gotcha). */
const partyNameSql = sql<string>`CASE WHEN "challans"."kind" = 'mill' THEN (SELECT name FROM mill_parties WHERE id = "challans"."party_id") ELSE (SELECT name FROM butta_parties WHERE id = "challans"."party_id") END`;

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

const round2 = (n: number) => Math.round(n * 100) / 100;

/* ------------------------------------------------------------------ */
/* Send → Pending                                                       */
/* ------------------------------------------------------------------ */

/**
 * The two lists of the Send tab: `send` (Pending: takas waiting to go for the first time) and `refinish` (the mill's
 * Refinish sub-tab: takas Mill QC / the godown marked for refinish, going back on a normal challan).
 */
export type SendMode = 'send' | 'refinish';

/** Stages counted in a mode ("total") and the stage that is ready to send. */
function modeStages(kind: ChallanKind, mode: SendMode): { notSent: TakaStage[]; ready: TakaStage } {
  const cfg = CHALLAN_KIND_CONFIG[kind];
  if (mode === 'refinish') {
    if (!cfg.refinishStage) throw notFound('Refinish list');
    return { notSent: [cfg.refinishStage], ready: cfg.refinishStage };
  }
  return { notSent: [...cfg.notSentStages], ready: cfg.readyStage };
}

/** Takas not yet sent on a challan of this kind (ready ones included) whose jobsheet is active. */
const notSentWhere = (kind: ChallanKind, mode: SendMode = 'send') =>
  and(inArray(takas.stage, modeStages(kind, mode).notSent), eq(takas.isDeleted, false), eq(jobsheets.isDeleted, false));

const isReadySql = (kind: ChallanKind, mode: SendMode = 'send') => sql`${takas.stage} = ${modeStages(kind, mode).ready}`;

const pendingOrderColumns = (kind: ChallanKind, mode: SendMode = 'send') => ({
  orderId: orders.id,
  orderNo: orders.orderNo,
  designCode: designCodeSql,
  thumbUrl: designThumbSql,
  imageUrl: designImageSql,
  quality: materials.name,
  takaCount: sql<number>`SUM(CASE WHEN ${isReadySql(kind, mode)} THEN 1 ELSE 0 END)`,
  totalMeters: sql<number>`COALESCE(SUM(CASE WHEN ${isReadySql(kind, mode)} THEN ${takas.meters} END), 0)`,
  notSentCount: sql<number>`COUNT(*)`,
});

function toPendingOrder(r: {
  orderId: number;
  orderNo: number;
  designCode: string | null;
  thumbUrl: string | null;
  imageUrl: string | null;
  quality: string | null;
  takaCount: number;
  totalMeters: number;
  notSentCount: number;
}): ChallanPendingOrder {
  return { ...r, takaCount: Number(r.takaCount), totalMeters: round2(Number(r.totalMeters)), notSentCount: Number(r.notSentCount) };
}

/** GET /<kind>/pending-orders — orders with at least one ready taka, with ready / not-yet-sent counts (one aggregate query). */
export async function listPendingOrders(kind: ChallanKind, q: ButtaListQuery, mode: SendMode = 'send'): Promise<ChallanPendingOrderPage> {
  let search: SQL | undefined;
  if (q.search) {
    const term = q.search.replace(/^#/, '');
    const p = likePattern(term);
    const orderNo = /^\d+$/.test(term) ? Number(term) : null;
    const stages = modeStages(kind, mode).notSent.map((s) => `'${s}'`).join(', ');
    search = sql`(${orders.orderNo} = ${orderNo ?? -1} OR ${designCodeSql} LIKE ${p} ESCAPE '\\' OR ${orders.id} IN (SELECT t2.order_id FROM takas t2 WHERE t2.is_deleted = 0 AND t2.stage IN (${sql.raw(stages)}) AND t2.taka_no LIKE ${p} ESCAPE '\\'))`;
  }
  const hasReady = sql`SUM(CASE WHEN ${isReadySql(kind, mode)} THEN 1 ELSE 0 END) > 0`;
  const [items, [{ total }]] = await db.batch([
    db
      .select(pendingOrderColumns(kind, mode))
      .from(takas)
      .innerJoin(jobsheets, eq(jobsheets.id, takas.jobsheetId))
      .innerJoin(orders, eq(orders.id, takas.orderId))
      .innerJoin(materials, eq(materials.id, orders.materialId))
      .leftJoin(designs, eq(designs.id, orders.designId))
      .leftJoin(designVariations, eq(designVariations.id, orders.variationId))
      .where(and(notSentWhere(kind, mode), search))
      .groupBy(orders.id)
      .having(hasReady)
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
      .where(and(notSentWhere(kind, mode), isReadySql(kind, mode), search)),
  ]);
  const count = Number(total);
  return { items: items.map(toPendingOrder), page: q.page, limit: q.limit, total: count, hasMore: q.page * q.limit < count };
}

/**
 * GET /<kind>/pending-orders/:orderId/takas — EVERY not-yet-sent taka of the order with its stage and a `ready` flag
 * (not-ready takas are shown greyed out and can't be selected).
 */
export async function listPendingOrderTakas(kind: ChallanKind, orderId: number, mode: SendMode = 'send'): Promise<ChallanPendingOrderTakas> {
  const [orderRows, takaRows] = await db.batch([
    db
      .select(pendingOrderColumns(kind, mode))
      .from(takas)
      .innerJoin(jobsheets, eq(jobsheets.id, takas.jobsheetId))
      .innerJoin(orders, eq(orders.id, takas.orderId))
      .innerJoin(materials, eq(materials.id, orders.materialId))
      .leftJoin(designs, eq(designs.id, orders.designId))
      .leftJoin(designVariations, eq(designVariations.id, orders.variationId))
      .where(and(notSentWhere(kind, mode), eq(orders.id, orderId)))
      .groupBy(orders.id),
    db
      .select({ id: takas.id, takaNo: takas.takaNo, meters: takas.meters, pcs: takas.pcs, isDamaged: takas.isDamaged, stage: takas.stage, refinishCount: takas.refinishCount })
      .from(takas)
      .innerJoin(jobsheets, eq(jobsheets.id, takas.jobsheetId))
      .where(and(notSentWhere(kind, mode), eq(takas.orderId, orderId))),
  ]);
  if (!orderRows[0]) throw notFound(`Order with takas waiting for ${CHALLAN_KIND_CONFIG[kind].place}`);
  const ready = modeStages(kind, mode).ready;
  return {
    order: toPendingOrder(orderRows[0]),
    takas: takaRows.map((t) => ({ ...t, ready: t.stage === ready })).sort((a, b) => compareTakaNo(a.takaNo, b.takaNo)),
  };
}

/** GET /<kind>/counts — the Send tab counts: takas ready to send / takas currently with the party. */
/** Taka counts (and pcs) for the Send tab / KPI row. */
export interface KindCounts {
  pending: number;
  inKind: number;
  refinish: number;
  pendingPcs: number;
  inKindPcs: number;
}

export async function getKindCounts(kind: ChallanKind): Promise<KindCounts> {
  const cfg = CHALLAN_KIND_CONFIG[kind];
  const pcsOf = sql`COALESCE(${takas.actualPcs}, ${takas.pcs}, 0)`;
  const [row] = await db
    .select({
      pending: sql<number>`COALESCE(SUM(CASE WHEN ${takas.stage} = ${cfg.readyStage} THEN 1 ELSE 0 END), 0)`,
      inKind: sql<number>`COALESCE(SUM(CASE WHEN ${takas.stage} = ${cfg.sentStage} THEN 1 ELSE 0 END), 0)`,
      refinish: sql<number>`COALESCE(SUM(CASE WHEN ${takas.stage} = ${cfg.refinishStage ?? '-'} THEN 1 ELSE 0 END), 0)`,
      pendingPcs: sql<number>`COALESCE(SUM(CASE WHEN ${takas.stage} = ${cfg.readyStage} THEN ${pcsOf} ELSE 0 END), 0)`,
      inKindPcs: sql<number>`COALESCE(SUM(CASE WHEN ${takas.stage} = ${cfg.sentStage} THEN ${pcsOf} ELSE 0 END), 0)`,
    })
    .from(takas)
    .innerJoin(jobsheets, eq(jobsheets.id, takas.jobsheetId))
    .where(and(eq(takas.isDeleted, false), eq(jobsheets.isDeleted, false), inArray(takas.stage, [cfg.readyStage, cfg.sentStage, ...(cfg.refinishStage ? [cfg.refinishStage] : [])])));
  return {
    pending: Number(row?.pending ?? 0),
    inKind: Number(row?.inKind ?? 0),
    refinish: Number(row?.refinish ?? 0),
    pendingPcs: Number(row?.pendingPcs ?? 0),
    inKindPcs: Number(row?.inKindPcs ?? 0),
  };
}

/* ------------------------------------------------------------------ */
/* Send → create the challan                                            */
/* ------------------------------------------------------------------ */

/** Reserves the next challan number of this kind inside the transaction. Numbers are never handed out twice. */
async function allocateChallanNo(tx: Tx, kind: ChallanKind): Promise<number> {
  const [row] = await tx
    .insert(counters)
    .values({ name: CHALLAN_KIND_CONFIG[kind].counter, value: 1 })
    .onConflictDoUpdate({ target: counters.name, set: { value: sql`${counters.value} + 1` } })
    .returning({ value: counters.value });
  return row.value;
}

/**
 * POST /<kind>/challans — one transaction: the next number, the challan, its takas (meters / pcs at the time of
 * sending), takas → the kind's sent stage (conditional on its ready stage; anything that changed meanwhile → 409 with
 * the list and nothing is saved), `sent_*` events, and the status of every touched order.
 */
export async function createChallan(kind: ChallanKind, role: RoleKey, input: unknown): Promise<ChallanCreateResult> {
  const cfg = CHALLAN_KIND_CONFIG[kind];
  const data = challanCreateSchema.parse(input);
  return db.transaction(async (tx) => {
    const parties = partyTable(kind);
    const [party] = await tx
      .select({ id: parties.id, name: parties.name })
      .from(parties)
      .where(and(eq(parties.id, data.partyId), eq(parties.isDeleted, false)));
    if (!party) throw badRequest(`This ${cfg.partyLabel.toLowerCase()} no longer exists. Pick it again.`, 'partyId');

    const sendable: string[] = sendableStages(kind);
    const rows: { id: number; takaNo: string; meters: number | null; pcs: number | null; stage: string; orderId: number; refinishCount: number }[] = [];
    for (const part of chunk(data.takaIds)) {
      rows.push(
        ...(await tx
          .select({ id: takas.id, takaNo: takas.takaNo, meters: takas.meters, pcs: takas.pcs, stage: takas.stage, orderId: takas.orderId, refinishCount: takas.refinishCount })
          .from(takas)
          .innerJoin(jobsheets, eq(jobsheets.id, takas.jobsheetId))
          .where(and(inArray(takas.id, part), eq(takas.isDeleted, false), eq(jobsheets.isDeleted, false)))),
      );
    }
    const found = new Map(rows.map((r) => [r.id, r]));
    const bad = data.takaIds.flatMap((id) => {
      const r = found.get(id);
      if (!r) return [`#${id} (no longer exists)`];
      return sendable.includes(r.stage) ? [] : [`${r.takaNo} (${takaStageLabel(r.stage)})`];
    });
    if (bad.length) {
      throw conflict(
        `${bad.length} taka${bad.length === 1 ? ' was' : 's were'} changed meanwhile and can't be sent: ${bad.slice(0, 20).join(', ')}${bad.length > 20 ? ' …' : ''}. Refresh the list and try again.`,
      );
    }

    const at = now();
    const challanNo = await allocateChallanNo(tx, kind);
    const [challan] = await tx
      .insert(challans)
      .values({
        kind,
        challanNo,
        partyId: party.id,
        challanDate: data.challanDate,
        ewayNo: data.ewayNo,
        createdBy: role,
        createdAt: at,
        updatedAt: at,
      })
      .returning({ id: challans.id });
    // A refinish taka already has a (finished) trip on a challan of this kind: that row is closed before the new one.
    const refinishIds = rows.filter((r) => r.stage === cfg.refinishStage).map((r) => r.id);
    for (const part of chunk(refinishIds)) {
      await tx
        .update(challanTakas)
        .set({ isActive: false, updatedAt: at })
        .where(and(inArray(challanTakas.takaId, part), eq(challanTakas.kind, kind), eq(challanTakas.isActive, true)));
    }
    for (const part of chunk(rows, 100)) {
      await tx.insert(challanTakas).values(
        part.map((r) => ({
          challanId: challan.id,
          kind,
          takaId: r.id,
          orderId: r.orderId,
          meters: r.meters,
          pcs: r.pcs,
          isRefinish: r.stage === cfg.refinishStage,
          createdAt: at,
          updatedAt: at,
        })),
      );
    }
    for (const part of chunk(data.takaIds)) {
      const moved = await tx
        .update(takas)
        .set({ stage: cfg.sentStage })
        .where(and(inArray(takas.id, part), inArray(takas.stage, sendableStages(kind))))
        .returning({ id: takas.id });
      if (moved.length !== part.length) throw conflict("Some takas were changed meanwhile and can't be sent. Refresh the list and try again.");
    }
    await writeTakaEvents(
      tx,
      role,
      rows.map(
        (r): TakaEventInput => ({
          takaId: r.id,
          event: KIND_EVENTS[kind].sent,
          challanId: challan.id,
          note: `${challanLabel(challanNo, kind)} · ${party.name}${r.stage === cfg.refinishStage ? ` · refinish${r.refinishCount > 1 ? ` ×${r.refinishCount}` : ''}` : ''}`,
        }),
      ),
    );
    await recomputeOrdersStatus(tx, role, rows.map((r) => r.orderId));
    const totalMeters = round2(rows.reduce((s, r) => s + (r.meters ?? 0), 0));
    return { challanId: challan.id, kind, challanNo, totalTakas: rows.length, totalMeters };
  });
}

/* ------------------------------------------------------------------ */
/* Challan list                                                         */
/* ------------------------------------------------------------------ */

// Stats over every row of the challan (a cancelled challan keeps its takas for the record).
const rowsOf = sql`FROM challan_takas ct WHERE ct.challan_id = "challans"."id"`;
const totalTakasSql = sql<number>`(SELECT COUNT(*) ${rowsOf})`;
const totalMetersSql = sql<number>`(SELECT COALESCE(SUM(ct.meters), 0) ${rowsOf})`;
const receivedSql = sql<number>`(SELECT COUNT(*) ${rowsOf} AND ct.received_at IS NOT NULL)`;

export async function listChallans(kind: ChallanKind, q: ChallanListQuery): Promise<ChallanPage> {
  const conds: (SQL | undefined)[] = [eq(challans.kind, kind)];
  if (q.filter === 'open') conds.push(eq(challans.status, 'active'), sql`${receivedSql} < ${totalTakasSql}`);
  if (q.filter === 'received') conds.push(eq(challans.status, 'active'), sql`${totalTakasSql} > 0 AND ${receivedSql} = ${totalTakasSql}`);
  if (q.search) {
    const term = q.search.replace(/^#/, '');
    const p = likePattern(term);
    const challanNo = parseChallanNo(term, kind);
    const orderNo = /^\d+$/.test(term) ? Number(term) : null;
    conds.push(
      sql`(${challans.challanNo} = ${challanNo ?? -1}
        OR ${partyNameSql} LIKE ${p} ESCAPE '\\'
        OR EXISTS (SELECT 1 ${rowsOf} AND ct.order_id IN (SELECT o.id FROM orders o WHERE o.order_no = ${orderNo ?? -1}))
        OR EXISTS (SELECT 1 ${rowsOf} AND ct.taka_id IN (SELECT t.id FROM takas t WHERE t.taka_no LIKE ${p} ESCAPE '\\')))`,
    );
  }
  const where = and(...conds);
  const [items, [{ total }]] = await db.batch([
    db
      .select({
        id: challans.id,
        kind: challans.kind,
        challanNo: challans.challanNo,
        status: challans.status,
        partyName: partyNameSql,
        challanDate: challans.challanDate,
        ewayNo: challans.ewayNo,
        totalTakas: totalTakasSql,
        totalMeters: totalMetersSql,
        receivedCount: receivedSql,
        createdAt: challans.createdAt,
      })
      .from(challans)
      .where(where)
      .orderBy(desc(challans.challanNo))
      .limit(q.limit)
      .offset((q.page - 1) * q.limit),
    db.select({ total: sql<number>`COUNT(*)` }).from(challans).where(where),
  ]);
  const count = Number(total);
  return {
    filter: q.filter,
    items: items.map((r) => ({
      ...r,
      totalTakas: Number(r.totalTakas),
      totalMeters: round2(Number(r.totalMeters)),
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

async function loadChallan(kind: ChallanKind, id: number) {
  const parties = partyTable(kind);
  const [header, rows] = await db.batch([
    db
      .select({
        id: challans.id,
        kind: challans.kind,
        challanNo: challans.challanNo,
        status: challans.status,
        challanDate: challans.challanDate,
        ewayNo: challans.ewayNo,
        createdBy: challans.createdBy,
        createdAt: challans.createdAt,
        cancelledAt: challans.cancelledAt,
        partyId: parties.id,
        partyName: parties.name,
        partyAddress: parties.address,
        partyMobile: parties.mobile,
        partyGstin: parties.gstin,
      })
      .from(challans)
      .innerJoin(parties, eq(parties.id, challans.partyId))
      .where(and(eq(challans.id, id), eq(challans.kind, kind))),
    db
      .select({
        id: takas.id,
        takaNo: takas.takaNo,
        isDamaged: takas.isDamaged,
        meters: challanTakas.meters,
        pcs: challanTakas.pcs,
        receivedAt: challanTakas.receivedAt,
        qcDoneAt: challanTakas.qcDoneAt,
        orderId: orders.id,
        orderNo: orders.orderNo,
        designCode: designCodeSql,
        thumbUrl: designThumbSql,
        imageUrl: designImageSql,
        quality: materials.name,
      })
      .from(challanTakas)
      .innerJoin(takas, eq(takas.id, challanTakas.takaId))
      .innerJoin(orders, eq(orders.id, challanTakas.orderId))
      .innerJoin(materials, eq(materials.id, orders.materialId))
      .leftJoin(designs, eq(designs.id, orders.designId))
      .leftJoin(designVariations, eq(designVariations.id, orders.variationId))
      .where(eq(challanTakas.challanId, id)),
  ]);
  const challan = header[0];
  if (!challan) throw notFound('Challan');
  return { challan, rows };
}

/** GET /<kind>/challans/:id — grouped by order; "with the party" rows first, received rows below. */
export async function getChallan(kind: ChallanKind, id: number): Promise<ChallanDetail> {
  const { challan, rows } = await loadChallan(kind, id);
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
    kind: challan.kind,
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

/** GET /<kind>/challans/:id/print — no order number and no client; meters at the time of sending. */
export async function getChallanPrint(kind: ChallanKind, id: number): Promise<ChallanPrintData> {
  const { challan, rows } = await loadChallan(kind, id);
  const sorted = [...rows].sort((a, b) => a.orderNo - b.orderNo || compareTakaNo(a.takaNo, b.takaNo));
  return {
    kind: challan.kind,
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
 * Only while NOTHING was received: all takas go back to the kind's ready stage, the challan is marked cancelled (its
 * number is never reused), `challan_cancelled` events are written and the statuses recomputed.
 */
export async function cancelChallan(kind: ChallanKind, role: RoleKey, id: number): Promise<{ challanId: number; challanNo: number }> {
  const cfg = CHALLAN_KIND_CONFIG[kind];
  return db.transaction(async (tx) => {
    const [challan] = await tx
      .select({ id: challans.id, challanNo: challans.challanNo, status: challans.status })
      .from(challans)
      .where(and(eq(challans.id, id), eq(challans.kind, kind)));
    if (!challan) throw notFound('Challan');
    if (challan.status === 'cancelled') throw conflict('This challan is already cancelled.');
    const rows = await tx
      .select({ id: challanTakas.id, takaId: challanTakas.takaId, orderId: challanTakas.orderId, receivedAt: challanTakas.receivedAt, isRefinish: challanTakas.isRefinish })
      .from(challanTakas)
      .where(and(eq(challanTakas.challanId, id), eq(challanTakas.isActive, true)));
    if (rows.some((r) => r.receivedAt !== null)) {
      throw conflict("This challan can't be cancelled because some of its takas were already received.");
    }
    const at = now();
    // Conditional on the current stage: a taka that moved on meanwhile stops the whole cancel.
    // Refinish trips go back to the refinish list, everything else to the kind's ready stage.
    for (const [isRefinish, backStage] of [
      [false, cfg.readyStage],
      [true, cfg.refinishStage ?? cfg.readyStage],
    ] as const) {
      for (const part of chunk(rows.filter((r) => r.isRefinish === isRefinish).map((r) => r.takaId))) {
        const back = await tx
          .update(takas)
          .set({ stage: backStage })
          .where(and(inArray(takas.id, part), eq(takas.stage, cfg.sentStage)))
          .returning({ id: takas.id });
        if (back.length !== part.length) throw conflict('Some takas changed meanwhile. Refresh and try again.');
      }
    }
    await tx.update(challanTakas).set({ isActive: false, updatedAt: at }).where(eq(challanTakas.challanId, id));
    // A refinish trip: the taka's previous trip becomes the active one again.
    for (const r of rows.filter((x) => x.isRefinish)) {
      await tx
        .update(challanTakas)
        .set({ isActive: true, updatedAt: at })
        .where(
          eq(
            challanTakas.id,
            sql`(SELECT MAX(p.id) FROM challan_takas p WHERE p.taka_id = ${r.takaId} AND p.kind = ${kind} AND p.id < ${r.id})`,
          ),
        );
    }
    await tx.update(challans).set({ status: 'cancelled', cancelledAt: at, cancelledBy: role }).where(eq(challans.id, id));
    await writeTakaEvents(
      tx,
      role,
      rows.map((r): TakaEventInput => ({ takaId: r.takaId, event: 'challan_cancelled', challanId: id, note: `${challanLabel(challan.challanNo, kind)} cancelled` })),
    );
    await recomputeOrdersStatus(tx, role, rows.map((r) => r.orderId));
    return { challanId: id, challanNo: challan.challanNo };
  });
}

/* ------------------------------------------------------------------ */
/* Receive                                                              */
/* ------------------------------------------------------------------ */

/**
 * POST /<kind>/receive — `{ takaNo }` (the Taka number screen) or `{ takaIds }` (ticked rows on a challan).
 * A taka is received only from the kind's sent stage: → its received stage, `received_at` / `received_by` on its
 * challan row, a `received_*` event, and the order status. Every taka gets a result (alerts are built from them).
 */
export async function receiveTakas(kind: ChallanKind, role: RoleKey, input: unknown): Promise<ReceiveResponse> {
  const cfg = CHALLAN_KIND_CONFIG[kind];
  const data = challanReceiveSchema.parse(input);
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
          ctId: challanTakas.id,
          challanId: challanTakas.challanId,
          challanNo: challans.challanNo,
          meters: challanTakas.meters,
          receivedAt: challanTakas.receivedAt,
        })
        .from(takas)
        .innerJoin(orders, eq(orders.id, takas.orderId))
        .leftJoin(challanTakas, and(eq(challanTakas.takaId, takas.id), eq(challanTakas.kind, kind), eq(challanTakas.isActive, true)))
        .leftJoin(challans, eq(challans.id, challanTakas.challanId))
        .where(and(eq(takas.isDeleted, false), 'takaNo' in w ? eq(takas.takaNo, w.takaNo) : eq(takas.id, w.id)))
        .limit(1);
      const label = 'takaNo' in w ? w.takaNo : String(w.id);
      const base = {
        takaId: row?.id ?? null,
        takaNo: row?.takaNo ?? label,
        orderNo: row?.orderNo ?? null,
        challanId: row?.challanId ?? null,
        challanNo: row?.challanNo ?? null,
        challanKind: kind,
        meters: row?.meters ?? null,
        receivedAt: row?.receivedAt ?? null,
      };
      if (!row) {
        results.push({ ...base, ok: false, code: 'not_found', message: `Taka ${label} not found` });
        continue;
      }
      if (row.receivedAt) {
        results.push({ ...base, ok: false, code: 'already_received', message: `Taka ${row.takaNo} was already received on ${formatIst(row.receivedAt)}` });
        continue;
      }
      if (row.stage !== cfg.sentStage || row.ctId === null) {
        results.push({
          ...base,
          ok: false,
          code: 'not_sent',
          message:
            row.stage === cfg.readyStage || row.stage === 'entered'
              ? `Taka ${row.takaNo} was not sent ${cfg.sentToText}`
              : `Taka ${row.takaNo} was not sent ${cfg.sentToText} (it is at: ${takaStageLabel(row.stage)})`,
        });
        continue;
      }
      const at = now();
      const moved = await tx
        .update(takas)
        .set({ stage: cfg.receivedStage })
        .where(and(eq(takas.id, row.id), eq(takas.stage, cfg.sentStage)))
        .returning({ id: takas.id });
      const marked = moved.length
        ? await tx
            .update(challanTakas)
            .set({ receivedAt: at, receivedBy: role, updatedAt: at })
            .where(and(eq(challanTakas.id, row.ctId), sql`${challanTakas.receivedAt} IS NULL`))
            .returning({ id: challanTakas.id })
        : [];
      if (!moved.length || !marked.length) {
        results.push({ ...base, ok: false, code: 'changed', message: `Taka ${row.takaNo} was just changed. Try again.` });
        continue;
      }
      events.push({ takaId: row.id, event: KIND_EVENTS[kind].received, challanId: row.challanId, note: row.challanNo ? challanLabel(row.challanNo, kind) : null });
      orderIds.push(row.orderId);
      results.push({ ...base, ok: true, code: 'received', message: `Taka ${row.takaNo} received`, receivedAt: at });
    }
    await writeTakaEvents(tx, role, events);
    await recomputeOrdersStatus(tx, role, orderIds);
    return { results, received: results.filter((r) => r.ok).length };
  });
}

/**
 * POST /<kind>/receive/:takaId/undo — back to the kind's sent stage, received fields cleared. Butta: only before the
 * butta QC is done (the taka leaves `butta_qc` then). Mill: always allowed for now (the Mill QC is a later sprint).
 */
export async function undoReceive(kind: ChallanKind, role: RoleKey, takaId: number): Promise<ReceiveResult> {
  const cfg = CHALLAN_KIND_CONFIG[kind];
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: takas.id,
        takaNo: takas.takaNo,
        stage: takas.stage,
        orderId: takas.orderId,
        orderNo: orders.orderNo,
        ctId: challanTakas.id,
        challanId: challanTakas.challanId,
        challanNo: challans.challanNo,
        meters: challanTakas.meters,
      })
      .from(takas)
      .innerJoin(orders, eq(orders.id, takas.orderId))
      .leftJoin(challanTakas, and(eq(challanTakas.takaId, takas.id), eq(challanTakas.kind, kind), eq(challanTakas.isActive, true)))
      .leftJoin(challans, eq(challans.id, challanTakas.challanId))
      .where(and(eq(takas.id, takaId), eq(takas.isDeleted, false)));
    if (!row) throw notFound('Taka');
    if (row.stage !== cfg.receivedStage || row.ctId === null) {
      throw conflict(
        row.stage === cfg.sentStage
          ? `Taka ${row.takaNo} is not received.`
          : kind === 'butta'
            ? `Taka ${row.takaNo} can't be un-received any more: its butta QC is already done.`
            : `Taka ${row.takaNo} can't be un-received any more: it has already moved on.`,
      );
    }
    const moved = await tx
      .update(takas)
      .set({ stage: cfg.sentStage })
      .where(and(eq(takas.id, takaId), eq(takas.stage, cfg.receivedStage)))
      .returning({ id: takas.id });
    if (!moved.length) throw conflict(`Taka ${row.takaNo} was just changed. Refresh and try again.`);
    await tx.update(challanTakas).set({ receivedAt: null, receivedBy: null }).where(eq(challanTakas.id, row.ctId));
    await writeTakaEvents(tx, role, [{ takaId, event: 'receive_undone', challanId: row.challanId, note: row.challanNo ? challanLabel(row.challanNo, kind) : null }]);
    await recomputeOrdersStatus(tx, role, [row.orderId]);
    return {
      takaId,
      takaNo: row.takaNo,
      ok: true,
      code: 'received',
      message: `Taka ${row.takaNo} is back at ${cfg.place}`,
      orderNo: row.orderNo,
      challanId: row.challanId,
      challanNo: row.challanNo,
      challanKind: kind,
      meters: row.meters,
      receivedAt: null,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Order → Docs → Challans                                              */
/* ------------------------------------------------------------------ */

/**
 * GET /orders/:id/challans — every challan (butta AND mill, cancelled ones included) that holds at least one taka of
 * the order, newest first, with this order's share of it. Same visibility rule as the order itself.
 */
export async function listOrderChallans(role: RoleKey, orderId: number): Promise<OrderChallans> {
  const [orderRows, rows] = await db.batch([
    db.select({ id: orders.id, status: orders.status }).from(orders).where(eq(orders.id, orderId)),
    db
      .select({
        id: challans.id,
        kind: challans.kind,
        challanNo: challans.challanNo,
        status: challans.status,
        partyName: partyNameSql,
        challanDate: challans.challanDate,
        orderTakas: sql<number>`COUNT(*)`,
        orderMeters: sql<number>`COALESCE(SUM(${challanTakas.meters}), 0)`,
        totalTakas: totalTakasSql,
        receivedCount: receivedSql,
        createdAt: challans.createdAt,
      })
      .from(challanTakas)
      .innerJoin(challans, eq(challans.id, challanTakas.challanId))
      .where(eq(challanTakas.orderId, orderId))
      .groupBy(challans.id)
      .orderBy(desc(challans.createdAt), desc(challans.id)),
  ]);
  const order = orderRows[0];
  if (!order || !canRoleSeeStatus(role, order.status)) throw notFound('Order');
  return {
    orderId,
    items: rows.map(({ createdAt: _createdAt, ...r }) => ({
      ...r,
      orderTakas: Number(r.orderTakas),
      orderMeters: round2(Number(r.orderMeters)),
      totalTakas: Number(r.totalTakas),
      receivedCount: Number(r.receivedCount),
    })),
  };
}

export type { TakaStage };
