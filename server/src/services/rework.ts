import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  reworkSelectable,
  sendBackSchema,
  SENT_BACK_BY_OWNER,
  sendBackStage,
  undoSendBackSchema,
  type TakaStage,
  type UndoSendBackResult,
  takaActualPcs,
  takaStageStatusText,
  type RoleKey,
  type SendBackResult,
} from '@rivoora/shared';
import { db } from '../db/client';
import { jobsheets, orders, takas } from '../db/schema';
import { conflict, notFound } from '../lib/errors';
import { chunk, recomputeOrdersStatus, writeTakaEvents, type TakaEventInput } from './taka-ops';
import { takaInOrder } from './free-stock';

/**
 * Rework: Jenish / Gaurang send takas back to butta cutting (`rework_butta`) or to the mill (`refinish`, which already
 * goes back through Mill → Send → Refinish). One transaction with conditional stage updates; ends with the status recompute.
 */
export async function sendBackTakas(role: RoleKey, orderId: number, input: unknown): Promise<SendBackResult> {
  const data = sendBackSchema.parse(input);
  return db.transaction(async (tx) => {
    const [order] = await tx.select({ id: orders.id, orderNo: orders.orderNo }).from(orders).where(eq(orders.id, orderId));
    if (!order) throw notFound('Order');

    const rows: { id: number; takaNo: string; stage: string; pcs: number | null; actualPcs: number | null }[] = [];
    for (const part of chunk(data.takaIds)) {
      rows.push(
        ...(await tx
          .select({ id: takas.id, takaNo: takas.takaNo, stage: takas.stage, pcs: takas.pcs, actualPcs: takas.actualPcs })
          .from(takas)
          .innerJoin(jobsheets, eq(jobsheets.id, takas.jobsheetId))
          .where(and(inArray(takas.id, part), takaInOrder(orderId), eq(takas.isDeleted, false), eq(jobsheets.isDeleted, false)))),
      );
    }
    const found = new Map(rows.map((r) => [r.id, r]));
    const targetStage = sendBackStage(data.target);
    const bad = data.takaIds.flatMap((id) => {
      const r = found.get(id);
      if (!r) return [`#${id} (not on this order)`];
      const sel = reworkSelectable(r.stage);
      if (!sel.selectable) return [`${r.takaNo} (${takaStageStatusText(r.stage)})`];
      if (r.stage === targetStage) return [`${r.takaNo} (already waiting there)`];
      return [];
    });
    if (bad.length) {
      throw conflict(`These takas can't be sent back: ${bad.slice(0, 15).join(', ')}${bad.length > 15 ? ' …' : ''}. Refresh and try again.`);
    }

    // Conditional update per current stage: anything that changed meanwhile stops the whole send-back.
    const byStage = new Map<string, number[]>();
    for (const r of rows) byStage.set(r.stage, [...(byStage.get(r.stage) ?? []), r.id]);
    for (const [stage, ids] of byStage) {
      for (const part of chunk(ids)) {
        const moved = await tx
          .update(takas)
          .set(
            data.target === 'butta'
              ? { stage: targetStage, stageBeforeRework: stage as TakaStage, reworkCount: sql`${takas.reworkCount} + 1`, godownCheckedAt: null, godownCheckedBy: null }
              : { stage: targetStage, stageBeforeRework: stage as TakaStage, refinishCount: sql`${takas.refinishCount} + 1`, godownCheckedAt: null, godownCheckedBy: null },
          )
          .where(and(inArray(takas.id, part), eq(takas.stage, stage as typeof takas.$inferSelect.stage)))
          .returning({ id: takas.id });
        if (moved.length !== part.length) throw conflict('Some takas changed meanwhile. Refresh and try again.');
      }
    }

    const where = data.target === 'butta' ? 'butta cutting' : 'the mill';
    const events = rows.map(
      (r): TakaEventInput => ({
        takaId: r.id,
        event: 'sent_back',
        note: [`Sent back to ${where} (from ${takaStageStatusText(r.stage)})`, data.target === 'mill' ? SENT_BACK_BY_OWNER : null, data.note].filter(Boolean).join(' · '),
      }),
    );
    await writeTakaEvents(tx, role, events);
    await recomputeOrdersStatus(tx, role, [orderId]);
    return { orderId, target: data.target, sent: rows.length, pcs: rows.reduce((n, r) => n + (takaActualPcs(r) ?? 0), 0) };
  });
}

/**
 * Sprint 21 (CR-09) — undo a send back, until the taka is put on a challan. The taka returns to the stage it had before
 * (`stage_before_rework`; an older send-back without one falls back to `final`, where it came from the godown). Allowed
 * only while the taka's LAST event is that send back (a refinish that came from Mill QC, or a taka that has been on a
 * challan since, can't be undone this way). Reason required; event `rework_undone`.
 */
export async function undoSendBack(role: RoleKey, orderId: number, input: unknown): Promise<UndoSendBackResult> {
  const data = undoSendBackSchema.parse(input);
  return db.transaction(async (tx) => {
    const [order] = await tx.select({ id: orders.id }).from(orders).where(eq(orders.id, orderId));
    if (!order) throw notFound('Order');
    const rows: { id: number; takaNo: string; stage: TakaStage; before: TakaStage | null; lastEvent: string | null }[] = [];
    for (const part of chunk(data.takaIds)) {
      rows.push(
        ...(await tx
          .select({
            id: takas.id,
            takaNo: takas.takaNo,
            stage: takas.stage,
            before: takas.stageBeforeRework,
            lastEvent: sql<string | null>`(SELECT e.event FROM taka_events e WHERE e.taka_id = "takas"."id" ORDER BY e.id DESC LIMIT 1)`,
          })
          .from(takas)
          .where(and(inArray(takas.id, part), takaInOrder(orderId), eq(takas.isDeleted, false)))),
      );
    }
    const found = new Map(rows.map((r) => [r.id, r]));
    const bad = data.takaIds.flatMap((id) => {
      const r = found.get(id);
      if (!r) return [`#${id} (not on this order)`];
      if ((r.stage !== 'rework_butta' && r.stage !== 'refinish') || r.lastEvent !== 'sent_back') return [`${r.takaNo} (${takaStageStatusText(r.stage)})`];
      return [];
    });
    if (bad.length) {
      throw conflict(`These takas can't be taken back — a send back can be undone only until the taka is put on a challan: ${bad.slice(0, 15).join(', ')}${bad.length > 15 ? ' …' : ''}.`);
    }
    for (const r of rows) {
      const back = r.before ?? 'final';
      const moved = await tx
        .update(takas)
        .set({
          stage: back,
          stageBeforeRework: null,
          ...(r.stage === 'rework_butta' ? { reworkCount: sql`MAX(${takas.reworkCount} - 1, 0)` } : { refinishCount: sql`MAX(${takas.refinishCount} - 1, 0)` }),
        })
        .where(and(eq(takas.id, r.id), eq(takas.stage, r.stage)))
        .returning({ id: takas.id });
      if (!moved.length) throw conflict('Some takas changed meanwhile. Refresh and try again.');
    }
    await writeTakaEvents(
      tx,
      role,
      rows.map((r): TakaEventInput => ({ takaId: r.id, event: 'rework_undone', note: `Send back undone → ${takaStageStatusText(r.before ?? 'final')} · ${data.reason}` })),
    );
    await recomputeOrdersStatus(tx, role, [orderId]);
    return { orderId, undone: rows.length };
  });
}
