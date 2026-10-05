import { migrate } from 'drizzle-orm/libsql/migrator';
import { resolve } from 'node:path';
import { SERVER_ROOT } from '../env';
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

async function main() {
  console.log('Applying migrations…');
  await assertNoDuplicateTakaNumbers();
  await migrate(db, { migrationsFolder: resolve(SERVER_ROOT, 'drizzle') });
  console.log('Migrations applied.');
  libsql.close();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
