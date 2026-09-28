import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { env } from '../env';
import * as schema from './schema';

/** The single shared Turso connection used by the whole server. */
export const libsql = createClient({ url: env.databaseUrl, authToken: env.authToken });

export const db = drizzle(libsql, { schema });

export type Db = typeof db;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;
