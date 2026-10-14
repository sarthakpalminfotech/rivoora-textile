import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import {
  can,
  canMoveTaka,
  canReceiveMovedTakas,
  moveBlockedReason,
  moveTakasSchema,
  takaActualPcs,
  type MarkFreshResult,
  type MoveTakasResult,
  type MoveTarget,
  type OrderStatusKey,
  type RoleKey,
} from '@rivoora/shared';
import { db } from '../db/client';
import { challanTakas, customers, jobsheets, orders, takas } from '../db/schema';
import { conflict, notFound } from '../lib/errors';
import { clearOpenDamages } from './godown';
import { chunk, recomputeOrdersStatus, refreshIsDamaged, writeTakaEvents, type TakaEventInput } from './taka-ops';

/** Move to order (fresh final takas to another order of the same design) and Mark as fresh (inventory). */

const now = () => new Date().toISOString();

/** Same inventory item = same design AND same variation (null = none), pcs unit. */
const sameItem = (a: { designId: number | null; variationId: number | null }, b: { designId: number | null; variationId: number | null }) =>
  a.designId === b.designId && a.variationId === b.variationId;

/** GET /godown/orders/:id/move-targets — orders of the same inventory item that are not fully dispatched. */
export async function getMoveTargets(role: RoleKey, orderId: number): Promise<MoveTarget[]> {
  const [source] = await db
    .select({ designId: orders.designId, variationId: orders.variationId, unit: orders.unit })
    .from(orders)
    .where(eq(orders.id, orderId));
  if (!source) throw notFound('Order');
  if (source.unit !== 'pcs') return [];
  const rows = await db
    .select({
      orderId: orders.id,
      orderNo: orders.orderNo,
      customerName: customers.name,
      orderedPcs: orders.quantity,
      status: orders.status,
      readyPcs: sql<number>`COALESCE((SELECT SUM(COALESCE(t.actual_pcs, t.pcs, 0)) FROM takas t WHERE t.order_id = "orders"."id" AND t.is_deleted = 0 AND t.stage IN ('final', 'ready_dispatch')), 0)`,
    })
    .from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .where(
      and(
        eq(orders.unit, 'pcs'),
        sql`${orders.id} <> ${orderId}`,
        source.designId === null ? sql`${orders.designId} IS NULL` : eq(orders.designId, source.designId),
        source.variationId === null ? sql`${orders.variationId} IS NULL` : eq(orders.variationId, source.variationId),
        notInArray(orders.status, ['pending_production', 'ready_production', 'dispatched']),
      ),
    )
    .orderBy(orders.orderNo);
  const seesClient = can(role, 'canSeeClient');
  return rows.map((r) => ({
    orderId: r.orderId,
    orderNo: r.orderNo,
    customerName: seesClient ? r.customerName : null,
    orderedPcs: r.orderedPcs,
    readyPcs: Number(r.readyPcs),
    status: r.status as OrderStatusKey,
  }));
}

/** POST /godown/takas/move — `{ takaIds, targetOrderId }`. One transaction; both orders' statuses are recomputed. */
export async function moveTakas(role: RoleKey, input: unknown): Promise<MoveTakasResult> {
  const data = moveTakasSchema.parse(input);
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: orders.id, orderNo: orders.orderNo, designId: orders.designId, variationId: orders.variationId, unit: orders.unit, status: orders.status })
      .from(orders)
      .where(eq(orders.id, data.targetOrderId));
    if (!target) throw notFound('Order');
    if (target.unit !== 'pcs' || !canReceiveMovedTakas(target.status)) throw conflict(`Order #${target.orderNo} can't receive takas (it is fully dispatched or not in production).`);

    const rows: {
      id: number;
      takaNo: string;
      orderId: number;
      orderNo: number;
      stage: string;
      isDamaged: boolean;
      checkedAt: string | null;
      pcs: number | null;
      actualPcs: number | null;
      designId: number | null;
      variationId: number | null;
    }[] = [];
    for (const part of chunk(data.takaIds)) {
      rows.push(
        ...(await tx
          .select({
            id: takas.id,
            takaNo: takas.takaNo,
            orderId: takas.orderId,
            orderNo: orders.orderNo,
            stage: takas.stage,
            isDamaged: takas.isDamaged,
            checkedAt: takas.godownCheckedAt,
            pcs: takas.pcs,
            actualPcs: takas.actualPcs,
            designId: orders.designId,
            variationId: orders.variationId,
          })
          .from(takas)
          .innerJoin(jobsheets, eq(jobsheets.id, takas.jobsheetId))
          .innerJoin(orders, eq(orders.id, takas.orderId))
          .where(and(inArray(takas.id, part), eq(takas.isDeleted, false), eq(jobsheets.isDeleted, false)))),
      );
    }
    if (rows.length !== data.takaIds.length) throw conflict('Some takas were changed meanwhile. Refresh and try again.');
    for (const r of rows) {
      const blocked = moveBlockedReason({ stage: r.stage, isDamaged: r.isDamaged, checked: r.checkedAt !== null });
      if (blocked || !canMoveTaka({ stage: r.stage, isDamaged: r.isDamaged, checked: r.checkedAt !== null })) throw conflict(`Taka ${r.takaNo}: ${blocked ?? "can't be moved."}`);
      if (r.orderId === target.id) throw conflict(`Taka ${r.takaNo} is already on Order #${target.orderNo}.`);
      if (!sameItem(r, target)) throw conflict(`Taka ${r.takaNo} is a different design than Order #${target.orderNo}.`);
    }

    const at = now();
    for (const part of chunk(data.takaIds)) {
      const moved = await tx
        .update(takas)
        .set({ orderId: target.id, originOrderId: sql`COALESCE(${takas.originOrderId}, ${takas.orderId})`, updatedAt: at })
        .where(and(inArray(takas.id, part), eq(takas.stage, 'final'), sql`${takas.godownCheckedAt} IS NULL`, eq(takas.isDamaged, false)))
        .returning({ id: takas.id });
      if (moved.length !== part.length) throw conflict('Some takas changed meanwhile. Refresh and try again.');
      // Challan rows carry the order too (butta / mill documents follow the taka).
      await tx.update(challanTakas).set({ orderId: target.id }).where(inArray(challanTakas.takaId, part));
    }
    const events = rows.map(
      (r): TakaEventInput => ({ takaId: r.id, event: 'moved_order', note: `Order #${r.orderNo} → Order #${target.orderNo}` }),
    );
    await writeTakaEvents(tx, role, events);
    const fromIds = [...new Set(rows.map((r) => r.orderId))];
    await recomputeOrdersStatus(tx, role, [...fromIds, target.id]);
    return { moved: rows.length, pcs: rows.reduce((n, r) => n + (takaActualPcs(r) ?? 0), 0), fromOrderIds: fromIds, targetOrderId: target.id };
  });
}

/**
 * POST /inventory/takas/:id/mark-fresh — resolves EVERY open damage of the taka (`resolved_stage = 'inventory'`),
 * recomputes `is_damaged`. Only for stock that is with us: final, ready for dispatch or refinish.
 */
export async function markTakaFresh(role: RoleKey, id: number): Promise<MarkFreshResult> {
  return db.transaction(async (tx) => {
    const [taka] = await tx
      .select({ id: takas.id, takaNo: takas.takaNo, stage: takas.stage, orderId: takas.orderId })
      .from(takas)
      .where(and(eq(takas.id, id), eq(takas.isDeleted, false)));
    if (!taka) throw notFound('Taka');
    if (!['final', 'ready_dispatch', 'refinish'].includes(taka.stage)) throw conflict(`Taka ${taka.takaNo} is not in stock (it can't be marked fresh).`);
    const events = await clearOpenDamages(tx, role, id, undefined, 'inventory', now());
    if (!events.length) throw conflict(`Taka ${taka.takaNo} has no open damage.`);
    await refreshIsDamaged(tx, [id]);
    await writeTakaEvents(tx, role, events);
    return { takaId: id, resolved: events.length };
  });
}
