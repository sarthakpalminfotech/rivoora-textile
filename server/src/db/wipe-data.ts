/**
 * One-time cleanup: deletes ALL data except users, sessions, designs and design variations. Counters are reset
 * (order / jobsheet / taka / challan numbers restart). Run deliberately: `npx tsx src/db/wipe-data.ts --yes`.
 */
import { libsql } from './client';

const WIPE = [
  'taka_damage_images', 'taka_events', 'taka_damages', 'goods_return_takas', 'goods_returns', 'dispatch_challan_takas',
  'challan_takas', 'takas', 'dispatch_challans', 'challans', 'mill_parties', 'butta_parties', 'damages',
  'jobsheet_machines', 'jobsheet_events', 'jobsheets', 'machines',
  // Sprint 16 (missing in an older DB → skipped).
  'outside_receipts', 'outside_pos', 'weavers', 'order_events', 'order_hold_events',
  'order_status_history', 'order_note_images', 'orders', 'materials', 'customer_brokers', 'customers', 'counters',
];

async function main() {
  if (!process.argv.includes('--yes')) throw new Error('Refusing to run without --yes');
  const existing = new Set((await libsql.execute(`SELECT name FROM sqlite_master WHERE type = 'table'`)).rows.map((r) => String(r.name)));
  const wipe = WIPE.filter((t) => existing.has(t));
  const count = async (t: string) => Number((await libsql.execute(`SELECT COUNT(*) AS c FROM "${t}"`)).rows[0].c);
  const before: Record<string, number> = {};
  for (const t of [...wipe, 'users', 'designs', 'design_variations']) before[t] = await count(t);
  console.log('Before:', before);

  await libsql.batch(
    [
      'UPDATE designs SET material_id = NULL WHERE material_id IS NOT NULL',
      ...wipe.map((t) => `DELETE FROM "${t}"`),
    ],
    'write',
  );

  const after: Record<string, number> = {};
  for (const t of [...wipe, 'users', 'designs', 'design_variations']) after[t] = await count(t);
  console.log('After:', after);
  libsql.close();
}

main().catch((e) => { console.error('Wipe failed:', e); process.exit(1); });
