import { and, asc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import {
  canRoleSeeStatus,
  freeStockStage,
  JOBSHEET_STATUS,
  orderCloseSchema,
  planHold,
  takaActualPcs,
  type CloseOrderResult,
  type ClosePreview,
  type RoleKey,
  type TakaStage,
} from '@rivoora/shared';
import { db, type DbOrTx } from '../db/client';
import { jobsheets, machines, orderEvents, orders, outsidePos, takas } from '../db/schema';
import { badRequest, conflict, notFound } from '../lib/errors';
import { currentUserId } from '../lib/request-context';
import { realJobsheet } from './external';
import { freeStockFields, takaInOrder } from './free-stock';
import { recomputeOrderStatus, writeEvents } from './jobsheets';
import { closeOpenPosOfOrder } from './outside';
import { chunk, recomputeOrdersStatus, writeTakaEvents, type TakaEventInput } from './taka-ops';

/**
 * Sprint 16 — Close order (Jenish, Gaurang: `canCloseOrder`), any order, any time. One transaction:
 * - jobsheets on the loom are completed with the frames entered (no remaining-frames jobsheet);
 * - Pending / Sent jobsheets are cancelled (soft-deleted, with a `cancelled` event — never hard-deleted);
 * - open outside POs are closed;
 * - takas WITH US that are not dispatched become free stock (reason `order_closed`); takas at butta cutting / the mill
 *   stay and become free stock when they come back (receive / QC);
 * - the order gets `is_closed` and the status Closed (it overrides every other status). History: "Order closed".
 * Afterwards the hold guard blocks every write on it except receiving.
 */

/** Stages a taka can't be freed from while the order closes: out at a party, or already with the client. */
const NOT_WITH_US: TakaStage[] = ['at_butta', 'at_mill', 'dispatched'];

async function loadOrder(tx: DbOrTx, role: RoleKey, orderId: number) {
  const [order] = await tx
    .select({ id: orders.id, orderNo: orders.orderNo, status: orders.status, isClosed: orders.isClosed })
    .from(orders)
    .where(eq(orders.id, orderId));
  if (!order || !canRoleSeeStatus(role, order.status)) throw notFound('Order');
  return order;
}

const ongoingOf = (tx: DbOrTx, orderId: number) =>
  tx
    .select({ id: jobsheets.id, jobsheetNo: jobsheets.jobsheetNo, frames: jobsheets.frames, runningMachineId: jobsheets.runningMachineId, machineNo: machines.machineNo })
    .from(jobsheets)
    .leftJoin(machines, eq(machines.id, jobsheets.runningMachineId))
    .where(and(eq(jobsheets.orderId, orderId), eq(jobsheets.isDeleted, false), realJobsheet, eq(jobsheets.status, JOBSHEET_STATUS.ONGOING)))
    .orderBy(asc(jobsheets.jobsheetNo));

/** GET /orders/:id/close-preview — what Close order will do (the confirm dialog's summary). */
export async function closePreview(role: RoleKey, orderId: number): Promise<ClosePreview> {
  await loadOrder(db, role, orderId);
  const [ongoing, pending, pos, withUs, out, dispatched] = await db.batch([
    ongoingOf(db, orderId),
    db
      .select({ n: sql<number>`COUNT(*)` })
      .from(jobsheets)
      .where(and(eq(jobsheets.orderId, orderId), eq(jobsheets.isDeleted, false), realJobsheet, inArray(jobsheets.status, [JOBSHEET_STATUS.PENDING, JOBSHEET_STATUS.SENT]))),
    db
      .select({ n: sql<number>`COUNT(*)` })
      .from(outsidePos)
      .where(and(eq(outsidePos.orderId, orderId), inArray(outsidePos.status, ['open', 'partly_received']))),
    db
      .select({ n: sql<number>`COUNT(*)`, pcs: sql<number>`COALESCE(SUM(COALESCE(${takas.actualPcs}, ${takas.pcs}, 0)), 0)` })
      .from(takas)
      .where(and(takaInOrder(orderId), eq(takas.isDeleted, false), notInArray(takas.stage, NOT_WITH_US))),
    db
      .select({ n: sql<number>`COUNT(*)` })
      .from(takas)
      .where(and(takaInOrder(orderId), eq(takas.isDeleted, false), inArray(takas.stage, ['at_butta', 'at_mill']))),
    db
      .select({ n: sql<number>`COUNT(*)` })
      .from(takas)
      .where(and(takaInOrder(orderId), eq(takas.isDeleted, false), eq(takas.stage, 'dispatched'))),
  ]);
  return {
    ongoing: ongoing.map((j) => ({ id: j.id, jobsheetNo: j.jobsheetNo, frames: j.frames, machineNo: j.machineNo })),
    pendingJobsheets: Number(pending[0]?.n ?? 0),
    openPos: Number(pos[0]?.n ?? 0),
    freeTakas: Number(withUs[0]?.n ?? 0),
    freePcs: Number(withUs[0]?.pcs ?? 0),
    outTakas: Number(out[0]?.n ?? 0),
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

    // 1 — jobsheets on the loom: completed with the frames entered (the Hold dialog's rule), nothing remaining.
    const ongoing = await ongoingOf(tx, orderId);
    const plan = planHold(ongoing, data.ongoing);
    if (plan.errors.length) throw badRequest(plan.errors[0].message, 'ongoing');
    for (const c of plan.completions) {
      const js = ongoing.find((j) => j.id === c.jobsheetId)!;
      const done = await tx
        .update(jobsheets)
        .set({ status: JOBSHEET_STATUS.COMPLETED, completedFrames: c.completedFrames, completedAt: at })
        .where(and(eq(jobsheets.id, c.jobsheetId), eq(jobsheets.status, JOBSHEET_STATUS.ONGOING)))
        .returning({ id: jobsheets.id });
      if (!done.length) throw conflict('A jobsheet was just completed by the supervisor. Refresh and try again.');
      await writeEvents(tx, role, [{ jobsheetId: c.jobsheetId, event: 'completed', machineId: js.runningMachineId, frames: c.completedFrames, note: 'completed — order closed' }]);
    }

    // 2 — Pending / Sent jobsheets are cancelled (soft delete + event).
    const cancelled = await tx
      .update(jobsheets)
      .set({ isDeleted: true, updatedAt: at })
      .where(and(eq(jobsheets.orderId, orderId), eq(jobsheets.isDeleted, false), realJobsheet, inArray(jobsheets.status, [JOBSHEET_STATUS.PENDING, JOBSHEET_STATUS.SENT])))
      .returning({ id: jobsheets.id });
    await writeEvents(tx, role, cancelled.map((j) => ({ jobsheetId: j.id, event: 'cancelled' as const, note: 'cancelled — order closed' })));

    // 3 — open outside POs are closed.
    const closedPos = await closeOpenPosOfOrder(tx, orderId, at);

    // 4 — takas with us (not out at a party, not dispatched) become free stock.
    const withUs = await tx
      .select({ id: takas.id, stage: takas.stage, pcs: takas.pcs, actualPcs: takas.actualPcs, orderId: takas.orderId })
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
    const outTakas = await tx
      .select({ n: sql<number>`COUNT(*)` })
      .from(takas)
      .where(and(takaInOrder(orderId), eq(takas.isDeleted, false), inArray(takas.stage, ['at_butta', 'at_mill'])));

    // 5 — the order itself.
    await tx.update(orders).set({ isClosed: true, closedAt: at, closedByUserId: currentUserId(), closeNote: data.note }).where(eq(orders.id, orderId));
    const freePcs = withUs.reduce((s, t) => s + (takaActualPcs(t) ?? 0), 0);
    const summary = [
      plan.completions.length && `${plan.completions.length} jobsheet${plan.completions.length === 1 ? '' : 's'} completed`,
      cancelled.length && `${cancelled.length} cancelled`,
      closedPos && `${closedPos} PO${closedPos === 1 ? '' : 's'} closed`,
      withUs.length && `${withUs.length} taka${withUs.length === 1 ? '' : 's'} (${freePcs} pcs) to free stock`,
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
      completed: plan.completions.length,
      cancelled: cancelled.length,
      closedPos,
      freeTakas: withUs.length,
      freePcs,
      outTakas: Number(outTakas[0]?.n ?? 0),
    };
  });
}
