import { and, desc, eq, or, sql, type SQL } from 'drizzle-orm';
import {
  buttaListQuerySchema,
  challanLabel,
  millQcOpenState,
  millQcSubmitSchema,
  type ButtaListQuery,
  type MillQcTaka,
  type QcPendingPage,
  type QcResult,
  type RoleKey,
} from '@rivoora/shared';
import { db } from '../db/client';
import { challanTakas, challans, orders, takas } from '../db/schema';
import { conflict, notFound } from '../lib/errors';
import { likePattern } from '../lib/http';
import { applyQcChanges } from './qc-shared';
import { takaByNo } from './takas';
import { freeTakasOfClosedOrders, recomputeOrdersStatus, refreshIsDamaged, writeTakaEvents, type TakaEventInput } from './taka-ops';
import { takaOrderId } from './free-stock';

/**
 * Mill QC (bilingual role): the last check of the takas that came back from the mill. A taka is Fresh or has damage;
 * older damages can be resolved; some takas go back to the mill for refinishing. Fresh and damaged takas become the
 * order's final takas in the godown.
 */

const now = () => new Date().toISOString();

/** GET /mill-qc/pending — takas in `mill_qc`, newest received first. */
export async function listMillQcPending(q: ButtaListQuery): Promise<QcPendingPage> {
  const parsed = buttaListQuerySchema.parse(q);
  let search: SQL | undefined;
  if (parsed.search) {
    const term = parsed.search.replace(/^#/, '');
    const p = likePattern(term);
    search = sql`(${takas.takaNo} LIKE ${p} ESCAPE '\\' OR ${takas.weaverTakaNo} LIKE ${p} ESCAPE '\\' OR ${orders.orderNo} = ${/^\d+$/.test(term) ? Number(term) : -1})`;
  }
  // Waiting for QC: back from the mill, or still marked at the mill on a challan the godown counted takas on.
  const where = and(
    or(eq(takas.stage, 'mill_qc'), and(eq(takas.stage, 'at_mill'), sql`${challans.receivedCount} > 0`)),
    eq(takas.isDeleted, false),
    // Sprint 15: a held order's takas wait (hidden) until the order is released.
    eq(orders.isOnHold, false),
    search,
  );
  const [items, [{ total }]] = await db.batch([
    db
      .select({
        id: takas.id,
        takaNo: takas.takaNo,
        orderNo: orders.orderNo,
        meters: takas.meters,
        pcs: takas.pcs,
        isDamaged: takas.isDamaged,
        challanNo: challans.challanNo,
        receivedAt: challanTakas.receivedAt,
      })
      .from(takas)
      .innerJoin(orders, eq(orders.id, takaOrderId))
      .leftJoin(challanTakas, and(eq(challanTakas.takaId, takas.id), eq(challanTakas.kind, 'mill'), eq(challanTakas.isActive, true)))
      .leftJoin(challans, eq(challans.id, challanTakas.challanId))
      .where(where)
      .orderBy(desc(challanTakas.receivedAt), desc(takas.id))
      .limit(parsed.limit)
      .offset((parsed.page - 1) * parsed.limit),
    db
      .select({ total: sql<number>`COUNT(*)` })
      .from(takas)
      .innerJoin(orders, eq(orders.id, takaOrderId))
      .leftJoin(challanTakas, and(eq(challanTakas.takaId, takas.id), eq(challanTakas.kind, 'mill'), eq(challanTakas.isActive, true)))
      .leftJoin(challans, eq(challans.id, challanTakas.challanId))
      .where(where),
  ]);
  const count = Number(total);
  return { items, page: parsed.page, limit: parsed.limit, total: count, hasMore: parsed.page * parsed.limit < count };
}

/** GET /mill-qc/taka/:no — the taka (restricted view) and what the Mill QC may do with it. */
export async function openMillQcTaka(role: RoleKey, takaNo: string): Promise<MillQcTaka> {
  const taka = await takaByNo(role, takaNo);
  return { taka, state: millQcOpenState(taka.stage) };
}

/**
 * POST /mill-qc/:takaId — one transaction.
 *  1. A taka still `at_mill` is marked received on its mill challan first (`received_mill`).
 *  2. Meters / pcs edits (`edited`), the decision on every open damage (resolved pcs; 0 = not resolved) and the new
 *     Mill damages with photos. Sending to refinish needs no answers: open damages just stay open.
 *  3. Stage: Fresh / Done → `final` (`mill_qc_done`) · Send to refinish → `refinish`, `refinish_count + 1`,
 *     `sent_refinish` with the note.
 * Ends with `is_damaged` and the order status.
 */
export async function submitMillQc(role: RoleKey, takaId: number, input: unknown): Promise<QcResult> {
  const data = millQcSubmitSchema.parse(input);
  return db.transaction(async (tx) => {
    const [taka] = await tx
      .select({
        id: takas.id,
        takaNo: takas.takaNo,
        stage: takas.stage,
        orderId: takas.orderId,
        meters: takas.meters,
        pcs: takas.pcs,
      })
      .from(takas)
      .where(and(eq(takas.id, takaId), eq(takas.isDeleted, false)));
    if (!taka) throw notFound('Taka');
    if (taka.stage !== 'mill_qc' && taka.stage !== 'at_mill') {
      throw conflict(
        taka.stage === 'final' || taka.stage === 'ready_dispatch'
          ? `Taka ${taka.takaNo} was already checked.`
          : `Taka ${taka.takaNo} was not sent to the mill.`,
      );
    }

    const at = now();
    const events: TakaEventInput[] = [];

    // 1 — not marked received yet: receive it on its challan now.
    if (taka.stage === 'at_mill') {
      const [row] = await tx
        .select({ id: challanTakas.id, challanId: challanTakas.challanId, challanNo: challans.challanNo })
        .from(challanTakas)
        .innerJoin(challans, eq(challans.id, challanTakas.challanId))
        .where(and(eq(challanTakas.takaId, takaId), eq(challanTakas.kind, 'mill'), eq(challanTakas.isActive, true)));
      if (!row) throw conflict(`Taka ${taka.takaNo} is not on a mill challan.`);
      const moved = await tx
        .update(takas)
        .set({ stage: 'mill_qc', hasBeenToMill: true })
        .where(and(eq(takas.id, takaId), eq(takas.stage, 'at_mill')))
        .returning({ id: takas.id });
      const marked = moved.length
        ? await tx
            .update(challanTakas)
            .set({ receivedAt: at, receivedBy: role, updatedAt: at })
            .where(and(eq(challanTakas.id, row.id), sql`${challanTakas.receivedAt} IS NULL`))
            .returning({ id: challanTakas.id })
        : [];
      if (!moved.length || !marked.length) throw conflict(`Taka ${taka.takaNo} was just changed. Go back and open it again.`);
      events.push({ takaId, event: 'received_mill', challanId: row.challanId, note: `${challanLabel(row.challanNo, 'mill')} · marked received at Mill QC` });
    }

    // 2 — meters / pcs, the open damages, the new Mill damages.
    const refinish = data.result === 'refinish';
    const changes = await applyQcChanges(
      tx,
      role,
      taka,
      data,
      { recordedAt: 'mill_qc', resolvedStage: 'mill_qc', label: 'Mill QC', requireAnswers: !refinish },
      at,
    );
    events.push(...changes.events);
    await refreshIsDamaged(tx, [takaId]);

    // 3 — the stage.
    const moved = await tx
      .update(takas)
      .set(refinish ? { stage: 'refinish', refinishCount: sql`${takas.refinishCount} + 1`, hasBeenToMill: true } : { stage: 'final', hasBeenToMill: true })
      .where(and(eq(takas.id, takaId), eq(takas.stage, 'mill_qc')))
      .returning({ isDamaged: takas.isDamaged, refinishCount: takas.refinishCount });
    if (!moved.length) throw conflict(`Taka ${taka.takaNo} was just changed. Go back and open it again.`);
    await tx.update(challanTakas).set({ qcDoneAt: at, updatedAt: at }).where(and(eq(challanTakas.takaId, takaId), eq(challanTakas.kind, 'mill'), eq(challanTakas.isActive, true)));
    if (refinish) {
      events.push({ takaId, event: 'sent_refinish', note: data.refinishNote ? `Mill QC · ${data.refinishNote}` : 'Mill QC' });
    } else {
      events.push({ takaId, event: 'mill_qc_done', note: moved[0].isDamaged ? 'Damaged' : 'Fresh' });
    }
    // Sprint 16: a taka of a CLOSED order becomes free stock once it is back.
    await freeTakasOfClosedOrders(tx, role, [takaId], at, events);
    await writeTakaEvents(tx, role, events);
    await recomputeOrdersStatus(tx, role, [taka.orderId]);
    return {
      takaId,
      takaNo: taka.takaNo,
      result: refinish ? 'refinish' : 'final',
      fresh: !moved[0].isDamaged,
      resolved: changes.resolved,
      kept: changes.kept,
      added: changes.added,
    };
  });
}
