import { and, asc, count, eq, ne, or, sql } from 'drizzle-orm';
import { damageInputSchema, type Damage, type LookupItem, type Paginated } from '@rivoora/shared';
import { db, type DbOrTx, type Tx } from '../db/client';
import { damages, takas } from '../db/schema';
import { conflict, notFound } from '../lib/errors';
import { likePattern, type PaginationQuery } from '../lib/http';

/** Damage master: WHAT a damage is. Names are unique (case-insensitive) among active rows. */

const columns = {
  id: damages.id,
  name: damages.name,
  notes: damages.notes,
  createdAt: damages.createdAt,
  updatedAt: damages.updatedAt,
};

function searchCondition(search?: string) {
  if (!search) return undefined;
  const p = likePattern(search);
  return or(sql`${damages.name} LIKE ${p} ESCAPE '\\'`, sql`${damages.notes} LIKE ${p} ESCAPE '\\'`);
}

export async function listDamages({ page, limit, search }: PaginationQuery): Promise<Paginated<Damage>> {
  const where = and(eq(damages.isDeleted, false), searchCondition(search));
  const [items, [{ total }]] = await db.batch([
    db
      .select(columns)
      .from(damages)
      .where(where)
      .orderBy(asc(sql`lower(${damages.name})`))
      .limit(limit)
      .offset((page - 1) * limit),
    db.select({ total: count() }).from(damages).where(where),
  ]);
  return { items, page, limit, total, hasMore: page * limit < total };
}

/** GET /lookup/damages — active names for the damage popup (Jemish, Gaurang, Taka entry). */
export async function lookupDamages(search?: string): Promise<LookupItem[]> {
  return db
    .select({ id: damages.id, name: damages.name })
    .from(damages)
    .where(and(eq(damages.isDeleted, false), search ? sql`${damages.name} LIKE ${likePattern(search)} ESCAPE '\\'` : undefined))
    .orderBy(asc(sql`lower(${damages.name})`))
    .limit(100);
}

export async function getDamage(id: number): Promise<Damage> {
  const [row] = await db
    .select(columns)
    .from(damages)
    .where(and(eq(damages.id, id), eq(damages.isDeleted, false)));
  if (!row) throw notFound('Damage');
  return row;
}

async function findByName(tx: DbOrTx, name: string, exceptId?: number) {
  const [row] = await tx
    .select({ id: damages.id, name: damages.name })
    .from(damages)
    .where(
      and(
        eq(damages.isDeleted, false),
        sql`lower(${damages.name}) = lower(${name})`,
        exceptId ? ne(damages.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  return row;
}

async function assertUniqueName(name: string, exceptId?: number) {
  const dupe = await findByName(db, name, exceptId);
  if (dupe) throw conflict(`A damage named "${dupe.name}" already exists`, 'name');
}

export async function createDamage(input: unknown): Promise<Damage> {
  const data = damageInputSchema.parse(input);
  await assertUniqueName(data.name);
  const [row] = await db.insert(damages).values(data).returning(columns);
  return row;
}

export async function updateDamage(id: number, input: unknown): Promise<Damage> {
  const data = damageInputSchema.parse(input);
  await assertUniqueName(data.name, id);
  const [row] = await db
    .update(damages)
    .set(data)
    .where(and(eq(damages.id, id), eq(damages.isDeleted, false)))
    .returning(columns);
  if (!row) throw notFound('Damage');
  return row;
}

/** Soft delete; blocked (409) while an active taka uses the damage. */
export async function deleteDamage(id: number): Promise<void> {
  await getDamage(id);
  const [{ used }] = await db
    .select({ used: count() })
    .from(takas)
    .where(and(eq(takas.damageId, id), eq(takas.isDeleted, false)));
  if (used > 0) {
    throw conflict(`This damage can't be deleted because it is used on ${used} taka${used === 1 ? '' : 's'}.`);
  }
  await db.update(damages).set({ isDeleted: true }).where(eq(damages.id, id));
}

/**
 * Resolves the damage of a taka write inside its transaction: a master id must exist and be active; a typed
 * "Other" name is matched case-insensitively or added to the master (also for the Taka entry role, which has no
 * master rights — this is part of the taka write). Returns the damage id.
 */
export async function resolveDamage(
  tx: Tx,
  damage: { damageId: number } | { otherName: string },
  cache: Map<string, number>,
): Promise<number | null> {
  if ('damageId' in damage) {
    const key = `#${damage.damageId}`;
    if (cache.has(key)) return cache.get(key)!;
    const [row] = await tx
      .select({ id: damages.id })
      .from(damages)
      .where(and(eq(damages.id, damage.damageId), eq(damages.isDeleted, false)));
    if (!row) return null;
    cache.set(key, row.id);
    return row.id;
  }
  const key = damage.otherName.toLowerCase();
  if (cache.has(key)) return cache.get(key)!;
  const found = await findByName(tx, damage.otherName);
  const id = found
    ? found.id
    : (await tx.insert(damages).values({ name: damage.otherName }).returning({ id: damages.id }))[0].id;
  cache.set(key, id);
  return id;
}
