import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  checkTake,
  formatKg,
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
import { counters, tfoPendingPrograms, warpingPendingJobInputs, warpingPendingJobs, yarnPos, yarnQualities, yarnStockMoves } from '../db/schema';
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

/**
 * Sprint 20: balances are per zone + item + quality, optionally narrowed to one lot (raw) or one box (twisted).
 * Pass `lotId`/`boxId` as `null` to mean "No lot" / "No box" specifically, or omit them to total across all of
 * them (the pre-Sprint-20 behaviour, still used where lot/box doesn't apply).
 */
export interface StockScope {
  lotId?: number | null;
  boxId?: number | null;
  /** Twisted "No box" stock recorded under a warping quality (rows whose `quality_id` is the system row). */
  warpingQualityId?: number | null;
}

export async function balanceG(tx: DbOrTx, zone: YarnZone, item: YarnItem, qualityId: number, scope: StockScope = {}): Promise<number> {
  const conds = [eq(yarnStockMoves.zone, zone), eq(yarnStockMoves.item, item), eq(yarnStockMoves.qualityId, qualityId)];
  if (scope.lotId !== undefined) conds.push(scope.lotId === null ? isNull(yarnStockMoves.lotId) : eq(yarnStockMoves.lotId, scope.lotId));
  if (scope.boxId !== undefined) conds.push(scope.boxId === null ? isNull(yarnStockMoves.boxId) : eq(yarnStockMoves.boxId, scope.boxId));
  if (scope.warpingQualityId !== undefined) {
    conds.push(scope.warpingQualityId === null ? isNull(yarnStockMoves.warpingQualityId) : eq(yarnStockMoves.warpingQualityId, scope.warpingQualityId));
  }
  const [row] = await tx
    .select({ g: sql<number>`COALESCE(SUM(${yarnStockMoves.qtyG}), 0)` })
    .from(yarnStockMoves)
    .where(and(...conds));
  return Number(row?.g ?? 0);
}

/**
 * Sprint 20 — what pending work holds on a stock bucket: pending TFO programs reserve TFO raw yarn (per quality + lot);
 * pending warping jobs reserve their Warping inputs (raw per quality + lot, twisted per box / "No box" quality).
 * Reserved stock can't be taken by anything else; starting the program / job ends its reservation.
 */
export async function reservedG(tx: DbOrTx, zone: YarnZone, item: YarnItem, qualityId: number, scope: StockScope = {}): Promise<number> {
  if (zone === 'tfo' && item === 'raw') {
    const conds = [eq(tfoPendingPrograms.status, 'pending'), eq(tfoPendingPrograms.rawQualityId, qualityId)];
    if (scope.lotId !== undefined) conds.push(scope.lotId === null ? isNull(tfoPendingPrograms.lotId) : eq(tfoPendingPrograms.lotId, scope.lotId));
    const [row] = await tx
      .select({ g: sql<number>`COALESCE(SUM(${tfoPendingPrograms.rawG}), 0)` })
      .from(tfoPendingPrograms)
      .where(and(...conds));
    return Number(row?.g ?? 0);
  }
  if (zone === 'warping') {
    const i = warpingPendingJobInputs;
    const conds = [eq(warpingPendingJobs.status, 'pending'), eq(i.item, item), eq(i.qualityId, qualityId)];
    if (scope.lotId !== undefined) conds.push(scope.lotId === null ? isNull(i.lotId) : eq(i.lotId, scope.lotId));
    if (scope.boxId !== undefined) conds.push(scope.boxId === null ? isNull(i.boxId) : eq(i.boxId, scope.boxId));
    if (scope.warpingQualityId !== undefined) conds.push(scope.warpingQualityId === null ? isNull(i.warpingQualityId) : eq(i.warpingQualityId, scope.warpingQualityId));
    const [row] = await tx
      .select({ g: sql<number>`COALESCE(SUM(${i.qtyG}), 0)` })
      .from(i)
      .innerJoin(warpingPendingJobs, eq(warpingPendingJobs.id, i.jobId))
      .where(and(...conds));
    return Number(row?.g ?? 0);
  }
  return 0;
}

/** The one reserved "system" yarn quality (Sprint 20) — stands in for `quality_id` on box-tied / warping-quality twisted rows. */
export async function systemQualityId(tx: DbOrTx): Promise<number> {
  const [row] = await tx.select({ id: yarnQualities.id }).from(yarnQualities).where(eq(yarnQualities.isSystem, true)).limit(1);
  if (!row) throw new Error('System yarn quality row is missing — migration 0019 did not run');
  return row.id;
}

/** Active qualities by id → name; 400 (with `field`) when one is missing or deleted. */
export async function qualityNames(tx: DbOrTx, ids: number[], field = 'qualityId'): Promise<Map<number, string>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  // Sprint 20: the reserved system row is never a pickable quality — only `systemQualityId()` may use it, for the
  // box-tied / warping-quality bookkeeping it was made for.
  const rows = await tx
    .select({ id: yarnQualities.id, name: yarnQualities.name })
    .from(yarnQualities)
    .where(and(inArray(yarnQualities.id, unique), eq(yarnQualities.isDeleted, false), eq(yarnQualities.isSystem, false)));
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
  /** Sprint 20: raw yarn's lot (omit when not applicable; null = "No lot"). */
  lotId?: number | null;
  /** Sprint 20: twisted yarn's box (omit when not applicable; null = "No box"). */
  boxId?: number | null;
  /** Sprint 20: twisted yarn's real quality from the TFO stop onward. */
  warpingQualityId?: number | null;
}

/** The ledger scope a move's balance check runs on (only the keys the move sets). */
function scopeOf(m: Pick<MoveInput, 'lotId' | 'boxId' | 'warpingQualityId'>): StockScope {
  const scope: StockScope = {};
  if (m.lotId !== undefined) scope.lotId = m.lotId;
  if (m.boxId !== undefined) scope.boxId = m.boxId;
  // A box already pins the quality; "No box" twisted stock is told apart by its warping quality.
  if (m.boxId === null && m.warpingQualityId !== undefined) scope.warpingQualityId = m.warpingQualityId;
  return scope;
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
    lotId: m.lotId ?? null,
    boxId: m.boxId ?? null,
    warpingQualityId: m.warpingQualityId ?? null,
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
 * transaction: 409 "Only 12.5 kg of raw yarn 75D in TFO" when there isn't enough. Sprint 20: what pending programs /
 * warping jobs reserve is not available (a starting program / job ends its own reservation BEFORE taking).
 */
export async function takeStock(tx: Tx, m: MoveInput & { qualityName: string; field?: string }): Promise<void> {
  if (MOVE_KIND_SIGN[m.kind] !== -1) throw new Error(`takeStock with ${m.kind}`);
  const scope = scopeOf(m);
  // Sequential on purpose: statements of one transaction run one after another.
  const balance = await balanceG(tx, m.zone, m.item, m.qualityId, scope);
  const reserved = await reservedG(tx, m.zone, m.item, m.qualityId, scope);
  const available = balance - reserved;
  const err = checkTake(available, m.qtyG);
  if (err === 'not_enough') {
    const text = notEnoughText({ availableG: available, item: m.item, qualityName: m.qualityName, zone: m.zone });
    throw conflict(reserved > 0 ? `${text} (${formatKg(reserved)} reserved for pending work)` : text, m.field ?? 'qtyKg');
  }
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

/**
 * Sprint 20 — `yarn_po_no`: new POs are numbered by the system. The counter starts at 1 and simply advances past
 * any number already used by an existing (typed) PO, so it never clashes and nothing is ever reused. Must run
 * inside the write transaction that inserts the PO.
 */
export async function allocateYarnPoNo(tx: Tx): Promise<number> {
  for (let i = 0; i < 10_000; i++) {
    const [row] = await tx
      .insert(counters)
      .values({ name: 'yarn_po_no', value: 1 })
      .onConflictDoUpdate({ target: counters.name, set: { value: sql`${counters.value} + 1` } })
      .returning({ value: counters.value });
    const [taken] = await tx.select({ id: yarnPos.id }).from(yarnPos).where(eq(yarnPos.poNo, row.value)).limit(1);
    if (!taken) return row.value;
  }
  throw new Error('Could not allocate a yarn PO number');
}
