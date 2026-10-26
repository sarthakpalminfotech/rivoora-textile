import { and, asc, desc, eq, inArray, notInArray, or, sql, type SQL } from 'drizzle-orm';
import {
  can,
  canRoleSeeStatus,
  fgReceiptSchema,
  FG_TAKA_PREFIX,
  isReadyOrLater,
  orderKind,
  OUTSIDE_PO_COUNTER,
  OUTSIDE_ROW_ERROR_TEXT,
  outsidePoInputSchema,
  outsidePoTotals,
  outsideReceiptSchema,
  outsideTakaNumber,
  poCanEdit,
  poIsOpen,
  poLabel,
  poPendingQty,
  poStatusFor,
  receiptLabel,
  receivedLot,
  receivedQtyOf,
  validateOutsideRows,
  type DamageRecordedAt,
  type OrderOutside,
  type OrderSteps,
  type OutsidePoCard,
  type OutsidePoPrintData,
  type OutsidePoTotals,
  type OutsideReceiptRow,
  type ReceiptFormData,
  type ReceiptResult,
  type ReceiptRow,
  type ReceiveGoodsData,
  type RoleKey,
  type TakaEventKind,
  type TakaSource,
  type TakaStage,
} from '@rivoora/shared';
import { db, type DbOrTx, type Tx } from '../db/client';
import { counters, designs, materials, orders, outsidePos, outsideReceipts, takas, weavers } from '../db/schema';
import { badRequest, conflict, notFound } from '../lib/errors';
import { currentUserId } from '../lib/request-context';
import { likePattern } from '../lib/http';
import { ensureExternalJobsheet } from './external';
import { recomputeOrderStatus } from './jobsheets';
import { orderNotHeldFor } from './hold';
import { addNewDamages, assertNewDamages, type NewDamageInput } from './qc-shared';
import { allocateTakaNumbers, chunk, initialStageForOrder, refreshIsDamaged, usedMessage, usedTakaNumbers, writeTakaEvents, type TakaEventInput } from './taka-ops';

/**
 * Sprint 16 â€” outside production and direct FG purchases.
 * - POs to outside weavers (PO-n): create / edit / cancel (while nothing came) / close / print.
 * - Receipts: an outside weaver's challan against a PO, or an FG supplier's challan for a direct FG purchase. The takas
 *   go on the order's hidden EXTERNAL jobsheet (`ensureExternalJobsheet`), start at the stage the ONE routing rule gives
 *   (`nextTakaStage`) and are numbered by `outsideTakaNumber` (ours when typed, else code + the weaver's number).
 * - Receive goods: the open POs + FG orders for the godown supervisor and Dhruvil (never a client / rate for them).
 * Every write is one transaction and ends with the order status recompute.
 */

const now = () => new Date().toISOString();
const round2 = (n: number) => Math.round(n * 100) / 100;

const designCodeSql = sql<string | null>`${designs.code}`;
const designThumbSql = sql<string | null>`${designs.thumbUrl}`;

/* ------------------------------------------------------------------ */
/* PO rows                                                              */
/* ------------------------------------------------------------------ */

const poColumns = {
  id: outsidePos.id,
  poNo: outsidePos.poNo,
  orderId: outsidePos.orderId,
  orderNo: orders.orderNo,
  weaverId: weavers.id,
  weaverName: weavers.name,
  weaverCode: weavers.shortCode,
  materialId: materials.id,
  materialName: materials.name,
  quantity: outsidePos.quantity,
  unit: outsidePos.unit,
  orderType: outsidePos.orderType,
  rate: outsidePos.rate,
  poDate: outsidePos.poDate,
  notes: outsidePos.notes,
  status: outsidePos.status,
  receivedQty: outsidePos.receivedQty,
  receivedTakas: outsidePos.receivedTakas,
  createdAt: outsidePos.createdAt,
};

type PoRow = {
  id: number;
  poNo: number;
  orderId: number;
  orderNo: number;
  weaverId: number;
  weaverName: string;
  weaverCode: string;
  materialId: number;
  materialName: string;
  quantity: number;
  unit: OutsidePoCard['unit'];
  orderType: OutsidePoCard['orderType'];
  rate: number | null;
  poDate: string;
  notes: string | null;
  status: OutsidePoCard['status'];
  receivedQty: number;
  receivedTakas: number;
  createdAt: string;
};

const poFrom = (tx: DbOrTx) =>
  tx
    .select(poColumns)
    .from(outsidePos)
    .innerJoin(orders, eq(orders.id, outsidePos.orderId))
    .innerJoin(weavers, eq(weavers.id, outsidePos.weaverId))
    .innerJoin(materials, eq(materials.id, outsidePos.materialId));

function toCard(r: PoRow, role: RoleKey): OutsidePoCard {
  return {
    id: r.id,
    poNo: r.poNo,
    label: poLabel(r.poNo),
    orderId: r.orderId,
    orderNo: r.orderNo,
    weaver: { id: r.weaverId, name: r.weaverName, shortCode: r.weaverCode },
    quality: { id: r.materialId, name: r.materialName },
    quantity: r.quantity,
    unit: r.unit,
    orderType: r.orderType,
    rate: can(role, 'canSeeRate') ? r.rate : null,
    poDate: r.poDate,
    notes: r.notes,
    status: r.status,
    receivedQty: round2(r.receivedQty),
    receivedTakas: r.receivedTakas,
    pendingQty: poPendingQty(r),
    canEdit: poCanEdit(r),
    createdAt: r.createdAt,
  };
}

async function loadPo(tx: DbOrTx, id: number): Promise<PoRow> {
  const [row] = await poFrom(tx).where(eq(outsidePos.id, id));
  if (!row) throw notFound('PO');
  return row;
}

/* ------------------------------------------------------------------ */
/* orders                                                               */
/* ------------------------------------------------------------------ */

interface OrderRow extends OrderSteps {
  id: number;
  orderNo: number;
  status: string;
  orderType: 'lump' | 'pcs_to_pcs';
  unit: string;
  quantity: number;
  isClosed: boolean;
  isOnHold: boolean;
  materialId: number;
}

async function loadOrder(tx: DbOrTx, orderId: number): Promise<OrderRow> {
  const [row] = await tx
    .select({
      id: orders.id,
      orderNo: orders.orderNo,
      status: orders.status,
      orderType: orders.orderType,
      unit: orders.unit,
      quantity: orders.quantity,
      isClosed: orders.isClosed,
      isOnHold: orders.isOnHold,
      materialId: orders.materialId,
      hasProduction: orders.hasProduction,
      hasButta: orders.hasButta,
      hasMill: orders.hasMill,
    })
    .from(orders)
    .where(eq(orders.id, orderId));
  if (!row) throw notFound('Order');
  return row;
}

/** An order that can get a PO: visible, sent for production, not closed, and not a direct FG purchase. */
async function loadOrderForPo(tx: DbOrTx, role: RoleKey, orderId: number): Promise<OrderRow> {
  const order = await loadOrder(tx, orderId);
  if (!canRoleSeeStatus(role, order.status)) throw notFound('Order');
  if (order.isClosed) throw conflict(`Order #${order.orderNo} is closed.`);
  if (!isReadyOrLater(order.status)) throw conflict('Send the order for production first â€” then POs can be given to outside weavers.');
  if (orderKind(order) === 'fg_purchase') throw conflict('A direct FG purchase has no POs. Tick Butta cutting, Mill or Production on the order first.');
  return order;
}

async function assertWeaver(tx: DbOrTx, weaverId: number) {
  const [w] = await tx.select({ id: weavers.id }).from(weavers).where(and(eq(weavers.id, weaverId), eq(weavers.isDeleted, false)));
  if (!w) throw badRequest('This weaver no longer exists. Pick it again.', 'weaverId');
}

async function assertMaterial(tx: DbOrTx, materialId: number) {
  const [m] = await tx.select({ id: materials.id }).from(materials).where(and(eq(materials.id, materialId), eq(materials.isDeleted, false)));
  if (!m) throw badRequest('This quality no longer exists. Pick it again.', 'materialId');
}

async function allocatePoNo(tx: Tx): Promise<number> {
  const [row] = await tx
    .insert(counters)
    .values({ name: OUTSIDE_PO_COUNTER, value: 1 })
    .onConflictDoUpdate({ target: counters.name, set: { value: sql`${counters.value} + 1` } })
    .returning({ value: counters.value });
  return row.value;
}

/* ------------------------------------------------------------------ */
/* PO writes                                                            */
/* ------------------------------------------------------------------ */

/** POST /orders/:id/outside-pos */
export async function createOutsidePo(role: RoleKey, orderId: number, input: unknown): Promise<OutsidePoCard> {
  const data = outsidePoInputSchema.parse(input);
  const id = await db.transaction(async (tx) => {
    await loadOrderForPo(tx, role, orderId);
    await assertWeaver(tx, data.weaverId);
    await assertMaterial(tx, data.materialId);
    const poNo = await allocatePoNo(tx);
    const at = now();
    const [row] = await tx
      .insert(outsidePos)
      .values({
        poNo,
        orderId,
        weaverId: data.weaverId,
        materialId: data.materialId,
        quantity: data.quantity,
        unit: data.unit,
        orderType: data.orderType,
        rate: can(role, 'canSeeRate') ? data.rate : null,
        poDate: data.poDate,
        notes: data.notes,
        createdBy: role,
        createdByUserId: currentUserId(),
        createdAt: at,
        updatedAt: at,
      })
      .returning({ id: outsidePos.id });
    await recomputeOrderStatus(orderId, role, tx);
    return row.id;
  });
  return toCard(await loadPo(db, id), role);
}

/** PUT /outside-pos/:id â€” only while nothing has been received. */
export async function updateOutsidePo(role: RoleKey, id: number, input: unknown): Promise<OutsidePoCard> {
  const data = outsidePoInputSchema.parse(input);
  await db.transaction(async (tx) => {
    const po = await loadPo(tx, id);
    await loadOrderForPo(tx, role, po.orderId);
    if (!poCanEdit(po)) throw conflict(`${poLabel(po.poNo)} can't be changed any more â€” goods were already received on it (or it is closed).`);
    await assertWeaver(tx, data.weaverId);
    await assertMaterial(tx, data.materialId);
    const done = await tx
      .update(outsidePos)
      .set({
        weaverId: data.weaverId,
        materialId: data.materialId,
        quantity: data.quantity,
        unit: data.unit,
        orderType: data.orderType,
        rate: can(role, 'canSeeRate') ? data.rate : po.rate,
        poDate: data.poDate,
        notes: data.notes,
        updatedAt: now(),
      })
      .where(and(eq(outsidePos.id, id), eq(outsidePos.status, 'open'), eq(outsidePos.receivedTakas, 0)))
      .returning({ id: outsidePos.id });
    if (!done.length) throw conflict(`${poLabel(po.poNo)} was just changed. Refresh and try again.`);
    await recomputeOrderStatus(po.orderId, role, tx);
  });
  return toCard(await loadPo(db, id), role);
}

/** POST /outside-pos/:id/cancel â€” only while nothing has been received (the number is never reused). */
export async function cancelOutsidePo(role: RoleKey, id: number): Promise<OutsidePoCard> {
  await db.transaction(async (tx) => {
    const po = await loadPo(tx, id);
    const order = await loadOrder(tx, po.orderId);
    if (!canRoleSeeStatus(role, order.status)) throw notFound('PO');
    if (!poCanEdit(po)) throw conflict(`${poLabel(po.poNo)} can't be cancelled â€” goods were already received on it (or it is closed). Close it instead.`);
    const done = await tx
      .update(outsidePos)
      .set({ status: 'cancelled', cancelledAt: now(), updatedAt: now() })
      .where(and(eq(outsidePos.id, id), eq(outsidePos.status, 'open'), eq(outsidePos.receivedTakas, 0)))
      .returning({ id: outsidePos.id });
    if (!done.length) throw conflict(`${poLabel(po.poNo)} was just changed. Refresh and try again.`);
    await recomputeOrderStatus(po.orderId, role, tx);
  });
  return toCard(await loadPo(db, id), role);
}

/** POST /outside-pos/:id/close â€” by hand (Jenish / Gaurang): nothing more is expected on it. */
export async function closeOutsidePo(role: RoleKey, id: number): Promise<OutsidePoCard> {
  await db.transaction(async (tx) => {
    const po = await loadPo(tx, id);
    const order = await loadOrder(tx, po.orderId);
    if (!canRoleSeeStatus(role, order.status)) throw notFound('PO');
    if (!poIsOpen(po.status)) throw conflict(`${poLabel(po.poNo)} is already ${po.status === 'received' ? 'fully received' : po.status}.`);
    await tx
      .update(outsidePos)
      .set({ status: 'closed', closedAt: now(), closedByUserId: currentUserId(), closeReason: 'manual', updatedAt: now() })
      .where(eq(outsidePos.id, id));
    await recomputeOrderStatus(po.orderId, role, tx);
  });
  return toCard(await loadPo(db, id), role);
}

/** Close every open PO of an order (Close order). Returns how many. */
export async function closeOpenPosOfOrder(tx: Tx, orderId: number, at: string): Promise<number> {
  const done = await tx
    .update(outsidePos)
    .set({ status: 'closed', closedAt: at, closedByUserId: currentUserId(), closeReason: 'order_closed', updatedAt: at })
    .where(and(eq(outsidePos.orderId, orderId), inArray(outsidePos.status, ['open', 'partly_received'])))
    .returning({ id: outsidePos.id });
  return done.length;
}

/* ------------------------------------------------------------------ */
/* PO reads                                                             */
/* ------------------------------------------------------------------ */

export async function getOutsidePo(role: RoleKey, id: number): Promise<OutsidePoCard> {
  return toCard(await loadPo(db, id), role);
}

/** GET /outside-pos/:id/print */
export async function getOutsidePoPrint(role: RoleKey, id: number): Promise<OutsidePoPrintData> {
  const [row] = await db
    .select({
      poNo: outsidePos.poNo,
      poDate: outsidePos.poDate,
      status: outsidePos.status,
      quantity: outsidePos.quantity,
      unit: outsidePos.unit,
      orderType: outsidePos.orderType,
      rate: outsidePos.rate,
      notes: outsidePos.notes,
      weaverName: weavers.name,
      weaverAddress: weavers.address,
      weaverMobile: weavers.mobile,
      weaverGstin: weavers.gstin,
      quality: materials.name,
      orderNo: orders.orderNo,
      designCode: designCodeSql,
      blouseOption: orders.blouseOption,
    })
    .from(outsidePos)
    .innerJoin(orders, eq(orders.id, outsidePos.orderId))
    .innerJoin(weavers, eq(weavers.id, outsidePos.weaverId))
    .innerJoin(materials, eq(materials.id, outsidePos.materialId))
    .leftJoin(designs, eq(designs.id, orders.designId))
    .where(eq(outsidePos.id, id));
  if (!row) throw notFound('PO');
  return {
    poNo: row.poNo,
    label: poLabel(row.poNo),
    poDate: row.poDate,
    status: row.status,
    weaver: { name: row.weaverName, address: row.weaverAddress, mobile: row.weaverMobile, gstin: row.weaverGstin },
    quality: row.quality,
    quantity: row.quantity,
    unit: row.unit,
    orderType: row.orderType,
    rate: can(role, 'canSeeRate') ? row.rate : null,
    notes: row.notes,
    orderNo: row.orderNo,
    designCode: row.designCode,
    blouseOption: row.blouseOption,
  };
}

const receiptColumns = {
  id: outsideReceipts.id,
  kind: outsideReceipts.kind,
  challanNo: outsideReceipts.challanNo,
  receiptDate: outsideReceipts.receiptDate,
  poId: outsideReceipts.poId,
  poNo: outsidePos.poNo,
  weaverName: weavers.name,
  supplierName: outsideReceipts.supplierName,
  takas: outsideReceipts.takas,
  pcs: outsideReceipts.pcs,
  meters: outsideReceipts.meters,
  damagedPcs: outsideReceipts.damagedPcs,
  notes: outsideReceipts.notes,
  createdAt: outsideReceipts.createdAt,
};

async function receiptsOfOrder(tx: DbOrTx, orderId: number): Promise<OutsideReceiptRow[]> {
  const rows = await tx
    .select(receiptColumns)
    .from(outsideReceipts)
    .leftJoin(outsidePos, eq(outsidePos.id, outsideReceipts.poId))
    .leftJoin(weavers, eq(weavers.id, outsideReceipts.weaverId))
    .where(eq(outsideReceipts.orderId, orderId))
    .orderBy(desc(outsideReceipts.createdAt), desc(outsideReceipts.id));
  return rows.map(({ weaverName, supplierName, ...r }) => ({ ...r, meters: round2(r.meters), partyName: weaverName ?? supplierName }));
}

/** GET /orders/:id/outside-pos â€” the order's Outside production / Purchase tab. */
export async function listOrderOutside(role: RoleKey, orderId: number): Promise<OrderOutside> {
  const order = await loadOrder(db, orderId);
  if (!canRoleSeeStatus(role, order.status)) throw notFound('Order');
  const [pos, receipts] = await Promise.all([poFrom(db).where(eq(outsidePos.orderId, orderId)).orderBy(desc(outsidePos.poNo)), receiptsOfOrder(db, orderId)]);
  const cards = pos.map((p) => toCard(p, role));
  return { orderId, orderNo: order.orderNo, kind: orderKind(order), totals: outsidePoTotals(cards), pos: cards, receipts };
}

/** The order's Docs â†’ POs + receipts (also the godown supervisor's read-only Docs; rate only with `canSeeRate`). */
export async function listOrderDocsOutside(role: RoleKey, orderId: number): Promise<{ pos: OutsidePoCard[]; receipts: OutsideReceiptRow[] }> {
  const [pos, receipts] = await Promise.all([
    poFrom(db).where(and(eq(outsidePos.orderId, orderId), sql`${outsidePos.status} <> 'cancelled'`)).orderBy(desc(outsidePos.poNo)),
    receiptsOfOrder(db, orderId),
  ]);
  return { pos: pos.map((p) => toCard(p, role)), receipts };
}

/** The open POs of an order (the dashboard's "At outside weaver" / "Given outside" drawer). */
export async function openPosOfOrder(role: RoleKey, orderId: number): Promise<OutsidePoCard[]> {
  const rows = await poFrom(db).where(and(eq(outsidePos.orderId, orderId), inArray(outsidePos.status, ['open', 'partly_received']))).orderBy(asc(outsidePos.poNo));
  return rows.map((p) => toCard(p, role));
}

/** PO totals per order (dashboard / inventory): one query for all the orders. */
export async function outsideTotalsByOrder(tx: DbOrTx, orderIds: readonly number[]): Promise<Map<number, OutsidePoTotals>> {
  const out = new Map<number, OutsidePoTotals>();
  if (!orderIds.length) return out;
  const rows: { orderId: number; unit: string; quantity: number; receivedQty: number; receivedTakas: number; status: string }[] = [];
  for (const part of chunk([...new Set(orderIds)])) {
    rows.push(
      ...(await tx
        .select({ orderId: outsidePos.orderId, unit: outsidePos.unit, quantity: outsidePos.quantity, receivedQty: outsidePos.receivedQty, receivedTakas: outsidePos.receivedTakas, status: outsidePos.status })
        .from(outsidePos)
        .where(inArray(outsidePos.orderId, part))),
    );
  }
  const byOrder = new Map<number, typeof rows>();
  for (const r of rows) byOrder.set(r.orderId, [...(byOrder.get(r.orderId) ?? []), r]);
  for (const [id, list] of byOrder) out.set(id, outsidePoTotals(list));
  return out;
}

/* ------------------------------------------------------------------ */
/* receipt forms                                                        */
/* ------------------------------------------------------------------ */

async function formOrderInfo(tx: DbOrTx, orderId: number) {
  const [row] = await tx
    .select({
      orderId: orders.id,
      orderNo: orders.orderNo,
      orderType: orders.orderType,
      quality: materials.name,
      designCode: designCodeSql,
      thumbUrl: designThumbSql,
      blouseOption: orders.blouseOption,
      hasProduction: orders.hasProduction,
      hasButta: orders.hasButta,
      hasMill: orders.hasMill,
    })
    .from(orders)
    .innerJoin(materials, eq(materials.id, orders.materialId))
    .leftJoin(designs, eq(designs.id, orders.designId))
    .where(eq(orders.id, orderId));
  if (!row) throw notFound('Order');
  const { hasProduction, hasButta, hasMill, ...rest } = row;
  return { ...rest, orderSteps: { hasProduction, hasButta, hasMill } };
}

/** GET /outside-pos/:id/receipt-form */
export async function receiptFormForPo(role: RoleKey, poId: number): Promise<ReceiptFormData> {
  const po = await loadPo(db, poId);
  return { kind: 'outside_po', ...(await formOrderInfo(db, po.orderId)), po: toCard(po, role), prefix: po.weaverCode };
}

/** GET /orders/:id/fg-receipt-form */
export async function receiptFormForFg(role: RoleKey, orderId: number): Promise<ReceiptFormData> {
  void role;
  return { kind: 'fg', ...(await formOrderInfo(db, orderId)), po: null, prefix: FG_TAKA_PREFIX };
}

/* ------------------------------------------------------------------ */
/* receipts                                                             */
/* ------------------------------------------------------------------ */

interface ReceiveContext {
  orderId: number;
  orderNo: number;
  receiptId: number;
  /** Prefix of takas received without our number: the weaver's code / FG. */
  prefix: string;
  weaverId: number | null;
  source: TakaSource;
  stage: TakaStage;
  recordedAt: DamageRecordedAt;
  event: TakaEventKind;
  label: string;
}

/**
 * Checks and saves the takas of a receipt (outside weaver or FG lump): weaver numbers unique per weaver, the system
 * number (ours, else prefix + weaver number) unique system-wide, damages within the pcs. On the external jobsheet.
 */
async function saveReceivedTakas(tx: Tx, role: RoleKey, ctx: ReceiveContext, rows: ReceiptRow[], at: string) {
  const parsed = rows.map((r) => ({ ...r, weaverTakaNo: r.weaverTakaNo.trim(), ourTakaNo: r.ourTakaNo?.trim() || null }));
  // Weaver numbers already used by this weaver (the same weaver can't send 1101 twice).
  const usedWeaverNos = new Set<string>();
  if (ctx.weaverId !== null) {
    for (const part of chunk(parsed.map((r) => r.weaverTakaNo))) {
      const found = await tx
        .select({ no: takas.weaverTakaNo })
        .from(takas)
        .where(and(eq(takas.weaverId, ctx.weaverId), eq(takas.isDeleted, false), inArray(takas.weaverTakaNo, part)));
      for (const f of found) if (f.no) usedWeaverNos.add(f.no);
    }
  }
  const systemNos = parsed.map((r) => outsideTakaNumber(ctx.prefix, r.weaverTakaNo, r.ourTakaNo));
  const used = await usedTakaNumbers(tx, systemNos);
  const errors = validateOutsideRows(parsed, ctx.prefix, { usedWeaverNos, usedSystemNos: new Set(used.keys()) });
  const bad = errors.findIndex((e) => e !== null);
  if (bad >= 0) {
    const err = errors[bad]!;
    // A used system number is fixed by typing OUR number for the taka — point the form at that column.
    const field = err.startsWith('own') || err === 'system_used' ? 'ourTakaNo' : 'weaverTakaNo';
    const message =
      err === 'system_used'
        ? `${usedMessage(systemNos[bad], used.get(systemNos[bad]))}${parsed[bad].ourTakaNo ? '' : ' â€” type our number for this taka'}`
        : `Taka ${parsed[bad].weaverTakaNo || bad + 1}: ${OUTSIDE_ROW_ERROR_TEXT[err]}`;
    throw badRequest(message, `rows.${bad}.${field}`);
  }
  parsed.forEach((r, i) => assertNewDamages(r.damages as NewDamageInput[], r.pcs, `rows.${i}.damages`));

  const jobsheetId = await ensureExternalJobsheet(tx, ctx.orderId, role);
  const inserted: { id: number; takaNo: string; weaverTakaNo: string | null; pcs: number | null }[] = [];
  for (const part of chunk(parsed.map((r, i) => ({ r, takaNo: systemNos[i] })), 100)) {
    inserted.push(
      ...(await tx
        .insert(takas)
        .values(
          part.map(({ r, takaNo }) => ({
            jobsheetId,
            orderId: ctx.orderId,
            takaNo,
            meters: r.meters ?? null,
            pcs: r.pcs,
            isDamaged: r.damages.length > 0,
            stage: ctx.stage,
            source: ctx.source,
            weaverTakaNo: r.weaverTakaNo,
            weaverId: ctx.weaverId,
            hasOwnNumber: !!r.ourTakaNo,
            outsideReceiptId: ctx.receiptId,
            enteredBy: role,
            createdAt: at,
            updatedAt: at,
          })),
        )
        .returning({ id: takas.id, takaNo: takas.takaNo, weaverTakaNo: takas.weaverTakaNo, pcs: takas.pcs })),
    );
  }
  const idByNo = new Map(inserted.map((t) => [t.takaNo, t.id]));
  const events: TakaEventInput[] = inserted.map((t) => ({ takaId: t.id, event: ctx.event, note: ctx.label }));
  for (const [i, r] of parsed.entries()) {
    if (!r.damages.length) continue;
    events.push(...(await addNewDamages(tx, role, idByNo.get(systemNos[i])!, r.damages as NewDamageInput[], ctx.recordedAt, at, `rows.${i}.damages`)));
  }
  await refreshIsDamaged(tx, inserted.map((t) => t.id));
  await writeTakaEvents(tx, role, events);
  return { inserted, rows: parsed };
}

async function insertReceipt(
  tx: Tx,
  role: RoleKey,
  values: { kind: 'outside_po' | 'fg'; poId: number | null; orderId: number; weaverId: number | null; supplierName: string | null; challanNo: string; receiptDate: string; notes: string | null },
  at: string,
): Promise<number> {
  const [row] = await tx
    .insert(outsideReceipts)
    .values({ ...values, createdBy: role, createdByUserId: currentUserId(), createdAt: at, updatedAt: at })
    .returning({ id: outsideReceipts.id });
  return row.id;
}

async function finishReceipt(tx: Tx, receiptId: number, takaRows: { pcs: number | null; meters?: number | null; damages?: { pcs: number }[] }[], damagedPcs?: number) {
  await tx
    .update(outsideReceipts)
    .set({
      takas: takaRows.length,
      pcs: takaRows.reduce((s, t) => s + (t.pcs ?? 0), 0),
      meters: round2(takaRows.reduce((s, t) => s + (t.meters ?? 0), 0)),
      damagedPcs: damagedPcs ?? takaRows.reduce((s, t) => s + (t.damages ?? []).reduce((n, d) => n + d.pcs, 0), 0),
    })
    .where(eq(outsideReceipts.id, receiptId));
}

/**
 * After Edit takas of a receipt: its totals from its active takas, and its PO's received quantity (all receipts of the
 * PO) + status. A closed / cancelled PO keeps its status.
 */
export async function refreshReceiptTotals(tx: Tx, receiptId: number): Promise<void> {
  const [r] = await tx.select({ poId: outsideReceipts.poId }).from(outsideReceipts).where(eq(outsideReceipts.id, receiptId));
  if (!r) return;
  const live = await tx
    .select({ pcs: takas.pcs, meters: takas.meters })
    .from(takas)
    .where(and(eq(takas.outsideReceiptId, receiptId), eq(takas.isDeleted, false)));
  await tx
    .update(outsideReceipts)
    .set({ takas: live.length, pcs: live.reduce((s, t) => s + (t.pcs ?? 0), 0), meters: round2(live.reduce((s, t) => s + (t.meters ?? 0), 0)), updatedAt: now() })
    .where(eq(outsideReceipts.id, receiptId));
  if (r.poId === null) return;
  const po = await loadPo(tx, r.poId);
  const all = await tx
    .select({ pcs: takas.pcs, meters: takas.meters })
    .from(takas)
    .innerJoin(outsideReceipts, eq(outsideReceipts.id, takas.outsideReceiptId))
    .where(and(eq(outsideReceipts.poId, r.poId), eq(takas.isDeleted, false)));
  const receivedQty = receivedQtyOf(po.unit, all);
  await tx
    .update(outsidePos)
    .set({ receivedQty, receivedTakas: all.length, status: poStatusFor({ status: po.status === 'received' ? 'partly_received' : po.status, quantity: po.quantity, receivedQty }), updatedAt: now() })
    .where(eq(outsidePos.id, r.poId));
}

/** POST /outside-pos/:id/receipts â€” an outside weaver's challan against an open PO. */
export async function createOutsideReceipt(role: RoleKey, poId: number, input: unknown): Promise<ReceiptResult> {
  const data = outsideReceiptSchema.parse(input);
  return db.transaction(async (tx) => {
    const po = await loadPo(tx, poId);
    const order = await loadOrder(tx, po.orderId);
    if (order.isClosed) throw conflict(`Order #${order.orderNo} is closed.`);
    if (!poIsOpen(po.status)) throw conflict(`${poLabel(po.poNo)} is ${po.status === 'received' ? 'fully received' : po.status} â€” nothing more can be received on it.`);
    const at = now();
    const receiptId = await insertReceipt(
      tx,
      role,
      { kind: 'outside_po', poId, orderId: po.orderId, weaverId: po.weaverId, supplierName: null, challanNo: data.challanNo, receiptDate: data.date, notes: data.notes },
      at,
    );
    const stage = await initialStageForOrder(tx, po.orderId, 'outside_receipt');
    const { inserted, rows } = await saveReceivedTakas(
      tx,
      role,
      {
        orderId: po.orderId,
        orderNo: order.orderNo,
        receiptId,
        prefix: po.weaverCode,
        weaverId: po.weaverId,
        source: 'outside_po',
        stage,
        recordedAt: 'outside_receipt',
        event: 'received_outside',
        label: `${receiptLabel({ challanNo: data.challanNo, poNo: po.poNo })} Â· ${po.weaverName}`,
      },
      data.rows,
      at,
    );
    await finishReceipt(tx, receiptId, rows);
    // The PO: what came (in its own unit) and its status.
    const receivedQty = round2(po.receivedQty + receivedQtyOf(po.unit, rows));
    await tx
      .update(outsidePos)
      .set({
        receivedQty,
        receivedTakas: po.receivedTakas + rows.length,
        status: poStatusFor({ status: po.status, quantity: po.quantity, receivedQty }),
        updatedAt: at,
      })
      .where(eq(outsidePos.id, poId));
    await recomputeOrderStatus(po.orderId, role, tx);
    return {
      receiptId,
      orderId: po.orderId,
      orderNo: order.orderNo,
      takas: inserted,
      pcs: rows.reduce((s, r) => s + r.pcs, 0),
      meters: round2(rows.reduce((s, r) => s + (r.meters ?? 0), 0)),
    };
  });
}

/**
 * POST /orders/:id/fg-receipts â€” a direct FG purchase. Lump: taka rows (FG + the supplier's number unless ours is typed).
 * Pcs to pcs: only the received pcs â†’ one "Received lot" taka (our next number). Everything goes to `final` (Dhruvil).
 */
export async function createFgReceipt(role: RoleKey, orderId: number, input: unknown): Promise<ReceiptResult> {
  const data = fgReceiptSchema.parse(input);
  return db.transaction(async (tx) => {
    const order = await loadOrder(tx, orderId);
    if (order.isClosed) throw conflict(`Order #${order.orderNo} is closed.`);
    if (orderKind(order) !== 'fg_purchase') throw conflict(`Order #${order.orderNo} is not a direct FG purchase â€” receive its goods on a PO.`);
    if (!isReadyOrLater(order.status)) throw conflict('Send the order for production first â€” then its goods can be received.');
    const lump = 'rows' in data;
    if (lump && order.orderType !== 'lump') throw badRequest('This order is pcs to pcs â€” enter the received pcs.');
    if (!lump && order.orderType === 'lump') throw badRequest('This is a lump order â€” enter the takas.');
    const at = now();
    const receiptId = await insertReceipt(
      tx,
      role,
      { kind: 'fg', poId: null, orderId, weaverId: null, supplierName: data.supplierName, challanNo: data.challanNo, receiptDate: data.date, notes: data.notes },
      at,
    );
    const label = `${receiptLabel({ challanNo: data.challanNo, supplierName: data.supplierName })} Â· FG purchase`;
    if ('rows' in data) {
      const { inserted, rows } = await saveReceivedTakas(
        tx,
        role,
        { orderId, orderNo: order.orderNo, receiptId, prefix: FG_TAKA_PREFIX, weaverId: null, source: 'fg_purchase', stage: 'final', recordedAt: 'fg_receipt', event: 'received_fg', label },
        data.rows,
        at,
      );
      await finishReceipt(tx, receiptId, rows);
      await recomputeOrderStatus(orderId, role, tx);
      return { receiptId, orderId, orderNo: order.orderNo, takas: inserted, pcs: rows.reduce((s, r) => s + r.pcs, 0), meters: round2(rows.reduce((s, r) => s + (r.meters ?? 0), 0)) };
    }
    // Pcs to pcs: one received lot.
    const lot = receivedLot(data.pcs, data.damagedPcs);
    if (lot.damagedPcs > 0 && !data.damage) throw badRequest('Pick the damage for the damaged pcs.', 'damage');
    const jobsheetId = await ensureExternalJobsheet(tx, orderId, role);
    const [no] = await allocateTakaNumbers(tx, 1);
    const [taka] = await tx
      .insert(takas)
      .values({
        jobsheetId,
        orderId,
        takaNo: no,
        pcs: lot.pcs,
        stage: 'final',
        source: 'fg_purchase',
        isReceivedLot: true,
        hasOwnNumber: true,
        outsideReceiptId: receiptId,
        enteredBy: role,
        createdAt: at,
        updatedAt: at,
      })
      .returning({ id: takas.id, takaNo: takas.takaNo, weaverTakaNo: takas.weaverTakaNo, pcs: takas.pcs });
    const events: TakaEventInput[] = [{ takaId: taka.id, event: 'received_fg', note: `${label} Â· received lot Â· ${lot.pcs} pcs` }];
    if (lot.damagedPcs > 0 && data.damage) {
      const damage = { ...(data.damage as NewDamageInput), pcs: lot.damagedPcs };
      assertNewDamages([damage], lot.pcs, 'damage');
      events.push(...(await addNewDamages(tx, role, taka.id, [damage], 'fg_receipt', at, 'damage')));
      await refreshIsDamaged(tx, [taka.id]);
    }
    await writeTakaEvents(tx, role, events);
    await finishReceipt(tx, receiptId, [{ pcs: lot.pcs, meters: null }], lot.damagedPcs);
    await recomputeOrderStatus(orderId, role, tx);
    return { receiptId, orderId, orderNo: order.orderNo, takas: [taka], pcs: lot.pcs, meters: 0 };
  });
}

/* ------------------------------------------------------------------ */
/* Receive goods module                                                 */
/* ------------------------------------------------------------------ */

const FG_KIND = and(eq(orders.hasProduction, false), eq(orders.hasButta, false), eq(orders.hasMill, false));

/**
 * GET /receive-goods?search= â€” the open POs and the FG orders still waiting for (more) goods. Closed and (for roles that
 * don't see them) held orders are left out; the godown supervisor never gets the client or a rate.
 */
export async function listReceiveGoods(role: RoleKey, search?: string): Promise<ReceiveGoodsData> {
  const term = search?.replace(/^#/, '').trim();
  const p = term ? likePattern(term) : null;
  const num = term && /^\d+$/.test(term) ? Number(term) : -1;
  const poNo = term ? Number(/^(?:po[\s-]*)?(\d+)$/i.exec(term)?.[1] ?? -1) : -1;
  const poSearch: SQL | undefined = p
    ? or(eq(outsidePos.poNo, poNo), eq(orders.orderNo, num), sql`${weavers.name} LIKE ${p} ESCAPE '\\'`, sql`${designCodeSql} LIKE ${p} ESCAPE '\\'`)
    : undefined;
  const fgSearch: SQL | undefined = p ? or(eq(orders.orderNo, num), sql`${designCodeSql} LIKE ${p} ESCAPE '\\'`) : undefined;
  const [poRows, fgRows] = await db.batch([
    db
      .select({ ...poColumns, designCode: designCodeSql, thumbUrl: designThumbSql, blouseOption: orders.blouseOption })
      .from(outsidePos)
      .innerJoin(orders, eq(orders.id, outsidePos.orderId))
      .innerJoin(weavers, eq(weavers.id, outsidePos.weaverId))
      .innerJoin(materials, eq(materials.id, outsidePos.materialId))
      .leftJoin(designs, eq(designs.id, orders.designId))
      .where(and(inArray(outsidePos.status, ['open', 'partly_received']), eq(orders.isClosed, false), orderNotHeldFor(role), poSearch))
      .orderBy(asc(outsidePos.poNo))
      .limit(200),
    db
      .select({
        orderId: orders.id,
        orderNo: orders.orderNo,
        orderType: orders.orderType,
        quantity: orders.quantity,
        unit: orders.unit,
        quality: materials.name,
        designCode: designCodeSql,
        thumbUrl: designThumbSql,
        blouseOption: orders.blouseOption,
        customerName: sql<string>`(SELECT c.name FROM customers c WHERE c.id = "orders"."customer_id")`,
        receivedTakas: sql<number>`COALESCE((SELECT SUM(r.takas) FROM outside_receipts r WHERE r.order_id = "orders"."id"), 0)`,
        receivedPcs: sql<number>`COALESCE((SELECT SUM(r.pcs) FROM outside_receipts r WHERE r.order_id = "orders"."id"), 0)`,
      })
      .from(orders)
      .innerJoin(materials, eq(materials.id, orders.materialId))
      .leftJoin(designs, eq(designs.id, orders.designId))
      .where(
        and(
          FG_KIND,
          eq(orders.isClosed, false),
          notInArray(orders.status, ['pending_production', 'partly_dispatched', 'dispatched', 'returned', 'closed']),
          orderNotHeldFor(role),
          fgSearch,
        ),
      )
      .orderBy(asc(orders.orderNo))
      .limit(200),
  ]);
  const seesClient = can(role, 'canSeeClient');
  return {
    pos: poRows.map(({ designCode, thumbUrl, blouseOption, ...r }) => ({ ...toCard(r, role), designCode, thumbUrl, blouseOption })),
    fgOrders: fgRows.map((r) => ({
      ...r,
      customerName: seesClient ? r.customerName : null,
      receivedTakas: Number(r.receivedTakas),
      receivedPcs: Number(r.receivedPcs),
    })),
  };
}
