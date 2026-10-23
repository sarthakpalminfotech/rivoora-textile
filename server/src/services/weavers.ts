import { and, asc, count, eq, ne, or, sql } from 'drizzle-orm';
import { suggestWeaverCode, weaverInputSchema, type Paginated, type Weaver, type WeaverLookupItem } from '@rivoora/shared';
import { db } from '../db/client';
import { outsidePos, takas, weavers } from '../db/schema';
import { conflict, notFound } from '../lib/errors';
import { likePattern, type PaginationQuery } from '../lib/http';

/**
 * Sprint 16 — Weaver master (outside weavers). Names unique (case-insensitive) and short codes unique among active
 * weavers; soft delete, blocked (409) while the weaver is on a PO. Same shape as the party masters.
 */

const columns = {
  id: weavers.id,
  name: weavers.name,
  shortCode: weavers.shortCode,
  mobile: weavers.mobile,
  address: weavers.address,
  gstin: weavers.gstin,
  notes: weavers.notes,
  createdAt: weavers.createdAt,
  updatedAt: weavers.updatedAt,
};

export async function listWeavers({ page, limit, search }: PaginationQuery): Promise<Paginated<Weaver>> {
  const p = search ? likePattern(search) : null;
  const where = and(
    eq(weavers.isDeleted, false),
    p ? or(sql`${weavers.name} LIKE ${p} ESCAPE '\\'`, sql`${weavers.shortCode} LIKE ${p} ESCAPE '\\'`, sql`${weavers.mobile} LIKE ${p} ESCAPE '\\'`) : undefined,
  );
  const [items, [{ total }]] = await db.batch([
    db.select(columns).from(weavers).where(where).orderBy(asc(sql`lower(${weavers.name})`)).limit(limit).offset((page - 1) * limit),
    db.select({ total: count() }).from(weavers).where(where),
  ]);
  return { items, page, limit, total, hasMore: page * limit < total };
}

/** GET /lookup/weavers — active weavers for the PO form. */
export async function lookupWeavers(search?: string): Promise<WeaverLookupItem[]> {
  return db
    .select({ id: weavers.id, name: weavers.name, shortCode: weavers.shortCode })
    .from(weavers)
    .where(and(eq(weavers.isDeleted, false), search ? sql`(${weavers.name} LIKE ${likePattern(search)} ESCAPE '\\' OR ${weavers.shortCode} = ${search.toUpperCase()})` : undefined))
    .orderBy(asc(sql`lower(${weavers.name})`))
    .limit(100);
}

export async function getWeaver(id: number): Promise<Weaver> {
  const [row] = await db.select(columns).from(weavers).where(and(eq(weavers.id, id), eq(weavers.isDeleted, false)));
  if (!row) throw notFound('Weaver');
  return row;
}

/** GET /weavers/suggest-code?name= — the code suggested for a name (taken codes are skipped). */
export async function suggestCode(name: string): Promise<{ code: string }> {
  const taken = await db.select({ code: weavers.shortCode }).from(weavers).where(eq(weavers.isDeleted, false));
  return { code: suggestWeaverCode(name, taken.map((t) => t.code)) };
}

async function assertUnique(name: string, shortCode: string, exceptId?: number) {
  const others = and(eq(weavers.isDeleted, false), exceptId ? ne(weavers.id, exceptId) : undefined);
  const [byName] = await db.select({ name: weavers.name }).from(weavers).where(and(others, sql`lower(${weavers.name}) = lower(${name})`)).limit(1);
  if (byName) throw conflict(`A weaver named "${byName.name}" already exists`, 'name');
  const [byCode] = await db.select({ name: weavers.name }).from(weavers).where(and(others, eq(weavers.shortCode, shortCode))).limit(1);
  if (byCode) throw conflict(`Short code ${shortCode} is already used by ${byCode.name}`, 'shortCode');
}

export async function createWeaver(input: unknown): Promise<Weaver> {
  const data = weaverInputSchema.parse(input);
  await assertUnique(data.name, data.shortCode);
  const [row] = await db.insert(weavers).values(data).returning(columns);
  return row;
}

/**
 * A weaver's short code may change only while none of its takas carries it (code + weaver number = the system number of
 * takas received without our number) — otherwise those numbers would no longer match.
 */
export async function updateWeaver(id: number, input: unknown): Promise<Weaver> {
  const data = weaverInputSchema.parse(input);
  const current = await getWeaver(id);
  await assertUnique(data.name, data.shortCode, id);
  if (current.shortCode !== data.shortCode) {
    const [{ n }] = await db
      .select({ n: count() })
      .from(takas)
      .where(and(eq(takas.weaverId, id), eq(takas.isDeleted, false), eq(takas.hasOwnNumber, false)));
    if (n > 0) throw conflict(`The short code can't change: ${n} taka${n === 1 ? '' : 's'} already carry ${current.shortCode}.`, 'shortCode');
  }
  const [row] = await db.update(weavers).set(data).where(and(eq(weavers.id, id), eq(weavers.isDeleted, false))).returning(columns);
  if (!row) throw notFound('Weaver');
  return row;
}

/** Soft delete; blocked (409) while the weaver is on any PO (cancelled ones included — they are on record). */
export async function deleteWeaver(id: number): Promise<void> {
  await getWeaver(id);
  const [{ used }] = await db.select({ used: count() }).from(outsidePos).where(eq(outsidePos.weaverId, id));
  if (used > 0) throw conflict(`This weaver can't be deleted because it is used on ${used} PO${used === 1 ? '' : 's'}.`);
  await db.update(weavers).set({ isDeleted: true }).where(eq(weavers.id, id));
}
