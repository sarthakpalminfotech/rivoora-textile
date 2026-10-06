import { and, asc, count, eq, ne, or, sql } from 'drizzle-orm';
import { CHALLAN_KIND_CONFIG, partyInputSchema, type ChallanKind, type ChallanParty, type LookupItem, type Paginated } from '@rivoora/shared';
import { db } from '../db/client';
import { buttaParties, challans, millParties } from '../db/schema';
import { conflict, notFound } from '../lib/errors';
import { likePattern, type PaginationQuery } from '../lib/http';

/**
 * Party masters of the challan kinds: butta parties and mill parties share the same fields and rules (one service,
 * `kind` picks the table). Names are unique (case-insensitive) among active rows; soft delete, blocked while on a challan.
 */

const table = (kind: ChallanKind) => (kind === 'butta' ? buttaParties : millParties);
const noun = (kind: ChallanKind) => CHALLAN_KIND_CONFIG[kind].partyLabel.toLowerCase();

function columns(kind: ChallanKind) {
  const t = table(kind);
  return { id: t.id, name: t.name, address: t.address, mobile: t.mobile, gstin: t.gstin, notes: t.notes, createdAt: t.createdAt, updatedAt: t.updatedAt };
}

function searchCondition(kind: ChallanKind, search?: string) {
  if (!search) return undefined;
  const t = table(kind);
  const p = likePattern(search);
  return or(
    sql`${t.name} LIKE ${p} ESCAPE '\\'`,
    sql`${t.mobile} LIKE ${p} ESCAPE '\\'`,
    sql`${t.gstin} LIKE ${p} ESCAPE '\\'`,
    sql`${t.address} LIKE ${p} ESCAPE '\\'`,
  );
}

export async function listParties(kind: ChallanKind, { page, limit, search }: PaginationQuery): Promise<Paginated<ChallanParty>> {
  const t = table(kind);
  const where = and(eq(t.isDeleted, false), searchCondition(kind, search));
  const [items, [{ total }]] = await db.batch([
    db
      .select(columns(kind))
      .from(t)
      .where(where)
      .orderBy(asc(sql`lower(${t.name})`))
      .limit(limit)
      .offset((page - 1) * limit),
    db.select({ total: count() }).from(t).where(where),
  ]);
  return { items, page, limit, total, hasMore: page * limit < total };
}

/** GET /lookup/<kind>-parties — active parties for the Send dialog. */
export async function lookupParties(kind: ChallanKind, search?: string): Promise<LookupItem[]> {
  const t = table(kind);
  return db
    .select({ id: t.id, name: t.name })
    .from(t)
    .where(and(eq(t.isDeleted, false), search ? sql`${t.name} LIKE ${likePattern(search)} ESCAPE '\\'` : undefined))
    .orderBy(asc(sql`lower(${t.name})`))
    .limit(100);
}

export async function getParty(kind: ChallanKind, id: number): Promise<ChallanParty> {
  const t = table(kind);
  const [row] = await db
    .select(columns(kind))
    .from(t)
    .where(and(eq(t.id, id), eq(t.isDeleted, false)));
  if (!row) throw notFound(CHALLAN_KIND_CONFIG[kind].partyLabel);
  return row;
}

async function assertUniqueName(kind: ChallanKind, name: string, exceptId?: number) {
  const t = table(kind);
  const [dupe] = await db
    .select({ name: t.name })
    .from(t)
    .where(and(eq(t.isDeleted, false), sql`lower(${t.name}) = lower(${name})`, exceptId ? ne(t.id, exceptId) : undefined))
    .limit(1);
  if (dupe) throw conflict(`A ${noun(kind)} named "${dupe.name}" already exists`, 'name');
}

export async function createParty(kind: ChallanKind, input: unknown): Promise<ChallanParty> {
  const data = partyInputSchema.parse(input);
  await assertUniqueName(kind, data.name);
  const [row] = await db.insert(table(kind)).values(data).returning(columns(kind));
  return row;
}

export async function updateParty(kind: ChallanKind, id: number, input: unknown): Promise<ChallanParty> {
  const data = partyInputSchema.parse(input);
  await assertUniqueName(kind, data.name, id);
  const t = table(kind);
  const [row] = await db
    .update(t)
    .set(data)
    .where(and(eq(t.id, id), eq(t.isDeleted, false)))
    .returning(columns(kind));
  if (!row) throw notFound(CHALLAN_KIND_CONFIG[kind].partyLabel);
  return row;
}

/** Soft delete; blocked (409) when the party is on any challan of its kind. */
export async function deleteParty(kind: ChallanKind, id: number): Promise<void> {
  await getParty(kind, id);
  const [{ used }] = await db
    .select({ used: count() })
    .from(challans)
    .where(and(eq(challans.kind, kind), eq(challans.partyId, id)));
  if (used > 0) {
    throw conflict(`This party can't be deleted because it is used on ${used} challan${used === 1 ? '' : 's'}.`);
  }
  await db.update(table(kind)).set({ isDeleted: true }).where(eq(table(kind).id, id));
}
