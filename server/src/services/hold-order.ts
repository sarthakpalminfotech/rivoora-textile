import { and, asc, eq } from 'drizzle-orm';
import { JOBSHEET_STATUS, orderHoldSchema, planHold, type OrderHoldEvent, type RoleKey } from '@rivoora/shared';
import { db } from '../db/client';
import { jobsheetMachines, jobsheets, orderHoldEvents, orders, users } from '../db/schema';
import { currentUserId } from '../lib/request-context';
import { badRequest, conflict, notFound } from '../lib/errors';
import { insertJobsheets, recomputeOrderStatus, writeEvents } from './jobsheets';

/** Hold order actions (Sprint 15). The visibility / write rules live in hold.ts and middleware/hold-guard.ts. */

/* ------------------------------------------------------------------ */
/* hold / release                                                       */
/* ------------------------------------------------------------------ */

export interface HoldResult {
  orderId: number;
  orderNo: number;
  /** Ongoing jobsheets that were completed. */
  completed: number;
  /** New Pending jobsheets for the frames that remained. */
  created: { id: number; jobsheetNo: number; frames: number }[];
}

/**
 * POST /orders/:id/hold — one transaction: every ongoing jobsheet is completed with the frames entered ("completed on
 * hold"), the frames that remain become a new Pending jobsheet (same machines, `parent_jobsheet_id` set), the order is
 * flagged and the status recomputed.
 */
export async function holdOrder(role: RoleKey, orderId: number, input: unknown): Promise<HoldResult> {
  const data = orderHoldSchema.parse(input);
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select({ id: orders.id, orderNo: orders.orderNo, isOnHold: orders.isOnHold })
      .from(orders)
      .where(eq(orders.id, orderId));
    if (!order) throw notFound('Order');
    if (order.isOnHold) throw conflict(`Order #${order.orderNo} is already on hold.`);

    const ongoing = await tx
      .select({ id: jobsheets.id, jobsheetNo: jobsheets.jobsheetNo, frames: jobsheets.frames, runningMachineId: jobsheets.runningMachineId })
      .from(jobsheets)
      .where(and(eq(jobsheets.orderId, orderId), eq(jobsheets.isDeleted, false), eq(jobsheets.status, JOBSHEET_STATUS.ONGOING)))
      .orderBy(asc(jobsheets.jobsheetNo));
    const plan = planHold(ongoing, data.ongoing);
    if (plan.errors.length) throw badRequest(plan.errors[0].message, 'ongoing');

    const at = new Date().toISOString();
    const created: HoldResult['created'] = [];
    for (const c of plan.completions) {
      const js = ongoing.find((j) => j.id === c.jobsheetId)!;
      const done = await tx
        .update(jobsheets)
        .set({ status: JOBSHEET_STATUS.COMPLETED, completedFrames: c.completedFrames, completedAt: at })
        .where(and(eq(jobsheets.id, c.jobsheetId), eq(jobsheets.status, JOBSHEET_STATUS.ONGOING)))
        .returning({ id: jobsheets.id });
      if (!done.length) throw conflict('A jobsheet was just completed by the supervisor. Refresh and try again.');
      await writeEvents(tx, role, [
        { jobsheetId: c.jobsheetId, event: 'completed', machineId: js.runningMachineId, frames: c.completedFrames, note: 'completed on hold' },
      ]);
      if (c.remainingFrames > 0) {
        const machineRows = await tx
          .select({ machineId: jobsheetMachines.machineId })
          .from(jobsheetMachines)
          .where(eq(jobsheetMachines.jobsheetId, c.jobsheetId));
        const [made] = await insertJobsheets(
          tx,
          role,
          orderId,
          [c.remainingFrames],
          machineRows.map((m) => m.machineId),
          {
            parentJobsheetId: c.jobsheetId,
            note: `${c.remainingFrames} frame${c.remainingFrames === 1 ? '' : 's'} left after hold (continued from #${order.orderNo} (${js.jobsheetNo}))`,
          },
        );
        created.push({ id: made.id, jobsheetNo: made.jobsheetNo, frames: made.frames });
      }
    }

    await tx
      .update(orders)
      .set({ isOnHold: true, heldAt: at, heldByUserId: currentUserId(), holdNote: data.note, releasedAt: null })
      .where(eq(orders.id, orderId));
    await tx.insert(orderHoldEvents).values({ orderId, event: 'held', note: data.note, role, userId: currentUserId(), createdAt: at, updatedAt: at });
    await recomputeOrderStatus(orderId, role, tx);
    return { orderId, orderNo: order.orderNo, completed: plan.completions.length, created };
  });
}

/** POST /orders/:id/release — everything becomes visible again and the status is recomputed. */
export async function releaseOrder(role: RoleKey, orderId: number): Promise<{ orderId: number; orderNo: number }> {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select({ id: orders.id, orderNo: orders.orderNo, isOnHold: orders.isOnHold })
      .from(orders)
      .where(eq(orders.id, orderId));
    if (!order) throw notFound('Order');
    if (!order.isOnHold) throw conflict(`Order #${order.orderNo} is not on hold.`);
    const at = new Date().toISOString();
    await tx.update(orders).set({ isOnHold: false, releasedAt: at }).where(eq(orders.id, orderId));
    await tx.insert(orderHoldEvents).values({ orderId, event: 'released', note: null, role, userId: currentUserId(), createdAt: at, updatedAt: at });
    await recomputeOrderStatus(orderId, role, tx);
    return { orderId, orderNo: order.orderNo };
  });
}

/** The History tab entries ("Put on hold" / "Released from hold"), oldest first. */
export async function listHoldEvents(orderId: number): Promise<OrderHoldEvent[]> {
  return db
    .select({
      id: orderHoldEvents.id,
      event: orderHoldEvents.event,
      note: orderHoldEvents.note,
      role: orderHoldEvents.role,
      userName: users.name,
      createdAt: orderHoldEvents.createdAt,
    })
    .from(orderHoldEvents)
    .leftJoin(users, eq(users.id, orderHoldEvents.userId))
    .where(eq(orderHoldEvents.orderId, orderId))
    .orderBy(asc(orderHoldEvents.createdAt), asc(orderHoldEvents.id));
}
