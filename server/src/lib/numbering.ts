import { sql } from 'drizzle-orm';
import { counterNameFor } from '@rivoora/shared';
import type { DbOrTx } from '../db/client';
import { counters } from '../db/schema';
import { currentFyNow, numberingStartFy } from './fy-clock';

/**
 * Sprint 23 (CR-23) — THE one generator of automatic numbers. Every number that restarts each financial year (order,
 * jobsheet, taka, dummy taka, challans, DC, GR, DL, PO, yarn PO, boxes, beams, warping jobs …) comes from here, inside the
 * caller's write transaction, so a rolled-back write uses no number and a number is never handed out twice.
 *
 * Counter rows: up to and including the start FY (`NUMBERING_START_FY`, default 2026-27) the existing global row `key`
 * simply continues — nothing is renumbered and there is no jump. Every later FY gets its own row `"<key>:<fy>"` that
 * starts at `first` (default 1).
 */
export { currentFyNow as currentFy };

/** The `n` next consecutive numbers of `key` in `fy` (default: the current FY). `first` = the FY's first number. */
export async function nextNumbers(tx: DbOrTx, key: string, n = 1, opts: { fy?: string; first?: number } = {}): Promise<number[]> {
  const fy = opts.fy ?? currentFyNow();
  const first = opts.first ?? 1;
  const name = counterNameFor(key, fy, numberingStartFy());
  const [row] = await tx
    .insert(counters)
    .values({ name, value: first + n - 1 })
    .onConflictDoUpdate({ target: counters.name, set: { value: sql`${counters.value} + ${n}` } })
    .returning({ value: counters.value });
  const start = row.value - n + 1;
  return Array.from({ length: n }, (_, i) => start + i);
}

/** One number. */
export async function nextNumber(tx: DbOrTx, key: string, opts: { fy?: string; first?: number } = {}): Promise<number> {
  return (await nextNumbers(tx, key, 1, opts))[0];
}

/** The number the next `nextNumber` would give in this FY, without taking it (read-only peek). */
export async function peekNextNumber(tx: DbOrTx, key: string, opts: { fy?: string; first?: number } = {}): Promise<number> {
  const fy = opts.fy ?? currentFyNow();
  const name = counterNameFor(key, fy, numberingStartFy());
  const [row] = await tx.select({ value: counters.value }).from(counters).where(sql`${counters.name} = ${name}`);
  return row ? row.value + 1 : (opts.first ?? 1);
}
