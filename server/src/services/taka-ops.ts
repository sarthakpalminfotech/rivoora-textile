import { and, eq, inArray, sql } from 'drizzle-orm';
import { currentUserId } from '../lib/request-context';
import {
  nextTakaStage,
  jobsheetRefShort,
  takaUsedText,
  TAKA_NO_START,
  type DamageRecordedAt,
  type DamageType,
  type RoleKey,
  type TakaEventKind,
  type TakaStage,
} from '@rivoora/shared';
import type { DbOrTx, Tx } from '../db/client';
import { counters, jobsheets, orders, takaDamages, takaEvents, takas } from '../db/schema';
import { badRequest } from '../lib/errors';
import { resolveDamage } from './damages';
import { recomputeOrderStatus } from './jobsheets';

/** Helpers shared by every taka write: where a taka starts, global number uniqueness, damages, history. */

const nowIso = () => new Date().toISOString();

/** Chunks a list so `IN (…)` stays well below SQLite's variable limit. */
export function chunk<T>(list: readonly T[], size = 400): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * The stage a new taka of this order starts in — Sprint 16: the ORDER's steps decide (`nextTakaStage`; the design only
 * pre-filled the Butta tick when the order was made). Existing orders were backfilled with the design's setting.
 */
export async function initialStageForOrder(tx: DbOrTx, orderId: number, from: 'taka_entry' | 'outside_receipt' | 'fg_receipt' = 'taka_entry'): Promise<TakaStage> {
  const [row] = await tx.select({ hasButta: orders.hasButta, hasMill: orders.hasMill }).from(orders).where(eq(orders.id, orderId));
  return nextTakaStage({ hasButta: row?.hasButta ?? true, hasMill: row?.hasMill ?? true }, from);
}

/** The steps of the order a taka counts for (its origin order while free stock) — the routing at QC uses them. */
export async function stepsOfTakaOrder(tx: DbOrTx, takaId: number): Promise<{ hasButta: boolean; hasMill: boolean; isClosed: boolean; orderNo: number }> {
  const [row] = await tx
    .select({ hasButta: orders.hasButta, hasMill: orders.hasMill, isClosed: orders.isClosed, orderNo: orders.orderNo })
    .from(takas)
    .innerJoin(orders, eq(orders.id, sql`COALESCE(${takas.allocatedOrderId}, ${takas.orderId})`))
    .where(eq(takas.id, takaId));
  return row ?? { hasButta: true, hasMill: true, isClosed: false, orderNo: 0 };
}

/**
 * Sprint 16 (Close order): takas of a CLOSED order that come back from butta cutting / the mill (receive or QC) become
 * free stock (reason `order_closed`) instead of going back to the order. Adds a `moved_to_inventory` event per taka.
 */
export async function freeTakasOfClosedOrders(tx: Tx, role: RoleKey, takaIds: readonly number[], at: string, events: TakaEventInput[]): Promise<number[]> {
  const ids = [...new Set(takaIds)];
  if (!ids.length) return [];
  const rows = await tx
    .select({ id: takas.id, orderNo: orders.orderNo })
    .from(takas)
    .innerJoin(orders, eq(orders.id, sql`COALESCE(${takas.allocatedOrderId}, ${takas.orderId})`))
    .where(and(inArray(takas.id, ids), eq(takas.isFreeStock, false), eq(orders.isClosed, true)));
  if (!rows.length) return [];
  await tx
    .update(takas)
    .set({ isFreeStock: true, freeStockAt: at, freeStockBy: role, freeStockReason: 'order_closed', allocatedOrderId: null, godownCheckedAt: null, godownCheckedBy: null })
    .where(inArray(takas.id, rows.map((r) => r.id)));
  for (const r of rows) events.push({ takaId: r.id, event: 'moved_to_inventory', note: `Order #${r.orderNo} is closed → free stock` });
  return rows.map((r) => r.id);
}

/**
 * Where each of these taka numbers is used right now (active takas anywhere): number → "#26 (319)" (order number
 * first). `exceptTakaIds` are takas that are part of the same write (an edit may swap / free their numbers).
 */
export async function usedTakaNumbers(tx: DbOrTx, numbers: readonly string[], exceptTakaIds: readonly number[] = []): Promise<Map<string, string>> {
  const used = new Map<string, string>();
  const except = new Set(exceptTakaIds);
  for (const part of chunk([...new Set(numbers.filter(Boolean))])) {
    const rows = await tx
      .select({ id: takas.id, takaNo: takas.takaNo, orderNo: orders.orderNo, jobsheetNo: jobsheets.jobsheetNo })
      .from(takas)
      .innerJoin(jobsheets, eq(jobsheets.id, takas.jobsheetId))
      .innerJoin(orders, eq(orders.id, takas.orderId))
      .where(and(eq(takas.isDeleted, false), inArray(takas.takaNo, part)));
    for (const r of rows) if (!except.has(r.id)) used.set(r.takaNo, jobsheetRefShort(r.orderNo, r.jobsheetNo));
  }
  return used;
}

const TAKA_COUNTER = 'taka_no';

/**
 * Reserves `n` system-generated taka numbers (11, 12, 13 … never reused) inside the write transaction. Numbers that
 * are already in use (older manual takas) are skipped.
 */
export async function allocateTakaNumbers(tx: Tx, n: number): Promise<string[]> {
  const out: string[] = [];
  while (out.length < n) {
    const [row] = await tx
      .insert(counters)
      .values({ name: TAKA_COUNTER, value: TAKA_NO_START })
      .onConflictDoUpdate({ target: counters.name, set: { value: sql`${counters.value} + 1` } })
      .returning({ value: counters.value });
    const no = String(row.value);
    if (!(await usedTakaNumbers(tx, [no])).has(no)) out.push(no);
  }
  return out;
}

/** The next `n` numbers a Taka entry would get right now (read-only; confirmed when the takas are saved). */
export async function peekTakaNumbers(db: DbOrTx, n: number): Promise<string[]> {
  const [row] = await db.select({ value: counters.value }).from(counters).where(eq(counters.name, TAKA_COUNTER));
  let next = row ? row.value + 1 : TAKA_NO_START;
  const out: string[] = [];
  while (out.length < n) {
    const window = Array.from({ length: n + 20 }, (_, i) => String(next + i));
    const used = await usedTakaNumbers(db, window);
    for (const no of window) if (!used.has(no) && out.length < n) out.push(no);
    next += window.length;
  }
  return out;
}

/** "Taka 6245 is already used (Order #26 (319)) / टाका 6245 पहले से है" */
export function usedMessage(takaNo: string, ref: string | undefined): string {
  const t = takaUsedText(takaNo, ref);
  return `${t.en} / ${t.hi}`;
}

/** Recomputes `takas.is_damaged` = "has at least one open damage" (call after EVERY damage write, same transaction). */
export async function refreshIsDamaged(tx: Tx, takaIds: readonly number[]) {
  for (const part of chunk([...new Set(takaIds)])) {
    if (!part.length) continue;
    await tx
      .update(takas)
      .set({
        isDamaged: sql`EXISTS (SELECT 1 FROM taka_damages d WHERE d.taka_id = "takas"."id" AND d.status = 'open' AND d.is_deleted = 0)`,
      })
      .where(inArray(takas.id, part));
  }
}

export interface DamageRow {
  takaId: number;
  damageId: number | null;
  pcs: number | null;
  /** The damage TYPE (machine / butta / mill / unmarked). */
  foundAt: DamageType;
  /** Where it was recorded. */
  recordedAt: DamageRecordedAt;
}

/** Inserts open damages; returns their ids in order. */
export async function insertTakaDamages(tx: Tx, role: RoleKey, rows: DamageRow[]): Promise<number[]> {
  if (!rows.length) return [];
  const at = nowIso();
  const ids: number[] = [];
  for (const part of chunk(rows, 100)) {
    const inserted = await tx
      .insert(takaDamages)
      .values(
        part.map((r) => ({
          takaId: r.takaId,
          damageId: r.damageId,
          pcs: r.pcs,
          foundAt: r.foundAt,
          recordedAt: r.recordedAt,
          status: 'open' as const,
          createdBy: role,
          createdAt: at,
          updatedAt: at,
        })),
      )
      .returning({ id: takaDamages.id });
    ids.push(...inserted.map((i) => i.id));
  }
  return ids;
}

export interface TakaEventInput {
  takaId: number;
  event: TakaEventKind;
  challanId?: number | null;
  /** The damage a damage event is about (the damage details timeline). */
  takaDamageId?: number | null;
  /** Sprint 12: the dispatch challan a dispatched / goods_returned event is about. */
  dispatchChallanId?: number | null;
  note?: string | null;
}

/** One history row per taka action. */
export async function writeTakaEvents(tx: Tx, role: RoleKey, events: TakaEventInput[]) {
  if (!events.length) return;
  const at = nowIso();
  for (const part of chunk(events, 100)) {
    await tx.insert(takaEvents).values(
      part.map((e) => ({
        takaId: e.takaId,
        event: e.event,
        challanId: e.challanId ?? null,
        takaDamageId: e.takaDamageId ?? null,
        note: e.note ?? null,
        role,
        userId: currentUserId(),
        dispatchChallanId: e.dispatchChallanId ?? null,
        createdAt: at,
        updatedAt: at,
      })),
    );
  }
}

type DamagePick = { damageId: number } | { otherName: string };

/**
 * Master ids of submitted damages: a master id must exist and be active; "Other" names are found
 * case-insensitively or added to the master inside this transaction (also for roles without master rights).
 * `field(i)` = the field path of the i-th damage for the error.
 */
export async function resolveDamageNames(
  tx: Tx,
  picks: readonly DamagePick[],
  field: (index: number) => string,
): Promise<number[]> {
  const cache = new Map<string, number>();
  const out: number[] = [];
  for (const [i, pick] of picks.entries()) {
    const id = await resolveDamage(tx, pick, cache);
    if (id === null) throw badRequest("That damage name no longer exists. Pick it again.", field(i));
    out.push(id);
  }
  return out;
}

/** Recomputes the order status of every touched order (call at the end of every send / receive / QC / cancel). */
export async function recomputeOrdersStatus(tx: Tx, role: RoleKey, orderIds: readonly number[]) {
  // Callers pass the takas' ORIGIN orders; takas allocated from free stock count for another order — recompute that too.
  const ids = new Set(orderIds);
  for (const part of chunk([...ids])) {
    if (!part.length) continue;
    const allocated = await tx
      .selectDistinct({ id: takas.allocatedOrderId })
      .from(takas)
      .where(and(inArray(takas.orderId, part), sql`${takas.allocatedOrderId} IS NOT NULL`, eq(takas.isDeleted, false)));
    for (const a of allocated) if (a.id !== null) ids.add(a.id);
  }
  for (const id of ids) await recomputeOrderStatus(id, role, tx);
}

/** Sprint 13: has this taka's PARENT (or any ancestor through `parent_taka_id`) been to the mill? Split parts inherit it. */
export async function ancestorHasBeenToMill(tx: DbOrTx, parentTakaId: number | null): Promise<boolean> {
  const seen = new Set<number>();
  let cur = parentTakaId;
  while (cur !== null && !seen.has(cur)) {
    seen.add(cur);
    const [row] = await tx
      .select({ hasBeenToMill: takas.hasBeenToMill, parentTakaId: takas.parentTakaId })
      .from(takas)
      .where(eq(takas.id, cur));
    if (!row) return false;
    if (row.hasBeenToMill) return true;
    cur = row.parentTakaId;
  }
  return false;
}
