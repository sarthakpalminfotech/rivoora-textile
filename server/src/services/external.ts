import { and, eq, sql, type SQL } from 'drizzle-orm';
import { externalJobsheetNo, JOBSHEET_STATUS, type OrderSteps, type RoleKey } from '@rivoora/shared';
import type { DbOrTx, Tx } from '../db/client';
import { jobsheets, orders, outsidePos } from '../db/schema';
import { notFound } from '../lib/errors';

/**
 * Sprint 16 — the ONE place for the hidden EXTERNAL jobsheet of an order.
 *
 * `takas.jobsheet_id` is NOT NULL and many queries join takas → jobsheets, so takas received from an outside weaver or
 * bought as finished goods point to one hidden jobsheet per order (`is_external = 1`). Its number is `-orders.id`:
 * unique (the unique index on `jobsheet_no` holds), never in the counter's positive range, never scannable (QR / by-no
 * only take positive numbers), never printed. It is Completed with 0 frames, so it adds nothing to frame / pcs maths.
 *
 * EVERY query that lists or counts jobsheets uses `realJobsheet` (or `j.is_external = 0` in raw SQL); taka queries
 * that join jobsheets only for `is_deleted` keep seeing outside takas.
 */
export const realJobsheet: SQL = eq(jobsheets.isExternal, false);

/** Raw twin for correlated subqueries over a jobsheet alias (e.g. `j`). */
export const realJobsheetRaw = (alias: string): SQL => sql.raw(`${alias}.is_external = 0`);

/** The order's external jobsheet — created on first use (inside the caller's transaction). */
export async function ensureExternalJobsheet(tx: Tx, orderId: number, role: RoleKey): Promise<number> {
  const [found] = await tx
    .select({ id: jobsheets.id })
    .from(jobsheets)
    .where(and(eq(jobsheets.orderId, orderId), eq(jobsheets.isExternal, true)))
    .limit(1);
  if (found) return found.id;
  const at = new Date().toISOString();
  const [row] = await tx
    .insert(jobsheets)
    .values({
      jobsheetNo: externalJobsheetNo(orderId),
      orderId,
      frames: 0,
      completedFrames: 0,
      status: JOBSHEET_STATUS.COMPLETED,
      completedAt: at,
      createdBy: role,
      isExternal: true,
      createdAt: at,
      updatedAt: at,
    })
    .returning({ id: jobsheets.id });
  return row.id;
}

/** The order's steps (+ number, closed flag) — 404 when it doesn't exist. */
export async function loadOrderSteps(tx: DbOrTx, orderId: number): Promise<OrderSteps & { orderNo: number; isClosed: boolean }> {
  const [row] = await tx
    .select({
      orderNo: orders.orderNo,
      hasProduction: orders.hasProduction,
      hasButta: orders.hasButta,
      hasMill: orders.hasMill,
      isClosed: orders.isClosed,
    })
    .from(orders)
    .where(eq(orders.id, orderId));
  if (!row) throw notFound('Order');
  return row;
}

/** Pcs of an order given outside on pcs POs that the jobsheets don't need to cover (shared `outsidePoCommittedPcs`). */
export const outsideCommittedPcsSql = sql<number>`COALESCE((SELECT SUM(CASE WHEN p.status = 'closed' THEN p.received_qty ELSE MAX(p.quantity, p.received_qty) END) FROM outside_pos p WHERE p.order_id = "orders"."id" AND p.unit = 'pcs' AND p.status <> 'cancelled'), 0)`;

/** The committed outside pcs of one order. */
export async function outsideCommittedPcs(tx: DbOrTx, orderId: number): Promise<number> {
  const [row] = await tx
    .select({
      pcs: sql<number>`COALESCE(SUM(CASE WHEN ${outsidePos.status} = 'closed' THEN ${outsidePos.receivedQty} ELSE MAX(${outsidePos.quantity}, ${outsidePos.receivedQty}) END), 0)`,
    })
    .from(outsidePos)
    .where(and(eq(outsidePos.orderId, orderId), eq(outsidePos.unit, 'pcs'), sql`${outsidePos.status} <> 'cancelled'`));
  return Math.round(Number(row?.pcs ?? 0));
}

/** The pcs POs of an order — the "120 pcs given outside (PO-3)" line. */
export async function outsidePcsPos(tx: DbOrTx, orderId: number): Promise<{ poNo: number; pcs: number }[]> {
  const rows = await tx
    .select({ poNo: outsidePos.poNo, quantity: outsidePos.quantity, receivedQty: outsidePos.receivedQty, status: outsidePos.status })
    .from(outsidePos)
    .where(and(eq(outsidePos.orderId, orderId), eq(outsidePos.unit, 'pcs'), sql`${outsidePos.status} <> 'cancelled'`))
    .orderBy(outsidePos.poNo);
  return rows.map((r) => ({ poNo: r.poNo, pcs: Math.round(r.status === 'closed' ? r.receivedQty : Math.max(r.quantity, r.receivedQty)) }));
}

/**
 * Sprint 19: the meter twin of `outsideCommittedPcs` — metres of an order given outside on meter POs that the
 * loom doesn't need to cover. No integer rounding (metres keep 2 decimals).
 */
export async function outsideCommittedMeters(tx: DbOrTx, orderId: number): Promise<number> {
  const [row] = await tx
    .select({
      meters: sql<number>`COALESCE(SUM(CASE WHEN ${outsidePos.status} = 'closed' THEN ${outsidePos.receivedQty} ELSE MAX(${outsidePos.quantity}, ${outsidePos.receivedQty}) END), 0)`,
    })
    .from(outsidePos)
    .where(and(eq(outsidePos.orderId, orderId), eq(outsidePos.unit, 'meters'), sql`${outsidePos.status} <> 'cancelled'`));
  return Math.round(Number(row?.meters ?? 0) * 100) / 100;
}

/** The meter POs of an order — the "120 m given outside (PO-3)" line. */
export async function outsideMetersPos(tx: DbOrTx, orderId: number): Promise<{ poNo: number; meters: number }[]> {
  const rows = await tx
    .select({ poNo: outsidePos.poNo, quantity: outsidePos.quantity, receivedQty: outsidePos.receivedQty, status: outsidePos.status })
    .from(outsidePos)
    .where(and(eq(outsidePos.orderId, orderId), eq(outsidePos.unit, 'meters'), sql`${outsidePos.status} <> 'cancelled'`))
    .orderBy(outsidePos.poNo);
  return rows.map((r) => ({ poNo: r.poNo, meters: Math.round((r.status === 'closed' ? r.receivedQty : Math.max(r.quantity, r.receivedQty)) * 100) / 100 }));
}
