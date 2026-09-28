import { and, asc, count, desc, eq, ne, or, sql } from 'drizzle-orm';
import {
  designInputSchema,
  normalizeCode,
  variationCode,
  variationInputSchema,
  type Design,
  type DesignListItem,
  type DesignVariation,
  type Paginated,
} from '@rivoora/shared';
import { db, type DbOrTx } from '../db/client';
import { designVariations, designs, orders } from '../db/schema';
import { conflict, notFound } from '../lib/errors';
import { likePattern, type PaginationQuery } from '../lib/http';

const variationColumns = {
  id: designVariations.id,
  designId: designVariations.designId,
  variationNo: designVariations.variationNo,
  code: designVariations.code,
  imageUrl: designVariations.imageUrl,
  thumbUrl: designVariations.thumbUrl,
  createdAt: designVariations.createdAt,
};

const designColumns = {
  id: designs.id,
  code: designs.code,
  name: designs.name,
  imageUrl: designs.imageUrl,
  thumbUrl: designs.thumbUrl,
  notes: designs.notes,
  createdAt: designs.createdAt,
  updatedAt: designs.updatedAt,
};

export async function listDesigns({ page, limit, search }: PaginationQuery): Promise<Paginated<DesignListItem>> {
  let searchCond;
  if (search) {
    const p = likePattern(normalizeCode(search));
    const pName = likePattern(search);
    searchCond = or(
      sql`${designs.code} LIKE ${p} ESCAPE '\\'`,
      sql`${designs.name} LIKE ${pName} ESCAPE '\\'`,
      sql`EXISTS (SELECT 1 FROM ${designVariations} dv WHERE dv.design_id = "designs"."id" AND dv.code LIKE ${p} ESCAPE '\\')`,
    );
  }
  const where = and(eq(designs.isDeleted, false), searchCond);
  const [items, [{ total }]] = await db.batch([
    db
      .select({
        id: designs.id,
        code: designs.code,
        name: designs.name,
        thumbUrl: designs.thumbUrl,
        imageUrl: designs.imageUrl,
        variationCount: sql<number>`(SELECT COUNT(*) FROM ${designVariations} dv WHERE dv.design_id = "designs"."id")`,
      })
      .from(designs)
      .where(where)
      .orderBy(desc(designs.id))
      .limit(limit)
      .offset((page - 1) * limit),
    db.select({ total: count() }).from(designs).where(where),
  ]);
  return { items, page, limit, total, hasMore: page * limit < total };
}

export async function getDesign(id: number): Promise<Design> {
  const [rows, variations] = await db.batch([
    db
      .select(designColumns)
      .from(designs)
      .where(and(eq(designs.id, id), eq(designs.isDeleted, false))),
    db
      .select(variationColumns)
      .from(designVariations)
      .where(eq(designVariations.designId, id))
      .orderBy(asc(designVariations.variationNo)),
  ]);
  const row = rows[0];
  if (!row) throw notFound('Design');
  return { ...row, variations };
}

export async function isDesignCodeTaken(code: string, exceptId?: number, tx: DbOrTx = db): Promise<boolean> {
  const [dupe] = await tx
    .select({ id: designs.id })
    .from(designs)
    .where(
      and(
        eq(designs.isDeleted, false),
        eq(designs.code, normalizeCode(code)),
        exceptId ? ne(designs.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  return Boolean(dupe);
}

async function assertCodeFree(code: string, exceptId?: number, tx: DbOrTx = db, field = 'code') {
  if (await isDesignCodeTaken(code, exceptId, tx)) {
    throw conflict(`Design code ${code} is already used by another design`, field);
  }
}

export async function insertDesign(
  tx: DbOrTx,
  data: { code: string; name?: string | null; notes?: string | null; imageUrl: string | null; thumbUrl: string | null },
  field = 'code',
) {
  await assertCodeFree(data.code, undefined, tx, field);
  const [row] = await tx.insert(designs).values(data).returning({ id: designs.id, code: designs.code });
  return row;
}

export async function createDesign(input: unknown): Promise<Design> {
  const data = designInputSchema.parse(input);
  const row = await insertDesign(db, data);
  return getDesign(row.id);
}

export async function updateDesign(id: number, input: unknown): Promise<Design> {
  const data = designInputSchema.parse(input);
  const current = await getDesign(id);
  await assertCodeFree(data.code, id);
  await db.transaction(async (tx) => {
    await tx.update(designs).set(data).where(eq(designs.id, id));
    // Variation codes are derived from the design code — keep them in step.
    if (current.code !== data.code) {
      for (const v of current.variations) {
        await tx
          .update(designVariations)
          .set({ code: variationCode(data.code, v.variationNo) })
          .where(eq(designVariations.id, v.id));
      }
    }
  });
  return getDesign(id);
}

export async function deleteDesign(id: number): Promise<void> {
  await getDesign(id);
  const [{ used }] = await db.select({ used: count() }).from(orders).where(eq(orders.designId, id));
  if (used > 0) {
    throw conflict(`This design can't be deleted because it is used in ${used} order${used === 1 ? '' : 's'}.`);
  }
  await db.update(designs).set({ isDeleted: true }).where(eq(designs.id, id));
}

export async function addVariation(designId: number, input: unknown): Promise<DesignVariation> {
  const data = variationInputSchema.parse(input);
  const design = await getDesign(designId);
  return db.transaction(async (tx) => {
    const [{ maxNo }] = await tx
      .select({ maxNo: sql<number>`COALESCE(MAX(${designVariations.variationNo}), 0)` })
      .from(designVariations)
      .where(eq(designVariations.designId, designId));
    const variationNo = Number(maxNo) + 1;
    const [row] = await tx
      .insert(designVariations)
      .values({ designId, variationNo, code: variationCode(design.code, variationNo), ...data })
      .returning(variationColumns);
    return row;
  });
}

export async function deleteVariation(designId: number, variationId: number): Promise<void> {
  const [variation] = await db
    .select({ id: designVariations.id, code: designVariations.code })
    .from(designVariations)
    .where(and(eq(designVariations.id, variationId), eq(designVariations.designId, designId)));
  if (!variation) throw notFound('Variation');
  const [{ used }] = await db.select({ used: count() }).from(orders).where(eq(orders.variationId, variationId));
  if (used > 0) {
    throw conflict(
      `Variation ${variation.code} can't be removed because it is used in ${used} order${used === 1 ? '' : 's'}.`,
    );
  }
  await db.delete(designVariations).where(eq(designVariations.id, variationId));
}
