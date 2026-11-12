#!/usr/bin/env node
/**
 * Sprint 26 — the demo environment launcher.
 *
 *   npm run demo:seed   → recreate server/.data/demo.db, migrate it, fill the demo data, check the dashboards
 *   npm run demo:dev    → server (:4000) + client (:5180) on the demo DB, with the DEMO DATA ribbon
 *
 * It ALWAYS points the app at the local demo file: TURSO_DATABASE_URL is set here (dotenv never overrides a variable that
 * is already set, so server/.env and its Turso address are never used). Cloudinary is switched off so demo uploads stay
 * on the local disk.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEMO_DB = resolve(ROOT, 'server', '.data', 'demo.db');
const mode = process.argv[2];
if (mode !== 'seed' && mode !== 'dev') {
  console.error('Usage: node scripts/demo.mjs seed|dev');
  process.exit(1);
}
mkdirSync(dirname(DEMO_DB), { recursive: true });

const env = {
  ...process.env,
  TURSO_DATABASE_URL: `file:${DEMO_DB.replace(/\\/g, '/')}`,
  TURSO_AUTH_TOKEN: 'demo',
  CLOUDINARY_CLOUD_NAME: '',
  CLOUDINARY_API_KEY: '',
  CLOUDINARY_API_SECRET: '',
  ...(mode === 'seed' ? { ALLOW_DEMO_SEED: '1' } : {}),
};

const run = (cmd, args, cwd) =>
  new Promise((done) => {
    const child = spawn(cmd, args, { cwd, env, stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('exit', (code) => done(code ?? 1));
  });

if (mode === 'seed') {
  console.log(`[demo] Demo database: ${DEMO_DB}`);
  process.exit(await run(process.execPath, ['--import', 'tsx', 'src/db/demo-seed.ts'], resolve(ROOT, 'server')));
} else {
  console.log(`[demo] Running the app on the demo database ${DEMO_DB}`);
  process.exit(await run('npm', ['run', 'dev'], ROOT));
}
