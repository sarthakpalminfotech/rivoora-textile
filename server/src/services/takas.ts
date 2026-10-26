import { and, asc, desc, eq, inArray, notInArray, sql, type SQL } from 'drizzle-orm';
import {
  can,
  FG_TAKA_PREFIX,
  outsideTakaNumber,
  WEAVER_TAKA_NO_REGEX,
  type ReceiptTakaGroup,
  dispatchChallanLabel,
  canRoleSeeJobsheetStatus,
  canRoleSeeStatus,
  damageLabel,
  DAMAGE_RECORDED_AT_LABEL,
  type DamageType,
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
  type DamageImage,
  type JobsheetTakaGroup,
  type OrderTakas,
  type RoleKey,
  type Taka,
  type TakaAvailability,
  type TakaChallanRef,
  type TakaDamageFull,
  type TakaDamagesDetail,
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
  challanTakas,
  challans,
  damages as damageMaster,
  designs,
  jobsheets,
  materials,
  orders,
  outsidePos,
  outsideReceipts,
  takaDamageImages,
  takaDamages,
  takaEvents,
  takas,
  weavers,
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
import { mapTaka, parseDamagesJson, sortTakas, takaColumns, takaDamagesJson, takaOriginOrderNo, takaParentNo } from './taka-shared';
import {
  initialStageForOrder,
  insertTakaDamages,
  refreshIsDamaged,
  resolveDamageNames,
  usedMessage,
  usedTakaNumbers,
  allocateTakaNumbers,
  writeTakaEvents,
  type TakaEventInput,
} from './taka-ops';
import { takaInOrder, takaOrderId } from './free-stock';
import { orderNotHeldFor } from './hold';
import { realJobsheet } from './external';
import { resolveTakaNumber } from './taka-lookup';
import { refreshReceiptTotals } from './outside';

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
      isExternal: jobsheets.isExternal,
      orderNo: orders.orderNo,
      orderStatus: orders.status,
    })
    .from(jobsheets)
    .innerJoin(orders, eq(orders.id, jobsheets.orderId))
    .where(eq(jobsheets.id, id));
  if (!js || js.isDeleted || !canRoleSeeJobsheetStatus(role, js.status)) throw notFound('Jobsheet');
  // Sprint 16: the hidden external jobsheet (outside / FG takas) is only ever edited per receipt by Jenish / Gaurang.
  if (js.isExternal && !can(role, 'canEditTakas')) throw notFound('Jobsheet');
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
    if (js.isExternal) throw notFound('Jobsheet');
    const existing = await activeTakas(tx, id);
    if (existing.length + data.takas.length > MAX_TAKAS_PER_JOBSHEET) {
      throw badRequest(`A jobsheet can have at most ${MAX_TAKAS_PER_JOBSHEET} takas.`);
    }
    // Numbers are system generated (counter, starting at 11) in the order the rows were sent.
    const numbers = await allocateTakaNumbers(tx, data.takas.length);
    const rows = data.takas.map((t, i) => ({ ...t, takaNo: numbers[i] }));
    rows.forEach((t, i) =>
      t.damages.forEach((d, j) => assertDamagePcs(t.takaNo, t.pcs, d.pcs, `takas.${i}.damages.${j}.pcs`)),
    );

    const at = now();
    const stage = await initialStageForOrder(tx, js.orderId);
    const inserted = await tx
      .insert(takas)
      .values(
        rows.map((t) => ({
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

    // Damages: the type (Machine / Butta / Mill) is chosen by the person entering; the master name says WHAT it is.
    const flat = rows.flatMap((t, i) => t.damages.map((d, j) => ({ takaIndex: i, damageIndex: j, takaNo: t.takaNo, pick: d })));
    const damageIds = await resolveDamageNames(
      tx,
      flat.map((f) => ('damageId' in f.pick ? { damageId: f.pick.damageId } : { otherName: f.pick.otherName })),
      (n) => `takas.${flat[n].takaIndex}.damages.${flat[n].damageIndex}`,
    );
    await insertTakaDamages(
      tx,
      role,
      flat.map((f, n) => ({ takaId: idByNo.get(f.takaNo)!, damageId: damageIds[n], pcs: f.pick.pcs, foundAt: f.pick.type, recordedAt: 'taka_entry' as const })),
    );
    const names = await damageNames(tx, damageIds);
    const events: TakaEventInput[] = inserted.map((t) => ({ takaId: t.id, event: 'entered', note: jobsheetRef(js.orderNo, js.jobsheetNo) }));
    flat.forEach((f, n) =>
      events.push({
        takaId: idByNo.get(f.takaNo)!,
        event: 'damage_added',
        note: `${damageLabel(f.pick.type, names.get(damageIds[n]), f.pick.pcs)} · recorded at ${DAMAGE_RECORDED_AT_LABEL.taka_entry}`,
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
/* edit (Jenish / Gaurang)                                              */
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
    // Sprint 16: outside / FG takas sit on the order's hidden external jobsheet and are edited ONE RECEIPT at a time
    // (a replace-set over the whole external jobsheet would remove the other receipts' takas).
    if (js.isExternal !== (data.receiptId !== undefined)) {
      throw badRequest(js.isExternal ? 'Open Edit takas from the receipt.' : 'This jobsheet has no receipts.');
    }
    let receipt: { id: number; weaverId: number | null; prefix: string } | null = null;
    if (data.receiptId !== undefined) {
      const [r] = await tx
        .select({ id: outsideReceipts.id, weaverId: outsideReceipts.weaverId, kind: outsideReceipts.kind, code: weavers.shortCode })
        .from(outsideReceipts)
        .leftJoin(weavers, eq(weavers.id, outsideReceipts.weaverId))
        .where(and(eq(outsideReceipts.id, data.receiptId), eq(outsideReceipts.orderId, js.orderId)));
      if (!r) throw notFound('Receipt');
      receipt = { id: r.id, weaverId: r.weaverId, prefix: r.kind === 'fg' ? FG_TAKA_PREFIX : (r.code ?? '') };
    }
    // Sprint 13: takas that became free stock (or went to another order) are no longer part of this jobsheet's set —
    // Edit takas must neither show nor remove them (their numbers stay used).
    const existing = (await activeTakas(tx, id)).filter(
      (t) => !t.isFreeStock && t.allocatedOrderNo === null && (!receipt || t.outsideReceiptId === receipt.id),
    );
    const values = data.takas.map((t) => t.takaNo);
    const used = await usedTakaNumbers(tx, values, existing.map((t) => t.id));
    assertValidNumbers(values, validateTakaNumbers(values, [], { used }), used);
    if (receipt) {
      // The weaver's own numbers: required where the taka had one, numeric, unique in the form and for the weaver.
      const seen = new Set<string>();
      const oldById = new Map(existing.map((t) => [t.id, t]));
      data.takas.forEach((t, i) => {
        const old = t.id !== undefined ? oldById.get(t.id) : undefined;
        const w = t.weaverTakaNo?.trim() ?? '';
        if (!w) {
          if (old?.weaverTakaNo) throw badRequest(`Taka ${t.takaNo}: enter the weaver taka number`, `takas.${i}.weaverTakaNo`);
          return;
        }
        if (!WEAVER_TAKA_NO_REGEX.test(w)) throw badRequest(`Taka ${t.takaNo}: weaver number — use digits, - or / only`, `takas.${i}.weaverTakaNo`);
        if (seen.has(w)) throw badRequest(`Weaver taka ${w} is typed twice`, `takas.${i}.weaverTakaNo`);
        seen.add(w);
      });
      if (receipt.weaverId !== null && seen.size) {
        const clash = await tx
          .select({ no: takas.weaverTakaNo })
          .from(takas)
          .where(
            and(
              eq(takas.weaverId, receipt.weaverId),
              eq(takas.isDeleted, false),
              inArray(takas.weaverTakaNo, [...seen]),
              existing.length ? notInArray(takas.id, existing.map((t) => t.id)) : undefined,
            ),
          )
          .limit(1);
        if (clash.length) {
          const i = data.takas.findIndex((t) => t.weaverTakaNo?.trim() === clash[0].no);
          throw badRequest(`This weaver already sent taka ${clash[0].no}`, `takas.${Math.max(0, i)}.weaverTakaNo`);
        }
      }
    }

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
      updates: { id: number; damageId: number | null; pcs: number | null; foundAt: DamageType; before: string; after: string }[];
      /** Existing open damages that are removed. */
      removes: { id: number; label: string }[];
      /** New machine damages. */
      adds: { damageId: number; pcs: number; type: DamageType }[];
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
        if (before && d.pcs !== null && d.pcs < (before.resolvedPcs ?? 0)) {
          throw badRequest(`Taka ${t.takaNo}: ${before.resolvedPcs} pcs of this damage are already resolved — the damaged pcs can't be less.`, `${field}.pcs`);
        }
        if (before) {
          keptIds.add(before.id);
          // An existing damage keeps its type unless the person picked another one.
          const type = d.type ?? before.foundAt;
          if (before.damageId !== damageId || before.pcs !== d.pcs || before.foundAt !== type) {
            plan.updates.push({
              id: before.id,
              damageId,
              pcs: d.pcs,
              foundAt: type,
              before: damageLabel(before.foundAt, before.damageName, before.pcs),
              after: damageLabel(type, damageId !== null ? names.get(damageId) : null, d.pcs),
            });
          }
        } else {
          if (!d.type) throw badRequest(`Taka ${t.takaNo}: choose the damage type`, `${field}.type`);
          plan.adds.push({ damageId: damageId!, pcs: d.pcs!, type: d.type });
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
    // Sprint 16: a receipt edit can change the weaver's number too (production takas never carry one).
    const weaverNoOf = (t: (typeof rows)[number], old: Taka) => (receipt ? t.weaverTakaNo?.trim() || null : old.weaverTakaNo);
    const isChanged = (t: (typeof rows)[number], old: Taka) =>
      old.takaNo !== t.takaNo || old.meters !== t.meters || old.pcs !== t.pcs || weaverNoOf(t, old) !== old.weaverTakaNo || damagesChanged(t.plan);
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
    if (addedRows.length && receipt) throw conflict('Takas of a receipt come in by receiving goods — they can be changed or removed here, not added.');
    const removed = existing.filter((t) => !seenIds.has(t.id));
    // A taka that is out on a challan (or already past the butta QC step it is in) can't just be removed.
    const stuck = removed.find((t) => ['at_butta', 'rework_butta', 'butta_qc', 'at_mill', 'mill_qc', 'final', 'refinish', 'ready_dispatch', 'dispatched'].includes(t.stage));
    if (stuck) {
      throw conflict(
        ['final', 'refinish', 'ready_dispatch', 'dispatched'].includes(stuck.stage)
          ? `Taka ${stuck.takaNo} has passed the mill and can't be removed.`
          : stuck.stage === 'at_mill' || stuck.stage === 'mill_qc'
            ? `Taka ${stuck.takaNo} is at the mill and can't be removed.`
            : `Taka ${stuck.takaNo} is at butta cutting and can't be removed. Cancel its challan or finish its butta QC first.`,
      );
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
    // Sprint 16: the same for the weaver's numbers (unique per weaver).
    const reWeaver = changed.filter((t) => weaverNoOf(t, byId.get(t.id!)!) !== byId.get(t.id!)!.weaverTakaNo);
    for (const t of reWeaver) {
      await tx.update(takas).set({ weaverTakaNo: `~${t.id}` }).where(eq(takas.id, t.id!));
    }
    for (const t of changed) {
      const old = byId.get(t.id!)!;
      const weaverNo = weaverNoOf(t, old);
      await tx
        .update(takas)
        .set({
          takaNo: t.takaNo,
          meters: t.meters,
          pcs: t.pcs,
          // Our number = anything other than the weaver code + the weaver number (a received lot always has ours).
          ...(receipt ? { weaverTakaNo: weaverNo, hasOwnNumber: !weaverNo || t.takaNo !== outsideTakaNumber(receipt.prefix, weaverNo) } : {}),
        })
        .where(eq(takas.id, t.id!));
      touched.add(t.id!);
      const parts = [
        old.takaNo !== t.takaNo && `number ${old.takaNo} → ${t.takaNo}`,
        weaverNo !== old.weaverTakaNo && `weaver number ${old.weaverTakaNo ?? '–'} → ${weaverNo ?? '–'}`,
        takaEditNote({ meters: old.meters, pcs: old.pcs }, { meters: t.meters, pcs: t.pcs }),
        ...t.plan.updates.map((u) => `damage ${u.before} → ${u.after}`),
        ...t.plan.removes.map((r) => `damage removed (${r.label})`),
      ].filter(Boolean);
      if (parts.length) events.push({ takaId: t.id!, event: 'edited', note: parts.join(' · ') });
      for (const a of t.plan.adds) {
        events.push({ takaId: t.id!, event: 'damage_added', note: `${damageLabel(a.type, names.get(a.damageId), a.pcs)} · recorded at ${DAMAGE_RECORDED_AT_LABEL.edit_takas}` });
      }
      for (const u of t.plan.updates) {
        await tx.update(takaDamages).set({ damageId: u.damageId, pcs: u.pcs, foundAt: u.foundAt }).where(eq(takaDamages.id, u.id));
      }
      for (const r of t.plan.removes) {
        await tx.update(takaDamages).set({ isDeleted: true }).where(eq(takaDamages.id, r.id));
      }
      await insertTakaDamages(
        tx,
        role,
        t.plan.adds.map((a) => ({ takaId: t.id!, damageId: a.damageId, pcs: a.pcs, foundAt: a.type, recordedAt: 'edit_takas' as const })),
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
          events.push({ takaId, event: 'damage_added', note: `${damageLabel(a.type, names.get(a.damageId), a.pcs)} · recorded at ${DAMAGE_RECORDED_AT_LABEL.edit_takas}` });
        }
        await insertTakaDamages(
          tx,
          role,
          t.plan.adds.map((a) => ({ takaId, damageId: a.damageId, pcs: a.pcs, foundAt: a.type, recordedAt: 'edit_takas' as const })),
        );
      }
    }
    await refreshIsDamaged(tx, [...touched]);
    await writeTakaEvents(tx, role, events);
    if (noteChanged) await tx.update(jobsheets).set({ takaNote: note }).where(eq(jobsheets.id, id));
    // Sprint 16: a receipt's totals (and its PO's received quantity) follow its takas.
    if (receipt) await refreshReceiptTotals(tx, receipt.id);

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
/* order takas (Jenish / Gaurang)                                       */
/* ------------------------------------------------------------------ */

export async function listOrderTakas(role: RoleKey, orderId: number): Promise<OrderTakas> {
  const [orderRows, sheetRows, takaRows, externalRows] = await db.batch([
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
      .where(and(eq(jobsheets.orderId, orderId), eq(jobsheets.isDeleted, false), realJobsheet))
      .orderBy(asc(jobsheets.jobsheetNo)),
    db
      .select({ ...takaColumns, jobsheetId: takas.jobsheetId, isExternal: jobsheets.isExternal })
      .from(takas)
      .innerJoin(jobsheets, eq(jobsheets.id, takas.jobsheetId))
      .where(and(takaInOrder(orderId), eq(takas.isDeleted, false), eq(jobsheets.isDeleted, false))),
    // Sprint 16: the order's hidden external jobsheet (outside / FG receipts) carries ONE shared note, if any —
    // Edit takas of a receipt must read it back unchanged (it must never blank another receipt's note).
    db
      .select({ takaNote: jobsheets.takaNote })
      .from(jobsheets)
      .where(and(eq(jobsheets.orderId, orderId), eq(jobsheets.isExternal, true))),
  ]);
  const externalNote = externalRows[0]?.takaNote ?? null;
  const order = orderRows[0];
  if (!order || !canRoleSeeStatus(role, order.status)) throw notFound('Order');

  const byJobsheet = new Map<number, Taka[]>();
  // Sprint 16: outside / FG takas (on an external jobsheet) are grouped by the receipt they came on.
  const byReceipt = new Map<number, { jobsheetId: number; takas: Taka[] }>();
  for (const { jobsheetId, isExternal, ...row } of takaRows) {
    const t = mapTaka(row);
    if (isExternal) {
      const key = t.outsideReceiptId ?? 0;
      const g = byReceipt.get(key) ?? { jobsheetId, takas: [] };
      g.takas.push(t);
      byReceipt.set(key, g);
      continue;
    }
    const list = byJobsheet.get(jobsheetId);
    if (list) list.push(t);
    else byJobsheet.set(jobsheetId, [t]);
  }
  const receiptIds = [...byReceipt.keys()].filter((k) => k > 0);
  const receiptRows = receiptIds.length
    ? await db
        .select({
          id: outsideReceipts.id,
          kind: outsideReceipts.kind,
          challanNo: outsideReceipts.challanNo,
          receiptDate: outsideReceipts.receiptDate,
          poId: outsideReceipts.poId,
          poNo: outsidePos.poNo,
          weaverName: weavers.name,
          weaverCode: weavers.shortCode,
          supplierName: outsideReceipts.supplierName,
        })
        .from(outsideReceipts)
        .leftJoin(outsidePos, eq(outsidePos.id, outsideReceipts.poId))
        .leftJoin(weavers, eq(weavers.id, outsideReceipts.weaverId))
        .where(inArray(outsideReceipts.id, receiptIds))
        .orderBy(desc(outsideReceipts.id))
    : [];
  const receipts: ReceiptTakaGroup[] = receiptRows.map((r) => ({
    receiptId: r.id,
    kind: r.kind,
    challanNo: r.challanNo,
    receiptDate: r.receiptDate,
    poId: r.poId,
    poNo: r.poNo,
    partyName: r.weaverName ?? r.supplierName,
    jobsheetId: byReceipt.get(r.id)!.jobsheetId,
    takas: sortTakas(byReceipt.get(r.id)!.takas),
    note: externalNote,
    prefix: r.kind === 'fg' ? FG_TAKA_PREFIX : r.weaverCode ?? '',
  }));
  // Takas on an external jobsheet without a receipt (e.g. split parts of an older one): one group of their own.
  const loose = byReceipt.get(0);
  if (loose) {
    receipts.push({
      receiptId: 0,
      kind: 'outside_po',
      challanNo: '—',
      receiptDate: '',
      poId: null,
      poNo: null,
      partyName: null,
      jobsheetId: loose.jobsheetId,
      takas: sortTakas(loose.takas),
      note: externalNote,
      prefix: '',
    });
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
  // Takas moved here from another order keep their old jobsheet: they get a group of their own ("from Order #A").
  const known = new Set(sheetRows.map((r) => r.id));
  const foreign = [...byJobsheet.keys()].filter((id) => !known.has(id));
  if (foreign.length) {
    const rows = await db
      .select({
        id: jobsheets.id,
        jobsheetNo: jobsheets.jobsheetNo,
        status: jobsheets.status,
        frames: jobsheets.frames,
        completedFrames: jobsheets.completedFrames,
        takaNote: jobsheets.takaNote,
        orderNo: orders.orderNo,
        machinesJson,
        ...runningMachineColumns,
      })
      .from(jobsheets)
      .innerJoin(orders, eq(orders.id, jobsheets.orderId))
      .leftJoin(runningMachine, eq(runningMachine.id, jobsheets.runningMachineId))
      .where(inArray(jobsheets.id, foreign))
      .orderBy(asc(jobsheets.jobsheetNo));
    for (const r of rows) {
      groups.push({
        jobsheetId: r.id,
        jobsheetNo: r.jobsheetNo,
        orderNo: r.orderNo,
        status: r.status,
        frames: r.frames,
        completedFrames: r.completedFrames,
        runningMachine: toMachineRef(r),
        machines: parseMachinesJson(r.machinesJson),
        note: r.takaNote,
        takas: sortTakas(byJobsheet.get(r.id) ?? []),
      });
    }
  }
  const all = [...groups.flatMap((g) => g.takas), ...receipts.flatMap((r) => r.takas)];
  return {
    orderId: order.id,
    orderNo: order.orderNo,
    total: all.length,
    damaged: all.filter((t) => t.isDamaged).length,
    totalMeters: totalMeters(all),
    totalPcs: totalPcs(all),
    groups,
    receipts,
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
    .innerJoin(orders, eq(orders.id, takaOrderId))
    .where(and(eq(takas.isDeleted, false), eq(takas.takaNo, value)))
    .limit(1);
  return row ? { available: false, usedBy: { orderNo: row.orderNo, jobsheetNo: row.jobsheetNo } } : { available: true };
}

const designCodeSql = sql<string | null>`${designs.code}`;
const designThumbSql = sql<string | null>`${designs.thumbUrl}`;
const designImageSql = sql<string | null>`${designs.imageUrl}`;

/** Photos of damages, grouped by damage id (oldest first). */
export async function damageImagesOf(damageIds: readonly number[]): Promise<Map<number, DamageImage[]>> {
  const out = new Map<number, DamageImage[]>();
  if (!damageIds.length) return out;
  const rows = await db
    .select({ id: takaDamageImages.id, takaDamageId: takaDamageImages.takaDamageId, url: takaDamageImages.imageUrl, thumbUrl: takaDamageImages.thumbUrl, createdAt: takaDamageImages.createdAt })
    .from(takaDamageImages)
    .where(inArray(takaDamageImages.takaDamageId, [...damageIds]))
    .orderBy(asc(takaDamageImages.id));
  for (const { takaDamageId, ...img } of rows) out.set(takaDamageId, [...(out.get(takaDamageId) ?? []), img]);
  return out;
}

async function loadTakaDetail(role: RoleKey, where: SQL): Promise<TakaDetail> {
  const [row] = await db
    .select({
      id: takas.id,
      takaNo: takas.takaNo,
      meters: takas.meters,
      pcs: takas.pcs,
      actualPcs: takas.actualPcs,
      refinishCount: takas.refinishCount,
      parentTakaNo: takaParentNo,
      godownCheckedAt: takas.godownCheckedAt,
      reworkCount: takas.reworkCount,
      isReturnLot: takas.isReturnLot,
      returnedAt: takas.returnedAt,
      originOrderNo: takaOriginOrderNo,
      isDamaged: takas.isDamaged,
      damagesJson: takaDamagesJson,
      stage: takas.stage,
      createdAt: takas.createdAt,
      orderId: orders.id,
      orderNo: orders.orderNo,
      orderStatus: orders.status,
      blouseOption: orders.blouseOption,
      isFreeStock: takas.isFreeStock,
      source: takas.source,
      weaverTakaNo: takas.weaverTakaNo,
      hasOwnNumber: takas.hasOwnNumber,
      hasBeenToMill: takas.hasBeenToMill,
      beenToButta: sql<number>`EXISTS (SELECT 1 FROM challan_takas bt WHERE bt.taka_id = "takas"."id" AND bt.kind = 'butta')`,
      orderHasProduction: orders.hasProduction,
      orderHasButta: orders.hasButta,
      orderHasMill: orders.hasMill,
      jobsheetId: jobsheets.id,
      jobsheetNo: jobsheets.jobsheetNo,
      quality: materials.name,
      designCode: designCodeSql,
      thumbUrl: designThumbSql,
      imageUrl: designImageSql,
    })
    .from(takas)
    .innerJoin(jobsheets, eq(jobsheets.id, takas.jobsheetId))
    .innerJoin(orders, eq(orders.id, takaOrderId))
    .innerJoin(materials, eq(materials.id, orders.materialId))
    .leftJoin(designs, eq(designs.id, orders.designId))
    .where(and(eq(takas.isDeleted, false), where))
    .limit(1);
  if (!row) throw notFound('Taka');
  // Jenish / Gaurang follow the order visibility rule; the godown / QC roles only ever get the restricted fields.
  if (!isRestricted(role) && !canRoleSeeStatus(role, row.orderStatus)) throw notFound('Taka');

  // The challans of the taka: the active row of each kind (butta cutting, then the mill), also after it came back.
  const challanRows = await db
    .select({
      id: challans.id,
      kind: challans.kind,
      challanNo: challans.challanNo,
      sentAt: challanTakas.createdAt,
      receivedAt: challanTakas.receivedAt,
      qcDoneAt: challanTakas.qcDoneAt,
    })
    .from(challanTakas)
    .innerJoin(challans, eq(challans.id, challanTakas.challanId))
    .where(and(eq(challanTakas.takaId, row.id), eq(challanTakas.isActive, true)))
    .orderBy(asc(challanTakas.id));
  const challanRefs: TakaChallanRef[] = challanRows.map((c) => ({
    id: c.id,
    kind: c.kind,
    challanNo: c.challanNo,
    sentAt: c.sentAt,
    receivedAt: c.receivedAt,
    qcDone: c.qcDoneAt !== null,
  }));

  const canSeeHistory = can(role, 'canEditTakas') || can(role, 'canUseGodownOrders');
  let events: TakaEvent[] = [];
  if (canSeeHistory) {
    events = await db
      .select({
        id: takaEvents.id,
        event: takaEvents.event,
        challanId: takaEvents.challanId,
        challanNo: challans.challanNo,
        challanKind: challans.kind,
        takaDamageId: takaEvents.takaDamageId,
        note: takaEvents.note,
        role: takaEvents.role,
        userName: sql<string | null>`(SELECT u.name FROM users u WHERE u.id = "taka_events"."user_id")`,
        dispatchChallanId: takaEvents.dispatchChallanId,
        dcNo: sql<number | null>`(SELECT d.challan_no FROM dispatch_challans d WHERE d.id = "taka_events"."dispatch_challan_id")`,
        dcRevision: sql<number | null>`(SELECT d.revision FROM dispatch_challans d WHERE d.id = "taka_events"."dispatch_challan_id")`,
        createdAt: takaEvents.createdAt,
      })
      .from(takaEvents)
      .leftJoin(challans, eq(challans.id, takaEvents.challanId))
      .where(eq(takaEvents.takaId, row.id))
      .orderBy(asc(takaEvents.createdAt), asc(takaEvents.id))
      .then((list) =>
        list.map(({ dcNo, dcRevision, ...e }): TakaEvent => ({
          ...e,
          dispatchChallanLabel: dcNo !== null ? dispatchChallanLabel(dcNo, dcRevision ?? 0) : null,
        })),
      );
  }
  const damages = parseDamagesJson(row.damagesJson);
  // Photos of the damages: only for the roles that can open the taka details drawer.
  if (canSeeHistory) {
    const images = await damageImagesOf(damages.map((d) => d.id));
    for (const d of damages) d.images = images.get(d.id) ?? [];
  }
  return {
    id: row.id,
    takaNo: row.takaNo,
    meters: row.meters,
    pcs: row.pcs,
    actualPcs: row.actualPcs,
    refinishCount: row.refinishCount,
    parentTakaNo: row.parentTakaNo,
    godownCheckedAt: row.godownCheckedAt,
    reworkCount: row.reworkCount,
    isReturnLot: row.isReturnLot,
    returnedAt: row.returnedAt,
    originOrderNo: row.originOrderNo,
    isDamaged: row.isDamaged,
    damages,
    stage: row.stage,
    orderId: row.orderId,
    orderNo: row.orderNo,
    jobsheetId: row.jobsheetId,
    jobsheetNo: row.jobsheetNo,
    quality: row.quality,
    blouseOption: row.blouseOption,
    isFreeStock: row.isFreeStock,
    source: row.source,
    weaverTakaNo: row.weaverTakaNo,
    hasOwnNumber: row.hasOwnNumber,
    orderSteps: { hasProduction: row.orderHasProduction, hasButta: row.orderHasButta, hasMill: row.orderHasMill },
    beenToButta: Boolean(row.beenToButta),
    hasBeenToMill: row.hasBeenToMill,
    design: { code: row.designCode, thumbUrl: row.thumbUrl, imageUrl: row.imageUrl },
    challans: challanRefs,
    events,
    createdAt: row.createdAt,
  };
}

/**
 * GET /takas/:id/damages — the damage details screen: the taka header, then one block per damage (open first, then
 * resolved) with its pcs (damaged / resolved / open), who added it, its photos and its own timeline. The timeline is
 * the taka's events about THIS damage; an older damage without an "added" event gets one made from the damage row.
 */
export async function getTakaDamagesDetail(role: RoleKey, id: number): Promise<TakaDamagesDetail> {
  const detail = await loadTakaDetail(role, eq(takas.id, id));
  const rows = await db
    .select({ id: takaDamages.id, createdBy: takaDamages.createdBy })
    .from(takaDamages)
    .where(and(eq(takaDamages.takaId, id), eq(takaDamages.isDeleted, false)));
  const createdBy = new Map(rows.map((r) => [r.id, r.createdBy]));
  const images = await damageImagesOf(detail.damages.map((d) => d.id));
  const full = detail.damages.map((d): TakaDamageFull => {
    const own = detail.events.filter((e) => e.takaDamageId === d.id);
    const events = [...own];
    if (!own.some((e) => e.event === 'damage_added')) {
      events.unshift({
        id: -d.id,
        event: 'damage_added',
        challanId: null,
        challanNo: null,
        challanKind: null,
        takaDamageId: d.id,
        note: damageLabel(d.foundAt, d.damageName, d.pcs),
        role: createdBy.get(d.id) ?? 'jemish',
        createdAt: d.createdAt,
      });
    }
    if (d.status === 'resolved' && !own.some((e) => e.event === 'damage_resolved') && d.resolvedAt) {
      events.push({
        id: -d.id - 1_000_000,
        event: 'damage_resolved',
        challanId: null,
        challanNo: null,
        challanKind: null,
        takaDamageId: d.id,
        note: d.pcs != null ? `resolved ${d.pcs} of ${d.pcs} pcs` : null,
        role: d.resolvedBy ?? 'jemish',
        createdAt: d.resolvedAt,
      });
    }
    events.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id);
    return { ...d, createdBy: createdBy.get(d.id) ?? 'jemish', images: images.get(d.id) ?? [], events };
  });
  full.sort((a, b) => Number(a.status === 'resolved') - Number(b.status === 'resolved') || a.id - b.id);
  return {
    taka: {
      id: detail.id,
      takaNo: detail.takaNo,
      meters: detail.meters,
      pcs: detail.pcs,
      stage: detail.stage,
      isDamaged: detail.isDamaged,
      orderId: detail.orderId,
      orderNo: detail.orderNo,
      jobsheetId: detail.jobsheetId,
      jobsheetNo: detail.jobsheetNo,
      quality: detail.quality,
      design: detail.design,
      challans: detail.challans,
    },
    damages: full,
  };
}

export const getTakaDetail = (role: RoleKey, id: number) => loadTakaDetail(role, eq(takas.id, id));

/**
 * The one active taka with this number (Receive and Butta QC). Sprint 16: our number OR an outside weaver's own number;
 * when several takas carry it the client shows the "Which one?" picker (`GET /takas/lookup`) — here that is a 409.
 */
export async function takaByNo(role: RoleKey, takaNo: string): Promise<TakaDetail> {
  const found = await resolveTakaNumber(db, takaNo);
  if (found.kind === 'many') {
    throw conflict(`${found.candidates.length} takas have number ${takaNo.trim()} — pick the right one.`, 'ambiguous');
  }
  return loadTakaDetail(role, found.kind === 'one' ? eq(takas.id, found.id) : eq(takas.takaNo, takaNo.trim()));
}

/* ------------------------------------------------------------------ */
/* Taka entry Jobsheets list                                            */
/* ------------------------------------------------------------------ */

const damagedCount = sql<number>`(SELECT COUNT(*) FROM takas t WHERE t.jobsheet_id = "jobsheets"."id" AND t.is_deleted = 0 AND t.is_damaged = 1)`;
const lastTakaAt = sql<string | null>`(SELECT MAX(t.created_at) FROM takas t WHERE t.jobsheet_id = "jobsheets"."id" AND t.is_deleted = 0)`;

/**
 * Every jobsheet in every status. Taka pending = no active takas yet: Completed first (most recently completed
 * first), then Ongoing, Sent, Pending (by number). Done = at least one taka, most recent taka entry first.
 */
export async function listTakaJobsheets(role: RoleKey, q: TakaListQuery): Promise<TakaJobsheetPage> {
  // Sprint 15: jobsheets of a held order are hidden from Taka entry.
  // Sprint 16: never the hidden external jobsheet (outside / FG takas are not entered here).
  const base: (SQL | undefined)[] = [eq(jobsheets.isDeleted, false), realJobsheet, orderNotHeldFor(role)];
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
        blouseOption: orders.blouseOption,
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
        blouseOption: r.blouseOption,
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
