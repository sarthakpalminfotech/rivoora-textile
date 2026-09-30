import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import {
  canRoleSeeJobsheetStatus,
  canRoleSeeStatus,
  JOBSHEET_STATUS,
  MAX_TAKAS_PER_JOBSHEET,
  TAKA_ERROR_TEXT,
  takaEditSchema,
  takaEntrySchema,
  takaSummary,
  validateTakaNumbers,
  type JobsheetTakaGroup,
  type OrderTakas,
  type RoleKey,
  type Taka,
  type TakaEditResult,
  type TakaEntryResult,
  type TakaJobsheetItem,
  type TakaJobsheetPage,
  type TakaListQuery,
  type TakaNoError,
} from '@rivoora/shared';
import { db, type Tx } from '../db/client';
import { designVariations, designs, jobsheets, orders, takas } from '../db/schema';
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
import { sortTakas, takaColumns } from './taka-shared';

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
  return sortTakas(rows);
}

/** 400 on the first invalid row, with the field path the forms map inline (`takas.3.takaNo`). */
function assertValidNumbers(values: string[], errors: (TakaNoError | null)[]) {
  const i = errors.findIndex((e) => e !== null);
  if (i >= 0) {
    const err = errors[i]!;
    throw badRequest(`Taka ${values[i] || i + 1}: ${TAKA_ERROR_TEXT[err].en}`, `takas.${i}.takaNo`);
  }
}

/* ------------------------------------------------------------------ */
/* entry (Taka entry role)                                              */
/* ------------------------------------------------------------------ */

/**
 * Adds takas to a jobsheet (never edits existing ones), appends the note, and completes the jobsheet if it isn't
 * Completed yet (completed frames = assigned frames). One transaction; ends with the order status recompute.
 */
export async function enterTakas(role: RoleKey, id: number, input: unknown): Promise<TakaEntryResult> {
  const data = takaEntrySchema.parse(input);
  return db.transaction(async (tx) => {
    const js = await loadJobsheetForTakas(tx, role, id);
    const existing = await activeTakas(tx, id);
    const values = data.takas.map((t) => t.takaNo);
    assertValidNumbers(values, validateTakaNumbers(values, existing.map((t) => t.takaNo)));
    if (existing.length + data.takas.length > MAX_TAKAS_PER_JOBSHEET) {
      throw badRequest(`A jobsheet can have at most ${MAX_TAKAS_PER_JOBSHEET} takas.`);
    }

    const at = now();
    const added = await tx
      .insert(takas)
      .values(
        data.takas.map((t) => ({
          jobsheetId: id,
          orderId: js.orderId,
          takaNo: t.takaNo,
          isDamaged: t.isDamaged,
          damageType: t.isDamaged ? ('machine' as const) : null,
          enteredBy: role,
          createdAt: at,
          updatedAt: at,
        })),
      )
      .returning(takaColumns);

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
      if (!done.length) throw conflict(`Jobsheet ${js.jobsheetNo} was just changed. Refresh and try again.`);
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
      { jobsheetId: id, event: 'takas_entered', note: takaSummary(data.takas) },
    ]);
    await recomputeOrderStatus(js.orderId, role, tx);
    return { jobsheetId: id, jobsheetNo: js.jobsheetNo, orderId: js.orderId, added: sortTakas(added), autoCompleted };
  });
}

/* ------------------------------------------------------------------ */
/* edit (Jemish / Gaurang)                                              */
/* ------------------------------------------------------------------ */

/**
 * Replaces the jobsheet's takas with the given set: rows with an `id` are updated, rows without one are added,
 * missing ones are soft-deleted. The note is replaced. One transaction; ends with the order status recompute.
 */
export async function editTakas(role: RoleKey, id: number, input: unknown): Promise<TakaEditResult> {
  const data = takaEditSchema.parse(input);
  return db.transaction(async (tx) => {
    const js = await loadJobsheetForTakas(tx, role, id);
    const existing = await activeTakas(tx, id);
    const values = data.takas.map((t) => t.takaNo);
    assertValidNumbers(values, validateTakaNumbers(values));

    const byId = new Map(existing.map((t) => [t.id, t]));
    const seenIds = new Set<number>();
    for (const t of data.takas) {
      if (t.id === undefined) continue;
      if (!byId.has(t.id) || seenIds.has(t.id)) {
        throw conflict('These takas were just changed by someone else. Close the form, refresh and try again.');
      }
      seenIds.add(t.id);
    }
    const addedRows = data.takas.filter((t) => t.id === undefined);
    if (addedRows.length && js.status !== JOBSHEET_STATUS.COMPLETED) {
      throw conflict('Takas can only be added once the jobsheet is completed.');
    }
    const removed = existing.filter((t) => !seenIds.has(t.id));
    const changed = data.takas.filter((t) => {
      if (t.id === undefined) return false;
      const old = byId.get(t.id)!;
      return old.takaNo !== t.takaNo || old.isDamaged !== t.isDamaged;
    });
    const note = data.note;
    const noteChanged = (js.takaNote ?? null) !== note;

    if (!addedRows.length && !removed.length && !changed.length && !noteChanged) {
      return { jobsheetId: id, orderId: js.orderId, added: 0, removed: 0, changed: 0, noteChanged: false, takas: existing };
    }

    const at = now();
    if (removed.length) {
      await tx
        .update(takas)
        .set({ isDeleted: true })
        .where(inArray(takas.id, removed.map((t) => t.id)));
    }
    // Renumbered rows go through a temporary value first, so swapping two numbers never hits the unique index.
    const renumbered = changed.filter((t) => byId.get(t.id!)!.takaNo !== t.takaNo);
    for (const t of renumbered) {
      await tx.update(takas).set({ takaNo: `~${t.id}` }).where(eq(takas.id, t.id!));
    }
    for (const t of changed) {
      await tx
        .update(takas)
        .set({ takaNo: t.takaNo, isDamaged: t.isDamaged, damageType: t.isDamaged ? 'machine' : null })
        .where(eq(takas.id, t.id!));
    }
    if (addedRows.length) {
      await tx.insert(takas).values(
        addedRows.map((t) => ({
          jobsheetId: id,
          orderId: js.orderId,
          takaNo: t.takaNo,
          isDamaged: t.isDamaged,
          damageType: t.isDamaged ? ('machine' as const) : null,
          enteredBy: role,
          createdAt: at,
          updatedAt: at,
        })),
      );
    }
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
  for (const { jobsheetId, ...t } of takaRows) {
    const list = byJobsheet.get(jobsheetId);
    if (list) list.push(t);
    else byJobsheet.set(jobsheetId, [t]);
  }
  const groups: JobsheetTakaGroup[] = sheetRows.map((r) => ({
    jobsheetId: r.id,
    jobsheetNo: r.jobsheetNo,
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
    groups,
  };
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
        designCode: sql<string | null>`COALESCE(${designVariations.code}, ${designs.code})`,
        thumbUrl: sql<string | null>`CASE WHEN ${designVariations.id} IS NOT NULL THEN ${designVariations.thumbUrl} ELSE ${designs.thumbUrl} END`,
        imageUrl: sql<string | null>`CASE WHEN ${designVariations.id} IS NOT NULL THEN ${designVariations.imageUrl} ELSE ${designs.imageUrl} END`,
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
