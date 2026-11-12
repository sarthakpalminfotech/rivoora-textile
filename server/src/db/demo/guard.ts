import { basename, resolve } from 'node:path';

/**
 * Sprint 26 — the demo seed's safety guard. Pure (no db / env imports) so the seed entry can run it BEFORE anything opens
 * a connection or loads `server/.env`.
 *
 * The seed only runs when ALL of these hold:
 * - the DB URL starts with `file:` (never `libsql://`, `https://`, `http://`, `ws://` — Turso is never seeded);
 * - the file name contains `demo`;
 * - `ALLOW_DEMO_SEED=1` is set.
 *
 * The refusal text never repeats a non-file URL (it could be the live Turso address).
 */
export function demoTargetProblem(url: string | undefined, allow: string | undefined): string | null {
  const u = url?.trim() ?? '';
  if (!u) return 'TURSO_DATABASE_URL is not set (run it through `npm run demo:seed`, which points it at server/.data/demo.db)';
  if (!/^file:/i.test(u)) return 'the database URL is not a local `file:` URL — remote / Turso databases are never seeded';
  const path = demoFilePath(u);
  if (!path) return 'the `file:` URL has no file path';
  if (!basename(path).toLowerCase().includes('demo')) return `the database file name must contain "demo" (got ${basename(path)})`;
  if (allow !== '1') return 'ALLOW_DEMO_SEED=1 is not set';
  return null;
}

/** The local path of a `file:` URL (`file:C:/x/demo.db`, `file:///C:/x/demo.db`, `file:./.data/demo.db`), else null. */
export function demoFilePath(url: string): string | null {
  const u = url.trim();
  if (!/^file:/i.test(u)) return null;
  let p = u.slice(5).split('?')[0];
  if (p.startsWith('//')) p = p.slice(2);
  if (/^\/[A-Za-z]:[\\/]/.test(p)) p = p.slice(1);
  p = decodeURIComponent(p);
  return p ? resolve(p) : null;
}

/** Is this server running on a demo database? (drives the DEMO DATA ribbon) */
export function isDemoDatabaseUrl(url: string | undefined): boolean {
  const path = url ? demoFilePath(url) : null;
  return !!path && basename(path).toLowerCase().includes('demo');
}
