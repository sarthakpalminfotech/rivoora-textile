import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  can,
  DAMAGED_LOT_COUNTER,
  damageLabel,
  damagedLotLabel,
  damagedLotSchema,
  type DamagedFreeTaka,
  type DamagedLotDetail,
  type DamagedLotRow,
  type Paginated,
  type RoleKey,
} from '@rivoora/shared';
import { db } from '../db/client';
import { damagedLotTakas, damagedLots, damages as damageMaster, designs, materials, orders, takaDamages, takas } from '../db/schema';
import { conflict, notFound } from '../lib/errors';
import { currentUserId } from '../lib/request-context';
import { nextNumber } from '../lib/numbering';
import { paginationSchema } from '../lib/http';
import { loadFreeTakas, removeFreeTakas } from './stock-adjust';

/**
 * Sprint 22 (C9) — damaged free stock sold in a lot (Jenish, Gaurang). The ticked damaged takas leave stock with the
 * reason `sold_lot`, their open damages are closed as "sold", and one lot row (DL-n) remembers buyer, amount and takas.
 * The amount is shown only to roles with `canSeeRate`.
 */

const now = () => new Date().toISOString();
const round2 = (n: number) => Math.round(n * 100) / 100;


/** GET /inventory/damaged/free-takas?materialId=&designId=&type= — damaged FREE-stock takas to pick for a lot. */
export async function listDamagedFreeTakas(query: { materialId?: number; designId?: number; type?: string }): Promise<DamagedFreeTaka[]> {
  const rows = await db
    .select({
      id: takas.id,
      takaNo: takas.takaNo,
      materialId: orders.materialId,
      quality: materials.name,
      designId: orders.designId,
      designCode: designs.code,
      unit: orders.unit,
      pcs: sql<number | null>`COALESCE(${takas.actualPcs}, ${takas.pcs})`,
      meters: sql<number | null>`COALESCE(${takas.actualMeters}, ${takas.meters})`,
    })
    .from(takas)
    .innerJoin(orders, eq(orders.id, takas.orderId))
    .innerJoin(materials, eq(materials.id, orders.materialId))
    .leftJoin(designs, eq(designs.id, orders.designId))
    .where(
      and(
        eq(takas.isFreeStock, true),
        eq(takas.isDeleted, false),
        sql`EXISTS (SELECT 1 FROM taka_damages d WHERE d.taka_id = "takas"."id" AND d.is_deleted = 0 AND d.status = 'open')`,
        query.materialId ? eq(orders.materialId, query.materialId) : undefined,
        query.designId ? eq(orders.designId, query.designId) : undefined,
      ),
    )
    .orderBy(takas.id);
  const ids = rows.map((r) => r.id);
  const dmg = ids.length
    ? await db
        .select({ takaId: takaDamages.takaId, foundAt: takaDamages.foundAt, pcs: takaDamages.pcs, resolvedPcs: takaDamages.resolvedPcs, meters: takaDamages.meters, resolvedMeters: takaDamages.resolvedMeters, name: damageMaster.name })
        .from(takaDamages)
        .leftJoin(damageMaster, eq(damageMaster.id, takaDamages.damageId))
        .where(and(inArray(takaDamages.takaId, ids), eq(takaDamages.status, 'open'), eq(takaDamages.isDeleted, false)))
    : [];
  const by = new Map<number, DamagedFreeTaka['damages']>();
  for (const d of dmg) {
    const list = by.get(d.takaId) ?? [];
    list.push({ type: d.foundAt, label: damageLabel(d.foundAt, d.name, d.pcs !== null ? d.pcs - d.resolvedPcs : null, d.meters !== null ? d.meters - d.resolvedMeters : null) });
    by.set(d.takaId, list);
  }
  return rows.map((r) => ({ ...r, damages: by.get(r.id) ?? [] })).filter((r) => !query.type || r.damages.some((d) => d.type === query.type));
}

/** POST /inventory/damaged/lots */
export async function sellDamagedLot(role: RoleKey, input: unknown): Promise<{ lotId: number; label: string; takas: number; pcs: number; meters: number }> {
  const data = damagedLotSchema.parse(input);
  return db.transaction(async (tx) => {
    const rows = await loadFreeTakas(tx, data.takaIds);
    const open = new Set(
      (await tx.select({ takaId: takaDamages.takaId }).from(takaDamages).where(and(inArray(takaDamages.takaId, rows.map((r) => r.id)), eq(takaDamages.status, 'open'), eq(takaDamages.isDeleted, false)))).map((r) => r.takaId),
    );
    const notDamaged = rows.filter((r) => !open.has(r.id));
    if (notDamaged.length) throw conflict(`These takas have no open damage: ${notDamaged.slice(0, 10).map((r) => r.takaNo).join(', ')}.`);
    const at = now();
    const c = { value: await nextNumber(tx, DAMAGED_LOT_COUNTER) };
    const label = damagedLotLabel(c.value);
    const [lot] = await tx
      .insert(damagedLots)
      .values({ lotNo: c.value, lotDate: data.lotDate, buyer: data.buyer, amount: data.amount, note: data.note, role, userId: currentUserId(), createdAt: at, updatedAt: at })
      .returning({ id: damagedLots.id });
    // Close the open damages as "sold".
    await tx
      .update(takaDamages)
      .set({ status: 'resolved', resolvedPcs: sql`COALESCE(${takaDamages.pcs}, 0)`, resolvedMeters: sql`COALESCE(${takaDamages.meters}, 0)`, resolvedAt: at, resolvedBy: role, resolvedStage: 'sold_lot', updatedAt: at })
      .where(and(inArray(takaDamages.takaId, rows.map((r) => r.id)), eq(takaDamages.status, 'open'), eq(takaDamages.isDeleted, false)));
    const totals = await removeFreeTakas(tx, role, rows, 'sold_lot', `Sold in lot ${label}`, `Sold in damaged lot ${label}${data.buyer ? ` to ${data.buyer}` : ''}`, at);
    await tx.insert(damagedLotTakas).values(rows.map((r) => ({ lotId: lot.id, takaId: r.id, pcs: r.actualPcs ?? r.pcs, meters: r.actualMeters ?? r.meters, createdAt: at })));
    return { lotId: lot.id, label, takas: rows.length, pcs: totals.pcs, meters: totals.meters };
  });
}

const lotQuery = paginationSchema;

function toRow(role: RoleKey, r: { id: number; lotNo: number; lotDate: string; buyer: string | null; amount: number | null; note: string | null; takas: number; pcs: number; meters: number }): DamagedLotRow {
  return { ...r, label: damagedLotLabel(r.lotNo), takas: Number(r.takas), pcs: Number(r.pcs), meters: round2(Number(r.meters)), amount: can(role, 'canSeeRate') ? r.amount : null };
}

/** GET /inventory/damaged/lots — newest first. */
export async function listDamagedLots(role: RoleKey, query: unknown): Promise<Paginated<DamagedLotRow>> {
  const q = lotQuery.parse(query ?? {});
  const [items, [{ total }]] = await db.batch([
    db
      .select({
        id: damagedLots.id,
        lotNo: damagedLots.lotNo,
        lotDate: damagedLots.lotDate,
        buyer: damagedLots.buyer,
        amount: damagedLots.amount,
        note: damagedLots.note,
        takas: sql<number>`(SELECT COUNT(*) FROM damaged_lot_takas t WHERE t.lot_id = "damaged_lots"."id")`,
        pcs: sql<number>`(SELECT COALESCE(SUM(t.pcs), 0) FROM damaged_lot_takas t WHERE t.lot_id = "damaged_lots"."id")`,
        meters: sql<number>`(SELECT COALESCE(SUM(t.meters), 0) FROM damaged_lot_takas t WHERE t.lot_id = "damaged_lots"."id")`,
      })
      .from(damagedLots)
      .orderBy(desc(damagedLots.id))
      .limit(q.limit)
      .offset((q.page - 1) * q.limit),
    db.select({ total: sql<number>`COUNT(*)` }).from(damagedLots),
  ]);
  const count = Number(total);
  return { items: items.map((r) => toRow(role, r)), page: q.page, limit: q.limit, total: count, hasMore: q.page * q.limit < count };
}

/** GET /inventory/damaged/lots/:id */
export async function getDamagedLot(role: RoleKey, id: number): Promise<DamagedLotDetail> {
  const [lot] = await db.select().from(damagedLots).where(eq(damagedLots.id, id));
  if (!lot) throw notFound('Damaged lot');
  const items = await db
    .select({ takaId: damagedLotTakas.takaId, takaNo: takas.takaNo, quality: materials.name, designCode: designs.code, pcs: damagedLotTakas.pcs, meters: damagedLotTakas.meters })
    .from(damagedLotTakas)
    .innerJoin(takas, eq(takas.id, damagedLotTakas.takaId))
    .innerJoin(orders, eq(orders.id, takas.orderId))
    .innerJoin(materials, eq(materials.id, orders.materialId))
    .leftJoin(designs, eq(designs.id, orders.designId))
    .where(eq(damagedLotTakas.lotId, id))
    .orderBy(damagedLotTakas.id);
  const pcs = items.reduce((s, i) => s + (i.pcs ?? 0), 0);
  const meters = round2(items.reduce((s, i) => s + (i.meters ?? 0), 0));
  return { ...toRow(role, { id: lot.id, lotNo: lot.lotNo, lotDate: lot.lotDate, buyer: lot.buyer, amount: lot.amount, note: lot.note, takas: items.length, pcs, meters }), items };
}
