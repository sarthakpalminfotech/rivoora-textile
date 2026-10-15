import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import {
  can,
  defaultPassword,
  userCreateSchema,
  userResetPasswordSchema,
  userUpdateSchema,
  type Paginated,
  type RoleKey,
  type UserRow,
} from '@rivoora/shared';
import { db, type DbOrTx } from '../db/client';
import { users } from '../db/schema';
import { badRequest, conflict, notFound } from '../lib/errors';
import { likePattern, type PaginationQuery } from '../lib/http';
import { hashPassword } from '../lib/password';
import { deleteUserSessions } from './auth';

/** The Users master (Jenish, Gaurang). Roles are fixed in code; this only manages who has which role. */

const columns = {
  id: users.id,
  name: users.name,
  phone: users.phone,
  role: users.role,
  isActive: users.isActive,
  lastLoginAt: users.lastLoginAt,
  createdAt: users.createdAt,
};

/** GET /users — paginated (like the other masters), search by name or phone. */
export async function listUsers(q: PaginationQuery): Promise<Paginated<UserRow>> {
  const p = q.search ? likePattern(q.search) : null;
  const where = p ? sql`(${users.name} LIKE ${p} ESCAPE '\' OR ${users.phone} LIKE ${p} ESCAPE '\')` : undefined;
  const [rows, [{ total }]] = await db.batch([
    db
      .select(columns)
      .from(users)
      .where(where)
      .orderBy(desc(users.isActive), asc(users.name))
      .limit(q.limit)
      .offset((q.page - 1) * q.limit),
    db.select({ total: sql<number>`COUNT(*)` }).from(users).where(where),
  ]);
  const count = Number(total);
  return {
    items: rows.map((r) => ({ ...r, role: r.role as RoleKey })),
    page: q.page,
    limit: q.limit,
    total: count,
    hasMore: q.page * q.limit < count,
  };
}

export async function getUser(id: number): Promise<UserRow> {
  const [row] = await db.select(columns).from(users).where(eq(users.id, id));
  if (!row) throw notFound('User');
  return { ...row, role: row.role as RoleKey };
}

async function assertPhoneFree(tx: DbOrTx, phone: string, exceptId?: number) {
  const [dup] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.phone, phone), eq(users.isActive, true), exceptId ? ne(users.id, exceptId) : undefined));
  if (dup) throw conflict('Another active user already has this mobile number', 'phone');
}

/** Active users whose role may manage users. */
async function activeManagers(tx: DbOrTx): Promise<number[]> {
  const rows = await tx.select({ id: users.id, role: users.role }).from(users).where(eq(users.isActive, true));
  return rows.filter((r) => can(r.role as RoleKey, 'canManageUsers')).map((r) => r.id);
}

export async function createUser(input: unknown): Promise<UserRow> {
  const data = userCreateSchema.parse(input);
  await assertPhoneFree(db, data.phone);
  const hash = await hashPassword(data.password ?? defaultPassword(data.phone));
  const [row] = await db
    .insert(users)
    .values({ name: data.name, phone: data.phone, role: data.role, isActive: data.isActive, passwordHash: hash })
    .returning({ id: users.id });
  return getUser(row.id);
}

export async function updateUser(actorId: number, id: number, input: unknown): Promise<UserRow> {
  const data = userUpdateSchema.parse(input);
  const current = await getUser(id);
  if (id === actorId) {
    if (!data.isActive) throw badRequest("You can't deactivate yourself", 'isActive');
    if (data.role !== current.role) throw badRequest("You can't change your own role", 'role');
  }
  if (data.isActive) await assertPhoneFree(db, data.phone, id);

  // The last active user who can manage users can't be deactivated or moved to a role that can't.
  const wasManager = current.isActive && can(current.role, 'canManageUsers');
  const staysManager = data.isActive && can(data.role, 'canManageUsers');
  if (wasManager && !staysManager) {
    const managers = await activeManagers(db);
    if (managers.length <= 1) throw conflict("This is the last active user who can manage users — it can't be deactivated or changed.");
  }

  await db
    .update(users)
    .set({ name: data.name, phone: data.phone, role: data.role, isActive: data.isActive })
    .where(eq(users.id, id));
  // A different role or a deactivation ends the user's sessions (they log in again with the new role).
  if (!data.isActive || data.role !== current.role) await deleteUserSessions(id);
  return getUser(id);
}

export async function resetPassword(id: number, input: unknown): Promise<{ ok: true }> {
  const data = userResetPasswordSchema.parse(input ?? {});
  const user = await getUser(id);
  const hash = await hashPassword(data.password ?? defaultPassword(user.phone));
  await db.update(users).set({ passwordHash: hash }).where(eq(users.id, id));
  await deleteUserSessions(id);
  return { ok: true };
}

/** Creates the default users (idempotent: a phone that already exists is left alone). Used by `db:migrate`. */
export async function seedDefaultUsers(
  list: readonly { name: string; phone: string; role: RoleKey }[],
): Promise<number> {
  let created = 0;
  for (const u of list) {
    const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.phone, u.phone));
    if (exists) continue;
    await db
      .insert(users)
      .values({ name: u.name, phone: u.phone, role: u.role, passwordHash: await hashPassword(defaultPassword(u.phone)) });
    created += 1;
  }
  return created;
}
