import { and, asc, count, eq, ne, or, sql } from 'drizzle-orm';
import { materialInputSchema, type LookupItem, type Material, type Paginated } from '@rivoora/shared';
import { db } from '../db/client';
import { materials, orders } from '../db/schema';
import { conflict, notFound } from '../lib/errors';
import { likePattern, type PaginationQuery } from '../lib/http';

const columns = {
  id: materials.id,
  name: materials.name,
  code: materials.code,
  notes: materials.notes,
  createdAt: materials.createdAt,
  updatedAt: materials.updatedAt,
};

function searchCondition(search?: string) {
  if (!search) return undefined;
  const p = likePattern(search);
  return or(
    sql`${materials.name} LIKE ${p} ESCAPE '\\'`,
    sql`${materials.code} LIKE ${p} ESCAPE '\\'`,
  );
}

export async function listMaterials({ page, limit, search }: PaginationQuery): Promise<Paginated<Material>> {
  const where = and(eq(materials.isDeleted, false), searchCondition(search));
  const [items, [{ total }]] = await db.batch([
    db
      .select(columns)
      .from(materials)
      .where(where)
      .orderBy(asc(sql`lower(${materials.name})`))
      .limit(limit)
      .offset((page - 1) * limit),
    db.select({ total: count() }).from(materials).where(where),
  ]);
  return { items, page, limit, total, hasMore: page * limit < total };
}

export async function lookupMaterials(search?: string): Promise<LookupItem[]> {
  return db
    .select({ id: materials.id, name: materials.name, code: materials.code })
    .from(materials)
    .where(and(eq(materials.isDeleted, false), searchCondition(search)))
    .orderBy(asc(sql`lower(${materials.name})`))
    .limit(50);
}

export async function getMaterial(id: number): Promise<Material> {
  const [row] = await db
    .select(columns)
    .from(materials)
    .where(and(eq(materials.id, id), eq(materials.isDeleted, false)));
  if (!row) throw notFound('Material');
  return row;
}

async function assertUniqueName(name: string, exceptId?: number) {
  const [dupe] = await db
    .select({ id: materials.id })
    .from(materials)
    .where(
      and(
        eq(materials.isDeleted, false),
        sql`lower(${materials.name}) = lower(${name})`,
        exceptId ? ne(materials.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  if (dupe) throw conflict(`A material named "${name}" already exists`, 'name');
}

export async function createMaterial(input: unknown): Promise<Material> {
  const data = materialInputSchema.parse(input);
  await assertUniqueName(data.name);
  const [row] = await db.insert(materials).values(data).returning(columns);
  return row;
}

export async function updateMaterial(id: number, input: unknown): Promise<Material> {
  const data = materialInputSchema.parse(input);
  await assertUniqueName(data.name, id);
  const [row] = await db
    .update(materials)
    .set(data)
    .where(and(eq(materials.id, id), eq(materials.isDeleted, false)))
    .returning(columns);
  if (!row) throw notFound('Material');
  return row;
}

export async function deleteMaterial(id: number): Promise<void> {
  await getMaterial(id);
  const [{ used }] = await db.select({ used: count() }).from(orders).where(eq(orders.materialId, id));
  if (used > 0) {
    throw conflict(
      `This material can't be deleted because it is used in ${used} order${used === 1 ? '' : 's'}.`,
    );
  }
  await db.update(materials).set({ isDeleted: true }).where(eq(materials.id, id));
}
