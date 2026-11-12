/**
 * Sprint 26 — `npm run demo:seed`: recreates the LOCAL demo database `server/.data/demo.db`, runs every migration on it
 * and fills 14 months of realistic demo data. Never touches Turso.
 *
 * The guard runs FIRST, before anything opens a connection or reads `server/.env` (only `./demo/guard` is imported
 * statically, and it imports nothing of the app). It refuses unless the URL starts with `file:`, the file name contains
 * `demo` and `ALLOW_DEMO_SEED=1` is set. Then it deletes ONLY that demo file (and its -journal / -wal / -shm siblings).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { demoFilePath, demoTargetProblem } from './demo/guard';

const SERVER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function refuse(why: string): never {
  console.error(`\n[demo:seed] REFUSED — ${why}.\n[demo:seed] Nothing was touched (no connection was opened).\n`);
  process.exit(1);
}

const problem = demoTargetProblem(process.env.TURSO_DATABASE_URL, process.env.ALLOW_DEMO_SEED);
if (problem) refuse(problem);
const file = demoFilePath(process.env.TURSO_DATABASE_URL!)!;

console.log(`[demo:seed] Guard passed: local file ${file}`);
for (const f of [file, `${file}-journal`, `${file}-wal`, `${file}-shm`]) if (existsSync(f)) rmSync(f);
mkdirSync(dirname(file), { recursive: true });

console.log('[demo:seed] Running every migration on the demo file…');
const migrate = spawnSync(process.execPath, ['--import', 'tsx', 'src/db/migrate.ts'], { cwd: SERVER_ROOT, env: process.env, stdio: 'inherit' });
if (migrate.status !== 0) refuse(`the migrations failed on the demo file (exit ${migrate.status})`);

const started = Date.now();
const { buildDemo } = await import('./demo/run');
const { checkCards, statusCorrections } = await import('./demo/verify');
const { libsql } = await import('./client');
const { defaultPassword } = await import('@rivoora/shared');

console.log('[demo:seed] Building 14 months of demo data…');
const result = await buildDemo();
console.log(`[demo:seed] Written in ${((Date.now() - started) / 1000).toFixed(1)} s:`);
for (const [k, v] of Object.entries(result.counts)) console.log(`  ${k.padEnd(34)} ${v.toLocaleString('en-IN')}`);
for (const n of result.notes) console.log(`  · ${n}`);

const fixes = await statusCorrections();
if (fixes.length) {
  console.error(`\n[demo:seed] ${fixes.length} order statuses differ from what the app computes:`);
  for (const f of fixes.slice(0, 20)) console.error(`  Order #${f.orderNo}: ${f.from} → ${f.to}`);
} else console.log('\n[demo:seed] Order statuses: the app recomputes every status to the same value (0 corrections).');

const cards = await checkCards();
console.log('\n[demo:seed] Dashboard cards (period: last 30 days)');
console.log(`  ${'card'.padEnd(20)} ${'title'.padEnd(40)} value`);
let failed = 0;
for (const c of cards) {
  if (!c.ok) failed += 1;
  console.log(`${c.ok ? '  ' : '✗ '}${`${c.id}`.padEnd(20)} ${c.title.slice(0, 40).padEnd(40)} ${c.text.slice(0, 110)}`);
}

console.log('\n[demo:seed] Logins (the default users):');
for (const u of result.logins) console.log(`  ${u.role.padEnd(18)} ${u.name.padEnd(18)} ${u.phone}  ${defaultPassword(u.phone)}`);
libsql.close();

if (failed || fixes.length) {
  console.error(`\n[demo:seed] FAILED: ${failed} card(s) without data, ${fixes.length} status correction(s).`);
  process.exit(1);
}
console.log(`\n[demo:seed] Done. ${cards.length} cards checked. Start the app on it with: npm run demo:dev`);
