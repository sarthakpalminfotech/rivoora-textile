import { createClient } from '@libsql/client';
import { getTableColumns, is } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { env } from '../env';
import * as schema from './schema';

/**
 * Sprint 23 (CR-23): every `fy` column has a constant DDL default ('2026-27' — SQLite's ADD COLUMN needs a constant) AND
 * a `$defaultFn` (the current FY). On insert Drizzle uses a static `.default()` BEFORE `$defaultFn`, so without this every
 * new row would be tagged 2026-27 forever while the numbers restart each year. At RUNTIME only (drizzle-kit loads
 * schema.ts, never this file, so the migrations / snapshots keep the DDL default) the static default is cleared and
 * Drizzle falls through to the FY function. Checked by `scripts/check-sprint23.mjs` (simulated year change).
 */
export const FY_COLUMNS: string[] = [];
for (const value of Object.values(schema)) {
  if (!is(value, SQLiteTable)) continue;
  for (const col of Object.values(getTableColumns(value))) {
    const c = col as unknown as { name: string; default: unknown; defaultFn?: () => unknown };
    if (c.name === 'fy' && c.defaultFn) {
      c.default = undefined;
      FY_COLUMNS.push(value[Symbol.for('drizzle:Name') as unknown as keyof typeof value] as unknown as string);
    }
  }
}

/** The single shared Turso connection used by the whole server. */
export const libsql = createClient({ url: env.databaseUrl, authToken: env.authToken });

export const db = drizzle(libsql, { schema });

export type Db = typeof db;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;
