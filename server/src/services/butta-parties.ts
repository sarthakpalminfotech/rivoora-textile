import { and, asc, count, eq, ne, or, sql } from 'drizzle-orm';
import { buttaPartyInputSchema, type ButtaParty, type LookupItem, type Paginated } from '@rivoora/shared';
import { db } from '../db/client';
import { buttaChallans, buttaParties } from '../db/schema';
import { conflict, notFound } from '../lib/errors';
import { likePattern, type PaginationQuery } from '../lib/http';

/** Butta parties master. Names are unique (case-insensitive) among active rows; soft delete, blocked while on a challan. */

const columns = {
  id: buttaParties.id,
  name: buttaParties.name,
  address: buttaParties.address,
  mobile: buttaParties.mobile,
  gstin: buttaParties.gstin,
  notes: buttaParties.notes,
  createdAt: buttaParties.createdAt,
  updatedAt: buttaParties.updatedAt,
};

function searchCondition(search?: string) {
  if (!search) return undefined;
  const p = likePattern(search);
  return or(
    sql`${buttaParties.name} LIKE ${p} ESCAPE '\\'`,
    sql`${buttaParties.mobile} LIKE ${p} ESCAPE '\\'`,
    sql`${buttaParties.gstin} LIKE ${p} ESCAPE '\\'`,
    sql`${buttaParties.address} LIKE ${p} ESCAPE '\\'`,
  );
}

export async function listButtaParties({ page, limit, search }: PaginationQuery): Promise<Paginated<ButtaParty>> {
  const where = and(eq(buttaParties.isDeleted, false), searchCondition(search));
  const [items, [{ total }]] = await db.batch([
    db
      .select(columns)
      .from(buttaParties)
      .where(where)
      .orderBy(asc(sql`lower(${buttaParties.name})`))
      .limit(limit)
      .offset((page - 1) * limit),
    db.select({ total: count() }).from(buttaParties).where(where),
  ]);
  return { items, page, limit, total, hasMore: page * limit < total };
}

/** GET /lookup/butta-parties — active parties for the Send dialog. */
export async function lookupButtaParties(search?: string): Promise<LookupItem[]> {
  return db
    .select({ id: buttaParties.id, name: buttaParties.name })
    .from(buttaParties)
    .where(and(eq(buttaParties.isDeleted, false), search ? sql`${buttaParties.name} LIKE ${likePattern(search)} ESCAPE '\\'` : undefined))
    .orderBy(asc(sql`lower(${buttaParties.name})`))
    .limit(100);
}

export async function getButtaParty(id: number): Promise<ButtaParty> {
  const [row] = await db
    .select(columns)
    .from(buttaParties)
    .where(and(eq(buttaParties.id, id), eq(buttaParties.isDeleted, false)));
  if (!row) throw notFound('Butta party');
  return row;
}

async function assertUniqueName(name: string, exceptId?: number) {
  const [dupe] = await db
    .select({ name: buttaParties.name })
    .from(buttaParties)
    .where(
      and(
        eq(buttaParties.isDeleted, false),
        sql`lower(${buttaParties.name}) = lower(${name})`,
        exceptId ? ne(buttaParties.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  if (dupe) throw conflict(`A butta party named "${dupe.name}" already exists`, 'name');
}

export async function createButtaParty(input: unknown): Promise<ButtaParty> {
  const data = buttaPartyInputSchema.parse(input);
  await assertUniqueName(data.name);
  const [row] = await db.insert(buttaParties).values(data).returning(columns);
  return row;
}

export async function updateButtaParty(id: number, input: unknown): Promise<ButtaParty> {
  const data = buttaPartyInputSchema.parse(input);
  await assertUniqueName(data.name, id);
  const [row] = await db
    .update(buttaParties)
    .set(data)
    .where(and(eq(buttaParties.id, id), eq(buttaParties.isDeleted, false)))
    .returning(columns);
  if (!row) throw notFound('Butta party');
  return row;
}

/** Soft delete; blocked (409) when the party is on any challan. */
export async function deleteButtaParty(id: number): Promise<void> {
  await getButtaParty(id);
  const [{ used }] = await db.select({ used: count() }).from(buttaChallans).where(eq(buttaChallans.partyId, id));
  if (used > 0) {
    throw conflict(`This party can't be deleted because it is used on ${used} challan${used === 1 ? '' : 's'}.`);
  }
  await db.update(buttaParties).set({ isDeleted: true }).where(eq(buttaParties.id, id));
}
