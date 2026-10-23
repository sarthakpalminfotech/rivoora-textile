import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { buttaListQuerySchema, nextTakaStage, qcSubmitSchema, type ButtaListQuery, type QcPendingPage, type QcResult, type RoleKey } from '@rivoora/shared';
import { db } from '../db/client';
import { challanTakas, challans, orders, takas } from '../db/schema';
import { conflict, notFound } from '../lib/errors';
import { likePattern } from '../lib/http';
import { ancestorHasBeenToMill, freeTakasOfClosedOrders, recomputeOrdersStatus, refreshIsDamaged, stepsOfTakaOrder, writeTakaEvents } from './taka-ops';
import { applyQcChanges } from './qc-shared';
import { takaOrderId } from './free-stock';

/** Butta QC (bilingual role): the takas received back from butta cutting are checked here. */

const now = () => new Date().toISOString();

/** GET /butta-qc/pending — takas in `butta_qc`, newest received first. */
export async function listQcPending(q: ButtaListQuery): Promise<QcPendingPage> {
  const parsed = buttaListQuerySchema.parse(q);
  let search: SQL | undefined;
  if (parsed.search) {
    const term = parsed.search.replace(/^#/, '');
    const p = likePattern(term);
    search = sql`(${takas.takaNo} LIKE ${p} ESCAPE '\\' OR ${takas.weaverTakaNo} LIKE ${p} ESCAPE '\\' OR ${orders.orderNo} = ${/^\d+$/.test(term) ? Number(term) : -1})`;
  }
  // Sprint 15: a held order's takas wait (hidden) until the order is released.
  const where = and(eq(takas.stage, 'butta_qc'), eq(takas.isDeleted, false), eq(orders.isOnHold, false), search);
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
      .leftJoin(challanTakas, and(eq(challanTakas.takaId, takas.id), eq(challanTakas.kind, 'butta'), eq(challanTakas.isActive, true)))
      .leftJoin(challans, eq(challans.id, challanTakas.challanId))
      .where(where)
      .orderBy(desc(challanTakas.receivedAt), desc(takas.id))
      .limit(parsed.limit)
      .offset((parsed.page - 1) * parsed.limit),
    db
      .select({ total: sql<number>`COUNT(*)` })
      .from(takas)
      .innerJoin(orders, eq(orders.id, takaOrderId))
      .where(where),
  ]);
  const count = Number(total);
  return { items, page: parsed.page, limit: parsed.limit, total: count, hasMore: parsed.page * parsed.limit < count };
}

/**
 * POST /butta-qc/:takaId — one transaction. Meters / pcs are updated when changed (an `edited` event notes old →
 * new). Every open damage must get an answer: how many pcs were resolved (0 = not resolved). A damage becomes
 * `resolved` only when ALL its pcs are resolved; a partial resolve keeps it open with fewer open pcs. New damages found
 * here are butta damages (`damage_added`), optionally with photos. The taka then waits for the mill (`butta_qc_done`).
 */
export async function submitQc(role: RoleKey, takaId: number, input: unknown): Promise<QcResult> {
  const data = qcSubmitSchema.parse(input);
  return db.transaction(async (tx) => {
    const [taka] = await tx
      .select({
        id: takas.id,
        takaNo: takas.takaNo,
        stage: takas.stage,
        orderId: takas.orderId,
        meters: takas.meters,
        pcs: takas.pcs,
        refinishCount: takas.refinishCount,
        hasBeenToMill: takas.hasBeenToMill,
        parentTakaId: takas.parentTakaId,
      })
      .from(takas)
      .where(and(eq(takas.id, takaId), eq(takas.isDeleted, false)));
    if (!taka) throw notFound('Taka');
    if (taka.stage !== 'butta_qc') {
      throw conflict(
        taka.stage === 'at_butta' || taka.stage === 'entered'
          ? `Taka ${taka.takaNo} has not been received from butta cutting yet.`
          : `Taka ${taka.takaNo} was already checked.`,
      );
    }

    const at = now();
    // Meters / pcs, the decision on every open damage and the new butta damages (+ photos).
    const { events, resolved, kept, added } = await applyQcChanges(
      tx,
      role,
      taka,
      data,
      { recordedAt: 'butta_qc', resolvedStage: 'butta_qc', label: 'Butta QC', requireAnswers: true },
      at,
    );
    await refreshIsDamaged(tx, [takaId]);

    // Done: waiting for the mill — or, for a taka that has already been to the mill (re-butta), back to the godown.
    const [mill] = await tx
      .select({ id: challanTakas.id })
      .from(challanTakas)
      .where(and(eq(challanTakas.takaId, takaId), eq(challanTakas.kind, 'mill')))
      .limit(1);
    // Sprint 16: the ONE routing rule — waiting for the mill only when the order has the Mill step and the taka is not
    // dyed yet (Sprint 13: the taka OR any ancestor has been to the mill); otherwise back to the godown (final).
    const nextStage = nextTakaStage(await stepsOfTakaOrder(tx, takaId), 'butta_qc', {
      hasBeenToMill: taka.hasBeenToMill,
      ancestorHasBeenToMill: await ancestorHasBeenToMill(tx, taka.parentTakaId),
      hasMillHistory: Boolean(mill),
      refinishCount: taka.refinishCount,
    });
    const moved = await tx
      .update(takas)
      .set({ stage: nextStage })
      .where(and(eq(takas.id, takaId), eq(takas.stage, 'butta_qc')))
      .returning({ isDamaged: takas.isDamaged });
    if (!moved.length) throw conflict(`Taka ${taka.takaNo} was just changed. Go back and open it again.`);
    await tx
      .update(challanTakas)
      .set({ qcDoneAt: at, updatedAt: at })
      .where(and(eq(challanTakas.takaId, takaId), eq(challanTakas.kind, 'butta'), eq(challanTakas.isActive, true)));
    events.push({ takaId, event: 'butta_qc_done', note: moved[0].isDamaged ? 'Damaged' : 'Fresh' });
    // Sprint 16: a taka of a CLOSED order becomes free stock once it is back.
    await freeTakasOfClosedOrders(tx, role, [takaId], at, events);
    await writeTakaEvents(tx, role, events);
    await recomputeOrdersStatus(tx, role, [taka.orderId]);
    return { takaId, takaNo: taka.takaNo, result: 'final', fresh: !moved[0].isDamaged, resolved, kept, added };
  });
}
