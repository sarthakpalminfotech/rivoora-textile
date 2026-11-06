import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import {
  damageLabel,
  reasonOnlySchema,
  ROLES,
  takaStageStatusText,
  type QcCorrectionAction,
  type QcCorrectionResult,
  type QcCorrectionTaka,
  type RoleKey,
  type TakaStage,
} from '@rivoora/shared';
import { db, type DbOrTx } from '../db/client';
import { damages as damageMaster, challanTakas, designs, orders, qcRuns, takaDamages, takaEvents, takas, users } from '../db/schema';
import { conflict, notFound } from '../lib/errors';
import { currentUserId } from '../lib/request-context';
import { refreshIsDamaged, recomputeOrdersStatus, writeTakaEvents } from './taka-ops';
import { latestQcRun, type QcRunChanges } from './qc-runs';
import { resolveTakaNumber } from './taka-lookup';

/**
 * Sprint 21 (C6) — QC corrections (Gaurang, the production supervisor, Jenish: `canUndoQc`).
 * - Undo QC result: while the taka has not moved on since that QC (its LAST event is the QC's own) it goes back to
 *   `butta_qc` / `mill_qc`; damages the QC added are deleted, damages it resolved are reopened exactly (from `qc_runs`).
 * - Cancel refinish: a taka in `refinish` that is on no challan goes back to `final` (the godown).
 * Both need a reason and write an event; the order status is recomputed.
 */

const QC_DONE_EVENTS = ['butta_qc_done', 'mill_qc_done', 'sent_refinish'];

async function findTaka(tx: DbOrTx, where: SQL) {
  const [t] = await tx
    .select({
      id: takas.id,
      takaNo: takas.takaNo,
      stage: takas.stage,
      orderId: takas.orderId,
      pcs: takas.pcs,
      meters: takas.meters,
      isFreeStock: takas.isFreeStock,
      refinishCount: takas.refinishCount,
      godownCheckedAt: takas.godownCheckedAt,
      orderNo: orders.orderNo,
      designCode: designs.code,
      lastEvent: sql<string | null>`(SELECT e.event FROM taka_events e WHERE e.taka_id = "takas"."id" ORDER BY e.id DESC LIMIT 1)`,
    })
    .from(takas)
    .innerJoin(orders, eq(orders.id, takas.orderId))
    .leftJoin(designs, eq(designs.id, orders.designId))
    .where(and(where, eq(takas.isDeleted, false)));
  return t ?? null;
}

type FoundTaka = NonNullable<Awaited<ReturnType<typeof findTaka>>>;

function undoQcCheck(t: FoundTaka, run: Awaited<ReturnType<typeof latestQcRun>>): QcCorrectionAction {
  if (!run || run.undoneAt) return { allowed: false, reason: 'There is no QC result on this taka to undo.' };
  if (t.isFreeStock) return { allowed: false, reason: 'This taka is free stock now — its QC result can no longer be undone.' };
  if (t.stage !== run.result) return { allowed: false, reason: `It has moved on (${takaStageStatusText(t.stage)}) — the QC result can't be undone.` };
  if (!t.lastEvent || !QC_DONE_EVENTS.includes(t.lastEvent)) return { allowed: false, reason: 'Something happened to this taka after the QC — the QC result can no longer be undone.' };
  if (t.stage === 'final' && t.godownCheckedAt) return { allowed: false, reason: 'It is already ticked in the godown.' };
  return { allowed: true, reason: null };
}

function cancelRefinishCheck(t: FoundTaka): QcCorrectionAction {
  if (t.isFreeStock) return { allowed: false, reason: 'This taka is free stock.' };
  if (t.stage !== 'refinish') {
    return { allowed: false, reason: t.stage === 'at_mill' ? 'It is on a mill challan — remove it from the challan first.' : 'This taka is not waiting in refinish.' };
  }
  return { allowed: true, reason: null };
}

/** GET /qc-corrections/taka/:no */
export async function qcCorrectionsByNo(_role: RoleKey, takaNo: string): Promise<QcCorrectionTaka> {
  const found = await resolveTakaNumber(db, takaNo);
  if (found.kind === 'many') throw conflict(`${found.candidates.length} takas have number ${takaNo.trim()} (${found.candidates.map((c) => c.fy).join(', ')}) — type the number from the current year, or pick the right one.`, 'ambiguous');
  const t = found.kind === 'one' ? await findTaka(db, eq(takas.id, found.id)) : null;
  if (!t) throw notFound('Taka');
  const run = await latestQcRun(db, t.id);
  const runUser = run?.doneByUserId ? ((await db.select({ name: users.name }).from(users).where(eq(users.id, run.doneByUserId)))[0]?.name ?? null) : null;
  const dmg = await db
    .select({
      id: takaDamages.id,
      foundAt: takaDamages.foundAt,
      pcs: takaDamages.pcs,
      resolvedPcs: takaDamages.resolvedPcs,
      meters: takaDamages.meters,
      resolvedMeters: takaDamages.resolvedMeters,
      status: takaDamages.status,
      name: damageMaster.name,
    })
    .from(takaDamages)
    .leftJoin(damageMaster, eq(damageMaster.id, takaDamages.damageId))
    .where(and(eq(takaDamages.takaId, t.id), eq(takaDamages.isDeleted, false)))
    .orderBy(asc(takaDamages.id));
  const events = await db
    .select({ id: takaEvents.id, event: takaEvents.event, note: takaEvents.note, createdAt: takaEvents.createdAt })
    .from(takaEvents)
    .where(eq(takaEvents.takaId, t.id))
    .orderBy(desc(takaEvents.id))
    .limit(12);
  return {
    id: t.id,
    takaNo: t.takaNo,
    orderNo: t.orderNo,
    designCode: t.designCode,
    stage: t.stage,
    pcs: t.pcs,
    meters: t.meters,
    lastQc: run && !run.undoneAt ? { kind: run.kind, result: run.result, at: run.createdAt, byName: runUser, byRole: run.doneByRole } : null,
    damages: dmg.map((d) => ({
      id: d.id,
      status: d.status,
      label: damageLabel(d.foundAt, d.name, d.pcs !== null ? d.pcs - d.resolvedPcs : null, d.meters !== null ? d.meters - d.resolvedMeters : null),
    })),
    undoQc: undoQcCheck(t, run),
    cancelRefinish: cancelRefinishCheck(t),
    events: events.reverse(),
  };
}

/** POST /qc-corrections/:takaId/undo-qc */
export async function undoQcResult(role: RoleKey, takaId: number, input: unknown): Promise<QcCorrectionResult> {
  const data = reasonOnlySchema.parse(input);
  return db.transaction(async (tx) => {
    const t = await findTaka(tx, eq(takas.id, takaId));
    if (!t) throw notFound('Taka');
    const run = await latestQcRun(tx, takaId);
    const check = undoQcCheck(t, run);
    if (!check.allowed || !run) throw conflict(`Taka ${t.takaNo}: ${check.reason}`);
    const changes = JSON.parse(run.changes) as QcRunChanges;
    const at = new Date().toISOString();

    // Damages: the ones the QC added go; the ones it touched get their old values back.
    for (const id of changes.addedIds) {
      await tx.update(takaDamages).set({ isDeleted: true, updatedAt: at }).where(eq(takaDamages.id, id));
    }
    for (const b of changes.before) {
      await tx
        .update(takaDamages)
        .set({
          status: b.status,
          pcs: b.pcs,
          resolvedPcs: b.resolvedPcs,
          meters: b.meters,
          resolvedMeters: b.resolvedMeters,
          resolvedAt: b.resolvedAt,
          resolvedBy: b.resolvedBy,
          resolvedStage: b.resolvedStage,
          updatedAt: at,
        })
        .where(eq(takaDamages.id, b.id));
    }
    await refreshIsDamaged(tx, [takaId]);

    const backTo: TakaStage = run.kind === 'butta' ? 'butta_qc' : 'mill_qc';
    const moved = await tx
      .update(takas)
      .set({ stage: backTo, ...(run.result === 'refinish' ? { refinishCount: changes.refinishCountBefore } : {}) })
      .where(and(eq(takas.id, takaId), eq(takas.stage, t.stage)))
      .returning({ id: takas.id });
    if (!moved.length) throw conflict(`Taka ${t.takaNo} was just changed. Refresh and try again.`);
    await tx
      .update(challanTakas)
      .set({ qcDoneAt: null, updatedAt: at })
      .where(and(eq(challanTakas.takaId, takaId), eq(challanTakas.kind, run.kind), eq(challanTakas.isActive, true)));
    await tx
      .update(qcRuns)
      .set({ undoneAt: at, undoneByRole: role, undoneByUserId: currentUserId(), undoneReason: data.reason, updatedAt: at })
      .where(eq(qcRuns.id, run.id));
    await writeTakaEvents(tx, role, [
      {
        takaId,
        event: 'qc_undone',
        note: `${run.kind === 'butta' ? 'Butta' : 'Mill'} QC result undone by ${ROLES[role].name} → ${takaStageStatusText(backTo)} · ${data.reason}${changes.addedIds.length ? ` · ${changes.addedIds.length} damage(s) removed` : ''}`,
      },
    ]);
    await recomputeOrdersStatus(tx, role, [t.orderId]);
    return { takaId, takaNo: t.takaNo, stage: backTo };
  });
}

/** POST /qc-corrections/:takaId/cancel-refinish */
export async function cancelRefinish(role: RoleKey, takaId: number, input: unknown): Promise<QcCorrectionResult> {
  const data = reasonOnlySchema.parse(input);
  return db.transaction(async (tx) => {
    const t = await findTaka(tx, eq(takas.id, takaId));
    if (!t) throw notFound('Taka');
    const check = cancelRefinishCheck(t);
    if (!check.allowed) throw conflict(`Taka ${t.takaNo}: ${check.reason}`);
    const moved = await tx
      .update(takas)
      .set({ stage: 'final', stageBeforeRework: null, refinishCount: sql`MAX(${takas.refinishCount} - 1, 0)`, godownCheckedAt: null, godownCheckedBy: null })
      .where(and(eq(takas.id, takaId), eq(takas.stage, 'refinish')))
      .returning({ id: takas.id });
    if (!moved.length) throw conflict(`Taka ${t.takaNo} was just changed. Refresh and try again.`);
    await writeTakaEvents(tx, role, [{ takaId, event: 'refinish_cancelled', note: `Refinish cancelled by ${ROLES[role].name} → godown · ${data.reason}` }]);
    await recomputeOrdersStatus(tx, role, [t.orderId]);
    return { takaId, takaNo: t.takaNo, stage: 'final' as TakaStage };
  });
}
