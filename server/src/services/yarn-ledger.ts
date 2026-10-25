import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  checkTake,
  MOVE_KIND_SIGN,
  notEnoughText,
  TAKE_ERROR_TEXT,
  type RoleKey,
  type YarnItem,
  type YarnMoveKind,
  type YarnRefType,
  type YarnZone,
} from '@rivoora/shared';
import type { DbOrTx, Tx } from '../db/client';
import { counters, yarnQualities, yarnStockMoves } from '../db/schema';
import { badRequest, conflict } from '../lib/errors';
import { currentUserId } from '../lib/request-context';

/**
 * Sprint 17 — the yarn stock ledger (`yarn_stock_moves`), the ONE place yarn quantities change. Balance = SUM(qty_g)
 * per zone + item + quality. `takeStock` checks the balance inside the caller's transaction (libSQL write
 * transactions are serialised), so stock never goes below zero. Every write in the yarn area goes through here.
 */

export const nowIso = () => new Date().toISOString();

/** Who does it: the acting role + the real user (request context). */
export const actor = (role: RoleKey) => ({ role, userId: currentUserId() });

export async function balanceG(tx: DbOrTx, zone: YarnZone, item: YarnItem, qualityId: number): Promise<number> {
  const [row] = await tx
    .select({ g: sql<number>`COALESCE(SUM(${yarnStockMoves.qtyG}), 0)` })
    .from(yarnStockMoves)
    .where(and(eq(yarnStockMoves.zone, zone), eq(yarnStockMoves.item, item), eq(yarnStockMoves.qualityId, qualityId)));
  return Number(row?.g ?? 0);
}

/** Active qualities by id → name; 400 (with `field`) when one is missing or deleted. */
export async function qualityNames(tx: DbOrTx, ids: number[], field = 'qualityId'): Promise<Map<number, string>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const rows = await tx
    .select({ id: yarnQualities.id, name: yarnQualities.name })
    .from(yarnQualities)
    .where(and(inArray(yarnQualities.id, unique), eq(yarnQualities.isDeleted, false)));
  const map = new Map(rows.map((r) => [r.id, r.name]));
  if (unique.some((id) => !map.has(id))) throw badRequest('That yarn quality no longer exists — pick another', field);
  return map;
}

interface MoveInput {
  zone: YarnZone;
  item: YarnItem;
  qualityId: number;
  /** Positive grams; the sign comes from the kind. */
  qtyG: number;
  kind: YarnMoveKind;
  refType: YarnRefType;
  refId: number;
  note?: string | null;
  role: RoleKey;
  createdAt?: string;
}

async function insertMove(tx: Tx, m: MoveInput) {
  await tx.insert(yarnStockMoves).values({
    zone: m.zone,
    item: m.item,
    qualityId: m.qualityId,
    qtyG: MOVE_KIND_SIGN[m.kind] * m.qtyG,
    kind: m.kind,
    refType: m.refType,
    refId: m.refId,
    note: m.note ?? null,
    ...actor(m.role),
    ...(m.createdAt ? { createdAt: m.createdAt } : {}),
  });
}

/** Adds stock (receipt, transfer in, TFO output / return). */
export async function addStock(tx: Tx, m: MoveInput): Promise<void> {
  if (MOVE_KIND_SIGN[m.kind] !== 1) throw new Error(`addStock with ${m.kind}`);
  if (!(m.qtyG > 0)) throw badRequest(TAKE_ERROR_TEXT.zero, 'qtyKg');
  await insertMove(tx, m);
}

/**
 * Takes stock out (transfer out, withdraw, TFO issue, warping issue) after checking the balance in the same
 * transaction: 409 "Only 12.5 kg of raw yarn 75D in TFO" when there isn't enough.
 */
export async function takeStock(tx: Tx, m: MoveInput & { qualityName: string; field?: string }): Promise<void> {
  if (MOVE_KIND_SIGN[m.kind] !== -1) throw new Error(`takeStock with ${m.kind}`);
  const available = await balanceG(tx, m.zone, m.item, m.qualityId);
  const err = checkTake(available, m.qtyG);
  if (err === 'not_enough') throw conflict(notEnoughText({ availableG: available, item: m.item, qualityName: m.qualityName, zone: m.zone }), m.field ?? 'qtyKg');
  if (err) throw badRequest(TAKE_ERROR_TEXT[err], m.field ?? 'qtyKg');
  await insertMove(tx, m);
}

/** The next `n` numbers of a named counter (warping jobs, beams) — never reused. */
export async function allocateNumbers(tx: Tx, name: string, n = 1): Promise<number[]> {
  const [row] = await tx
    .insert(counters)
    .values({ name, value: n })
    .onConflictDoUpdate({ target: counters.name, set: { value: sql`${counters.value} + ${n}` } })
    .returning({ value: counters.value });
  const first = row.value - n + 1;
  return Array.from({ length: n }, (_, i) => first + i);
}
