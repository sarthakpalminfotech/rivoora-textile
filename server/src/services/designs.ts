import { and, count, desc, eq, inArray, ne, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  designBulkSchema,
  designInputSchema,
  NO_QUALITY_LABEL,
  normalizeCode,
  parseQualityParam,
  QUALITY_CARD_THUMBS,
  type Design,
  type DesignBulkResult,
  type DesignListItem,
  type DesignQuality,
  type DesignQualityGroup,
  type Paginated,
} from '@rivoora/shared';
import { db, type DbOrTx, type Tx } from '../db/client';
import { designQualities, designs, materials, orders } from '../db/schema';
import { badRequest, conflict, notFound } from '../lib/errors';
import { likePattern, paginationSchema } from '../lib/http';

/*
 * Sprint 18: every design is standalone (variations are gone — migration 0017 turned them into designs) and belongs to
 * one or more qualities (`design_qualities`). `designs.material_id` is deprecated and never read or written here.
 */

/** The design's ACTIVE qualities as a JSON array (outer column written explicitly — see the Drizzle gotcha). */
export const designQualitiesJson = sql<string | null>`(SELECT json_group_array(json_object('id', m.id, 'name', m.name)) FROM design_qualities dq JOIN materials m ON m.id = dq.material_id AND m.is_deleted = 0 WHERE dq.design_id = "designs"."id")`;

/** "Georgette, Silk" — the design's qualities by name (null when it has none). Outer column written explicitly. */
export const designQualityNames = sql<string | null>`(SELECT group_concat(name, ', ') FROM (SELECT m.name AS name FROM design_qualities dq JOIN materials m ON m.id = dq.material_id AND m.is_deleted = 0 WHERE dq.design_id = "designs"."id" ORDER BY m.name))`;

export function parseQualities(raw: string | null): DesignQuality[] {
  if (!raw) return [];
  return (JSON.parse(raw) as DesignQuality[])
    .filter((q) => q && q.id !== null)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
}

/** The design has no active quality ("No quality" group). */
const hasNoQuality = sql`NOT EXISTS (SELECT 1 FROM design_qualities dq JOIN materials m ON m.id = dq.material_id AND m.is_deleted = 0 WHERE dq.design_id = "designs"."id")`;
const inQuality = (materialId: number) =>
  sql`EXISTS (SELECT 1 FROM design_qualities dq WHERE dq.design_id = "designs"."id" AND dq.material_id = ${materialId})`;

/** Search by design code (normalized) or name. */
function designSearch(search: string | undefined): SQL | undefined {
  if (!search) return undefined;
  return or(
    sql`${designs.code} LIKE ${likePattern(normalizeCode(search))} ESCAPE '\\'`,
    sql`${designs.name} LIKE ${likePattern(search)} ESCAPE '\\'`,
  );
}

const listColumns = {
  id: designs.id,
  code: designs.code,
  name: designs.name,
  thumbUrl: designs.thumbUrl,
  imageUrl: designs.imageUrl,
  buttaCutting: designs.buttaCutting,
  qualitiesJson: designQualitiesJson,
};

function toListItem({ qualitiesJson, ...r }: { qualitiesJson: string | null } & Omit<DesignListItem, 'qualities'>): DesignListItem {
  return { ...r, qualities: parseQualities(qualitiesJson) };
}

export const designListQuerySchema = paginationSchema.extend({
  /** `?quality=<materialId>` or `none` (designs without a quality). */
  quality: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? null : parseQualityParam(v))),
});

/** GET /designs — the designs of one quality (or every design), newest first. */
export async function listDesigns(query: unknown): Promise<Paginated<DesignListItem>> {
  const { page, limit, search, quality } = designListQuerySchema.parse(query);
  const where = and(
    eq(designs.isDeleted, false),
    designSearch(search),
    quality === 'none' ? hasNoQuality : quality !== null ? inQuality(quality) : undefined,
  );
  const [items, [{ total }]] = await db.batch([
    db
      .select(listColumns)
      .from(designs)
      .where(where)
      .orderBy(desc(designs.id))
      .limit(limit)
      .offset((page - 1) * limit),
    db.select({ total: count() }).from(designs).where(where),
  ]);
  return { items: items.map(toListItem), page, limit, total, hasMore: page * limit < total };
}

export const qualityGroupsQuerySchema = z.object({
  /** Only designs whose code / name match (the drawer's search). */
  search: z.string().trim().max(100).optional().transform((v) => v || undefined),
  /** Only qualities whose name matches (the Design master's search). */
  qualitySearch: z.string().trim().max(100).optional().transform((v) => v || undefined),
  /** Designs returned per group (the card's thumbnail strip / the drawer's first tiles). */
  designs: z.coerce.number().int().min(0).max(60).default(QUALITY_CARD_THUMBS),
});

/**
 * GET /designs/qualities — one group per quality that has designs (by name), plus "No quality" (last) when > 0, each
 * with its design count and its newest designs. Three small queries, whatever the number of qualities.
 */
export async function listQualityGroups(query: unknown): Promise<DesignQualityGroup[]> {
  const q = qualityGroupsQuerySchema.parse(query);
  const searchSql = designSearch(q.search);
  const designWhere = and(eq(designs.isDeleted, false), searchSql);
  const qualityWhere = and(
    eq(materials.isDeleted, false),
    q.qualitySearch ? sql`${materials.name} LIKE ${likePattern(q.qualitySearch)} ESCAPE '\\'` : undefined,
  );
  const showNoQuality = !q.qualitySearch || NO_QUALITY_LABEL.toLowerCase().includes(q.qualitySearch.toLowerCase());

  const [groupRows, [noQuality]] = await db.batch([
    db
      .select({ materialId: materials.id, name: materials.name, designCount: sql<number>`COUNT(DISTINCT ${designs.id})` })
      .from(designQualities)
      .innerJoin(designs, eq(designs.id, designQualities.designId))
      .innerJoin(materials, eq(materials.id, designQualities.materialId))
      .where(and(designWhere, qualityWhere))
      .groupBy(materials.id),
    db.select({ n: count() }).from(designs).where(and(designWhere, hasNoQuality)),
  ]);

  const groups: DesignQualityGroup[] = groupRows
    .map((g) => ({ materialId: g.materialId, name: g.name, designCount: Number(g.designCount), designs: [] as DesignListItem[] }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
  if (showNoQuality && noQuality.n > 0) groups.push({ materialId: null, name: NO_QUALITY_LABEL, designCount: noQuality.n, designs: [] });
  if (q.designs === 0 || groups.length === 0) return groups;

  // The newest `q.designs` designs of every group: one window query over the quality rows, one for "No quality".
  const materialIds = groups.flatMap((g) => (g.materialId === null ? [] : [g.materialId]));
  type RankedRow = Omit<DesignListItem, 'qualities' | 'buttaCutting'> & { buttaCutting: number; qualitiesJson: string | null; groupId: number };
  const [topRows, noQualityRows] = await Promise.all([
    materialIds.length
      ? db.all<RankedRow>(sql`
          SELECT id, code, name, thumbUrl, imageUrl, buttaCutting, qualitiesJson, groupId FROM (
            SELECT "designs"."id" AS id, "designs"."code" AS code, "designs"."name" AS name, "designs"."thumb_url" AS thumbUrl,
              "designs"."image_url" AS imageUrl, "designs"."butta_cutting" AS buttaCutting, ${designQualitiesJson} AS qualitiesJson,
              "design_qualities"."material_id" AS groupId,
              ROW_NUMBER() OVER (PARTITION BY "design_qualities"."material_id" ORDER BY "designs"."id" DESC) AS rn
            FROM "design_qualities" JOIN "designs" ON "designs"."id" = "design_qualities"."design_id"
            WHERE ${designWhere} AND "design_qualities"."material_id" IN (${sql.join(materialIds.map((id) => sql`${id}`), sql`, `)})
          ) WHERE rn <= ${q.designs}`)
      : Promise.resolve([] as RankedRow[]),
    groups.some((g) => g.materialId === null)
      ? db.select(listColumns).from(designs).where(and(designWhere, hasNoQuality)).orderBy(desc(designs.id)).limit(q.designs)
      : Promise.resolve([]),
  ]);
  const byGroup = new Map<number | null, DesignListItem[]>();
  for (const { groupId, buttaCutting, ...r } of topRows) {
    const list = byGroup.get(Number(groupId)) ?? [];
    list.push(toListItem({ ...r, buttaCutting: Boolean(buttaCutting) }));
    byGroup.set(Number(groupId), list);
  }
  byGroup.set(null, noQualityRows.map(toListItem));
  for (const g of groups) g.designs = (byGroup.get(g.materialId) ?? []).sort((a, b) => b.id - a.id);
  return groups;
}

export async function getDesign(id: number, tx: DbOrTx = db): Promise<Design> {
  const [row] = await tx
    .select({
      id: designs.id,
      code: designs.code,
      name: designs.name,
      imageUrl: designs.imageUrl,
      thumbUrl: designs.thumbUrl,
      notes: designs.notes,
      buttaCutting: designs.buttaCutting,
      createdAt: designs.createdAt,
      updatedAt: designs.updatedAt,
      qualitiesJson: designQualitiesJson,
    })
    .from(designs)
    .where(and(eq(designs.id, id), eq(designs.isDeleted, false)));
  if (!row) throw notFound('Design');
  const { qualitiesJson, ...rest } = row;
  return { ...rest, qualities: parseQualities(qualitiesJson) };
}

/** Codes are unique among active designs (variation codes became design codes in Sprint 18). */
export async function isDesignCodeTaken(code: string, exceptId?: number, tx: DbOrTx = db): Promise<boolean> {
  const [design] = await tx
    .select({ id: designs.id })
    .from(designs)
    .where(and(eq(designs.isDeleted, false), eq(designs.code, normalizeCode(code)), exceptId ? ne(designs.id, exceptId) : undefined))
    .limit(1);
  return Boolean(design);
}

/** Active codes among `codes` (normalized) — one query for "Upload many". */
export async function takenDesignCodes(codes: readonly string[], tx: DbOrTx = db): Promise<Set<string>> {
  const list = [...new Set(codes.map(normalizeCode))].filter(Boolean);
  if (!list.length) return new Set();
  const rows = await tx
    .select({ code: designs.code })
    .from(designs)
    .where(and(eq(designs.isDeleted, false), inArray(designs.code, list)));
  return new Set(rows.map((r) => r.code));
}

/** Every quality must exist and not be deleted. */
async function assertQualitiesExist(materialIds: readonly number[], tx: DbOrTx, field = 'materialIds') {
  const rows = await tx
    .select({ id: materials.id })
    .from(materials)
    .where(and(inArray(materials.id, [...materialIds]), eq(materials.isDeleted, false)));
  if (rows.length !== new Set(materialIds).size) throw badRequest('A selected quality no longer exists. Pick again.', field);
}

async function assertCodeFree(code: string, exceptId?: number, tx: DbOrTx = db, field = 'code') {
  if (await isDesignCodeTaken(code, exceptId, tx)) throw conflict(`Code ${code} is already used by another design`, field);
}

/** Replaces the design's qualities with `materialIds`. */
async function setQualities(tx: DbOrTx, designId: number, materialIds: readonly number[]) {
  await tx.delete(designQualities).where(eq(designQualities.designId, designId));
  if (materialIds.length) await tx.insert(designQualities).values(materialIds.map((materialId) => ({ designId, materialId })));
}

export async function insertDesign(
  tx: DbOrTx,
  data: {
    code: string;
    name?: string | null;
    notes?: string | null;
    imageUrl: string | null;
    thumbUrl: string | null;
    /** Sprint 18: the design's qualities (at least one on every new design). */
    materialIds: readonly number[];
    buttaCutting: boolean;
  },
  field = 'code',
  qualityField = 'materialIds',
) {
  await assertCodeFree(data.code, undefined, tx, field);
  await assertQualitiesExist(data.materialIds, tx, qualityField);
  const { materialIds, ...values } = data;
  const [row] = await tx.insert(designs).values(values).returning({ id: designs.id, code: designs.code });
  await setQualities(tx, row.id, materialIds);
  return row;
}

export async function createDesign(input: unknown): Promise<Design> {
  const data = designInputSchema.parse(input);
  const id = await db.transaction(async (tx) => (await insertDesign(tx, data)).id);
  return getDesign(id);
}

export async function updateDesign(id: number, input: unknown): Promise<Design> {
  const data = designInputSchema.parse(input);
  await db.transaction(async (tx) => {
    await getDesign(id, tx);
    await assertCodeFree(data.code, id, tx);
    await assertQualitiesExist(data.materialIds, tx);
    const { materialIds, ...values } = data;
    await tx.update(designs).set(values).where(eq(designs.id, id));
    await setQualities(tx, id, materialIds);
  });
  return getDesign(id);
}

/**
 * POST /designs/bulk — "Upload many": every row becomes a design, in ONE transaction (all or nothing). A problem is
 * reported on its row as field `designs.<index>.code` / `designs.<index>.materialIds`.
 */
export async function createDesignsBulk(input: unknown): Promise<DesignBulkResult> {
  const { designs: rows } = designBulkSchema.parse(input);
  const firstIndex = new Map<string, number>();
  rows.forEach((r, i) => {
    const prev = firstIndex.get(r.code);
    if (prev !== undefined) throw badRequest(`Code ${r.code} is used twice on this page`, `designs.${i}.code`);
    firstIndex.set(r.code, i);
  });
  return db.transaction(async (tx) => {
    const taken = await takenDesignCodes(rows.map((r) => r.code), tx);
    const clash = rows.findIndex((r) => taken.has(r.code));
    if (clash >= 0) throw conflict(`Code ${rows[clash].code} is already used by another design`, `designs.${clash}.code`);
    const created: DesignBulkResult['created'] = [];
    for (const [i, r] of rows.entries()) {
      created.push(await insertDesign(tx, r, `designs.${i}.code`, `designs.${i}.materialIds`));
    }
    return { created };
  });
}

export async function deleteDesign(id: number): Promise<void> {
  await getDesign(id);
  const [{ used }] = await db.select({ used: count() }).from(orders).where(eq(orders.designId, id));
  if (used > 0) {
    throw conflict(`This design can't be deleted because it is used in ${used} order${used === 1 ? '' : 's'}.`);
  }
  // Its quality rows stay (harmless: a deleted design is never listed).
  await db.update(designs).set({ isDeleted: true }).where(eq(designs.id, id));
}

/** Sprint 18: a new design uploaded from the order form goes into the order's quality. */
export async function insertDesignFromOrder(
  tx: Tx,
  data: { code: string; imageUrl: string; thumbUrl: string; buttaCutting: boolean },
  materialId: number,
) {
  return insertDesign(tx, { ...data, materialIds: [materialId] }, 'designCode', 'materialId');
}
