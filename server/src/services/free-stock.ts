import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { FreeStockReason, RoleKey } from '@rivoora/shared';
import { takas } from '../db/schema';

/**
 * Sprint 13 — THE rule for "which order does a taka count for" (SQL twin of `effectiveOrderId` in shared/freeStock.ts):
 * a taka counts for its order only while it is NOT free stock, and then for the order it was allocated to, else its
 * origin order (`takas.order_id`). Every order-level query uses one of the fragments below.
 */

/** Drizzle: the order a taka counts for (use in joins: `eq(orders.id, takaOrderId)`). Null while free stock — pair with `takaNotFree`. */
export const takaOrderId = sql<number>`COALESCE(${takas.allocatedOrderId}, ${takas.orderId})`;

/** Drizzle: the taka is not free stock. */
export const takaNotFree = eq(takas.isFreeStock, false);

/** Drizzle: the taka counts for exactly this order (not free stock, allocated to it or made for it). */
export const takaInOrder = (orderId: number): SQL => and(takaNotFree, sql`COALESCE(${takas.allocatedOrderId}, ${takas.orderId}) = ${orderId}`)!;

/** Drizzle: the taka is free stock. */
export const takaIsFree = eq(takas.isFreeStock, true);

/**
 * Raw SQL for correlated subqueries: the taka alias `t` counts for the order column `orderCol`
 * (e.g. `"orders"."id"`). Both arguments are code constants, never user input.
 */
export const takaInOrderRaw = (alias: string, orderCol: string): SQL =>
  sql.raw(`${alias}.is_free_stock = 0 AND COALESCE(${alias}.allocated_order_id, ${alias}.order_id) = ${orderCol}`);

/** The columns that turn a taka into free stock (its `order_id` stays the origin order; an allocation is dropped). */
export const freeStockFields = (role: RoleKey, at: string, reason: FreeStockReason) =>
  ({ isFreeStock: true, freeStockAt: at, freeStockBy: role, freeStockReason: reason, allocatedOrderId: null }) as const;
