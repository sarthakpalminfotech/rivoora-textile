import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { orderOnHoldMessage, seesHeldOrders, type RoleKey } from '@rivoora/shared';
import type { DbOrTx } from '../db/client';
import { orders, takas } from '../db/schema';
import { conflict, notFound } from '../lib/errors';
import { takaOrderId } from './free-stock';

/**
 * Hold order (Sprint 15). ONE place for the rules:
 *  - READS: every role except Jenish / Gaurang has a held order hidden — list queries add `orderNotHeldFor(role)`
 *    (the query must join `orders`), detail reads go through `assertNotHeldFor` / `assertOrderVisibleFor` / the read
 *    guard in `middleware/hold-guard.ts`.
 *  - WRITES: the hold guard middleware answers 409 "Order #26 is on hold" for every write on a held order. The only
 *    exceptions are the receive endpoints and Jenish's release.
 */

/** List queries: leave out held orders for the roles that must not see them. Needs `orders` in the query. */
export const orderNotHeldFor = (role: RoleKey): SQL | undefined => (seesHeldOrders(role) ? undefined : eq(orders.isOnHold, false));

/** Raw twin for correlated subqueries: `orderCol` is a code constant such as `"orders"."id"`. */
export const orderNotHeldRaw = (role: RoleKey, orderCol: string): SQL | undefined =>
  seesHeldOrders(role) ? undefined : sql.raw(`NOT EXISTS (SELECT 1 FROM orders ho WHERE ho.id = ${orderCol} AND ho.is_on_hold = 1)`);

/** List queries over takas (no `orders` join): leave out takas that count for a held order (free stock is never held). */
export const takaNotHeldFor = (role: RoleKey): SQL | undefined =>
  seesHeldOrders(role)
    ? undefined
    : sql`NOT EXISTS (SELECT 1 FROM orders ho WHERE ho.id = ${takaOrderId} AND ho.is_on_hold = 1 AND ${takas.isFreeStock} = 0)`;

/** Taka-level condition for every role: the taka does not count for a held order (nothing new can be sent for those). */
export const takaOrderNotHeld = sql`NOT EXISTS (SELECT 1 FROM orders ho WHERE ho.id = ${takaOrderId} AND ho.is_on_hold = 1 AND ${takas.isFreeStock} = 0)`;

/** Throws 409 "Order #26 is on hold" when any of the orders is held. */
export async function assertOrdersNotOnHold(tx: DbOrTx, orderIds: readonly number[], role?: RoleKey): Promise<void> {
  const ids = [...new Set(orderIds)];
  if (ids.length === 0) return;
  const rows = await tx
    .select({ orderNo: orders.orderNo })
    .from(orders)
    .where(and(inArray(orders.id, ids), eq(orders.isOnHold, true)))
    .orderBy(asc(orders.orderNo))
    .limit(1);
  if (rows.length) throw conflict(orderOnHoldMessage(rows[0].orderNo, role));
}

/** For a role that must not see held orders: 409 with the (bilingual for QC / Taka entry) hold message. */
export function assertNotHeldFor(role: RoleKey, order: { orderNo: number; isOnHold: boolean }): void {
  if (order.isOnHold && !seesHeldOrders(role)) throw conflict(orderOnHoldMessage(order.orderNo, role));
}

/** 404 for a role that must not see held orders (order-level screens: Orders, Godown, Dispatched). */
export function assertOrderVisibleFor(role: RoleKey, order: { isOnHold: boolean } | undefined): void {
  if (order?.isOnHold && !seesHeldOrders(role)) throw notFound('Order');
}
