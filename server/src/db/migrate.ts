import { migrate } from 'drizzle-orm/libsql/migrator';
import { resolve } from 'node:path';
import { SERVER_ROOT } from '../env';
import { db, libsql } from './client';

async function main() {
  console.log('Applying migrations…');
  await migrate(db, { migrationsFolder: resolve(SERVER_ROOT, 'drizzle') });
  console.log('Migrations applied.');
  libsql.close();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
