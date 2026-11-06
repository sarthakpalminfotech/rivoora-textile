import { and, asc, desc, eq, inArray, like, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  compareTakaNo,
  lineDamageError,
  lineDamagedQty,
  PARTY_RETURN_COUNTER,
  partyReturnHeaderSchema,
  partyReturnLabel,
  partyReturnLinesSchema,
  returnOrganised,
  takaActualMeters,
  takaActualPcs,
  type Paginated,
  type PartyReturnCard,
  type PartyReturnDetail,
  type PartyReturnLineView,
  type RoleKey,
} from '@rivoora/shared';
import { db, type DbOrTx, type Tx } from '../db/client';
import {
  counters,
  customers,
  damages as damageMaster,
  designs,
  materials,
  orders,
  partyReturnImages,
  partyReturnLineDamages,
  partyReturnLines,
  partyReturns,
  partyReturnTakas,
  takas,
} from '../db/schema';
import { badRequest, conflict, notFound } from '../lib/errors';
import { currentUserId } from '../lib/request-context';
import { likePattern, paginationSchema } from '../lib/http';
import { ensureExternalJobsheet } from './external';
import { addNewDamages, type NewDamageInput } from './qc-shared';
import { nextDummyTakaNo, recomputeOrdersStatus, refreshIsDamaged, writeTakaEvents, type TakaEventInput } from './taka-ops';
import { holderOrderId } from './stock-adjust';

/**
 * Sprint 22 (CR-13 + C8) — goods return AGAINST THE PARTY (Dhruvil, Jenish, Gaurang: `canGoodsReturn`).
 * 1. Mark goods received → GR-n, Pending (nothing enters stock). Pcs / Meters / Takas never mix.
 * 2. Organise design-wise: lines (quality, design, qty, damaged part with type + name). A Takas return has one line per
 *    returned taka (its design is known) — only the damage is marked.
 * 3. Complete (organised = received): fresh part → one free-stock taka (dummy number), damaged part → another with the
 *    open damages; returned takas go dispatched → free stock. Read-only afterwards. No DC revision, no order status.
 */

const now = () => new Date().toISOString();
const round2 = (n: number) => Math.round(n * 100) / 100;
const unitOf = (as: string): 'pcs' | 'meters' => (as === 'pcs' ? 'pcs' : 'meters');

/* ------------------------------------------------------------------ */
/* options                                                              */
/* ------------------------------------------------------------------ */

/** GET /party-returns/customers?search= — the parties (clients) a return can come from. */
export async function lookupReturnParties(search: string | undefined) {
  return db
    .select({ id: customers.id, name: customers.name })
    .from(customers)
    .where(and(eq(customers.isDeleted, false), eq(customers.isSystem, false), search ? like(customers.name, likePattern(search)) : undefined))
    .orderBy(asc(customers.name))
    .limit(50);
}

/** GET /party-returns/dispatched-takas?customerId=&search= — our dispatched takas of that client. */
export async function listDispatchedTakasOfParty(customerId: number, search?: string) {
  const rows = await db
    .select({
      id: takas.id,
      takaNo: takas.takaNo,
      orderNo: orders.orderNo,
      unit: orders.unit,
      pcs: sql<number | null>`COALESCE(${takas.actualPcs}, ${takas.pcs})`,
      meters: sql<number | null>`COALESCE(${takas.actualMeters}, ${takas.meters})`,
      designCode: designs.code,
      quality: materials.name,
    })
    .from(takas)
    .innerJoin(orders, eq(orders.id, takaOrderOf()))
    .innerJoin(materials, eq(materials.id, orders.materialId))
    .leftJoin(designs, eq(designs.id, orders.designId))
    .where(
      and(
        eq(takas.stage, 'dispatched'),
        eq(takas.isDeleted, false),
        eq(orders.customerId, customerId),
        search ? or(like(takas.takaNo, likePattern(search)), like(takas.weaverTakaNo, likePattern(search))) : undefined,
      ),
    )
    .orderBy(takas.id)
    .limit(300);
  return rows.sort((a, b) => compareTakaNo(a.takaNo, b.takaNo));
}
const takaOrderOf = () => sql`COALESCE(${takas.allocatedOrderId}, ${takas.orderId})`;

/* ------------------------------------------------------------------ */
/* reading                                                              */
/* ------------------------------------------------------------------ */

const listQuery = paginationSchema.extend({
  status: z.enum(['pending', 'completed']).default('pending').catch('pending'),
  search: z.string().trim().max(60).optional(),
});

/** GET /party-returns?status=pending|completed */
export async function listPartyReturns(query: unknown): Promise<Paginated<PartyReturnCard> & { counts: { pending: number; completed: number } }> {
  const q = listQuery.parse(query ?? {});
  const term = q.search?.replace(/^GR-?/i, '');
  const search = q.search
    ? or(like(customers.name, likePattern(q.search)), /^\d+$/.test(term ?? '') ? eq(partyReturns.returnNo, Number(term)) : undefined)
    : undefined;
  const where = and(eq(partyReturns.status, q.status), search);
  const [items, [{ total }], [counts]] = await db.batch([
    db
      .select({
        id: partyReturns.id,
        returnNo: partyReturns.returnNo,
        customerName: customers.name,
        receivedDate: partyReturns.receivedDate,
        receivedAs: partyReturns.receivedAs,
        receivedQty: partyReturns.receivedQty,
        status: partyReturns.status,
        organised: sql<number>`(SELECT COALESCE(SUM(l.qty), 0) FROM party_return_lines l WHERE l.return_id = "party_returns"."id")`,
      })
      .from(partyReturns)
      .innerJoin(customers, eq(customers.id, partyReturns.customerId))
      .where(where)
      .orderBy(desc(partyReturns.id))
      .limit(q.limit)
      .offset((q.page - 1) * q.limit),
    db.select({ total: sql<number>`COUNT(*)` }).from(partyReturns).innerJoin(customers, eq(customers.id, partyReturns.customerId)).where(where),
    db.select({ pending: sql<number>`COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0)`, completed: sql<number>`COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0)` }).from(partyReturns),
  ]);
  const count = Number(total);
  return {
    items: items.map((r) => ({ ...r, label: partyReturnLabel(r.returnNo), unit: unitOf(r.receivedAs), organised: round2(Number(r.organised)) })),
    page: q.page,
    limit: q.limit,
    total: count,
    hasMore: q.page * q.limit < count,
    counts: { pending: Number(counts?.pending ?? 0), completed: Number(counts?.completed ?? 0) },
  };
}

/** GET /party-returns/:id */
export async function getPartyReturn(id: number, conn: DbOrTx = db): Promise<PartyReturnDetail> {
  const [ret] = await conn
    .select({
      id: partyReturns.id,
      returnNo: partyReturns.returnNo,
      customerId: partyReturns.customerId,
      customerName: customers.name,
      receivedDate: partyReturns.receivedDate,
      receivedAs: partyReturns.receivedAs,
      receivedQty: partyReturns.receivedQty,
      note: partyReturns.note,
      status: partyReturns.status,
      completedAt: partyReturns.completedAt,
      createdAt: partyReturns.createdAt,
    })
    .from(partyReturns)
    .innerJoin(customers, eq(customers.id, partyReturns.customerId))
    .where(eq(partyReturns.id, id));
  if (!ret) throw notFound('Goods return');
  const [lineRows, images] = await Promise.all([
    conn
      .select({
        id: partyReturnLines.id,
        takaId: partyReturnLines.takaId,
        takaNo: takas.takaNo,
        materialId: partyReturnLines.materialId,
        quality: materials.name,
        designId: partyReturnLines.designId,
        designCode: designs.code,
        qty: partyReturnLines.qty,
        blouseOption: partyReturnLines.blouseOption,
      })
      .from(partyReturnLines)
      .innerJoin(materials, eq(materials.id, partyReturnLines.materialId))
      .innerJoin(designs, eq(designs.id, partyReturnLines.designId))
      .leftJoin(takas, eq(takas.id, partyReturnLines.takaId))
      .where(eq(partyReturnLines.returnId, id))
      .orderBy(asc(partyReturnLines.id)),
    conn.select({ url: partyReturnImages.imageUrl, thumbUrl: partyReturnImages.thumbUrl }).from(partyReturnImages).where(eq(partyReturnImages.returnId, id)).orderBy(asc(partyReturnImages.id)),
  ]);
  const dmg = lineRows.length
    ? await conn
        .select({ lineId: partyReturnLineDamages.lineId, type: partyReturnLineDamages.type, damageId: partyReturnLineDamages.damageId, otherName: partyReturnLineDamages.otherName, name: damageMaster.name, qty: partyReturnLineDamages.qty })
        .from(partyReturnLineDamages)
        .leftJoin(damageMaster, eq(damageMaster.id, partyReturnLineDamages.damageId))
        .where(inArray(partyReturnLineDamages.lineId, lineRows.map((l) => l.id)))
        .orderBy(asc(partyReturnLineDamages.id))
    : [];
  const lines: PartyReturnLineView[] = lineRows.map((l) => ({
    ...l,
    damages: dmg.filter((d) => d.lineId === l.id).map((d) => ({ type: d.type, damageId: d.damageId, otherName: d.otherName, name: d.name ?? d.otherName ?? '', qty: d.qty })),
  }));
  const org = returnOrganised(ret.receivedQty, lines);
  return {
    id: ret.id,
    returnNo: ret.returnNo,
    label: partyReturnLabel(ret.returnNo),
    customer: { id: ret.customerId, name: ret.customerName },
    receivedDate: ret.receivedDate,
    receivedAs: ret.receivedAs,
    unit: unitOf(ret.receivedAs),
    receivedQty: ret.receivedQty,
    note: ret.note,
    status: ret.status,
    images,
    lines,
    organised: org.organised,
    left: org.left,
    canComplete: ret.status === 'pending' && org.complete,
    completedAt: ret.completedAt,
    createdAt: ret.createdAt,
  };
}

/* ------------------------------------------------------------------ */
/* writing                                                              */
/* ------------------------------------------------------------------ */

async function loadPending(tx: Tx, id: number) {
  const [ret] = await tx.select().from(partyReturns).where(eq(partyReturns.id, id));
  if (!ret) throw notFound('Goods return');
  if (ret.status === 'completed') throw conflict(`${partyReturnLabel(ret.returnNo)} is completed — it can no longer be changed.`);
  return ret;
}

/** Takas mode: checks the takas are this party's dispatched takas, all in ONE unit; returns one prepared line each. */
async function takaLines(tx: Tx, customerId: number, takaIds: readonly number[]) {
  const rows = await tx
    .select({
      id: takas.id,
      takaNo: takas.takaNo,
      stage: takas.stage,
      pcs: takas.pcs,
      actualPcs: takas.actualPcs,
      meters: takas.meters,
      actualMeters: takas.actualMeters,
      unit: orders.unit,
      customerId: orders.customerId,
      materialId: orders.materialId,
      designId: orders.designId,
      blouseOption: orders.blouseOption,
    })
    .from(takas)
    .innerJoin(orders, eq(orders.id, takaOrderOf()))
    .where(and(inArray(takas.id, [...takaIds]), eq(takas.isDeleted, false)));
  if (rows.length !== new Set(takaIds).size) throw conflict('Some takas were not found. Refresh and try again.');
  const bad = rows.find((r) => r.stage !== 'dispatched' || r.customerId !== customerId);
  if (bad) throw badRequest(`Taka ${bad.takaNo} is not a dispatched taka of this party.`, 'takaIds');
  if (new Set(rows.map((r) => r.unit)).size > 1) throw badRequest('Pcs and metres cannot be in one goods return.', 'takaIds');
  if (rows.some((r) => r.designId === null)) throw badRequest('A returned taka has no design.', 'takaIds');
  return rows.map((r) => ({ ...r, designId: r.designId!, qty: r.unit === 'meters' ? round2(takaActualMeters(r) ?? 0) : (takaActualPcs(r) ?? 0) }));
}

async function writeImages(tx: Tx, returnId: number, images: { url: string; thumbUrl: string }[]) {
  await tx.delete(partyReturnImages).where(eq(partyReturnImages.returnId, returnId));
  if (images.length) await tx.insert(partyReturnImages).values(images.map((i) => ({ returnId, imageUrl: i.url, thumbUrl: i.thumbUrl })));
}

/** POST /party-returns — Mark goods received. */
export async function createPartyReturn(role: RoleKey, input: unknown): Promise<{ id: number; label: string }> {
  const data = partyReturnHeaderSchema.parse(input);
  return db.transaction(async (tx) => {
    const [cust] = await tx.select({ id: customers.id }).from(customers).where(and(eq(customers.id, data.customerId), eq(customers.isDeleted, false)));
    if (!cust) throw badRequest('That party no longer exists.', 'customerId');
    let receivedQty = data.receivedQty ?? 0;
    const prepared = data.receivedAs === 'takas' ? await takaLines(tx, data.customerId, data.takaIds) : [];
    if (data.receivedAs === 'takas') receivedQty = round2(prepared.reduce((s, l) => s + l.qty, 0));
    const at = now();
    const [c] = await tx
      .insert(counters)
      .values({ name: PARTY_RETURN_COUNTER, value: 1 })
      .onConflictDoUpdate({ target: counters.name, set: { value: sql`${counters.value} + 1` } })
      .returning({ value: counters.value });
    const [ret] = await tx
      .insert(partyReturns)
      .values({ returnNo: c.value, customerId: data.customerId, receivedDate: data.receivedDate, receivedAs: data.receivedAs, receivedQty, note: data.note, role, userId: currentUserId(), createdAt: at, updatedAt: at })
      .returning({ id: partyReturns.id });
    if (prepared.length) {
      await tx.insert(partyReturnTakas).values(prepared.map((l) => ({ returnId: ret.id, takaId: l.id })));
      await tx.insert(partyReturnLines).values(prepared.map((l) => ({ returnId: ret.id, takaId: l.id, materialId: l.materialId, designId: l.designId, qty: l.qty, blouseOption: l.blouseOption })));
    }
    await writeImages(tx, ret.id, data.images);
    return { id: ret.id, label: partyReturnLabel(c.value) };
  });
}

/** PUT /party-returns/:id — edit the received details while Pending. */
export async function updatePartyReturn(role: RoleKey, id: number, input: unknown): Promise<{ id: number }> {
  void role;
  const data = partyReturnHeaderSchema.parse(input);
  return db.transaction(async (tx) => {
    const ret = await loadPending(tx, id);
    if (data.receivedAs !== ret.receivedAs) throw conflict("The 'received as' choice can't be changed — mark a new goods return instead.");
    let receivedQty = data.receivedQty ?? 0;
    if (ret.receivedAs === 'takas') {
      const prepared = await takaLines(tx, data.customerId, data.takaIds);
      receivedQty = round2(prepared.reduce((s, l) => s + l.qty, 0));
      // keep the lines (and their damage marks) of takas that stay; add the new ones; drop the removed ones
      const have = await tx.select({ id: partyReturnLines.id, takaId: partyReturnLines.takaId }).from(partyReturnLines).where(eq(partyReturnLines.returnId, id));
      const keep = new Set(prepared.map((l) => l.id));
      const drop = have.filter((h) => h.takaId === null || !keep.has(h.takaId));
      if (drop.length) {
        await tx.delete(partyReturnLineDamages).where(inArray(partyReturnLineDamages.lineId, drop.map((d) => d.id)));
        await tx.delete(partyReturnLines).where(inArray(partyReturnLines.id, drop.map((d) => d.id)));
      }
      const present = new Set(have.map((h) => h.takaId));
      const fresh = prepared.filter((l) => !present.has(l.id));
      if (fresh.length) await tx.insert(partyReturnLines).values(fresh.map((l) => ({ returnId: id, takaId: l.id, materialId: l.materialId, designId: l.designId, qty: l.qty, blouseOption: l.blouseOption })));
      await tx.delete(partyReturnTakas).where(eq(partyReturnTakas.returnId, id));
      await tx.insert(partyReturnTakas).values(prepared.map((l) => ({ returnId: id, takaId: l.id })));
    }
    await tx.update(partyReturns).set({ customerId: data.customerId, receivedDate: data.receivedDate, receivedQty, note: data.note, updatedAt: now() }).where(eq(partyReturns.id, id));
    await writeImages(tx, id, data.images);
    return { id };
  });
}

/** PUT /party-returns/:id/lines — the design lines while Pending (Takas mode: only the damage of each returned taka). */
export async function savePartyReturnLines(id: number, input: unknown): Promise<{ id: number; organised: number; left: number }> {
  const data = partyReturnLinesSchema.parse(input);
  return db.transaction(async (tx) => {
    const ret = await loadPending(tx, id);
    const unit = unitOf(ret.receivedAs);
    const takasMode = ret.receivedAs === 'takas';
    data.lines.forEach((l, i) => {
      const err = lineDamageError(l.qty, l.damages);
      if (err) throw badRequest(err, `lines.${i}.damages`);
      if (unit === 'pcs') {
        if (!Number.isInteger(l.qty)) throw badRequest('Use a whole number of pcs', `lines.${i}.qty`);
        if (l.damages.some((d) => !Number.isInteger(d.qty))) throw badRequest('Use a whole number of pcs', `lines.${i}.damages`);
      }
    });
    if (takasMode) {
      const have = await tx.select({ id: partyReturnLines.id, takaId: partyReturnLines.takaId, qty: partyReturnLines.qty }).from(partyReturnLines).where(eq(partyReturnLines.returnId, id));
      const byTaka = new Map(have.map((h) => [h.takaId, h]));
      for (const l of data.lines) {
        const h = l.takaId !== null ? byTaka.get(l.takaId) : undefined;
        if (!h) throw badRequest('Only the returned takas can be marked.', 'lines');
        if (lineDamageError(h.qty, l.damages)) throw badRequest("Damaged quantity can't be more than the taka", 'lines');
      }
      const lineIds = have.map((h) => h.id);
      if (lineIds.length) await tx.delete(partyReturnLineDamages).where(inArray(partyReturnLineDamages.lineId, lineIds));
      for (const l of data.lines) {
        const h = byTaka.get(l.takaId!)!;
        if (l.damages.length) await tx.insert(partyReturnLineDamages).values(l.damages.map((d) => ({ lineId: h.id, type: d.type, damageId: 'damageId' in d ? d.damageId : null, otherName: 'otherName' in d ? d.otherName : null, qty: d.qty })));
      }
      return { id, organised: round2(have.reduce((s, h) => s + h.qty, 0)), left: round2(ret.receivedQty - have.reduce((s, h) => s + h.qty, 0)) };
    }
    const org = returnOrganised(ret.receivedQty, data.lines);
    if (org.left < 0) throw badRequest(`Organised quantity (${org.organised}) is more than received (${ret.receivedQty}). Correct the received quantity first.`, 'lines');
    // every line's design must be in its quality
    for (const [i, l] of data.lines.entries()) {
      const ok = await tx.all(sql`SELECT 1 AS x FROM design_qualities WHERE design_id = ${l.designId} AND material_id = ${l.materialId} LIMIT 1`);
      if (!ok.length) throw badRequest('This design is not in that quality.', `lines.${i}.designId`);
    }
    const old = await tx.select({ id: partyReturnLines.id }).from(partyReturnLines).where(eq(partyReturnLines.returnId, id));
    if (old.length) {
      await tx.delete(partyReturnLineDamages).where(inArray(partyReturnLineDamages.lineId, old.map((o) => o.id)));
      await tx.delete(partyReturnLines).where(eq(partyReturnLines.returnId, id));
    }
    for (const l of data.lines) {
      const [row] = await tx
        .insert(partyReturnLines)
        .values({ returnId: id, materialId: l.materialId, designId: l.designId, qty: unit === 'pcs' ? l.qty : round2(l.qty), blouseOption: unit === 'pcs' ? l.blouseOption : null })
        .returning({ id: partyReturnLines.id });
      if (l.damages.length) await tx.insert(partyReturnLineDamages).values(l.damages.map((d) => ({ lineId: row.id, type: d.type, damageId: 'damageId' in d ? d.damageId : null, otherName: 'otherName' in d ? d.otherName : null, qty: d.qty })));
    }
    await tx.update(partyReturns).set({ updatedAt: now() }).where(eq(partyReturns.id, id));
    return { id, organised: org.organised, left: org.left };
  });
}

/** POST /party-returns/:id/complete */
export async function completePartyReturn(role: RoleKey, id: number): Promise<{ id: number; label: string; takas: number; freshTakas: number; damagedTakas: number }> {
  return db.transaction(async (tx) => {
    const ret = await loadPending(tx, id);
    const label = partyReturnLabel(ret.returnNo);
    const [cust] = await tx.select({ name: customers.name }).from(customers).where(eq(customers.id, ret.customerId));
    const detail = await getPartyReturn(id, tx);
    if (!detail.canComplete) throw conflict(`Organise the full quantity first (received ${ret.receivedQty}, organised ${detail.organised}, left ${detail.left}).`);
    const unit = unitOf(ret.receivedAs);
    const at = now();
    const events: TakaEventInput[] = [];
    const touchedOrders = new Set<number>();
    let freshTakas = 0;
    let damagedTakas = 0;
    const origin = `Returned · ${label} · ${cust?.name ?? ''}`;

    const damageInput = (d: PartyReturnLineView['damages'][number]): NewDamageInput => ({
      type: d.type as NewDamageInput['type'],
      ...(unit === 'pcs' ? { pcs: d.qty } : { meters: round2(d.qty) }),
      images: [],
      ...(d.damageId !== null ? { damageId: d.damageId } : { otherName: d.otherName ?? '' }),
    });

    for (const line of detail.lines) {
      const damagedQty = lineDamagedQty(line.damages);
      if (ret.receivedAs === 'takas') {
        // The returned taka itself goes dispatched → free stock (final), the damage marks become open damages.
        const [t] = await tx.select({ id: takas.id, orderId: takas.orderId, allocatedOrderId: takas.allocatedOrderId }).from(takas).where(eq(takas.id, line.takaId!));
        const moved = await tx
          .update(takas)
          .set({ stage: 'final', isFreeStock: true, freeStockAt: at, freeStockBy: role, freeStockReason: 'goods_return', allocatedOrderId: null, returnedAt: at, godownCheckedAt: null, godownCheckedBy: null, updatedAt: at })
          .where(and(eq(takas.id, line.takaId!), eq(takas.stage, 'dispatched'), eq(takas.isDeleted, false)))
          .returning({ id: takas.id });
        if (!moved.length) throw conflict(`Taka ${line.takaNo} is no longer dispatched. Refresh and try again.`);
        events.push({ takaId: line.takaId!, event: 'party_return', note: origin });
        if (line.damages.length) {
          events.push(...(await addNewDamages(tx, role, line.takaId!, line.damages.map(damageInput), 'goods_return', at, 'damage')));
          await refreshIsDamaged(tx, [line.takaId!]);
          damagedTakas += 1;
        } else freshTakas += 1;
        touchedOrders.add(t.orderId);
        if (t.allocatedOrderId) touchedOrders.add(t.allocatedOrderId);
        continue;
      }
      const holderId = await holderOrderId(tx, role, { designId: line.designId, materialId: line.materialId, unit, blouseOption: unit === 'pcs' ? line.blouseOption : null });
      const jobsheetId = await ensureExternalJobsheet(tx, holderId, role);
      const make = async (qty: number, damaged: boolean) => {
        const takaNo = await nextDummyTakaNo(tx);
        const [row] = await tx
          .insert(takas)
          .values({
            jobsheetId,
            orderId: holderId,
            takaNo,
            pcs: unit === 'pcs' ? qty : null,
            meters: unit === 'meters' ? round2(qty) : null,
            stage: 'final',
            isFreeStock: true,
            freeStockAt: at,
            freeStockBy: role,
            freeStockReason: 'goods_return',
            returnedAt: at,
            hasOwnNumber: true,
            enteredBy: role,
            createdAt: at,
            updatedAt: at,
          })
          .returning({ id: takas.id });
        events.push({ takaId: row.id, event: 'party_return', note: `${origin}${damaged ? ' · damaged' : ''}` });
        return row.id;
      };
      const fresh = round2(line.qty - damagedQty);
      if (fresh > 0) {
        await make(fresh, false);
        freshTakas += 1;
      }
      if (damagedQty > 0) {
        const id2 = await make(damagedQty, true);
        events.push(...(await addNewDamages(tx, role, id2, line.damages.map(damageInput), 'goods_return', at, 'damage')));
        await refreshIsDamaged(tx, [id2]);
        damagedTakas += 1;
      }
    }
    await writeTakaEvents(tx, role, events);
    await tx.update(partyReturns).set({ status: 'completed', completedAt: at, completedByRole: role, updatedAt: at }).where(eq(partyReturns.id, id));
    // Takas that left Dispatched change their order's status (Dispatched → Partly dispatched …); a GR never sets Returned.
    if (touchedOrders.size) await recomputeOrdersStatus(tx, role, [...touchedOrders]);
    return { id, label, takas: freshTakas + damagedTakas, freshTakas, damagedTakas };
  });
}

