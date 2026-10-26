import { libsql } from './client';

/**
 * Sprint 18 — READ ONLY. Prints what migration 0017 (variations → designs) will change on the database in .env, and
 * anything that would make it stop. It never writes. Run: `npm run db:s18-report`.
 */
async function rows(sql: string) {
  return (await libsql.execute(sql)).rows;
}
const n = async (sql: string) => Number((await rows(sql))[0]?.n ?? 0);

async function main() {
  const applied = await rows(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'design_variation_map'`);
  if (applied.length) {
    console.log('Migration 0017 is already applied:');
    console.log(`  ${await n('SELECT COUNT(*) AS n FROM design_variation_map')} variations were turned into designs.`);
    console.log(`  ${await n('SELECT COUNT(*) AS n FROM design_qualities')} design qualities.`);
    libsql.close();
    return;
  }
  const variations = await n('SELECT COUNT(*) AS n FROM design_variations');
  const ofDeleted = await n('SELECT COUNT(*) AS n FROM design_variations v JOIN designs d ON d.id = v.design_id WHERE d.is_deleted = 1');
  const orders = await n('SELECT COUNT(*) AS n FROM orders WHERE variation_id IS NOT NULL');
  const withMaterial = await n('SELECT COUNT(*) AS n FROM designs WHERE material_id IS NOT NULL');
  const variationsWithMaterial = await n(
    'SELECT COUNT(*) AS n FROM design_variations v JOIN designs d ON d.id = v.design_id WHERE d.material_id IS NOT NULL',
  );
  const jobsheets = await n('SELECT COUNT(*) AS n FROM jobsheets');
  const ordersTotal = await n('SELECT COUNT(*) AS n FROM orders');

  console.log('Migration 0017 (Sprint 18) will, in ONE transaction:');
  console.log(`  • create ${variations} new design(s), one per variation (${ofDeleted} of them deleted, because their design is deleted)`);
  console.log(`  • record each one in design_variation_map (${variations} row(s))`);
  console.log(`  • move ${orders} order(s) from a variation to its new design (orders.variation_id → NULL, design_id → the new design)`);
  console.log(`  • add ${withMaterial + variationsWithMaterial} design_qualities row(s) (${withMaterial} design(s) with a material + ${variationsWithMaterial} new design(s) of their variations)`);
  console.log(`  • add jobsheets.sections = 3 to all ${jobsheets} jobsheet(s); orders.is_outside_order = 0 / outside_party_name to all ${ordersTotal} order(s)`);
  console.log('  • keep design_variations and designs.material_id (unused from now on); nothing is dropped');

  // Things that would stop it (it then changes nothing).
  const clashes = await rows(`
    SELECT v.code AS code FROM design_variations v JOIN designs p ON p.id = v.design_id AND p.is_deleted = 0
    WHERE EXISTS (SELECT 1 FROM designs d WHERE d.is_deleted = 0 AND d.code = v.code)
       OR (SELECT COUNT(*) FROM design_variations v2 JOIN designs p2 ON p2.id = v2.design_id AND p2.is_deleted = 0 WHERE v2.code = v.code) > 1`);
  const dangling = await n('SELECT COUNT(*) AS n FROM orders o WHERE o.variation_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM design_variations v WHERE v.id = o.variation_id)');
  if (clashes.length || dangling) {
    console.log('\nIt would STOP (and change nothing) because:');
    if (clashes.length) console.log(`  • variation code(s) already used by another active design / variation: ${clashes.map((r) => r.code).join(', ')}`);
    if (dangling) console.log(`  • ${dangling} order(s) point to a variation that no longer exists`);
  } else {
    console.log('\nNo blocking problems found.');
  }
  libsql.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
