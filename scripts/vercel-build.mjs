// Vercel build (runs on Vercel via vercel.json → buildCommand). Produces .vercel/output (Build Output API v3):
//   static/          ← client/dist (the React app)
//   functions/api.func  ← server/src/index.ts bundled into one CommonJS file (the Express app)
// Local development is not affected: `npm run dev` / `npm run build` / `npm start` never use this file.
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'tsup';

const root = resolve(import.meta.dirname, '..');
const out = join(root, '.vercel/output');
const fn = join(out, 'functions/api.func');

rmSync(out, { recursive: true, force: true });
execSync('npm run build -w client', { cwd: root, stdio: 'inherit' });

await build({
  entry: { index: join(root, 'server/src/index.ts') },
  format: ['cjs'],
  platform: 'node',
  target: 'node20',
  outDir: fn,
  shims: true, // import.meta.url (env.ts) in CommonJS
  noExternal: [/.*/],
  external: ['sharp'], // local-disk storage only (never loaded on Vercel)
  silent: true,
  esbuildOptions(options) {
    // Turso over HTTP — no native libsql binary needed in the function.
    options.alias = { '@libsql/client': '@libsql/client/web' };
  },
});

writeFileSync(
  join(fn, '.vc-config.json'),
  JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.js', launcherType: 'Nodejs', maxDuration: 30, regions: ['bom1'] }),
);

mkdirSync(join(out, 'static'), { recursive: true });
cpSync(join(root, 'client/dist'), join(out, 'static'), { recursive: true });

writeFileSync(
  join(out, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '^/assets/(.*)$', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
        { handle: 'filesystem' },
        { src: '^/api(/.*)?$', dest: '/api' },
        { src: '^/(.*)$', dest: '/index.html' },
      ],
    },
    null,
    2,
  ),
);
console.log('[vercel-build] .vercel/output ready');
