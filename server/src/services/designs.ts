import { and, asc, count, desc, eq, ne, or, sql } from 'drizzle-orm';
import {
  designInputSchema,
  normalizeCode,
  variationInputSchema,
  type Design,
  type DesignListItem,
  type DesignVariation,
  type Paginated,
} from '@rivoora/shared';
import { db, type DbOrTx } from '../db/client';
import { designVariations, designs, materials, orders } from '../db/schema';
import { badRequest, conflict, notFound } from '../lib/errors';
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
  materialId: materials.id,
  materialName: materials.name,
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
        materialName: materials.name,
      })
      .from(designs)
      .leftJoin(materials, eq(materials.id, designs.materialId))
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
      .leftJoin(materials, eq(materials.id, designs.materialId))
      .where(and(eq(designs.id, id), eq(designs.isDeleted, false))),
    db
      .select(variationColumns)
      .from(designVariations)
      .where(eq(designVariations.designId, id))
      .orderBy(asc(designVariations.variationNo)),
  ]);
  const row = rows[0];
  if (!row) throw notFound('Design');
  const { materialId, materialName, ...rest } = row;
  return {
    ...rest,
    material: materialId !== null && materialName !== null ? { id: materialId, name: materialName } : null,
    variations,
  };
}

/** Codes of active designs and of their variations share one namespace. */
export async function isDesignCodeTaken(code: string, exceptId?: number, tx: DbOrTx = db): Promise<boolean> {
  const normalized = normalizeCode(code);
  const [design] = await tx
    .select({ id: designs.id })
    .from(designs)
    .where(and(eq(designs.isDeleted, false), eq(designs.code, normalized), exceptId ? ne(designs.id, exceptId) : undefined))
    .limit(1);
  if (design) return true;
  return Boolean(await findActiveVariationByCode(normalized, undefined, tx));
}

async function findActiveVariationByCode(code: string, exceptId?: number, tx: DbOrTx = db) {
  const [row] = await tx
    .select({ id: designVariations.id })
    .from(designVariations)
    .innerJoin(designs, and(eq(designs.id, designVariations.designId), eq(designs.isDeleted, false)))
    .where(and(eq(designVariations.code, code), exceptId ? ne(designVariations.id, exceptId) : undefined))
    .limit(1);
  return row;
}

async function assertMaterialExists(materialId: number | null, tx: DbOrTx = db) {
  if (!materialId) return;
  const [row] = await tx
    .select({ id: materials.id })
    .from(materials)
    .where(and(eq(materials.id, materialId), eq(materials.isDeleted, false)));
  if (!row) throw badRequest('Selected material no longer exists', 'materialId');
}

async function assertCodeFree(code: string, exceptId?: number, tx: DbOrTx = db, field = 'code') {
  if (await isDesignCodeTaken(code, exceptId, tx)) {
    throw conflict(`Code ${code} is already used by another design or variation`, field);
  }
}

export async function insertDesign(
  tx: DbOrTx,
  data: {
    code: string;
    name?: string | null;
    notes?: string | null;
    imageUrl: string | null;
    thumbUrl: string | null;
    materialId?: number | null;
  },
  field = 'code',
) {
  await assertCodeFree(data.code, undefined, tx, field);
  await assertMaterialExists(data.materialId ?? null, tx);
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
  await getDesign(id);
  await assertCodeFree(data.code, id);
  await assertMaterialExists(data.materialId);
  // Variation codes are entered by hand, so they are not renamed with the design.
  await db.update(designs).set(data).where(eq(designs.id, id));
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
  await getDesign(designId);
  return db.transaction(async (tx) => {
    const [designDupe] = await tx
      .select({ id: designs.id })
      .from(designs)
      .where(and(eq(designs.isDeleted, false), eq(designs.code, data.code)))
      .limit(1);
    if (designDupe || (await findActiveVariationByCode(data.code, undefined, tx))) {
      throw conflict(`Code ${data.code} is already used by another design or variation`, 'code');
    }
    const [{ maxNo }] = await tx
      .select({ maxNo: sql<number>`COALESCE(MAX(${designVariations.variationNo}), 0)` })
      .from(designVariations)
      .where(eq(designVariations.designId, designId));
    const variationNo = Number(maxNo) + 1;
    const [row] = await tx
      .insert(designVariations)
      .values({ designId, variationNo, ...data })
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
