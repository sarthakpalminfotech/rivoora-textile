import { and, desc, eq, gte, inArray, like, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  addStockSchema,
  compareTakaNo,
  isManualStockOrderNo,
  MANUAL_STOCK_REASON,
  nextSplitNumber,
  partialMoveMeters,
  planPcsMove,
  removeRemark,
  removeStockSchema,
  takaActualMeters,
  takaActualPcs,
  type StockAdjustmentRow,
  type Paginated,
  type RoleKey,
} from '@rivoora/shared';
import { db, type Tx } from '../db/client';
import { counters, customers, designs, materials, orders, stockAdjustments, takaDamages, takas, users } from '../db/schema';
import { badRequest, conflict } from '../lib/errors';
import { currentUserId } from '../lib/request-context';
import { paginationSchema } from '../lib/http';
import { ensureExternalJobsheet } from './external';
import { addNewDamages, type NewDamageInput } from './qc-shared';
import { nextDummyTakaNo, refreshIsDamaged, writeTakaEvents, type TakaEventInput } from './taka-ops';

/**
 * Sprint 22 (C2 / CR-14 / B3) — manual finished stock (Jenish, Gaurang: `canAdjustFinishedStock`).
 * - Add stock: ONE free-stock taka with a dummy number (D01 …), reason `manual_add`, hung on the hidden stock-holder
 *   order of its (design, quality, unit, blouse). Shown everywhere as "Manual stock".
 * - Remove stock: FREE stock only, by ticking takas or (pcs) an amount; a reason is required.
 * - Every add / remove writes a `stock_adjustments` row (the Stock adjustments list).
 */

const now = () => new Date().toISOString();
const round2 = (n: number) => Math.round(n * 100) / 100;
const HOLDER_COUNTER = 'stock_holder_order_no';

/** The reserved "Stock (system)" customer the holder orders point to (soft-deleted so no list shows it). */
async function systemCustomerId(tx: Tx): Promise<number> {
  const [found] = await tx.select({ id: customers.id }).from(customers).where(eq(customers.isSystem, true)).limit(1);
  if (found) return found.id;
  const [row] = await tx.insert(customers).values({ name: 'Stock (system)', isSystem: true, isDeleted: true }).returning({ id: customers.id });
  return row.id;
}

/** Found-or-created inside the caller's transaction (the unique index guards a race). */
export async function holderOrderId(
  tx: Tx,
  _role: RoleKey,
  key: { designId: number; materialId: number; unit: 'pcs' | 'meters'; blouseOption: 'with_blouse' | 'without_blouse' | null },
): Promise<number> {
  const find = async () => {
    const [row] = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(
        and(
          eq(orders.isStockHolder, true),
          eq(orders.designId, key.designId),
          eq(orders.materialId, key.materialId),
          eq(orders.unit, key.unit),
          sql`COALESCE(${orders.blouseOption}, '') = ${key.blouseOption ?? ''}`,
        ),
      );
    return row?.id ?? null;
  };
  const existing = await find();
  if (existing) return existing;
  const [c] = await tx
    .insert(counters)
    .values({ name: HOLDER_COUNTER, value: 1 })
    .onConflictDoUpdate({ target: counters.name, set: { value: sql`${counters.value} + 1` } })
    .returning({ value: counters.value });
  const at = now();
  try {
    const [row] = await tx
      .insert(orders)
      .values({
        orderNo: -c.value,
        customerId: await systemCustomerId(tx),
        orderType: 'lump',
        materialId: key.materialId,
        designId: key.designId,
        blouseOption: key.blouseOption,
        quantity: 0,
        unit: key.unit,
        orderDate: at.slice(0, 10),
        status: 'closed',
        isClosed: true,
        isStockHolder: true,
        hasProduction: false,
        hasButta: false,
        hasMill: false,
      })
      .returning({ id: orders.id });
    return row.id;
  } catch (err) {
    const again = await find();
    if (again) return again;
    throw err;
  }
}

export interface StockAddResult {
  takaId: number;
  takaNo: string;
  unit: 'pcs' | 'meters';
  quantity: number;
  damaged: number;
}

/** POST /inventory/stock/add */
export async function addStock(role: RoleKey, input: unknown): Promise<StockAddResult> {
  const data = addStockSchema.parse(input);
  return db.transaction(async (tx) => {
    const [design] = await tx.select({ id: designs.id, code: designs.code }).from(designs).where(and(eq(designs.id, data.designId), eq(designs.isDeleted, false)));
    if (!design) throw badRequest('That design no longer exists.', 'designId');
    const [mat] = await tx.select({ id: materials.id }).from(materials).where(and(eq(materials.id, data.materialId), eq(materials.isDeleted, false)));
    if (!mat) throw badRequest('That quality no longer exists.', 'materialId');
    const inQuality = await tx.all(sql`SELECT 1 AS x FROM design_qualities WHERE design_id = ${data.designId} AND material_id = ${data.materialId} LIMIT 1`);
    if (!inQuality.length) throw badRequest('This design is not in that quality.', 'designId');

    const blouse = data.unit === 'pcs' ? data.blouseOption : null;
    const holderId = await holderOrderId(tx, role, { designId: data.designId, materialId: data.materialId, unit: data.unit, blouseOption: blouse });
    const jobsheetId = await ensureExternalJobsheet(tx, holderId, role);
    const takaNo = await nextDummyTakaNo(tx);
    const at = now();
    const pcs = data.unit === 'pcs' ? data.quantity : null;
    const meters = data.unit === 'meters' ? round2(data.quantity) : null;
    const [taka] = await tx
      .insert(takas)
      .values({
        jobsheetId,
        orderId: holderId,
        takaNo,
        pcs,
        meters,
        stage: 'final',
        isFreeStock: true,
        freeStockAt: at,
        freeStockBy: role,
        freeStockReason: MANUAL_STOCK_REASON,
        hasOwnNumber: true,
        enteredBy: role,
        createdAt: at,
        updatedAt: at,
      })
      .returning({ id: takas.id });
    const events: TakaEventInput[] = [
      { takaId: taka.id, event: 'stock_added', note: `Manual stock · ${data.unit === 'pcs' ? `${data.quantity} pcs` : `${round2(data.quantity)} m`} · ${data.condition}${data.remark ? ` · ${data.remark}` : ''}` },
    ];
    let damaged = 0;
    if (data.condition === 'damaged' && data.damage) {
      const d = data.damage;
      const damage: NewDamageInput = {
        type: d.type as NewDamageInput['type'],
        ...(data.unit === 'pcs' ? { pcs: d.qty } : { meters: round2(d.qty) }),
        images: [],
        ...('damageId' in d ? { damageId: d.damageId } : { otherName: d.otherName }),
      };
      events.push(...(await addNewDamages(tx, role, taka.id, [damage], 'inventory', at, 'damage')));
      await refreshIsDamaged(tx, [taka.id]);
      damaged = d.qty;
    }
    await writeTakaEvents(tx, role, events);
    await tx.insert(stockAdjustments).values({
      kind: 'add',
      designId: data.designId,
      materialId: data.materialId,
      unit: data.unit,
      qty: data.unit === 'pcs' ? data.quantity : round2(data.quantity),
      condition: data.condition,
      takaId: taka.id,
      remark: data.remark ?? 'Manual add',
      role,
      userId: currentUserId(),
      createdAt: at,
    });
    return { takaId: taka.id, takaNo, unit: data.unit, quantity: data.quantity, damaged };
  });
}

export interface StockRemoveResult {
  takas: number;
  pcs: number;
  meters: number;
  split: boolean;
  reasonText: string;
}

interface FreeRow {
  id: number;
  takaNo: string;
  stage: typeof takas.$inferSelect.stage;
  pcs: number | null;
  actualPcs: number | null;
  meters: number | null;
  actualMeters: number | null;
  jobsheetId: number;
  orderId: number;
  designId: number | null;
  materialId: number;
  unit: string;
  hasBeenToMill: boolean;
  originOrderId: number | null;
  freeStockReason: typeof takas.$inferSelect.freeStockReason;
  source: typeof takas.$inferSelect.source;
  weaverId: number | null;
  weaverTakaNo: string | null;
  hasOwnNumber: boolean;
  outsideReceiptId: number | null;
}

const freeSelect = {
  id: takas.id,
  takaNo: takas.takaNo,
  stage: takas.stage,
  pcs: takas.pcs,
  actualPcs: takas.actualPcs,
  meters: takas.meters,
  actualMeters: takas.actualMeters,
  jobsheetId: takas.jobsheetId,
  orderId: takas.orderId,
  designId: orders.designId,
  materialId: orders.materialId,
  unit: orders.unit,
  hasBeenToMill: takas.hasBeenToMill,
  originOrderId: takas.originOrderId,
  freeStockReason: takas.freeStockReason,
  source: takas.source,
  weaverId: takas.weaverId,
  weaverTakaNo: takas.weaverTakaNo,
  hasOwnNumber: takas.hasOwnNumber,
  outsideReceiptId: takas.outsideReceiptId,
};

/** Free-stock takas by id (all must still be free stock). */
export async function loadFreeTakas(tx: Tx, ids: readonly number[]): Promise<FreeRow[]> {
  const rows = await tx
    .select(freeSelect)
    .from(takas)
    .innerJoin(orders, eq(orders.id, takas.orderId))
    .where(and(inArray(takas.id, [...ids]), eq(takas.isFreeStock, true), eq(takas.isDeleted, false)));
  if (rows.length !== new Set(ids).size) throw conflict('Some takas are no longer free stock. Refresh and try again.');
  return rows;
}

async function writeAdjustment(tx: Tx, role: RoleKey, t: { takaId: number; designId: number | null; materialId: number; unit: string; qty: number; damaged: boolean }, remark: string, at: string) {
  await tx.insert(stockAdjustments).values({
    kind: 'remove',
    designId: t.designId,
    materialId: t.materialId,
    unit: (t.unit === 'meters' ? 'meters' : 'pcs') as 'pcs' | 'meters',
    qty: t.qty,
    condition: t.damaged ? 'damaged' : 'fresh',
    takaId: t.takaId,
    remark,
    role,
    userId: currentUserId(),
    createdAt: at,
  });
}

/** Soft-removes free-stock takas (they leave every stock figure); one adjustment + event per taka. Used by Remove stock and the damaged lots. */
export async function removeFreeTakas(tx: Tx, role: RoleKey, rows: readonly FreeRow[], reasonCode: string, remark: string, eventNote: string, at: string): Promise<{ pcs: number; meters: number }> {
  let pcs = 0;
  let meters = 0;
  const damagedIds = new Set(
    (await tx.select({ takaId: takaDamages.takaId }).from(takaDamages).where(and(inArray(takaDamages.takaId, rows.map((r) => r.id)), eq(takaDamages.status, 'open'), eq(takaDamages.isDeleted, false)))).map((r) => r.takaId),
  );
  for (const r of rows) {
    const moved = await tx
      .update(takas)
      .set({ isDeleted: true, removedAt: at, removedByUserId: currentUserId(), removedReason: reasonCode, updatedAt: at })
      .where(and(eq(takas.id, r.id), eq(takas.isFreeStock, true), eq(takas.isDeleted, false)))
      .returning({ id: takas.id });
    if (!moved.length) throw conflict(`Taka ${r.takaNo} changed meanwhile. Refresh and try again.`);
    const p = takaActualPcs(r) ?? 0;
    const m = takaActualMeters(r) ?? 0;
    pcs += p;
    meters += m;
    await writeAdjustment(tx, role, { takaId: r.id, designId: r.designId, materialId: r.materialId, unit: r.unit, qty: r.unit === 'meters' ? round2(m) : p, damaged: damagedIds.has(r.id) }, remark, at);
  }
  await writeTakaEvents(tx, role, rows.map((r): TakaEventInput => ({ takaId: r.id, event: 'stock_removed', note: eventNote })));
  return { pcs, meters: round2(meters) };
}

/** POST /inventory/stock/remove */
export async function removeStock(role: RoleKey, input: unknown): Promise<StockRemoveResult> {
  const data = removeStockSchema.parse(input);
  const remark = removeRemark(data.reason, data.note);
  return db.transaction(async (tx) => {
    const at = now();
    let rows: FreeRow[] = [];
    let split = false;
    if (data.takaIds) {
      rows = await loadFreeTakas(tx, data.takaIds);
    } else {
      // pcs mode: ready (final) free pcs of one design + quality, largest first; a taka needed only partly is split.
      const candidates = await tx
        .select(freeSelect)
        .from(takas)
        .innerJoin(orders, eq(orders.id, takas.orderId))
        .where(and(eq(takas.isFreeStock, true), eq(takas.isDeleted, false), eq(takas.stage, 'final'), eq(orders.designId, data.designId!), eq(orders.materialId, data.materialId!), eq(orders.unit, 'pcs')));
      const plan = planPcsMove(candidates, data.pcs!);
      if (plan.shortBy > 0) {
        const have = data.pcs! - plan.shortBy;
        throw badRequest(have > 0 ? `Only ${have} pcs of free stock are ready.` : 'There is no ready free stock of this design and quality.', 'pcs');
      }
      const byId = new Map(candidates.map((c) => [c.id, c]));
      rows = plan.whole.map((id) => byId.get(id)!);
      if (plan.partial) {
        const parent = byId.get(plan.partial.id)!;
        const taken = (await tx.select({ no: takas.takaNo }).from(takas).where(and(like(takas.takaNo, `${parent.takaNo.replace(/[A-Z]$/, '')}%`), eq(takas.isDeleted, false)))).map((r) => r.no);
        const newNo = nextSplitNumber(parent.takaNo, taken);
        if (!newNo) throw conflict(`Taka ${parent.takaNo} can't be split any further.`);
        const meterParts = partialMoveMeters(parent.meters, plan.partial.keepPcs, plan.partial.movePcs);
        const kept = await tx
          .update(takas)
          .set({ pcs: plan.partial.keepPcs, actualPcs: null, meters: meterParts.keep, updatedAt: at })
          .where(and(eq(takas.id, parent.id), eq(takas.isFreeStock, true), eq(takas.stage, 'final')))
          .returning({ id: takas.id });
        if (!kept.length) throw conflict(`Taka ${parent.takaNo} was just changed. Refresh and try again.`);
        const [part] = await tx
          .insert(takas)
          .values({
            jobsheetId: parent.jobsheetId,
            orderId: parent.orderId,
            takaNo: newNo,
            pcs: plan.partial.movePcs,
            meters: meterParts.move,
            stage: 'final',
            parentTakaId: parent.id,
            isFreeStock: true,
            freeStockAt: at,
            freeStockBy: role,
            freeStockReason: parent.freeStockReason,
            hasBeenToMill: parent.hasBeenToMill,
            originOrderId: parent.originOrderId,
            source: parent.source,
            weaverId: parent.weaverId,
            hasOwnNumber: parent.hasOwnNumber,
            outsideReceiptId: parent.outsideReceiptId,
            enteredBy: role,
            createdAt: at,
            updatedAt: at,
          })
          .returning({ id: takas.id });
        await writeTakaEvents(tx, role, [
          { takaId: parent.id, event: 'split', note: `split into ${parent.takaNo} (${plan.partial.keepPcs} pcs) and ${newNo} (${plan.partial.movePcs} pcs) · ${remark}` },
          { takaId: part.id, event: 'split', note: `split from ${parent.takaNo}` },
        ]);
        rows.push({ ...parent, id: part.id, takaNo: newNo, pcs: plan.partial.movePcs, actualPcs: null, meters: meterParts.move, actualMeters: null });
        split = true;
      }
    }
    const done = await removeFreeTakas(tx, role, rows, data.reason, remark, `Stock removed · ${remark}`, at);
    return { takas: rows.length, pcs: done.pcs, meters: done.meters, split, reasonText: remark };
  });
}

/* ------------------------------------------------------------------ */
/* Stock adjustments list                                               */
/* ------------------------------------------------------------------ */

export const adjustmentsQuerySchema = paginationSchema.extend({
  kind: z.enum(['add', 'remove']).optional().catch(undefined),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  designId: z.coerce.number().int().positive().optional().catch(undefined),
  userId: z.coerce.number().int().positive().optional().catch(undefined),
});

/** GET /inventory/stock-adjustments */
export async function listStockAdjustments(query: unknown): Promise<Paginated<StockAdjustmentRow>> {
  const q = adjustmentsQuerySchema.parse(query ?? {});
  const where = and(
    q.kind ? eq(stockAdjustments.kind, q.kind) : undefined,
    q.from ? gte(stockAdjustments.createdAt, `${q.from}T00:00:00`) : undefined,
    q.to ? lte(stockAdjustments.createdAt, `${q.to}T23:59:59.999Z`) : undefined,
    q.designId ? eq(stockAdjustments.designId, q.designId) : undefined,
    q.userId ? eq(stockAdjustments.userId, q.userId) : undefined,
  );
  const [items, [{ total }]] = await db.batch([
    db
      .select({
        id: stockAdjustments.id,
        kind: stockAdjustments.kind,
        createdAt: stockAdjustments.createdAt,
        quality: materials.name,
        designCode: designs.code,
        unit: stockAdjustments.unit,
        qty: stockAdjustments.qty,
        condition: stockAdjustments.condition,
        takaNo: takas.takaNo,
        remark: stockAdjustments.remark,
        userName: users.name,
        role: stockAdjustments.role,
      })
      .from(stockAdjustments)
      .innerJoin(materials, eq(materials.id, stockAdjustments.materialId))
      .leftJoin(designs, eq(designs.id, stockAdjustments.designId))
      .leftJoin(takas, eq(takas.id, stockAdjustments.takaId))
      .leftJoin(users, eq(users.id, stockAdjustments.userId))
      .where(where)
      .orderBy(desc(stockAdjustments.id))
      .limit(q.limit)
      .offset((q.page - 1) * q.limit),
    db.select({ total: sql<number>`COUNT(*)` }).from(stockAdjustments).where(where),
  ]);
  const count = Number(total);
  return { items, page: q.page, limit: q.limit, total: count, hasMore: q.page * q.limit < count };
}

/** Free-stock takas of one design + quality for the Remove stock picker (whole takas). */
export async function listRemovableTakas(designId: number, materialId: number) {
  const rows = await db
    .select({
      id: takas.id,
      takaNo: takas.takaNo,
      stage: takas.stage,
      pcs: sql<number | null>`COALESCE(${takas.actualPcs}, ${takas.pcs})`,
      meters: sql<number | null>`COALESCE(${takas.actualMeters}, ${takas.meters})`,
      unit: orders.unit,
      fromOrderNo: orders.orderNo,
      reason: takas.freeStockReason,
      isDamaged: takas.isDamaged,
    })
    .from(takas)
    .innerJoin(orders, eq(orders.id, takas.orderId))
    .where(and(eq(takas.isFreeStock, true), eq(takas.isDeleted, false), eq(orders.designId, designId), eq(orders.materialId, materialId)));
  return rows.sort((a, b) => compareTakaNo(a.takaNo, b.takaNo)).map((r) => ({ ...r, isManual: isManualStockOrderNo(r.fromOrderNo) }));
}

