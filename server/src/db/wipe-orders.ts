/**
 * One-time cleanup before go-live: deletes every ORDER and everything created from orders (jobsheets, takas, damages,
 * challans, dispatch, goods returns, hold events, history). KEEPS all masters: users, sessions, customers + brokers,
 * materials, designs + variations, machines, damage master, butta / mill parties. Counters are reset, so order /
 * jobsheet / taka / challan numbers restart at 1 (taka numbers at their configured start).
 * Run deliberately: `npx tsx src/db/wipe-orders.ts --yes`. Tables missing in an older DB are skipped.
 */
import { libsql } from './client';

// Children first.
const WIPE = [
  'taka_damage_images', 'taka_events', 'taka_damages', 'goods_return_takas', 'goods_returns', 'dispatch_challan_takas',
  'challan_takas', 'takas', 'dispatch_challans', 'challans', 'jobsheet_machines', 'jobsheet_events', 'jobsheets',
  // Sprint 16: receipts and outside POs (children of orders), the order History events.
  'outside_receipts', 'outside_pos', 'order_events',
  'order_hold_events', 'order_status_history', 'order_note_images', 'orders', 'counters',
];
const KEPT = ['users', 'customers', 'customer_brokers', 'materials', 'designs', 'design_variations', 'machines', 'damages', 'butta_parties', 'mill_parties', 'weavers'];

async function main() {
  if (!process.argv.includes('--yes')) throw new Error('Refusing to run without --yes');
  console.log('Database:', (process.env.TURSO_DATABASE_URL ?? '').replace(/^(.{28}).*/, '$1…'));
  const existing = new Set((await libsql.execute(`SELECT name FROM sqlite_master WHERE type = 'table'`)).rows.map((r) => String(r.name)));
  const wipe = WIPE.filter((t) => existing.has(t));
  const count = async (t: string) => Number((await libsql.execute(`SELECT COUNT(*) AS c FROM "${t}"`)).rows[0].c);
  const snapshot = async (tables: string[]) => Object.fromEntries(await Promise.all(tables.map(async (t) => [t, await count(t)] as const)));

  const keptBefore = await snapshot(KEPT.filter((t) => existing.has(t)));
  console.log('Before (to delete):', await snapshot(wipe));
  console.log('Before (kept):', keptBefore);

  await libsql.batch(wipe.map((t) => `DELETE FROM "${t}"`), 'write');

  const after = await snapshot(wipe);
  const keptAfter = await snapshot(KEPT.filter((t) => existing.has(t)));
  console.log('After (deleted):', after);
  console.log('After (kept):', keptAfter);
  if (Object.values(after).some((n) => n !== 0) || JSON.stringify(keptBefore) !== JSON.stringify(keptAfter)) {
    throw new Error('Counts do not match expectations — check the output above.');
  }
  libsql.close();
}

main().catch((e) => { console.error('Wipe failed:', e); process.exit(1); });
