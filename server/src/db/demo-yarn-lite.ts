/**
 * Adds a SMALL yarn data set (parties, qualities, a few POs / lots, TFO programs, boxes, warping, beams, Palti) to the
 * EXISTING local demo database. Same guard as demo-seed.ts: local `file:` URL with "demo" in its name + ALLOW_DEMO_SEED=1.
 * Run through `npm run demo:yarn-lite`. Refuses to run twice.
 */
import { demoTargetProblem } from './demo/guard';

const problem = demoTargetProblem(process.env.TURSO_DATABASE_URL, process.env.ALLOW_DEMO_SEED);
if (problem) {
  console.error(`\n[demo:yarn] REFUSED — ${problem}.\n`);
  process.exit(1);
}

const { libsql } = await import('./client');
const { Clock, Rng } = await import('./demo/clock');
const { Sink } = await import('./demo/sink');
const { YarnSim } = await import('./demo/yarn');
const { YARN_PARTIES, YARN_QUALITIES, WARPING_QUALITIES } = await import('./demo/masters');

// Replace any earlier yarn demo data (the demo file only; the system rows from the migrations stay).
await libsql.execute('PRAGMA foreign_keys = OFF');
for (const t of [
  'yarn_stock_moves', 'yarn_receipt_line_allocations', 'yarn_receipt_lines', 'yarn_receipts', 'yarn_po_events', 'yarn_po_lines', 'yarn_pos', 'yarn_lots',
  'yarn_transfers', 'yarn_withdrawals', 'palti_run_inputs', 'palti_runs', 'beam_moves', 'beams', 'warping_job_inputs', 'warping_jobs', 'warping_pending_job_inputs',
  'warping_pending_jobs', 'tfo_pending_programs', 'tfo_program_events', 'tfo_program_sections', 'yarn_boxes',
]) await libsql.execute(`DELETE FROM ${t}`);
await libsql.execute(`DELETE FROM tfo_programs WHERE status != 'system'`);
await libsql.execute('DELETE FROM tfo_machines WHERE machine_no > 0');
await libsql.execute('DELETE FROM warping_qualities');
await libsql.execute('DELETE FROM yarn_qualities WHERE is_system = 0');
await libsql.execute('DELETE FROM yarn_parties');
await libsql.execute(`DELETE FROM counters WHERE name IN ('yarn_po_no','yarn_box_no','warping_job_no','beam_no','yarn_beam_code_no','yarn_adjustment_no')`);
await libsql.execute('PRAGMA foreign_keys = ON');

const now = new Date();
const tables = (await libsql.execute(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%drizzle%'`)).rows.map((r) => String(r.name));
const columns = new Map<string, Set<string>>();
const startIds = new Map<string, number>();
for (const t of tables) {
  const cols = new Set((await libsql.execute(`PRAGMA table_info("${t}")`)).rows.map((r) => String(r.name)));
  columns.set(t, cols);
  if (cols.has('id')) startIds.set(t, Number((await libsql.execute(`SELECT COALESCE(MAX(id), 0) AS m FROM "${t}"`)).rows[0].m));
}
const userRows = (await libsql.execute('SELECT id, role FROM users')).rows;
const users = Object.fromEntries(userRows.map((u) => [String(u.role), Number(u.id)])) as Record<string, number>;
const systemQualityId = Number((await libsql.execute('SELECT id FROM yarn_qualities WHERE is_system = 1 ORDER BY id LIMIT 1')).rows[0]?.id);
const paltiProgramId = Number((await libsql.execute(`SELECT id FROM tfo_programs WHERE status = 'system' ORDER BY id LIMIT 1`)).rows[0]?.id);

const sink = new Sink(startIds);
const clock = new Clock(now, 75);
const t0 = clock.iso(0);
const partyIds = YARN_PARTIES.slice(0, 5).map((name) => sink.add('yarn_parties', { name, address: 'Surat' }, t0));
const qualityIds = YARN_QUALITIES.map(([name, denier, filament, min]) => sink.add('yarn_qualities', { name, denier, filament, min_g: min !== null ? min * 10_000 : null }, t0));
const wqIds = WARPING_QUALITIES.slice(0, 6).map((name) => sink.add('warping_qualities', { name }, t0));
const tfoMachineIds = Array.from({ length: 4 }, (_, i) => sink.add('tfo_machines', { machine_no: i + 1, name: null }, t0));

const yarn = new YarnSim(clock, new Rng(7_2026), sink, users as never, { qualityIds, wqIds, partyIds, tfoMachineIds, systemQualityId, paltiProgramId });
yarn.runLite();

await libsql.execute('PRAGMA foreign_keys = OFF');
const written = await sink.flush(libsql, columns, now.toISOString());
await libsql.batch(
  Object.entries(yarn.counters()).map(([name, value]) => ({ sql: 'INSERT INTO counters (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = MAX(value, excluded.value)', args: [name, value] })),
  'write',
);
const fk = await libsql.execute('PRAGMA foreign_key_check');
await libsql.execute('PRAGMA foreign_keys = ON');
if (fk.rows.length) throw new Error(`${fk.rows.length} foreign key problems`);
console.log(`[demo:yarn] ${written} rows written: POs ${sink.count('yarn_pos')}, lots ${sink.count('yarn_lots')}, TFO programs ${sink.count('tfo_programs')}, boxes ${sink.count('yarn_boxes')}, warping jobs ${sink.count('warping_jobs')}, beams ${sink.count('beams')}, stock moves ${sink.count('yarn_stock_moves')}.`);
libsql.close();
