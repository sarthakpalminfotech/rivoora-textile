import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  initialTakaStage,
  jobsheetRefShort,
  takaUsedText,
  type DamageType,
  type RoleKey,
  type TakaEventKind,
  type TakaStage,
} from '@rivoora/shared';
import type { DbOrTx, Tx } from '../db/client';
import { designs, jobsheets, orders, takaDamages, takaEvents, takas } from '../db/schema';
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

/** The stage a new taka of this order starts in (butta design / no design → `entered`, else `waiting_mill`). */
export async function initialStageForOrder(tx: DbOrTx, orderId: number): Promise<TakaStage> {
  const [row] = await tx
    .select({ designId: orders.designId, buttaCutting: designs.buttaCutting })
    .from(orders)
    .leftJoin(designs, eq(designs.id, orders.designId))
    .where(eq(orders.id, orderId));
  return initialTakaStage(row?.designId != null && row.buttaCutting !== null ? { buttaCutting: row.buttaCutting } : null);
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
  foundAt: DamageType;
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
  for (const id of new Set(orderIds)) await recomputeOrderStatus(id, role, tx);
}
