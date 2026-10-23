import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  nextTakaStage,
  orderStepsSchema,
  sameSteps,
  stepsChangeError,
  stepsChangeNote,
  stepUntickLocks,
  type OrderSteps,
  type RoleKey,
  type StepLockFacts,
  type StepLocks,
} from '@rivoora/shared';
import { db, type DbOrTx, type Tx } from '../db/client';
import { jobsheets, orderEvents, orders, outsidePos, takas } from '../db/schema';
import { badRequest, conflict, notFound } from '../lib/errors';
import { currentUserId } from '../lib/request-context';
import { realJobsheet } from './external';
import { takaInOrder } from './free-stock';
import { recomputeOrderStatus } from './jobsheets';
import { chunk, writeTakaEvents, type TakaEventInput } from './taka-ops';

/**
 * Sprint 16 — changing an order's steps after it was created (Jenish, Gaurang: `canEditOrderSteps`).
 * - Unticking a step is blocked once any taka has reached it (Production: once any jobsheet exists) — `stepsChangeError`.
 * - Takas WAITING for a step that is unticked move on by the routing rule (waiting for butta → waiting for the mill or
 *   final; waiting for the mill → final). Ticking a step affects only routing that has not happened yet.
 * - Every change writes a History entry ("Steps changed: Butta removed").
 */

/** The facts behind the untick guards (one batch). */
export async function stepLockFacts(tx: DbOrTx, orderId: number): Promise<StepLockFacts> {
  const inOrder = and(takaInOrder(orderId), eq(takas.isDeleted, false));
  // Sequential on purpose: the same helper runs inside write transactions.
  const js = await tx.select({ n: sql<number>`COUNT(*)` }).from(jobsheets).where(and(eq(jobsheets.orderId, orderId), eq(jobsheets.isDeleted, false), realJobsheet));
  const butta = await tx
    .select({ n: sql<number>`COUNT(*)` })
    .from(takas)
    .where(and(inOrder, sql`(${takas.stage} IN ('at_butta', 'butta_qc', 'rework_butta') OR EXISTS (SELECT 1 FROM challan_takas ct WHERE ct.taka_id = "takas"."id" AND ct.kind = 'butta'))`));
  const mill = await tx
    .select({ n: sql<number>`COUNT(*)` })
    .from(takas)
    .where(and(inOrder, sql`(${takas.stage} IN ('at_mill', 'mill_qc') OR ${takas.hasBeenToMill} = 1 OR EXISTS (SELECT 1 FROM challan_takas ct WHERE ct.taka_id = "takas"."id" AND ct.kind = 'mill'))`));
  const pos = await tx.select({ n: sql<number>`COUNT(*)` }).from(outsidePos).where(and(eq(outsidePos.orderId, orderId), ne(outsidePos.status, 'cancelled')));
  return { jobsheets: Number(js[0]?.n ?? 0), buttaTakas: Number(butta[0]?.n ?? 0), millTakas: Number(mill[0]?.n ?? 0), outsidePos: Number(pos[0]?.n ?? 0) };
}

export async function stepLocksOf(tx: DbOrTx, orderId: number): Promise<StepLocks> {
  return stepUntickLocks(await stepLockFacts(tx, orderId));
}

const FIELD: Record<string, string> = { production: 'hasProduction', butta: 'hasButta', mill: 'hasMill' };

/** Applies a change of steps inside the caller's transaction. Returns false when nothing changed. */
export async function applyStepsChange(tx: Tx, role: RoleKey, orderId: number, before: OrderSteps, after: OrderSteps): Promise<boolean> {
  if (sameSteps(before, after)) return false;
  const err = stepsChangeError(before, after, await stepLockFacts(tx, orderId));
  if (err) throw badRequest(err.message, err.step ? FIELD[err.step] : 'hasProduction');
  await tx.update(orders).set({ hasProduction: after.hasProduction, hasButta: after.hasButta, hasMill: after.hasMill }).where(eq(orders.id, orderId));
  const note = stepsChangeNote(before, after)!;

  // Takas waiting for a step that is no longer ticked move on by the routing rule.
  const events: TakaEventInput[] = [];
  const reroute = async (from: 'entered' | 'waiting_mill', to: string, text: string) => {
    const rows = await tx.select({ id: takas.id }).from(takas).where(and(takaInOrder(orderId), eq(takas.isDeleted, false), eq(takas.stage, from)));
    for (const part of chunk(rows.map((r) => r.id))) {
      await tx
        .update(takas)
        .set({ stage: to as typeof takas.$inferInsert.stage })
        .where(and(inArray(takas.id, part), eq(takas.stage, from)));
    }
    for (const r of rows) events.push({ takaId: r.id, event: 'edited', note: `${note} · ${text}` });
  };
  if (before.hasButta && !after.hasButta) {
    const to = nextTakaStage(after, 'taka_entry');
    await reroute('entered', to, to === 'waiting_mill' ? 'now waiting for the mill' : 'now with the godown (final)');
  }
  if (before.hasMill && !after.hasMill) await reroute('waiting_mill', 'final', 'now with the godown (final)');
  await writeTakaEvents(tx, role, events);

  const at = new Date().toISOString();
  await tx.insert(orderEvents).values({ orderId, event: 'steps_changed', note, role, userId: currentUserId(), createdAt: at, updatedAt: at });
  await recomputeOrderStatus(orderId, role, tx);
  return true;
}

/** PUT /orders/:id/steps */
export async function updateOrderSteps(role: RoleKey, orderId: number, input: unknown): Promise<void> {
  const after = orderStepsSchema.parse(input);
  await db.transaction(async (tx) => {
    const [order] = await tx
      .select({ hasProduction: orders.hasProduction, hasButta: orders.hasButta, hasMill: orders.hasMill, isClosed: orders.isClosed, orderNo: orders.orderNo })
      .from(orders)
      .where(eq(orders.id, orderId));
    if (!order) throw notFound('Order');
    if (order.isClosed) throw conflict(`Order #${order.orderNo} is closed.`);
    await applyStepsChange(tx, role, orderId, order, after);
  });
}
