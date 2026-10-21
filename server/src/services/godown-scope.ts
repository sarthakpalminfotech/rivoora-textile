import { and, eq, inArray, sql } from 'drizzle-orm';
import { can, TAKA_STAGES, type RoleKey } from '@rivoora/shared';
import { db } from '../db/client';
import { takas } from '../db/schema';
import { takaInOrder } from './free-stock';

/**
 * Sprint 15 — the godown supervisor's read-only Orders module. He sees the orders that have at least one taka at the
 * butta stage or later (`entered` = waiting for butta, rework_butta, at_butta, butta_qc, waiting_mill, at_mill, mill_qc,
 * refinish, final, ready_dispatch, dispatched) — never an order that is still only in production — and never the
 * client, broker, phone or rate. This is the ONE definition; the list query, the detail guard and the dashboard use it.
 */

/** The taka stages that put an order in his module (every stage a taka can be in once it exists). */
export const GODOWN_ORDER_STAGES = TAKA_STAGES;

/** True for the role that only gets the limited module (Jenish / Gaurang have the full Orders). */
export const isGodownOrdersOnly = (role: RoleKey): boolean => can(role, 'canViewGodownOrders') && !can(role, 'canViewOrders');

const stageList = sql.raw(GODOWN_ORDER_STAGES.map((s) => `'${s}'`).join(', '));

/** Drizzle condition on a query over `orders`: it has an active taka (not free stock) at the butta stage or later. */
export const orderHasGodownTakas = sql`EXISTS (SELECT 1 FROM takas gt WHERE gt.is_deleted = 0 AND gt.is_free_stock = 0 AND COALESCE(gt.allocated_order_id, gt.order_id) = "orders"."id" AND gt.stage IN (${stageList}))`;

/** Does this order qualify (detail reads)? */
export async function orderInGodownScope(orderId: number): Promise<boolean> {
  const rows = await db
    .select({ id: takas.id })
    .from(takas)
    .where(and(takaInOrder(orderId), eq(takas.isDeleted, false), inArray(takas.stage, [...GODOWN_ORDER_STAGES])))
    .limit(1);
  return rows.length > 0;
}
