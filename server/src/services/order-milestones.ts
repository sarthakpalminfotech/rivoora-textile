import { and, asc, eq, sql } from 'drizzle-orm';
import { canRoleSeeStatus, type MilestoneLot, type OrderMilestoneInput, type RoleKey } from '@rivoora/shared';
import { db } from '../db/client';
import { challanTakas, challans, designs, dispatchChallans, jobsheets, orders } from '../db/schema';
import { notFound } from '../lib/errors';

/**
 * GET /orders/:id/milestones — the raw times behind the History → Overview timeline (the maths is the shared,
 * pure `orderMilestones`). Same visibility rule as the order itself. Four small queries in one batch:
 * - order + design (does the design go for butta cutting?) + the first "In production" status change (fallback),
 * - the first jobsheet start,
 * - per challan (butta / mill, not cancelled): when it was created and when its takas of this order were received,
 * - the original dispatch challans (revision 0).
 */
export async function getOrderMilestones(role: RoleKey, orderId: number): Promise<OrderMilestoneInput> {
  const [orderRows, startRows, challanRows, dispatchRows] = await db.batch([
    db
      .select({
        id: orders.id,
        status: orders.status,
        createdAt: orders.createdAt,
        buttaCutting: designs.buttaCutting,
        firstInProduction: sql<string | null>`(SELECT MIN(h.changed_at) FROM order_status_history h WHERE h.order_id = ${orders.id} AND h.to_status = 'in_production')`,
      })
      .from(orders)
      .leftJoin(designs, eq(designs.id, orders.designId))
      .where(eq(orders.id, orderId)),
    db
      .select({ at: sql<string | null>`MIN(${jobsheets.startedAt})` })
      .from(jobsheets)
      .where(and(eq(jobsheets.orderId, orderId), eq(jobsheets.isDeleted, false))),
    db
      .select({
        challanId: challans.id,
        kind: challans.kind,
        createdAt: challans.createdAt,
        firstReceived: sql<string | null>`MIN(${challanTakas.receivedAt})`,
        lastReceived: sql<string | null>`MAX(${challanTakas.receivedAt})`,
      })
      .from(challanTakas)
      .innerJoin(challans, eq(challans.id, challanTakas.challanId))
      .where(and(eq(challanTakas.orderId, orderId), eq(challans.status, 'active')))
      .groupBy(challans.id)
      .orderBy(asc(challans.createdAt)),
    db
      .select({ createdAt: dispatchChallans.createdAt })
      .from(dispatchChallans)
      .where(and(eq(dispatchChallans.orderId, orderId), eq(dispatchChallans.revision, 0)))
      .orderBy(asc(dispatchChallans.createdAt)),
  ]);
  const order = orderRows[0];
  if (!order || !canRoleSeeStatus(role, order.status)) throw notFound('Order');

  const lots = {
    butta: { sent: [] as MilestoneLot[], received: [] as MilestoneLot[] },
    mill: { sent: [] as MilestoneLot[], received: [] as MilestoneLot[] },
  };
  for (const c of challanRows) {
    const bucket = lots[c.kind];
    bucket.sent.push({ first: c.createdAt, last: c.createdAt });
    if (c.firstReceived && c.lastReceived) bucket.received.push({ first: c.firstReceived, last: c.lastReceived });
  }
  return {
    createdAt: order.createdAt,
    productionStartedAt: startRows[0]?.at ?? order.firstInProduction,
    buttaApplies: order.buttaCutting ?? true,
    buttaSent: lots.butta.sent,
    buttaReceived: lots.butta.received,
    millSent: lots.mill.sent,
    millReceived: lots.mill.received,
    dispatched: dispatchRows.map((d) => ({ first: d.createdAt, last: d.createdAt })),
  };
}
