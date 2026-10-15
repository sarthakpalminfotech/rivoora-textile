/**
 * One-time: the owner's display name is "Jenish" (role key stays `jemish`). Changes users.name ONLY for the default
 * owner row (phone 9999999999 and name 'Jemish'); phone, password and role are untouched. Run: `npm run db:rename-owner`.
 */
import { and, eq } from 'drizzle-orm';
import { db, libsql } from './client';
import { users } from './schema';

async function main() {
  const rows = await db
    .update(users)
    .set({ name: 'Jenish' })
    .where(and(eq(users.phone, '9999999999'), eq(users.name, 'Jemish')))
    .returning({ id: users.id });
  console.log(rows.length ? `Renamed ${rows.length} user to Jenish.` : 'Nothing to rename.');
  libsql.close();
}

main().catch((err) => {
  console.error('Rename failed:', err);
  process.exit(1);
});
