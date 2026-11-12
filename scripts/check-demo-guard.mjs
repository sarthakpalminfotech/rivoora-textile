#!/usr/bin/env node
/**
 * Sprint 26 — proves the demo seed refuses every target that is not a local demo file, BEFORE it connects.
 * The URLs below are made up (nothing is contacted: the seed must exit before any import of the database client).
 * Run: node scripts/check-demo-guard.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'rivoora-guard-'));
const cases = [
  { name: 'Turso libsql:// URL', url: 'libsql://made-up-demo-db.turso.io', allow: '1' },
  { name: 'https:// URL', url: 'https://made-up-demo-db.turso.io', allow: '1' },
  { name: 'ws:// URL', url: 'ws://127.0.0.1:8080/demo', allow: '1' },
  { name: 'file without "demo" in the name', url: `file:${join(dir, 'live.db').replace(/\\/g, '/')}`, allow: '1', file: join(dir, 'live.db') },
  { name: 'demo file but ALLOW_DEMO_SEED missing', url: `file:${join(dir, 'demo.db').replace(/\\/g, '/')}`, allow: undefined, file: join(dir, 'demo.db') },
  { name: 'demo file but ALLOW_DEMO_SEED=0', url: `file:${join(dir, 'demo.db').replace(/\\/g, '/')}`, allow: '0', file: join(dir, 'demo.db') },
  { name: 'no URL at all', url: undefined, allow: '1' },
];

let failed = 0;
for (const c of cases) {
  const env = { ...process.env, TURSO_AUTH_TOKEN: 'x' };
  delete env.TURSO_DATABASE_URL;
  delete env.ALLOW_DEMO_SEED;
  if (c.url !== undefined) env.TURSO_DATABASE_URL = c.url;
  if (c.allow !== undefined) env.ALLOW_DEMO_SEED = c.allow;
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'src/db/demo-seed.ts'], { cwd: join(ROOT, 'server'), env, encoding: 'utf8' });
  const out = `${r.stdout}${r.stderr}`;
  const refused = r.status === 1 && out.includes('REFUSED') && !out.includes('Running every migration');
  const leaked = c.url && !c.url.startsWith('file:') && out.includes(c.url);
  const touched = c.file ? existsSync(c.file) : false;
  const ok = refused && !leaked && !touched;
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${c.name}${ok ? '' : ` (exit ${r.status}${leaked ? ', URL printed' : ''}${touched ? ', file created' : ''})\n${out}`}`);
}
rmSync(dir, { recursive: true, force: true });
console.log(failed ? `\n${failed} guard check(s) FAILED` : `\nAll ${cases.length} guard checks passed: the demo seed refuses before connecting.`);
process.exit(failed ? 1 : 0);
