import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import {
  can,
  canRoleSeeJobsheetStatus,
  canRoleSeeStatus,
  damageLabel,
  jobsheetRef,
  JOBSHEET_STATUS,
  MAX_TAKAS_PER_JOBSHEET,
  takaEditNote,
  takaEditSchema,
  takaEntrySchema,
  takaNoError,
  takaSummary,
  totalMeters,
  totalPcs,
  validateTakaNumbers,
  TAKA_ERROR_TEXT,
  type JobsheetTakaGroup,
  type OrderTakas,
  type RoleKey,
  type Taka,
  type TakaAvailability,
  type TakaDetail,
  type TakaEditResult,
  type TakaEntryResult,
  type TakaEvent,
  type TakaJobsheetItem,
  type TakaJobsheetPage,
  type TakaListQuery,
  type TakaNoError,
} from '@rivoora/shared';
import { db, type Tx } from '../db/client';
import {
  buttaChallanTakas,
  buttaChallans,
  damages as damageMaster,
  designVariations,
  designs,
  jobsheets,
  materials,
  orders,
  takaDamages,
  takaEvents,
  takas,
} from '../db/schema';
import { badRequest, conflict, notFound } from '../lib/errors';
import {
  activeTakaCount,
  isRestricted,
  jobsheetSearch,
  machinesJson,
  now,
  parseMachinesJson,
  recomputeOrderStatus,
  runningMachine,
  runningMachineColumns,
  toMachineRef,
  writeEvents,
} from './jobsheets';
import { mapTaka, parseDamagesJson, sortTakas, takaColumns, takaDamagesJson } from './taka-shared';
import {
  initialStageForOrder,
  insertTakaDamages,
  refreshIsDamaged,
  resolveDamageNames,
  usedMessage,
  usedTakaNumbers,
  writeTakaEvents,
  type TakaEventInput,
} from './taka-ops';

/* ------------------------------------------------------------------ */
/* helpers                                                              */
/* ------------------------------------------------------------------ */

/** A jobsheet the role may see (404 otherwise), with what taka writes need. */
async function loadJobsheetForTakas(tx: Tx, role: RoleKey, id: number) {
  const [js] = await tx
    .select({
      id: jobsheets.id,
      jobsheetNo: jobsheets.jobsheetNo,
      orderId: jobsheets.orderId,
      status: jobsheets.status,
      frames: jobsheets.frames,
      runningMachineId: jobsheets.runningMachineId,
      takaNote: jobsheets.takaNote,
      isDeleted: jobsheets.isDeleted,
      orderNo: orders.orderNo,
      orderStatus: orders.status,
    })
    .from(jobsheets)
    .innerJoin(orders, eq(orders.id, jobsheets.orderId))
    .where(eq(jobsheets.id, id));
  if (!js || js.isDeleted || !canRoleSeeJobsheetStatus(role, js.status)) throw notFound('Jobsheet');
  if (!isRestricted(role) && !canRoleSeeStatus(role, js.orderStatus)) throw notFound('Jobsheet');
  return js;
}

async function activeTakas(tx: Tx, jobsheetId: number): Promise<Taka[]> {
  const rows = await tx
    .select(takaColumns)
    .from(takas)
    .where(and(eq(takas.jobsheetId, jobsheetId), eq(takas.isDeleted, false)))
    .orderBy(asc(takas.id));
  return sortTakas(rows.map(mapTaka));
}

/**
 * 400 on the first invalid row, with the field path the forms map inline (`takas.3.takaNo`). A number that is
 * already used anywhere gets the bilingual message with the order / jobsheet it is used in.
 */
function assertValidNumbers(values: string[], errors: (TakaNoError | null)[], used: ReadonlyMap<string, string>) {
  const i = errors.findIndex((e) => e !== null);
  if (i >= 0) {
    const err = errors[i]!;
    const message =
      err === 'already_used'
        ? usedMessage(values[i], used.get(values[i].trim()))
        : `Taka ${values[i] || i + 1}: ${TAKA_ERROR_TEXT[err].en}`;
    throw badRequest(message, `takas.${i}.takaNo`);
  }
}

/** A taka's damage must not be bigger than the taka itself. */
function assertDamagePcs(takaNo: string, takaPcs: number | null, pcs: number | null, field: string) {
  if (pcs !== null && takaPcs !== null && pcs > takaPcs) {
    throw badRequest(`Taka ${takaNo}: damaged pcs can't be more than the taka's ${takaPcs} pcs`, field);
  }
}

/* ------------------------------------------------------------------ */
/* entry (Taka entry role)                                              */
/* ------------------------------------------------------------------ */

/**
 * Adds takas to a jobsheet (never edits existing ones), appends the note, and completes the jobsheet if it isn't
 * Completed yet (completed frames = assigned frames). Each new taka starts in `entered` (butta design / no design)
 * or `waiting_mill` (design skips butta cutting). One transaction; ends with the order status recompute.
 */
export async function enterTakas(role: RoleKey, id: number, input: unknown): Promise<TakaEntryResult> {
  const data = takaEntrySchema.parse(input);
  return db.transaction(async (tx) => {
    const js = await loadJobsheetForTakas(tx, role, id);
    const existing = await activeTakas(tx, id);
    const values = data.takas.map((t) => t.takaNo);
    const used = await usedTakaNumbers(tx, values);
    assertValidNumbers(values, validateTakaNumbers(values, existing.map((t) => t.takaNo), { used }), used);
    if (existing.length + data.takas.length > MAX_TAKAS_PER_JOBSHEET) {
      throw badRequest(`A jobsheet can have at most ${MAX_TAKAS_PER_JOBSHEET} takas.`);
    }
    data.takas.forEach((t, i) =>
      t.damages.forEach((d, j) => assertDamagePcs(t.takaNo, t.pcs, d.pcs, `takas.${i}.damages.${j}.pcs`)),
    );

    const at = now();
    const stage = await initialStageForOrder(tx, js.orderId);
    const inserted = await tx
      .insert(takas)
      .values(
        data.takas.map((t) => ({
          jobsheetId: id,
          orderId: js.orderId,
          takaNo: t.takaNo,
          meters: t.meters,
          pcs: t.pcs,
          isDamaged: t.damages.length > 0,
          stage,
          enteredBy: role,
          createdAt: at,
          updatedAt: at,
        })),
      )
      .returning({ id: takas.id, takaNo: takas.takaNo });
    const idByNo = new Map(inserted.map((t) => [t.takaNo, t.id]));

    // Damages: every one is machine damage (WHERE) at taka entry; the master name says WHAT it is.
    const flat = data.takas.flatMap((t, i) => t.damages.map((d, j) => ({ takaIndex: i, damageIndex: j, takaNo: t.takaNo, pick: d })));
    const damageIds = await resolveDamageNames(
      tx,
      flat.map((f) => ('damageId' in f.pick ? { damageId: f.pick.damageId } : { otherName: f.pick.otherName })),
      (n) => `takas.${flat[n].takaIndex}.damages.${flat[n].damageIndex}`,
    );
    await insertTakaDamages(
      tx,
      role,
      flat.map((f, n) => ({ takaId: idByNo.get(f.takaNo)!, damageId: damageIds[n], pcs: f.pick.pcs, foundAt: 'machine' as const })),
    );
    const names = await damageNames(tx, damageIds);
    const events: TakaEventInput[] = inserted.map((t) => ({ takaId: t.id, event: 'entered', note: jobsheetRef(js.orderNo, js.jobsheetNo) }));
    flat.forEach((f, n) =>
      events.push({
        takaId: idByNo.get(f.takaNo)!,
        event: 'damage_added',
        note: damageLabel('machine', names.get(damageIds[n]), f.pick.pcs),
      }),
    );
    await writeTakaEvents(tx, role, events);

    const insertedIds = new Set(inserted.map((t) => t.id));
    const added = (await activeTakas(tx, id)).filter((t) => insertedIds.has(t.id));

    if (data.note) {
      const note = js.takaNote ? `${js.takaNote}\n${data.note}` : data.note;
      await tx.update(jobsheets).set({ takaNote: note }).where(eq(jobsheets.id, id));
    }

    const autoCompleted = js.status !== JOBSHEET_STATUS.COMPLETED;
    if (autoCompleted) {
      const done = await tx
        .update(jobsheets)
        .set({ status: JOBSHEET_STATUS.COMPLETED, completedAt: at, completedFrames: js.frames })
        .where(and(eq(jobsheets.id, id), eq(jobsheets.status, js.status)))
        .returning({ id: jobsheets.id });
      if (!done.length) throw conflict(`${jobsheetRef(js.orderNo, js.jobsheetNo)} was just changed. Refresh and try again.`);
    }
    await writeEvents(tx, role, [
      ...(autoCompleted
        ? [
            {
              jobsheetId: id,
              event: 'completed' as const,
              machineId: js.runningMachineId,
              frames: js.frames,
              note: 'completed at taka entry',
            },
          ]
        : []),
      { jobsheetId: id, event: 'takas_entered', note: takaSummary(added) },
    ]);
    await recomputeOrderStatus(js.orderId, role, tx);
    return { jobsheetId: id, jobsheetNo: js.jobsheetNo, orderNo: js.orderNo, orderId: js.orderId, added, autoCompleted };
  });
}

/** Names of damage master entries (for history notes). */
async function damageNames(tx: Tx, ids: readonly number[]): Promise<Map<number, string>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const rows = await tx.select({ id: damageMaster.id, name: damageMaster.name }).from(damageMaster).where(inArray(damageMaster.id, unique));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/* ------------------------------------------------------------------ */
/* edit (Jemish / Gaurang)                                              */
/* ------------------------------------------------------------------ */

type EditRow = ReturnType<typeof takaEditSchema.parse>['takas'][number];

/**
 * Replaces the jobsheet's takas with the given set: rows with an `id` are updated, rows without one are added,
 * missing ones are soft-deleted (not while at butta cutting / in QC). Each taka carries its OPEN damages after the
 * edit: ids keep / change a damage, missing ones are removed, rows without an id are new machine damages. Resolved
 * damages are read-only. The note is replaced. One transaction; ends with the order status recompute.
 */
export async function editTakas(role: RoleKey, id: number, input: unknown): Promise<TakaEditResult> {
  const data = takaEditSchema.parse(input);
  return db.transaction(async (tx) => {
    const js = await loadJobsheetForTakas(tx, role, id);
    const existing = await activeTakas(tx, id);
    const values = data.takas.map((t) => t.takaNo);
    const used = await usedTakaNumbers(tx, values, existing.map((t) => t.id));
    assertValidNumbers(values, validateTakaNumbers(values, [], { used }), used);

    const byId = new Map(existing.map((t) => [t.id, t]));
    const seenIds = new Set<number>();
    for (const t of data.takas) {
      if (t.id === undefined) continue;
      if (!byId.has(t.id) || seenIds.has(t.id)) {
        throw conflict('These takas were just changed by someone else. Close the form, refresh and try again.');
      }
      seenIds.add(t.id);
    }

    // Damage plan per submitted taka (resolving names in the master first).
    interface DamagePlan {
      /** Existing open damages that change. */
      updates: { id: number; damageId: number | null; pcs: number | null; before: string; after: string }[];
      /** Existing open damages that are removed. */
      removes: { id: number; label: string }[];
      /** New machine damages. */
      adds: { damageId: number; pcs: number }[];
    }
    const flat: { rowIndex: number; j: number; pick: { damageId: number } | { otherName: string } }[] = [];
    data.takas.forEach((t, i) =>
      t.damages.forEach((d, j) => {
        if ('otherName' in d) flat.push({ rowIndex: i, j, pick: { otherName: d.otherName } });
        else if (d.damageId !== null) flat.push({ rowIndex: i, j, pick: { damageId: d.damageId } });
      }),
    );
    const flatIds = await resolveDamageNames(tx, flat.map((f) => f.pick), (n) => `takas.${flat[n].rowIndex}.damages.${flat[n].j}`);
    const resolvedId = new Map(flat.map((f, n) => [`${f.rowIndex}.${f.j}`, flatIds[n]]));
    const names = await damageNames(tx, flatIds);
    for (const t of existing) for (const d of t.damages) if (d.damageId !== null && d.damageName) names.set(d.damageId, d.damageName);

    const plans = data.takas.map((t, i): DamagePlan => {
      const old = t.id !== undefined ? byId.get(t.id) : undefined;
      const oldOpen = old ? old.damages.filter((d) => d.status === 'open') : [];
      const oldOpenById = new Map(oldOpen.map((d) => [d.id, d]));
      const plan: DamagePlan = { updates: [], removes: [], adds: [] };
      const keptIds = new Set<number>();
      t.damages.forEach((d, j) => {
        const field = `takas.${i}.damages.${j}`;
        const before = d.id !== undefined ? oldOpenById.get(d.id) : undefined;
        if (d.id !== undefined && !before) {
          throw conflict('These takas were just changed by someone else. Close the form, refresh and try again.');
        }
        const damageId = 'otherName' in d || d.damageId !== null ? resolvedId.get(`${i}.${j}`)! : null;
        // An older damage may keep a missing name / pcs only while it is unchanged.
        if (damageId === null && !(before && before.damageId === null)) {
          throw badRequest(`Taka ${t.takaNo}: pick the damage name`, field);
        }
        if (d.pcs === null && !(before && before.pcs === null)) {
          throw badRequest(`Taka ${t.takaNo}: enter the damaged pcs`, `${field}.pcs`);
        }
        assertDamagePcs(t.takaNo, t.pcs ?? old?.pcs ?? null, d.pcs, `${field}.pcs`);
        if (before) {
          keptIds.add(before.id);
          if (before.damageId !== damageId || before.pcs !== d.pcs) {
            plan.updates.push({
              id: before.id,
              damageId,
              pcs: d.pcs,
              before: damageLabel(before.foundAt, before.damageName, before.pcs),
              after: damageLabel(before.foundAt, damageId !== null ? names.get(damageId) : null, d.pcs),
            });
          }
        } else {
          plan.adds.push({ damageId: damageId!, pcs: d.pcs! });
        }
      });
      for (const d of oldOpen) {
        if (!keptIds.has(d.id)) plan.removes.push({ id: d.id, label: damageLabel(d.foundAt, d.damageName, d.pcs) });
      }
      return plan;
    });
    const damagesChanged = (p: DamagePlan) => p.updates.length + p.removes.length + p.adds.length > 0;

    // The rows as they will be saved.
    const rows: (EditRow & { plan: DamagePlan })[] = data.takas.map((t, i) => ({ ...t, plan: plans[i] }));
    const isChanged = (t: (typeof rows)[number], old: Taka) =>
      old.takaNo !== t.takaNo || old.meters !== t.meters || old.pcs !== t.pcs || damagesChanged(t.plan);
    // Pcs are required on every new or edited taka; only an unchanged older taka without pcs may stay without.
    rows.forEach((t, i) => {
      if (t.pcs !== null) return;
      const old = t.id !== undefined ? byId.get(t.id) : undefined;
      if (!old || old.pcs !== null || isChanged(t, old)) throw badRequest(`Taka ${t.takaNo}: enter the pcs`, `takas.${i}.pcs`);
    });

    const addedRows = rows.filter((t) => t.id === undefined);
    if (addedRows.length && js.status !== JOBSHEET_STATUS.COMPLETED) {
      throw conflict('Takas can only be added once the jobsheet is completed.');
    }
    const removed = existing.filter((t) => !seenIds.has(t.id));
    const stuck = removed.find((t) => t.stage === 'at_butta' || t.stage === 'butta_qc');
    if (stuck) {
      throw conflict(`Taka ${stuck.takaNo} is at butta cutting and can't be removed. Cancel its challan or finish its butta QC first.`);
    }
    const changed = rows.filter((t) => t.id !== undefined && isChanged(t, byId.get(t.id)!));
    const note = data.note;
    const noteChanged = (js.takaNote ?? null) !== note;

    if (!addedRows.length && !removed.length && !changed.length && !noteChanged) {
      return { jobsheetId: id, orderId: js.orderId, added: 0, removed: 0, changed: 0, noteChanged: false, takas: existing };
    }

    const at = now();
    const events: TakaEventInput[] = [];
    const touched = new Set<number>();
    if (removed.length) {
      await tx
        .update(takas)
        .set({ isDeleted: true })
        .where(inArray(takas.id, removed.map((t) => t.id)));
      for (const t of removed) events.push({ takaId: t.id, event: 'edited', note: 'taka removed' });
    }
    // Renumbered rows go through a temporary value first, so swapping two numbers never hits the unique index.
    const renumbered = changed.filter((t) => byId.get(t.id!)!.takaNo !== t.takaNo);
    for (const t of renumbered) {
      await tx.update(takas).set({ takaNo: `~${t.id}` }).where(eq(takas.id, t.id!));
    }
    for (const t of changed) {
      const old = byId.get(t.id!)!;
      await tx
        .update(takas)
        .set({ takaNo: t.takaNo, meters: t.meters, pcs: t.pcs })
        .where(eq(takas.id, t.id!));
      touched.add(t.id!);
      const parts = [
        old.takaNo !== t.takaNo && `number ${old.takaNo} → ${t.takaNo}`,
        takaEditNote({ meters: old.meters, pcs: old.pcs }, { meters: t.meters, pcs: t.pcs }),
        ...t.plan.updates.map((u) => `damage ${u.before} → ${u.after}`),
        ...t.plan.removes.map((r) => `damage removed (${r.label})`),
      ].filter(Boolean);
      if (parts.length) events.push({ takaId: t.id!, event: 'edited', note: parts.join(' · ') });
      for (const a of t.plan.adds) {
        events.push({ takaId: t.id!, event: 'damage_added', note: damageLabel('machine', names.get(a.damageId), a.pcs) });
      }
      for (const u of t.plan.updates) {
        await tx.update(takaDamages).set({ damageId: u.damageId, pcs: u.pcs }).where(eq(takaDamages.id, u.id));
      }
      for (const r of t.plan.removes) {
        await tx.update(takaDamages).set({ isDeleted: true }).where(eq(takaDamages.id, r.id));
      }
      await insertTakaDamages(
        tx,
        role,
        t.plan.adds.map((a) => ({ takaId: t.id!, damageId: a.damageId, pcs: a.pcs, foundAt: 'machine' as const })),
      );
    }
    if (addedRows.length) {
      const stage = await initialStageForOrder(tx, js.orderId);
      const inserted = await tx
        .insert(takas)
        .values(
          addedRows.map((t) => ({
            jobsheetId: id,
            orderId: js.orderId,
            takaNo: t.takaNo,
            meters: t.meters,
            pcs: t.pcs,
            isDamaged: t.plan.adds.length > 0,
            stage,
            enteredBy: role,
            createdAt: at,
            updatedAt: at,
          })),
        )
        .returning({ id: takas.id, takaNo: takas.takaNo });
      const idByNo = new Map(inserted.map((t) => [t.takaNo, t.id]));
      for (const t of addedRows) {
        const takaId = idByNo.get(t.takaNo)!;
        touched.add(takaId);
        events.push({ takaId, event: 'entered', note: `${jobsheetRef(js.orderNo, js.jobsheetNo)} · added in Edit takas` });
        for (const a of t.plan.adds) {
          events.push({ takaId, event: 'damage_added', note: damageLabel('machine', names.get(a.damageId), a.pcs) });
        }
        await insertTakaDamages(
          tx,
          role,
          t.plan.adds.map((a) => ({ takaId, damageId: a.damageId, pcs: a.pcs, foundAt: 'machine' as const })),
        );
      }
    }
    await refreshIsDamaged(tx, [...touched]);
    await writeTakaEvents(tx, role, events);
    if (noteChanged) await tx.update(jobsheets).set({ takaNote: note }).where(eq(jobsheets.id, id));

    const after = await activeTakas(tx, id);
    const parts = [
      addedRows.length && `${addedRows.length} added`,
      removed.length && `${removed.length} removed`,
      changed.length && `${changed.length} changed`,
      noteChanged && 'note edited',
    ].filter(Boolean);
    await writeEvents(tx, role, [{ jobsheetId: id, event: 'takas_edited', note: `${takaSummary(after)} · ${parts.join(', ')}` }]);
    await recomputeOrderStatus(js.orderId, role, tx);
    return {
      jobsheetId: id,
      orderId: js.orderId,
      added: addedRows.length,
      removed: removed.length,
      changed: changed.length,
      noteChanged,
      takas: after,
    };
  });
}

/* ------------------------------------------------------------------ */
/* order takas (Jemish / Gaurang)                                       */
/* ------------------------------------------------------------------ */

export async function listOrderTakas(role: RoleKey, orderId: number): Promise<OrderTakas> {
  const [orderRows, sheetRows, takaRows] = await db.batch([
    db.select({ id: orders.id, orderNo: orders.orderNo, status: orders.status }).from(orders).where(eq(orders.id, orderId)),
    db
      .select({
        id: jobsheets.id,
        jobsheetNo: jobsheets.jobsheetNo,
        status: jobsheets.status,
        frames: jobsheets.frames,
        completedFrames: jobsheets.completedFrames,
        takaNote: jobsheets.takaNote,
        machinesJson,
        ...runningMachineColumns,
      })
      .from(jobsheets)
      .leftJoin(runningMachine, eq(runningMachine.id, jobsheets.runningMachineId))
      .where(and(eq(jobsheets.orderId, orderId), eq(jobsheets.isDeleted, false)))
      .orderBy(asc(jobsheets.jobsheetNo)),
    db
      .select({ ...takaColumns, jobsheetId: takas.jobsheetId })
      .from(takas)
      .innerJoin(jobsheets, eq(jobsheets.id, takas.jobsheetId))
      .where(and(eq(takas.orderId, orderId), eq(takas.isDeleted, false), eq(jobsheets.isDeleted, false))),
  ]);
  const order = orderRows[0];
  if (!order || !canRoleSeeStatus(role, order.status)) throw notFound('Order');

  const byJobsheet = new Map<number, Taka[]>();
  for (const { jobsheetId, ...row } of takaRows) {
    const t = mapTaka(row);
    const list = byJobsheet.get(jobsheetId);
    if (list) list.push(t);
    else byJobsheet.set(jobsheetId, [t]);
  }
  const groups: JobsheetTakaGroup[] = sheetRows.map((r) => ({
    jobsheetId: r.id,
    jobsheetNo: r.jobsheetNo,
    orderNo: order.orderNo,
    status: r.status,
    frames: r.frames,
    completedFrames: r.completedFrames,
    runningMachine: toMachineRef(r),
    machines: parseMachinesJson(r.machinesJson),
    note: r.takaNote,
    takas: sortTakas(byJobsheet.get(r.id) ?? []),
  }));
  const all = groups.flatMap((g) => g.takas);
  return {
    orderId: order.id,
    orderNo: order.orderNo,
    total: all.length,
    damaged: all.filter((t) => t.isDamaged).length,
    totalMeters: totalMeters(all),
    totalPcs: totalPcs(all),
    groups,
  };
}

/* ------------------------------------------------------------------ */
/* taka numbers: live check, lookup, details                            */
/* ------------------------------------------------------------------ */

/** GET /takas/check?no= — is this taka number free (numbers are unique across the whole system)? */
export async function checkTakaNo(no: string): Promise<TakaAvailability> {
  const value = no.trim();
  if (takaNoError(value) !== null) return { available: true }; // format errors are shown by the form itself
  const [row] = await db
    .select({ orderNo: orders.orderNo, jobsheetNo: jobsheets.jobsheetNo })
    .from(takas)
    .innerJoin(jobsheets, eq(jobsheets.id, takas.jobsheetId))
    .innerJoin(orders, eq(orders.id, takas.orderId))
    .where(and(eq(takas.isDeleted, false), eq(takas.takaNo, value)))
    .limit(1);
  return row ? { available: false, usedBy: { orderNo: row.orderNo, jobsheetNo: row.jobsheetNo } } : { available: true };
}

const designCodeSql = sql<string | null>`COALESCE(${designVariations.code}, ${designs.code})`;
const designThumbSql = sql<string | null>`CASE WHEN ${designVariations.id} IS NOT NULL THEN ${designVariations.thumbUrl} ELSE ${designs.thumbUrl} END`;
const designImageSql = sql<string | null>`CASE WHEN ${designVariations.id} IS NOT NULL THEN ${designVariations.imageUrl} ELSE ${designs.imageUrl} END`;

async function loadTakaDetail(role: RoleKey, where: SQL): Promise<TakaDetail> {
  const [row] = await db
    .select({
      id: takas.id,
      takaNo: takas.takaNo,
      meters: takas.meters,
      pcs: takas.pcs,
      isDamaged: takas.isDamaged,
      damagesJson: takaDamagesJson,
      stage: takas.stage,
      createdAt: takas.createdAt,
      orderId: orders.id,
      orderNo: orders.orderNo,
      orderStatus: orders.status,
      jobsheetId: jobsheets.id,
      jobsheetNo: jobsheets.jobsheetNo,
      quality: materials.name,
      designCode: designCodeSql,
      thumbUrl: designThumbSql,
      imageUrl: designImageSql,
      challanId: buttaChallanTakas.challanId,
      challanNo: buttaChallans.challanNo,
      sentAt: buttaChallanTakas.createdAt,
      receivedAt: buttaChallanTakas.receivedAt,
      qcDoneAt: buttaChallanTakas.qcDoneAt,
    })
    .from(takas)
    .innerJoin(jobsheets, eq(jobsheets.id, takas.jobsheetId))
    .innerJoin(orders, eq(orders.id, takas.orderId))
    .innerJoin(materials, eq(materials.id, orders.materialId))
    .leftJoin(designs, eq(designs.id, orders.designId))
    .leftJoin(designVariations, eq(designVariations.id, orders.variationId))
    .leftJoin(buttaChallanTakas, and(eq(buttaChallanTakas.takaId, takas.id), eq(buttaChallanTakas.isActive, true)))
    .leftJoin(buttaChallans, eq(buttaChallans.id, buttaChallanTakas.challanId))
    .where(and(eq(takas.isDeleted, false), where))
    .limit(1);
  if (!row) throw notFound('Taka');
  // Jemish / Gaurang follow the order visibility rule; the godown / QC roles only ever get the restricted fields.
  if (!isRestricted(role) && !canRoleSeeStatus(role, row.orderStatus)) throw notFound('Taka');

  let events: TakaEvent[] = [];
  if (can(role, 'canEditTakas')) {
    events = await db
      .select({
        id: takaEvents.id,
        event: takaEvents.event,
        challanId: takaEvents.challanId,
        challanNo: buttaChallans.challanNo,
        note: takaEvents.note,
        role: takaEvents.role,
        createdAt: takaEvents.createdAt,
      })
      .from(takaEvents)
      .leftJoin(buttaChallans, eq(buttaChallans.id, takaEvents.challanId))
      .where(eq(takaEvents.takaId, row.id))
      .orderBy(asc(takaEvents.createdAt), asc(takaEvents.id));
  }
  const damages = parseDamagesJson(row.damagesJson);
  return {
    id: row.id,
    takaNo: row.takaNo,
    meters: row.meters,
    pcs: row.pcs,
    isDamaged: row.isDamaged,
    damages,
    stage: row.stage,
    orderId: row.orderId,
    orderNo: row.orderNo,
    jobsheetId: row.jobsheetId,
    jobsheetNo: row.jobsheetNo,
    quality: row.quality,
    design: { code: row.designCode, thumbUrl: row.thumbUrl, imageUrl: row.imageUrl },
    challan:
      row.challanId !== null && row.challanNo !== null
        ? { id: row.challanId, challanNo: row.challanNo, sentAt: row.sentAt!, receivedAt: row.receivedAt, qcDone: row.qcDoneAt !== null }
        : null,
    events,
    createdAt: row.createdAt,
  };
}

export const getTakaDetail = (role: RoleKey, id: number) => loadTakaDetail(role, eq(takas.id, id));

/** The one active taka with this number (Receive and Butta QC). */
export const takaByNo = (role: RoleKey, takaNo: string) => loadTakaDetail(role, eq(takas.takaNo, takaNo.trim()));

/* ------------------------------------------------------------------ */
/* Taka entry Jobsheets list                                            */
/* ------------------------------------------------------------------ */

const damagedCount = sql<number>`(SELECT COUNT(*) FROM takas t WHERE t.jobsheet_id = "jobsheets"."id" AND t.is_deleted = 0 AND t.is_damaged = 1)`;
const lastTakaAt = sql<string | null>`(SELECT MAX(t.created_at) FROM takas t WHERE t.jobsheet_id = "jobsheets"."id" AND t.is_deleted = 0)`;

/**
 * Every jobsheet in every status. Taka pending = no active takas yet: Completed first (most recently completed
 * first), then Ongoing, Sent, Pending (by number). Done = at least one taka, most recent taka entry first.
 */
export async function listTakaJobsheets(q: TakaListQuery): Promise<TakaJobsheetPage> {
  const base: (SQL | undefined)[] = [eq(jobsheets.isDeleted, false)];
  if (q.search) base.push(jobsheetSearch(q.search));
  const tabWhere = q.tab === 'pending' ? sql`${activeTakaCount} = 0` : sql`${activeTakaCount} > 0`;
  const order =
    q.tab === 'pending'
      ? [
          sql`CASE ${jobsheets.status} WHEN 'completed' THEN 0 WHEN 'ongoing' THEN 1 WHEN 'sent' THEN 2 ELSE 3 END`,
          sql`CASE WHEN ${jobsheets.status} = 'completed' THEN ${jobsheets.completedAt} END DESC`,
          asc(jobsheets.jobsheetNo),
        ]
      : [desc(lastTakaAt), desc(jobsheets.jobsheetNo)];

  const [items, [counts]] = await db.batch([
    db
      .select({
        id: jobsheets.id,
        jobsheetNo: jobsheets.jobsheetNo,
        status: jobsheets.status,
        frames: jobsheets.frames,
        completedFrames: jobsheets.completedFrames,
        orderNo: orders.orderNo,
        designCode: designCodeSql,
        thumbUrl: designThumbSql,
        imageUrl: designImageSql,
        machinesJson,
        ...runningMachineColumns,
        completedAt: jobsheets.completedAt,
        takaCount: activeTakaCount,
        damagedCount,
        lastTakaAt,
      })
      .from(jobsheets)
      .innerJoin(orders, eq(orders.id, jobsheets.orderId))
      .leftJoin(designs, eq(designs.id, orders.designId))
      .leftJoin(designVariations, eq(designVariations.id, orders.variationId))
      .leftJoin(runningMachine, eq(runningMachine.id, jobsheets.runningMachineId))
      .where(and(...base, tabWhere))
      .orderBy(...order)
      .limit(q.limit)
      .offset((q.page - 1) * q.limit),
    db
      .select({
        pending: sql<number>`COALESCE(SUM(CASE WHEN ${activeTakaCount} = 0 THEN 1 ELSE 0 END), 0)`,
        done: sql<number>`COALESCE(SUM(CASE WHEN ${activeTakaCount} > 0 THEN 1 ELSE 0 END), 0)`,
      })
      .from(jobsheets)
      .innerJoin(orders, eq(orders.id, jobsheets.orderId))
      .leftJoin(designs, eq(designs.id, orders.designId))
      .leftJoin(designVariations, eq(designVariations.id, orders.variationId))
      .where(and(...base)),
  ]);

  const tabCounts = { pending: Number(counts?.pending ?? 0), done: Number(counts?.done ?? 0) };
  const total = tabCounts[q.tab];
  return {
    items: items.map(
      (r): TakaJobsheetItem => ({
        id: r.id,
        jobsheetNo: r.jobsheetNo,
        status: r.status,
        frames: r.frames,
        completedFrames: r.completedFrames,
        orderNo: r.orderNo,
        designCode: r.designCode,
        thumbUrl: r.thumbUrl,
        imageUrl: r.imageUrl,
        machines: parseMachinesJson(r.machinesJson),
        runningMachine: toMachineRef(r),
        completedAt: r.completedAt,
        takaCount: Number(r.takaCount),
        damagedCount: Number(r.damagedCount),
        lastTakaAt: r.lastTakaAt,
      }),
    ),
    page: q.page,
    limit: q.limit,
    total,
    hasMore: q.page * q.limit < total,
    counts: tabCounts,
  };
}
