/**
 * Sprint 16 — proves that EXISTING orders behave exactly as before after migration 0015. LOCAL FILE DB ONLY:
 *
 *   TURSO_DATABASE_URL=file:C:/path/copy.db TURSO_AUTH_TOKEN=x npx tsx src/db/check-sprint16-existing.ts
 *
 * Checks, for every order that existed before the migration (no outside POs / receipts / outside takas):
 *  1. the backfill: has_production = 1, has_mill = 1, has_butta = the design's "Goes for butta cutting" (1 without design);
 *  2. the routing of a NEW taka (`initialStageForOrder`) equals the old design rule;
 *  3. the status the NEW rules compute equals the stored status (recompute inside a transaction that is rolled back);
 *  4. no external jobsheet exists, and the real-jobsheet counts equal the plain counts.
 * Exits 1 on any mismatch. Changes nothing.
 */
import { eq, sql } from 'drizzle-orm';
import { initialTakaStage } from '@rivoora/shared';
import { db, libsql } from './client';
import { designs, orders } from './schema';
import { recomputeOrderStatus } from '../services/jobsheets';
import { initialStageForOrder } from '../services/taka-ops';

const url = process.env.TURSO_DATABASE_URL ?? '';
if (!url.startsWith('file:')) {
  console.error('Refusing to run: TURSO_DATABASE_URL must be a local file: database (never Turso).');
  process.exit(2);
}

class Rollback extends Error {}

async function main() {
  let failed = 0;
  const fail = (what: string, extra?: unknown) => {
    failed += 1;
    console.log(`FAIL ${what}${extra === undefined ? '' : `  → ${JSON.stringify(extra)}`}`);
  };
  const rows = await db
    .select({
      id: orders.id,
      orderNo: orders.orderNo,
      status: orders.status,
      designId: orders.designId,
      hasProduction: orders.hasProduction,
      hasButta: orders.hasButta,
      hasMill: orders.hasMill,
      buttaCutting: designs.buttaCutting,
    })
    .from(orders)
    .leftJoin(designs, eq(designs.id, orders.designId));
  const external = Number((await libsql.execute('SELECT COUNT(*) AS n FROM jobsheets WHERE is_external = 1')).rows[0].n);
  const outside = Number((await libsql.execute("SELECT COUNT(*) AS n FROM takas WHERE source <> 'production'")).rows[0].n);
  const pos = Number((await libsql.execute('SELECT COUNT(*) AS n FROM outside_pos')).rows[0].n);
  console.log(`${rows.length} orders · external jobsheets ${external} · outside takas ${outside} · POs ${pos}`);
  if (external || outside || pos) console.log('(this DB already has Sprint 16 data — only orders without it are checked)');

  let checked = 0;
  for (const o of rows) {
    const touched = Number(
      (await libsql.execute({ sql: 'SELECT (SELECT COUNT(*) FROM outside_pos WHERE order_id = ?) + (SELECT COUNT(*) FROM outside_receipts WHERE order_id = ?) AS n', args: [o.id, o.id] })).rows[0].n,
    );
    if (touched) continue;
    checked += 1;
    const expectButta = o.designId == null || o.buttaCutting == null ? true : o.buttaCutting;
    if (!o.hasProduction || !o.hasMill || o.hasButta !== expectButta) {
      fail(`order #${o.orderNo}: backfill`, { hasProduction: o.hasProduction, hasButta: o.hasButta, hasMill: o.hasMill, expectButta });
    }
    const oldStage = initialTakaStage(o.designId != null && o.buttaCutting !== null ? { buttaCutting: o.buttaCutting } : null);
    const newStage = await initialStageForOrder(db, o.id);
    if (oldStage !== newStage) fail(`order #${o.orderNo}: routing of a new taka`, { oldStage, newStage });
    // The new status rules, without saving anything.
    let changedTo: string | null = null;
    try {
      await db.transaction(async (tx) => {
        const changed = await recomputeOrderStatus(o.id, 'jemish', tx);
        if (changed) {
          const [after] = await tx.select({ status: orders.status }).from(orders).where(eq(orders.id, o.id));
          changedTo = after.status;
        }
        throw new Rollback();
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }
    if (changedTo !== null) fail(`order #${o.orderNo}: status would change`, { stored: o.status, newRules: changedTo });
  }
  const [{ n: realVsAll }] = (await db.all(sql`SELECT (SELECT COUNT(*) FROM jobsheets WHERE is_deleted = 0) - (SELECT COUNT(*) FROM jobsheets WHERE is_deleted = 0 AND is_external = 0) AS n`)) as { n: number }[];
  if (!external && Number(realVsAll) !== 0) fail('real jobsheet count differs from the plain count');
  console.log(failed ? `\n${failed} check(s) FAILED (${checked} orders checked)` : `\nAll ${checked} existing orders unchanged (backfill, routing, status).`);
  libsql.close();
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
