import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDemoDatabaseUrl } from './db/demo/guard';

/** Server package root (both src/ and dist/ sit one level below it). */
export const SERVER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

config({ path: resolve(SERVER_ROOT, '.env'), quiet: true });

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(
      `\n[config] Missing environment variable ${name}.\n` +
        `Copy server/.env.example to server/.env and fill in TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.\n`,
    );
    process.exit(1);
  }
  return value;
}

const clientDist = resolve(SERVER_ROOT, '..', 'client', 'dist');

const databaseUrl = required('TURSO_DATABASE_URL');

export const env = {
  databaseUrl,
  authToken: required('TURSO_AUTH_TOKEN'),
  port: Number(process.env.PORT) || 4000,
  uploadsDir: resolve(SERVER_ROOT, 'uploads'),
  clientDist: existsSync(clientDist) ? clientDist : null,
  isProduction: process.env.NODE_ENV === 'production',
  /** Sprint 26: running on the local demo database (`file:` URL whose file name contains "demo") → the DEMO DATA ribbon. */
  isDemo: isDemoDatabaseUrl(databaseUrl),
};
