import { migrate } from 'drizzle-orm/libsql/migrator';
import { resolve } from 'node:path';
import { SERVER_ROOT } from '../env';
import { DEFAULT_USERS } from '@rivoora/shared';
import { seedDefaultUsers } from '../services/users';
import { db, libsql } from './client';

/**
 * Sprint 7 makes taka numbers unique across the whole system (migration 0008). Before that migration is applied we
 * look for numbers that are already used twice and, if there are any, STOP with a clear list so they can be fixed
 * by hand — the migration never changes data silently.
 */
async function assertNoDuplicateTakaNumbers() {
  const tables = await libsql.execute(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'takas'`);
  if (tables.rows.length === 0) return; // fresh database: nothing to check
  const index = await libsql.execute(
    `SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'takas_taka_no_active_unique'`,
  );
  if (index.rows.length > 0) return; // already migrated

  const dupes = await libsql.execute(`
    SELECT t.taka_no AS taka_no,
           group_concat('Order #' || o.order_no || ' (' || j.jobsheet_no || ')' || CASE WHEN j.is_deleted = 1 THEN ' [deleted jobsheet]' ELSE '' END, ', ') AS used_in
    FROM takas t
    JOIN jobsheets j ON j.id = t.jobsheet_id
    JOIN orders o ON o.id = t.order_id
    WHERE t.is_deleted = 0
    GROUP BY t.taka_no
    HAVING COUNT(*) > 1
    ORDER BY t.taka_no
  `);
  if (dupes.rows.length === 0) return;

  console.error(
    `\nMigration stopped: ${dupes.rows.length} taka number${dupes.rows.length === 1 ? ' is' : 's are'} used more than once.\n` +
      'Taka numbers must now be unique across the whole system. Fix these (renumber or remove one of each pair in\n' +
      'Edit takas), then run the migration again. Nothing was changed.\n',
  );
  for (const row of dupes.rows) console.error(`  Taka ${row.taka_no}  →  ${row.used_in}`);
  console.error('');
  libsql.close();
  process.exit(1);
}

/** Row counts of the butta challan tables BEFORE migration 0009 turns them into the generic `challans` tables. */
async function buttaChallanCounts(): Promise<{ challans: number; takas: number } | null> {
  const old = await libsql.execute(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'butta_challans'`);
  if (old.rows.length === 0) return null;
  const challans = await libsql.execute('SELECT COUNT(*) AS n FROM butta_challans');
  const takas = await libsql.execute('SELECT COUNT(*) AS n FROM butta_challan_takas');
  return { challans: Number(challans.rows[0]?.n ?? 0), takas: Number(takas.rows[0]?.n ?? 0) };
}

const countOf = async (sql: string) => Number((await libsql.execute(sql)).rows[0]?.n ?? 0);

/**
 * Sprint 18 (migration 0017) turns every design variation into a standalone design. Before it runs we print exactly
 * what it will change; afterwards the same figures are counted again. Returns null when it has already been applied.
 */
async function variationPlan(): Promise<{ variations: number; ordersOnVariation: number; designsWithMaterial: number } | null> {
  const applied = await libsql.execute(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'design_variation_map'`);
  if (applied.rows.length > 0) return null;
  const old = await libsql.execute(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'design_variations'`);
  if (old.rows.length === 0) return null; // fresh database
  const plan = {
    variations: await countOf('SELECT COUNT(*) AS n FROM design_variations'),
    ordersOnVariation: await countOf('SELECT COUNT(*) AS n FROM orders WHERE variation_id IS NOT NULL'),
    designsWithMaterial: await countOf('SELECT COUNT(*) AS n FROM designs WHERE material_id IS NOT NULL'),
  };
  console.log(
    `Sprint 18 design change: ${plan.variations} variation(s) become designs, ${plan.ordersOnVariation} order(s) move from a\n` +
      `variation to its new design, ${plan.designsWithMaterial} design(s) get their material as a quality (+ the new designs\n` +
      'of their variations). The whole migration is one transaction: if a check fails, nothing is changed.',
  );
  return plan;
}

/**
 * Sprint 8 (migration 0009) moves the butta challans into the generic `challans` / `challan_takas` tables. The SQL
 * itself compares the counts and fails (rolling everything back) if anything is off; this wrapper counts before and
 * after as well and explains a failure in plain words.
 */
async function main() {
  console.log('Applying migrations…');
  await assertNoDuplicateTakaNumbers();
  const before = await buttaChallanCounts();
  const s18 = await variationPlan();
  try {
    await migrate(db, { migrationsFolder: resolve(SERVER_ROOT, 'drizzle') });
  } catch (err) {
    if (String(err).includes('__s18_check')) {
      console.error(
        '\nMigration stopped: turning the design variations into designs did not add up (designs created, the map, the\n' +
          'orders that moved, duplicate codes or qualities). Nothing was changed. Run `npm run db:s18-report` to see why.\n',
      );
      libsql.close();
      process.exit(1);
    }
    if (String(err).includes('__s8_check')) {
      console.error(
        '\nMigration stopped: the butta challans could not be moved to the new challan tables without losing something\n' +
          `(before: ${before?.challans ?? 0} challans / ${before?.takas ?? 0} challan takas). Nothing was changed.\n`,
      );
      libsql.close();
      process.exit(1);
    }
    throw err;
  }
  if (before) {
    const after = {
      challans: Number((await libsql.execute(`SELECT COUNT(*) AS n FROM challans WHERE kind = 'butta'`)).rows[0]?.n ?? 0),
      takas: Number((await libsql.execute(`SELECT COUNT(*) AS n FROM challan_takas WHERE kind = 'butta'`)).rows[0]?.n ?? 0),
    };
    if (after.challans !== before.challans || after.takas !== before.takas) {
      console.error(
        `\nCheck failed: ${before.challans} butta challans / ${before.takas} challan takas before, ${after.challans} / ${after.takas} after.\n`,
      );
      libsql.close();
      process.exit(1);
    }
    console.log(`Butta challans moved to the generic challan tables: ${after.challans} challans, ${after.takas} taka rows (counts match).`);
  }
  if (s18) {
    const mapped = await countOf('SELECT COUNT(*) AS n FROM design_variation_map');
    const moved = await countOf('SELECT COUNT(*) AS n FROM orders WHERE design_id IN (SELECT new_design_id FROM design_variation_map)');
    const qualities = await countOf('SELECT COUNT(*) AS n FROM design_qualities');
    if (mapped !== s18.variations || moved !== s18.ordersOnVariation) {
      console.error(`\nCheck failed: ${s18.variations} variations / ${s18.ordersOnVariation} orders before, ${mapped} mapped / ${moved} moved after.\n`);
      libsql.close();
      process.exit(1);
    }
    console.log(`Variations → designs: ${mapped} designs created (design_variation_map), ${moved} orders moved, ${qualities} design qualities (counts match).`);
  }
  console.log('Migrations applied.');
  // Sprint 12: the default logins (a phone that already exists is left alone).
  const created = await seedDefaultUsers(DEFAULT_USERS);
  console.log(created ? `Default users created: ${created}.` : 'Default users already exist.');
  libsql.close();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
