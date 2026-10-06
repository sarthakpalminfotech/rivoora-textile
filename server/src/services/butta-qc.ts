import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import {
  applyResolve,
  buttaListQuerySchema,
  damageLabel,
  MAX_DAMAGE_IMAGES,
  qcSubmitSchema,
  takaEditNote,
  validateQcDecisions,
  type ButtaListQuery,
  type QcPendingPage,
  type QcResult,
  type RoleKey,
} from '@rivoora/shared';
import { db } from '../db/client';
import { challanTakas, challans, damages as damageMaster, orders, takaDamageImages, takaDamages, takas } from '../db/schema';
import { badRequest, conflict, notFound } from '../lib/errors';
import { likePattern } from '../lib/http';
import {
  insertTakaDamages,
  recomputeOrdersStatus,
  refreshIsDamaged,
  resolveDamageNames,
  writeTakaEvents,
  type TakaEventInput,
} from './taka-ops';

/** Butta QC (bilingual role): the takas received back from butta cutting are checked here. */

const now = () => new Date().toISOString();

/** Photos come from our own upload endpoint: a local `/uploads/…` path or an https (Cloudinary) URL. */
const isOurImageUrl = (url: string) => url.startsWith('/uploads/') || /^https:\/\//i.test(url);

/** GET /butta-qc/pending — takas in `butta_qc`, newest received first. */
export async function listQcPending(q: ButtaListQuery): Promise<QcPendingPage> {
  const parsed = buttaListQuerySchema.parse(q);
  let search: SQL | undefined;
  if (parsed.search) {
    const term = parsed.search.replace(/^#/, '');
    const p = likePattern(term);
    search = sql`(${takas.takaNo} LIKE ${p} ESCAPE '\\' OR ${orders.orderNo} = ${/^\d+$/.test(term) ? Number(term) : -1})`;
  }
  const where = and(eq(takas.stage, 'butta_qc'), eq(takas.isDeleted, false), search);
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
      .innerJoin(orders, eq(orders.id, takas.orderId))
      .leftJoin(challanTakas, and(eq(challanTakas.takaId, takas.id), eq(challanTakas.kind, 'butta'), eq(challanTakas.isActive, true)))
      .leftJoin(challans, eq(challans.id, challanTakas.challanId))
      .where(where)
      .orderBy(desc(challanTakas.receivedAt), desc(takas.id))
      .limit(parsed.limit)
      .offset((parsed.page - 1) * parsed.limit),
    db
      .select({ total: sql<number>`COUNT(*)` })
      .from(takas)
      .innerJoin(orders, eq(orders.id, takas.orderId))
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
  data.newDamages.forEach((d, j) => {
    if (d.images.length > MAX_DAMAGE_IMAGES) throw badRequest(`At most ${MAX_DAMAGE_IMAGES} images per damage.`, `newDamages.${j}.images`);
    if (d.images.some((i) => !isOurImageUrl(i.url) || !isOurImageUrl(i.thumbUrl))) throw badRequest('Upload the photos again.', `newDamages.${j}.images`);
  });
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
    if (taka.stage !== 'butta_qc') {
      throw conflict(
        taka.stage === 'at_butta' || taka.stage === 'entered'
          ? `Taka ${taka.takaNo} has not been received from butta cutting yet.`
          : `Taka ${taka.takaNo} was already checked.`,
      );
    }

    const open = await tx
      .select({
        id: takaDamages.id,
        damageId: takaDamages.damageId,
        foundAt: takaDamages.foundAt,
        pcs: takaDamages.pcs,
        resolvedPcs: takaDamages.resolvedPcs,
        name: damageMaster.name,
      })
      .from(takaDamages)
      .leftJoin(damageMaster, eq(damageMaster.id, takaDamages.damageId))
      .where(and(eq(takaDamages.takaId, takaId), eq(takaDamages.status, 'open'), eq(takaDamages.isDeleted, false)));

    const issues = validateQcDecisions(open, data.damageDecisions, data.pcs);
    if (issues.unknown.length) throw conflict('This taka was just changed by someone else. Go back and open it again.');
    if (issues.unanswered.length) throw badRequest('Answer every damage: resolved or not resolved.', 'damageDecisions');
    if (issues.pcsMissing.length) throw badRequest('Enter how many pcs are damaged.', 'damageDecisions');
    if (issues.pcsTooBig.length) throw badRequest(`A damage can't have more pcs than the taka (${data.pcs}).`, 'damageDecisions');
    if (issues.resolvedTooBig.length) throw badRequest("You can't resolve more pcs than are still damaged.", 'damageDecisions');
    data.newDamages.forEach((d, j) => {
      if (d.pcs > data.pcs) throw badRequest(`A damage can't have more pcs than the taka (${data.pcs}).`, `newDamages.${j}.pcs`);
    });

    const at = now();
    const events: TakaEventInput[] = [];

    // Meters / pcs.
    const editNote = takaEditNote({ meters: taka.meters, pcs: taka.pcs }, { meters: data.meters, pcs: data.pcs });
    if (editNote) {
      await tx.update(takas).set({ meters: data.meters, pcs: data.pcs }).where(eq(takas.id, takaId));
      events.push({ takaId, event: 'edited', note: `Butta QC · ${editNote}` });
    }

    // Decisions on the open damages (pcs resolved now; 0 = not resolved).
    const byId = new Map(data.damageDecisions.map((d) => [d.takaDamageId, d]));
    let resolved = 0;
    let kept = 0;
    for (const d of open) {
      const decision = byId.get(d.id)!;
      const pcs = d.pcs ?? decision.pcs ?? 0;
      if (decision.resolvedPcs <= 0) {
        if (d.pcs === null) await tx.update(takaDamages).set({ pcs }).where(eq(takaDamages.id, d.id));
        events.push({ takaId, event: 'damage_kept', takaDamageId: d.id, note: damageLabel(d.foundAt, d.name, pcs - (d.resolvedPcs ?? 0)) });
        kept += 1;
        continue;
      }
      const next = applyResolve({ pcs, resolvedPcs: d.resolvedPcs }, decision.resolvedPcs);
      await tx
        .update(takaDamages)
        .set(
          next.status === 'resolved'
            ? { status: 'resolved', resolvedPcs: next.resolvedPcs, resolvedAt: at, resolvedBy: role, resolvedStage: 'butta_qc', pcs }
            : { resolvedPcs: next.resolvedPcs, pcs },
        )
        .where(eq(takaDamages.id, d.id));
      const what = damageLabel(d.foundAt, d.name);
      events.push({
        takaId,
        event: next.status === 'resolved' ? 'damage_resolved' : 'damage_partly_resolved',
        takaDamageId: d.id,
        note: `${what} · resolved ${next.resolvedPcs} of ${pcs} pcs`,
      });
      if (next.status === 'resolved') resolved += 1;
      else kept += 1;
    }

    // New butta damages (+ photos).
    const damageIds = await resolveDamageNames(
      tx,
      data.newDamages.map((d) => ('damageId' in d ? { damageId: d.damageId } : { otherName: d.otherName })),
      (n) => `newDamages.${n}`,
    );
    const newIds = await insertTakaDamages(
      tx,
      role,
      data.newDamages.map((d, n) => ({ takaId, damageId: damageIds[n], pcs: d.pcs, foundAt: 'butta' as const })),
    );
    for (const [n, d] of data.newDamages.entries()) {
      if (!d.images.length) continue;
      await tx
        .insert(takaDamageImages)
        .values(d.images.map((i) => ({ takaDamageId: newIds[n], imageUrl: i.url, thumbUrl: i.thumbUrl, createdBy: role, createdAt: at })));
    }
    if (damageIds.length) {
      const names = new Map(
        (await tx.select({ id: damageMaster.id, name: damageMaster.name }).from(damageMaster).where(inArray(damageMaster.id, damageIds))).map((r) => [r.id, r.name]),
      );
      data.newDamages.forEach((d, n) =>
        events.push({
          takaId,
          event: 'damage_added',
          takaDamageId: newIds[n],
          note: `${damageLabel('butta', names.get(damageIds[n]), d.pcs)}${d.images.length ? ` · ${d.images.length} photo${d.images.length === 1 ? '' : 's'}` : ''}`,
        }),
      );
    }
    await refreshIsDamaged(tx, [takaId]);

    // Done: waiting for the mill.
    const moved = await tx
      .update(takas)
      .set({ stage: 'waiting_mill' })
      .where(and(eq(takas.id, takaId), eq(takas.stage, 'butta_qc')))
      .returning({ isDamaged: takas.isDamaged });
    if (!moved.length) throw conflict(`Taka ${taka.takaNo} was just changed. Go back and open it again.`);
    await tx
      .update(challanTakas)
      .set({ qcDoneAt: at, updatedAt: at })
      .where(and(eq(challanTakas.takaId, takaId), eq(challanTakas.kind, 'butta'), eq(challanTakas.isActive, true)));
    events.push({ takaId, event: 'butta_qc_done', note: moved[0].isDamaged ? 'Damaged' : 'Fresh' });
    await writeTakaEvents(tx, role, events);
    await recomputeOrdersStatus(tx, role, [taka.orderId]);
    return { takaId, takaNo: taka.takaNo, fresh: !moved[0].isDamaged, resolved, kept, added: data.newDamages.length };
  });
}
