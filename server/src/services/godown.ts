import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import {
  compareTakaNo,
  godownKpis,
  godownListQuerySchema,
  godownRefinishSchema,
  godownResolveSchema,
  damageLabel,
  godownSplitSchema,
  godownTakaPatchSchema,
  qcNewDamageSchema,
  readyDispatchBlockers,
  readyDispatchSchema,
  splitMeters,
  takaActualPcs,
  validateSplit,
  type GodownListQuery,
  type GodownOrder,
  type GodownOrderPage,
  type GodownSplitResult,
  type GodownTaka,
  type OrderDamages,
  type ReadyDispatchResult,
  type RoleKey,
} from '@rivoora/shared';
import { db, type Tx } from '../db/client';
import { damages as damageMaster, designVariations, designs, jobsheets, materials, orders, takaDamages, takas } from '../db/schema';
import { badRequest, conflict, notFound } from '../lib/errors';
import { likePattern } from '../lib/http';
import { getOrderDamages } from './dashboard';
import { addNewDamages, assertNewDamages } from './qc-shared';
import { damageImagesOf } from './takas';
import { takaParentNo } from './taka-shared';
import { recomputeOrdersStatus, refreshIsDamaged, usedTakaNumbers, usedMessage, writeTakaEvents, type TakaEventInput } from './taka-ops';

/**
 * Godown supervisor → Orders (also open to Jemish / Gaurang): the order's final takas, ticked one by one, with the
 * pcs actually counted, splits, and the "Ready to dispatch" confirmation. Restricted view: never a client or a rate.
 * Every write is one transaction with conditional stage updates and ends with the order status recompute.
 */

const now = () => new Date().toISOString();

const designCodeSql = sql<string | null>`COALESCE(${designVariations.code}, ${designs.code})`;
const designThumbSql = sql<string | null>`CASE WHEN ${designVariations.id} IS NOT NULL THEN ${designVariations.thumbUrl} ELSE ${designs.thumbUrl} END`;
const designImageSql = sql<string | null>`CASE WHEN ${designVariations.id} IS NOT NULL THEN ${designVariations.imageUrl} ELSE ${designs.imageUrl} END`;

/** Stages of takas that have passed (or are about to leave) the Mill QC — what makes an order visible here. */
const POST_QC = ['final', 'refinish', 'ready_dispatch'] as const;

/* ------------------------------------------------------------------ */
/* Orders list                                                          */
/* ------------------------------------------------------------------ */

/**
 * GET /godown/orders — orders with at least one taka that passed the Mill QC. Orders with unchecked final takas first,
 * then by order number, newest first. Search: order number or any taka number of the order.
 */
export async function listGodownOrders(q: GodownListQuery): Promise<GodownOrderPage> {
  const parsed = godownListQuerySchema.parse(q);
  let search: SQL | undefined;
  if (parsed.search) {
    const term = parsed.search.replace(/^#/, '');
    const p = likePattern(term);
    const orderNo = /^\d+$/.test(term) ? Number(term) : -1;
    search = sql`(${orders.orderNo} = ${orderNo} OR ${orders.id} IN (SELECT t2.order_id FROM takas t2 WHERE t2.is_deleted = 0 AND t2.stage IN ('final', 'refinish', 'ready_dispatch') AND t2.taka_no LIKE ${p} ESCAPE '\\'))`;
  }
  const unchecked = sql<number>`SUM(CASE WHEN ${takas.stage} = 'final' AND ${takas.godownCheckedAt} IS NULL THEN 1 ELSE 0 END)`;
  const hasPostQc = sql`SUM(CASE WHEN ${takas.stage} IN ('final', 'refinish', 'ready_dispatch') THEN 1 ELSE 0 END) > 0`;
  const base = db
    .select({
      orderId: orders.id,
      orderNo: orders.orderNo,
      designCode: designCodeSql,
      thumbUrl: designThumbSql,
      imageUrl: designImageSql,
      orderedPcs: orders.quantity,
      uncheckedCount: unchecked,
    })
    .from(takas)
    .innerJoin(jobsheets, eq(jobsheets.id, takas.jobsheetId))
    .innerJoin(orders, eq(orders.id, takas.orderId))
    .leftJoin(designs, eq(designs.id, orders.designId))
    .leftJoin(designVariations, eq(designVariations.id, orders.variationId))
    .where(and(eq(takas.isDeleted, false), eq(jobsheets.isDeleted, false), search))
    .groupBy(orders.id)
    .having(hasPostQc);
  const [items, [{ total }]] = await db.batch([
    base
      .orderBy(sql`CASE WHEN ${unchecked} > 0 THEN 0 ELSE 1 END`, desc(orders.orderNo))
      .limit(parsed.limit)
      .offset((parsed.page - 1) * parsed.limit),
    db
      .select({ total: sql<number>`COUNT(DISTINCT ${orders.id})` })
      .from(takas)
      .innerJoin(jobsheets, eq(jobsheets.id, takas.jobsheetId))
      .innerJoin(orders, eq(orders.id, takas.orderId))
      .where(and(eq(takas.isDeleted, false), eq(jobsheets.isDeleted, false), inArray(takas.stage, [...POST_QC]), search)),
  ]);
  const count = Number(total);
  return {
    items: items.map((r) => ({ ...r, uncheckedCount: Number(r.uncheckedCount) })),
    page: parsed.page,
    limit: parsed.limit,
    total: count,
    hasMore: parsed.page * parsed.limit < count,
  };
}

/* ------------------------------------------------------------------ */
/* Order screen                                                         */
/* ------------------------------------------------------------------ */

/** GET /godown/orders/:orderId — header, KPIs, the final takas (+ the ones already ready to dispatch). */
export async function getGodownOrder(orderId: number): Promise<GodownOrder> {
  const [orderRows, takaRows] = await db.batch([
    db
      .select({
        orderId: orders.id,
        orderNo: orders.orderNo,
        designCode: designCodeSql,
        thumbUrl: designThumbSql,
        imageUrl: designImageSql,
        quality: materials.name,
        orderedPcs: orders.quantity,
      })
      .from(orders)
      .innerJoin(materials, eq(materials.id, orders.materialId))
      .leftJoin(designs, eq(designs.id, orders.designId))
      .leftJoin(designVariations, eq(designVariations.id, orders.variationId))
      .where(eq(orders.id, orderId)),
    db
      .select({
        id: takas.id,
        takaNo: takas.takaNo,
        meters: takas.meters,
        pcs: takas.pcs,
        actualPcs: takas.actualPcs,
        stage: takas.stage,
        godownCheckedAt: takas.godownCheckedAt,
        parentTakaNo: takaParentNo,
        refinishCount: takas.refinishCount,
        isDamaged: takas.isDamaged,
        jobsheetId: takas.jobsheetId,
      })
      .from(takas)
      .innerJoin(jobsheets, eq(jobsheets.id, takas.jobsheetId))
      .where(and(eq(takas.orderId, orderId), eq(takas.isDeleted, false), eq(jobsheets.isDeleted, false))),
  ]);
  const order = orderRows[0];
  if (!order) throw notFound('Order');
  const kpis = godownKpis(takaRows.map((t) => ({ stage: t.stage, pcs: t.pcs, actualPcs: t.actualPcs, checked: t.godownCheckedAt !== null })));
  const list: GodownTaka[] = takaRows
    .filter((t) => t.stage === 'final' || t.stage === 'ready_dispatch')
    .map(({ godownCheckedAt, ...t }) => ({ ...t, checked: godownCheckedAt !== null, checkedAt: godownCheckedAt }))
    .sort((a, b) => compareTakaNo(a.takaNo, b.takaNo));
  return {
    ...order,
    kpis,
    takas: list,
    orderTakaNos: takaRows.map((t) => t.takaNo),
  };
}

/* ------------------------------------------------------------------ */
/* helpers                                                              */
/* ------------------------------------------------------------------ */

async function loadFinalTaka(tx: Tx, id: number) {
  const [taka] = await tx
    .select({
      id: takas.id,
      takaNo: takas.takaNo,
      stage: takas.stage,
      orderId: takas.orderId,
      jobsheetId: takas.jobsheetId,
      meters: takas.meters,
      pcs: takas.pcs,
      actualPcs: takas.actualPcs,
      godownCheckedAt: takas.godownCheckedAt,
      refinishCount: takas.refinishCount,
    })
    .from(takas)
    .where(and(eq(takas.id, id), eq(takas.isDeleted, false)));
  if (!taka) throw notFound('Taka');
  if (taka.stage !== 'final') {
    throw conflict(
      taka.stage === 'ready_dispatch'
        ? `Taka ${taka.takaNo} is already ready to dispatch and can't be changed.`
        : `Taka ${taka.takaNo} is not a final taka (it is not in the godown).`,
    );
  }
  return taka;
}

/* ------------------------------------------------------------------ */
/* Tick / actual pcs                                                    */
/* ------------------------------------------------------------------ */

/** PATCH /godown/takas/:id — `{ checked?, actualPcs? }`; saves at once, with who + when. */
export async function patchGodownTaka(role: RoleKey, id: number, input: unknown): Promise<GodownTaka> {
  const data = godownTakaPatchSchema.parse(input);
  return db.transaction(async (tx) => {
    const taka = await loadFinalTaka(tx, id);
    const at = now();
    const events: TakaEventInput[] = [];
    const set: Partial<typeof takas.$inferInsert> = {};
    if (data.actualPcs !== undefined) {
      const before = takaActualPcs(taka);
      // Same as the expected pcs = no separate actual value.
      const next = data.actualPcs === taka.pcs ? null : data.actualPcs;
      if (data.actualPcs !== before) {
        set.actualPcs = next;
        events.push({ takaId: id, event: 'actual_pcs_changed', note: `pcs ${before ?? '–'} → ${data.actualPcs}${taka.pcs != null ? ` (expected ${taka.pcs})` : ''}` });
      } else if (next !== taka.actualPcs) {
        set.actualPcs = next;
      }
    }
    if (data.checked !== undefined && data.checked !== (taka.godownCheckedAt !== null)) {
      set.godownCheckedAt = data.checked ? at : null;
      set.godownCheckedBy = data.checked ? role : null;
      events.push({ takaId: id, event: data.checked ? 'godown_checked' : 'godown_unchecked', note: null });
    }
    if (Object.keys(set).length) {
      const moved = await tx
        .update(takas)
        .set(set)
        .where(and(eq(takas.id, id), eq(takas.stage, 'final')))
        .returning({ id: takas.id });
      if (!moved.length) throw conflict(`Taka ${taka.takaNo} was just changed. Refresh and try again.`);
    }
    await writeTakaEvents(tx, role, events);
    const [row] = await tx
      .select({
        id: takas.id,
        takaNo: takas.takaNo,
        meters: takas.meters,
        pcs: takas.pcs,
        actualPcs: takas.actualPcs,
        stage: takas.stage,
        godownCheckedAt: takas.godownCheckedAt,
        parentTakaNo: takaParentNo,
        refinishCount: takas.refinishCount,
        isDamaged: takas.isDamaged,
        jobsheetId: takas.jobsheetId,
      })
      .from(takas)
      .where(eq(takas.id, id));
    const { godownCheckedAt, ...rest } = row;
    return { ...rest, checked: godownCheckedAt !== null, checkedAt: godownCheckedAt };
  });
}

/* ------------------------------------------------------------------ */
/* Mark damage / send to refinish (the row's ⋯ menu)                     */
/* ------------------------------------------------------------------ */

/** POST /godown/takas/:id/damage — one new "Supervisor marked" damage on a final taka. */
export async function markGodownDamage(role: RoleKey, id: number, input: unknown): Promise<{ takaId: number }> {
  const damage = qcNewDamageSchema.parse(input);
  return db.transaction(async (tx) => {
    const taka = await loadFinalTaka(tx, id);
    const pcs = takaActualPcs(taka) ?? 9999;
    assertNewDamages([damage], pcs, 'damage');
    const events = await addNewDamages(tx, role, id, [damage], 'godown', now(), 'damage');
    await refreshIsDamaged(tx, [id]);
    await writeTakaEvents(tx, role, events);
    return { takaId: id };
  });
}

/** POST /godown/takas/:id/refinish — a final taka goes back to refinish (it leaves the final list and its tick). */
export async function sendGodownRefinish(role: RoleKey, id: number, input: unknown): Promise<{ takaId: number }> {
  const { note } = godownRefinishSchema.parse(input ?? {});
  return db.transaction(async (tx) => {
    const taka = await loadFinalTaka(tx, id);
    const moved = await tx
      .update(takas)
      .set({ stage: 'refinish', refinishCount: sql`${takas.refinishCount} + 1`, godownCheckedAt: null, godownCheckedBy: null })
      .where(and(eq(takas.id, id), eq(takas.stage, 'final')))
      .returning({ id: takas.id });
    if (!moved.length) throw conflict(`Taka ${taka.takaNo} was just changed. Refresh and try again.`);
    await writeTakaEvents(tx, role, [{ takaId: id, event: 'sent_refinish', note: note ? `Godown · ${note}` : 'Godown' }]);
    await recomputeOrdersStatus(tx, role, [taka.orderId]);
    return { takaId: id };
  });
}

/** Marks the taka's open damages (one, or all) as fully resolved; returns the `damage_resolved` events. */
async function clearOpenDamages(tx: Tx, role: RoleKey, takaId: number, onlyId: number | undefined, stage: string, at: string): Promise<TakaEventInput[]> {
  const open = await tx
    .select({ id: takaDamages.id, foundAt: takaDamages.foundAt, pcs: takaDamages.pcs, name: damageMaster.name })
    .from(takaDamages)
    .leftJoin(damageMaster, eq(damageMaster.id, takaDamages.damageId))
    .where(and(eq(takaDamages.takaId, takaId), eq(takaDamages.status, 'open'), eq(takaDamages.isDeleted, false), onlyId !== undefined ? eq(takaDamages.id, onlyId) : undefined));
  const events: TakaEventInput[] = [];
  for (const d of open) {
    await tx
      .update(takaDamages)
      .set({ status: 'resolved', resolvedPcs: d.pcs ?? 0, resolvedAt: at, resolvedBy: role, resolvedStage: stage })
      .where(eq(takaDamages.id, d.id));
    events.push({ takaId, event: 'damage_resolved', takaDamageId: d.id, note: `${damageLabel(d.foundAt, d.name)} · ${stage === 'split' ? 'cleared by split' : 'resolved at the godown'}` });
  }
  return events;
}

/** POST /godown/takas/:id/resolve — resolve one damage, or all open damages, of a final taka. */
export async function resolveGodownDamage(role: RoleKey, id: number, input: unknown): Promise<{ takaId: number; resolved: number }> {
  const { takaDamageId } = godownResolveSchema.parse(input ?? {});
  return db.transaction(async (tx) => {
    await loadFinalTaka(tx, id);
    const events = await clearOpenDamages(tx, role, id, takaDamageId, 'godown', now());
    if (!events.length) throw conflict('There is no open damage to resolve on this taka.');
    await refreshIsDamaged(tx, [id]);
    await writeTakaEvents(tx, role, events);
    return { takaId: id, resolved: events.length };
  });
}

/* ------------------------------------------------------------------ */
/* Split                                                                */
/* ------------------------------------------------------------------ */

/**
 * POST /godown/takas/:id/split — `{ parts: [{ takaNo, pcs, damages?, refinish? }] }`, the first part is the original
 * taka (it keeps its row, with its new pcs). The parts must add up to the taka's actual pcs and every number must be
 * valid and unique system-wide. New parts: same order / jobsheet, stage `final` (`refinish` when sent to refinish),
 * `parent_taka_id`, meters = parent meters × part pcs ÷ total (the last part takes the remainder). Existing open
 * damages stay on the original taka.
 */
export async function splitTaka(role: RoleKey, id: number, input: unknown): Promise<GodownSplitResult> {
  const data = godownSplitSchema.parse(input);
  return db.transaction(async (tx) => {
    const parent = await loadFinalTaka(tx, id);
    const actual = takaActualPcs(parent);
    if (actual === null) throw badRequest(`Taka ${parent.takaNo} has no pcs to split.`);

    const numbers = data.parts.map((p) => p.takaNo);
    const used = await usedTakaNumbers(tx, numbers, [id]);
    const check = validateSplit(
      data.parts.map((p) => ({ takaNo: p.takaNo, pcs: p.pcs })),
      actual,
      new Set(used.keys()),
    );
    const bad = check.rows.findIndex((r) => r !== null);
    if (bad >= 0) {
      const err = check.rows[bad];
      const no = numbers[bad];
      throw badRequest(
        err === 'already_used'
          ? usedMessage(no, used.get(no.trim()))
          : err === 'duplicate'
            ? `Taka ${no} is typed twice.`
            : err === 'pcs_required'
              ? `Taka ${no || bad + 1}: enter the pcs (at least 1).`
              : `Taka ${no || bad + 1}: use digits, - or / (and a capital letter at the end).`,
        `parts.${bad}.${err === 'pcs_required' ? 'pcs' : 'takaNo'}`,
      );
    }
    if (check.diff !== 0) {
      throw badRequest(`The parts add up to ${check.total} pcs, but the taka has ${actual} pcs (${check.diff > 0 ? `${check.diff} short` : `${-check.diff} too many`}).`, 'parts');
    }

    const first = data.parts[0];
    data.parts.forEach((p, i) => assertNewDamages(p.damages, p.pcs, `parts.${i}.damages`));

    const at = now();
    const meters = splitMeters(parent.meters, data.parts.map((p) => p.pcs));
    const events: TakaEventInput[] = [];
    const touched = [id];

    // A split starts clean: the damage the taka had before is cleared, only the damage marked on the parts counts.
    events.push(...(await clearOpenDamages(tx, role, id, undefined, 'split', at)));

    // Part 1 keeps the original row (a renamed number goes through a temporary value, nothing else uses it).
    const renamed = first.takaNo !== parent.takaNo;
    const firstSet: Partial<typeof takas.$inferInsert> = { pcs: first.pcs, actualPcs: null, meters: meters[0] };
    if (first.refinish) Object.assign(firstSet, { stage: 'refinish', godownCheckedAt: null, godownCheckedBy: null });
    if (renamed) firstSet.takaNo = first.takaNo;
    const firstMoved = await tx
      .update(takas)
      .set(first.refinish ? { ...firstSet, refinishCount: sql`${takas.refinishCount} + 1` } : firstSet)
      .where(and(eq(takas.id, id), eq(takas.stage, 'final')))
      .returning({ id: takas.id });
    if (!firstMoved.length) throw conflict(`Taka ${parent.takaNo} was just changed. Refresh and try again.`);
    if (renamed) events.push({ takaId: id, event: 'edited', note: `number ${parent.takaNo} → ${first.takaNo} (split)` });
    if (first.refinish) events.push({ takaId: id, event: 'sent_refinish', note: 'Godown · split' });
    events.push(...(await addNewDamages(tx, role, id, first.damages, 'godown', at, 'parts.0.damages')));

    // The other parts are new takas of the same jobsheet.
    const created: GodownSplitResult['parts'] = [{ id, takaNo: first.takaNo, pcs: first.pcs, meters: meters[0], stage: first.refinish ? 'refinish' : 'final' }];
    for (let i = 1; i < data.parts.length; i += 1) {
      const p = data.parts[i];
      const [row] = await tx
        .insert(takas)
        .values({
          jobsheetId: parent.jobsheetId,
          orderId: parent.orderId,
          takaNo: p.takaNo,
          meters: meters[i],
          pcs: p.pcs,
          stage: p.refinish ? 'refinish' : 'final',
          refinishCount: p.refinish ? 1 : 0,
          parentTakaId: id,
          enteredBy: role,
          createdAt: at,
          updatedAt: at,
        })
        .returning({ id: takas.id });
      touched.push(row.id);
      created.push({ id: row.id, takaNo: p.takaNo, pcs: p.pcs, meters: meters[i], stage: p.refinish ? 'refinish' : 'final' });
      events.push({ takaId: row.id, event: 'split', note: `split from ${first.takaNo}` });
      if (p.refinish) events.push({ takaId: row.id, event: 'sent_refinish', note: 'Godown · split' });
      events.push(...(await addNewDamages(tx, role, row.id, p.damages, 'godown', at, `parts.${i}.damages`)));
    }
    events.push({ takaId: id, event: 'split', note: `split into ${data.parts.map((p) => p.takaNo).join(', ')}` });
    await refreshIsDamaged(tx, touched);
    await writeTakaEvents(tx, role, events);
    await recomputeOrdersStatus(tx, role, [parent.orderId]);
    return { parentId: id, orderId: parent.orderId, parts: created };
  });
}

/* ------------------------------------------------------------------ */
/* Ready to dispatch                                                    */
/* ------------------------------------------------------------------ */

/**
 * POST /godown/orders/:orderId/ready-dispatch — `{ takaIds }`: every taka must be final and ticked, else nothing is
 * saved (409). The takas become `ready_dispatch` (`ready_dispatch` event); unticked ones stay in the godown.
 */
export async function confirmReadyDispatch(role: RoleKey, orderId: number, input: unknown): Promise<ReadyDispatchResult> {
  const data = readyDispatchSchema.parse(input);
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: takas.id,
        takaNo: takas.takaNo,
        stage: takas.stage,
        pcs: takas.pcs,
        actualPcs: takas.actualPcs,
        godownCheckedAt: takas.godownCheckedAt,
      })
      .from(takas)
      .where(and(inArray(takas.id, data.takaIds), eq(takas.orderId, orderId), eq(takas.isDeleted, false)));
    if (rows.length !== data.takaIds.length) throw conflict('Some takas were changed meanwhile. Refresh and try again.');
    const list = rows.map((r) => ({ ...r, checked: r.godownCheckedAt !== null }));
    const blockers = readyDispatchBlockers(list);
    if (blockers.length) {
      throw conflict(
        `${blockers.length} taka${blockers.length === 1 ? ' is' : 's are'} not checked or no longer final: ${blockers.slice(0, 15).map((b) => b.takaNo).join(', ')}${blockers.length > 15 ? ' …' : ''}. Refresh and try again.`,
      );
    }
    const moved = await tx
      .update(takas)
      .set({ stage: 'ready_dispatch' })
      .where(and(inArray(takas.id, data.takaIds), eq(takas.stage, 'final'), sql`${takas.godownCheckedAt} IS NOT NULL`))
      .returning({ id: takas.id });
    if (moved.length !== data.takaIds.length) throw conflict('Some takas were changed meanwhile. Refresh and try again.');
    await writeTakaEvents(
      tx,
      role,
      list.map((t): TakaEventInput => ({ takaId: t.id, event: 'ready_dispatch', note: `${takaActualPcs(t) ?? 0} pcs` })),
    );
    await recomputeOrdersStatus(tx, role, [orderId]);
    return { orderId, confirmed: list.length, pcs: list.reduce((s, t) => s + (takaActualPcs(t) ?? 0), 0) };
  });
}

/* ------------------------------------------------------------------ */
/* Damage tab                                                           */
/* ------------------------------------------------------------------ */

/** GET /godown/orders/:orderId/damages — the order's takas with OPEN damage, with photos (read-only). */
export async function getGodownDamages(role: RoleKey, orderId: number): Promise<OrderDamages> {
  const data = await getOrderDamages(role, orderId, {});
  const ids = data.items.flatMap((t) => t.damages.map((d) => d.id));
  const images = await damageImagesOf(ids);
  for (const t of data.items) for (const d of t.damages) d.images = images.get(d.id) ?? [];
  return data;
}

