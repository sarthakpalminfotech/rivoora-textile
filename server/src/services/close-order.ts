import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import {
  canRoleSeeStatus,
  closeBlockedMessage,
  closeBlockers,
  freeStockStage,
  isMeterOrder,
  JOBSHEET_STATUS,
  orderCloseSchema,
  takaActualMeters,
  takaActualPcs,
  type CloseBlocker,
  type CloseOrderResult,
  type ClosePreview,
  type RoleKey,
  type TakaStage,
} from '@rivoora/shared';
import { db, type DbOrTx } from '../db/client';
import { jobsheets, orderEvents, orderHoldEvents, orders, outsidePos, takas } from '../db/schema';
import { conflict, notFound } from '../lib/errors';
import { currentUserId } from '../lib/request-context';
import { realJobsheet } from './external';
import { freeStockFields, takaInOrder } from './free-stock';
import { recomputeOrderStatus, writeEvents } from './jobsheets';
import { chunk, recomputeOrdersStatus, writeTakaEvents, type TakaEventInput } from './taka-ops';

/**
 * Sprint 16 / 21 — Close order (Jenish, Gaurang: `canCloseOrder`). Sprint 21 (CR-04): allowed only when nothing of the
 * order is in process (`closeBlockers`: a jobsheet on the loom, takas at butta / mill / in QC / refinish / sent back,
 * an outside PO with goods expected). Held orders can be closed too (the hold ends). One transaction:
 * - Pending jobsheets are cancelled (soft-deleted, with a `cancelled` event — never hard-deleted);
 * - takas WITH US (entered, waiting for the mill, final, ready for dispatch) become free stock (reason `order_closed`);
 * - dispatched takas stay dispatched;
 * - the order gets `is_closed` and the status Closed (it overrides every other status). History: "Order closed".
 * The blockers are checked again inside the transaction (someone may have sent a jobsheet meanwhile) → 409.
 */

/** Stages that never become free stock when the order closes (the rest are blockers or with the client). */
const NOT_WITH_US: TakaStage[] = ['at_butta', 'at_mill', 'dispatched', 'lost'];

async function loadOrder(tx: DbOrTx, role: RoleKey, orderId: number) {
  const [order] = await tx
    .select({ id: orders.id, orderNo: orders.orderNo, status: orders.status, isClosed: orders.isClosed, unit: orders.unit, isOnHold: orders.isOnHold })
    .from(orders)
    .where(eq(orders.id, orderId));
  if (!order || !canRoleSeeStatus(role, order.status)) throw notFound('Order');
  return order;
}

/** What still blocks the close (Sprint 21). */
export async function loadCloseBlockers(tx: DbOrTx, orderId: number): Promise<CloseBlocker[]> {
  const [onLoom, noTakas, byStage, pos] = await Promise.all([
    tx
      .select({ n: sql<number>`COUNT(*)` })
      .from(jobsheets)
      .where(and(eq(jobsheets.orderId, orderId), eq(jobsheets.isDeleted, false), realJobsheet, inArray(jobsheets.status, [JOBSHEET_STATUS.SENT, JOBSHEET_STATUS.ONGOING]))),
    tx
      .select({ n: sql<number>`COUNT(*)` })
      .from(jobsheets)
      .where(
        and(
          eq(jobsheets.orderId, orderId),
          eq(jobsheets.isDeleted, false),
          realJobsheet,
          eq(jobsheets.status, JOBSHEET_STATUS.COMPLETED),
          sql`NOT EXISTS (SELECT 1 FROM takas WHERE takas.jobsheet_id = "jobsheets"."id" AND takas.is_deleted = 0)`,
        ),
      ),
    tx
      .select({ stage: takas.stage, n: sql<number>`COUNT(*)` })
      .from(takas)
      .where(and(takaInOrder(orderId), eq(takas.isDeleted, false)))
      .groupBy(takas.stage),
    tx
      .select({ n: sql<number>`COUNT(*)` })
      .from(outsidePos)
      .where(and(eq(outsidePos.orderId, orderId), inArray(outsidePos.status, ['open', 'partly_received']))),
  ]);
  const takasByStage: Partial<Record<TakaStage, number>> = {};
  for (const r of byStage) takasByStage[r.stage] = Number(r.n);
  return closeBlockers({
    orderId,
    jobsheetsOnLoom: Number(onLoom[0]?.n ?? 0),
    completedWithoutTakas: Number(noTakas[0]?.n ?? 0),
    takasByStage,
    openOutsidePos: Number(pos[0]?.n ?? 0),
  });
}

/** GET /orders/:id/close-preview — the blockers, or what Close order will do (the dialog's summary). */
export async function closePreview(role: RoleKey, orderId: number): Promise<ClosePreview> {
  await loadOrder(db, role, orderId);
  const blockers = await loadCloseBlockers(db, orderId);
  const [pending, withUs, dispatched] = await db.batch([
    db
      .select({ n: sql<number>`COUNT(*)` })
      .from(jobsheets)
      .where(and(eq(jobsheets.orderId, orderId), eq(jobsheets.isDeleted, false), realJobsheet, eq(jobsheets.status, JOBSHEET_STATUS.PENDING))),
    db
      .select({
        n: sql<number>`COUNT(*)`,
        pcs: sql<number>`COALESCE(SUM(COALESCE(${takas.actualPcs}, ${takas.pcs}, 0)), 0)`,
        meters: sql<number>`COALESCE(SUM(COALESCE(${takas.actualMeters}, ${takas.meters}, 0)), 0)`,
      })
      .from(takas)
      .where(and(takaInOrder(orderId), eq(takas.isDeleted, false), notInArray(takas.stage, NOT_WITH_US))),
    db
      .select({ n: sql<number>`COUNT(*)` })
      .from(takas)
      .where(and(takaInOrder(orderId), eq(takas.isDeleted, false), eq(takas.stage, 'dispatched'))),
  ]);
  return {
    blockers,
    pendingJobsheets: Number(pending[0]?.n ?? 0),
    freeTakas: Number(withUs[0]?.n ?? 0),
    freePcs: Number(withUs[0]?.pcs ?? 0),
    freeMeters: Number(withUs[0]?.meters ?? 0),
    dispatchedTakas: Number(dispatched[0]?.n ?? 0),
  };
}

/** POST /orders/:id/close */
export async function closeOrder(role: RoleKey, orderId: number, input: unknown): Promise<CloseOrderResult> {
  const data = orderCloseSchema.parse(input ?? {});
  return db.transaction(async (tx) => {
    const order = await loadOrder(tx, role, orderId);
    if (order.isClosed) throw conflict(`Order #${order.orderNo} is already closed.`);
    const at = new Date().toISOString();
    const meterOrder = isMeterOrder(order);

    // 1 — the order must be clear (checked again inside the transaction).
    const blockers = await loadCloseBlockers(tx, orderId);
    if (blockers.length) throw conflict(closeBlockedMessage(blockers));

    // 2 — Pending jobsheets are cancelled (soft delete + event).
    const cancelled = await tx
      .update(jobsheets)
      .set({ isDeleted: true, updatedAt: at })
      .where(and(eq(jobsheets.orderId, orderId), eq(jobsheets.isDeleted, false), realJobsheet, eq(jobsheets.status, JOBSHEET_STATUS.PENDING)))
      .returning({ id: jobsheets.id });
    await writeEvents(tx, role, cancelled.map((j) => ({ jobsheetId: j.id, event: 'cancelled' as const, note: 'cancelled — order closed' })));

    // 3 — a held order is released by the close.
    if (order.isOnHold) {
      await tx.update(orders).set({ isOnHold: false, releasedAt: at }).where(eq(orders.id, orderId));
      await tx.insert(orderHoldEvents).values({ orderId, event: 'released', note: 'released — order closed', role, userId: currentUserId(), createdAt: at, updatedAt: at });
    }

    // 4 — takas with us (not dispatched) become free stock.
    const withUs = await tx
      .select({ id: takas.id, stage: takas.stage, pcs: takas.pcs, actualPcs: takas.actualPcs, meters: takas.meters, actualMeters: takas.actualMeters, orderId: takas.orderId })
      .from(takas)
      .where(and(takaInOrder(orderId), eq(takas.isDeleted, false), notInArray(takas.stage, NOT_WITH_US)));
    const byStage = new Map<TakaStage, number[]>();
    for (const t of withUs) byStage.set(t.stage, [...(byStage.get(t.stage) ?? []), t.id]);
    for (const [stage, ids] of byStage) {
      for (const part of chunk(ids)) {
        const moved = await tx
          .update(takas)
          .set({
            stage: freeStockStage(stage) as TakaStage,
            godownCheckedAt: null,
            godownCheckedBy: null,
            updatedAt: at,
            ...freeStockFields(role, at, 'order_closed'),
          })
          .where(and(inArray(takas.id, part), eq(takas.stage, stage), eq(takas.isFreeStock, false)))
          .returning({ id: takas.id });
        if (moved.length !== part.length) throw conflict('Some takas changed meanwhile. Refresh and try again.');
      }
    }
    const events: TakaEventInput[] = withUs.map((t) => ({
      takaId: t.id,
      event: 'moved_to_inventory',
      note: `Order #${order.orderNo} closed → free stock${t.stage === 'ready_dispatch' ? ' · back to final' : ''}`,
    }));
    await writeTakaEvents(tx, role, events);

    // 5 — the order itself.
    await tx.update(orders).set({ isClosed: true, closedAt: at, closedByUserId: currentUserId(), closeNote: data.note }).where(eq(orders.id, orderId));
    const freePcs = withUs.reduce((s, t) => s + (takaActualPcs(t) ?? 0), 0);
    const freeMeters = withUs.reduce((s, t) => s + (takaActualMeters(t) ?? 0), 0);
    const summary = [
      cancelled.length && `${cancelled.length} cancelled`,
      withUs.length && `${withUs.length} taka${withUs.length === 1 ? '' : 's'} (${meterOrder ? `${freeMeters} m` : `${freePcs} pcs`}) to free stock`,
      data.note,
    ]
      .filter(Boolean)
      .join(' · ');
    await tx.insert(orderEvents).values({ orderId, event: 'order_closed', note: summary || null, role, userId: currentUserId(), createdAt: at, updatedAt: at });
    await recomputeOrderStatus(orderId, role, tx);
    // The origin orders of takas that were allocated here (they don't count there, but the rule recomputes both).
    await recomputeOrdersStatus(tx, role, [...new Set(withUs.map((t) => t.orderId))].filter((id) => id !== orderId));
    return {
      orderId,
      orderNo: order.orderNo,
      cancelled: cancelled.length,
      freeTakas: withUs.length,
      freePcs,
      freeMeters,
    };
  });
}
