import { and, eq } from 'drizzle-orm';
import { canRoleSeeStatus, orderShrinkage, type OrderShrinkage, type RoleKey } from '@rivoora/shared';
import { db } from '../db/client';
import { orders, takas } from '../db/schema';
import { notFound } from '../lib/errors';
import { takaInOrder } from './free-stock';

/** GET /orders/:id/shrinkage (Sprint 21, CR-08) — expected vs actual metres of the order's takas. */
export async function getOrderShrinkage(role: RoleKey, orderId: number): Promise<OrderShrinkage> {
  const [order] = await db.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId));
  if (!order || !canRoleSeeStatus(role, order.status)) throw notFound('Order');
  const rows = await db
    .select({ meters: takas.meters, actualMeters: takas.actualMeters })
    .from(takas)
    .where(and(takaInOrder(orderId), eq(takas.isDeleted, false)));
  return orderShrinkage(rows);
}
