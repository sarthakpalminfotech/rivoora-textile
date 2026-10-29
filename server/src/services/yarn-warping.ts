import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  BEAM_COUNTER,
  formatKg,
  kgToGrams,
  WARPING_JOB_COUNTER,
  warpingJobDoneSchema,
  warpingJobLabel,
  warpingPendingJobSchema,
  YARN_ZONE_CONFIG,
  type Paginated,
  type RoleKey,
  type WarpingDoneResult,
  type WarpingInputKind,
  type WarpingJob,
  type WarpingJobInput,
  type WarpingPendingJob,
  type WarpingStatus,
  type YarnItem,
} from '@rivoora/shared';
import { db, type DbOrTx, type Tx } from '../db/client';
import {
  beamMoves,
  beams,
  warpingJobInputs,
  warpingJobs,
  warpingPendingJobInputs,
  warpingPendingJobs,
  warpingQualities,
  yarnBoxes,
  yarnLots,
  yarnQualities,
} from '../db/schema';
import { badRequest, conflict, notFound } from '../lib/errors';
import { actor, allocateNumbers, balanceG, nowIso, reservedG, systemQualityId, takeStock, type StockScope } from './yarn-ledger';

/**
 * Sprint 17 → 20 — Warping: Pending → In process → Done.
 * - Create (owners, `canPlanYarn`): inputs from Warping stock — raw yarn of a lot, (part of) a TFO box, or "No box"
 *   twisted yarn — plus taar, panna and meters OR "Full meter". The inputs are RESERVED while pending (`reservedG`).
 *   Edit / cancel while pending (the floor too).
 * - Start (WJ-n): the inputs leave Warping stock now (`warping_issue`); a box at 0 becomes Used.
 * - Mark done: one or more beams — typed beam no. (unique across all beams; old beams keep "BM-<n>"), warping quality,
 *   taar, panna, meters (pre-filled from the job; required per beam with Full meter), kept in Direct or Warping.
 */

/* ------------------------------------------------------------------ */
/* inputs                                                               */
/* ------------------------------------------------------------------ */

/** One input as stored (both input tables share these columns). */
interface InputRow {
  item: YarnItem;
  qualityId: number;
  qtyG: number;
  lotId: number | null;
  boxId: number | null;
  warpingQualityId: number | null;
}

/** The ledger scope an input row takes from (and reserves on). */
function inputScope(r: InputRow): StockScope {
  if (r.item === 'raw') return { lotId: r.lotId };
  if (r.boxId !== null) return { boxId: r.boxId };
  return r.warpingQualityId !== null ? { boxId: null, warpingQualityId: r.warpingQualityId } : { boxId: null };
}

const inputKind = (r: { item: YarnItem; boxId: number | null }): WarpingInputKind => (r.item === 'raw' ? 'raw' : r.boxId !== null ? 'box' : 'no_box');

type ParsedInput = ReturnType<typeof warpingPendingJobSchema.parse>['inputs'][number];

/** Request inputs → stored rows (checks the lot / box / qualities); `names` gets a display name per row. */
async function resolveInputs(tx: Tx, inputs: ParsedInput[]): Promise<{ rows: InputRow[]; names: string[] }> {
  const sysQ = await systemQualityId(tx);
  const rows: InputRow[] = [];
  const names: string[] = [];
  for (const [i, inp] of inputs.entries()) {
    const qtyG = kgToGrams(inp.qtyKg);
    if (inp.kind === 'raw') {
      const [q] = await tx.select({ name: yarnQualities.name }).from(yarnQualities).where(and(eq(yarnQualities.id, inp.qualityId), eq(yarnQualities.isDeleted, false), eq(yarnQualities.isSystem, false)));
      if (!q) throw badRequest('That yarn quality no longer exists — pick another', `inputs.${i}.qualityId`);
      const lotId = inp.lotId ?? null;
      if (lotId !== null) {
        const [lot] = await tx.select({ qualityId: yarnLots.qualityId }).from(yarnLots).where(eq(yarnLots.id, lotId));
        if (!lot || lot.qualityId !== inp.qualityId) throw badRequest('That lot is not a lot of this quality', `inputs.${i}.lotId`);
      }
      rows.push({ item: 'raw', qualityId: inp.qualityId, qtyG, lotId, boxId: null, warpingQualityId: null });
      names.push(q.name);
    } else if (inp.kind === 'box') {
      const [box] = await tx
        .select({ id: yarnBoxes.id, boxNo: yarnBoxes.boxNo, zone: yarnBoxes.zone, status: yarnBoxes.status, wq: yarnBoxes.warpingQualityId })
        .from(yarnBoxes)
        .where(eq(yarnBoxes.id, inp.boxId));
      if (!box || box.status !== 'in_stock' || box.zone !== 'warping') {
        throw conflict(`${box ? `Box ${box.boxNo}` : 'That box'} is no longer in ${YARN_ZONE_CONFIG.warping.label} — refresh and try again.`, `inputs.${i}.boxId`);
      }
      rows.push({ item: 'twisted', qualityId: sysQ, qtyG, lotId: null, boxId: box.id, warpingQualityId: box.wq });
      names.push(`box ${box.boxNo}`);
    } else if (inp.warpingQualityId) {
      const [wq] = await tx.select({ name: warpingQualities.name }).from(warpingQualities).where(and(eq(warpingQualities.id, inp.warpingQualityId), eq(warpingQualities.isDeleted, false)));
      if (!wq) throw badRequest('That warping quality no longer exists — pick another', `inputs.${i}.qualityId`);
      rows.push({ item: 'twisted', qualityId: sysQ, qtyG, lotId: null, boxId: null, warpingQualityId: inp.warpingQualityId });
      names.push(wq.name);
    } else {
      const [q] = await tx.select({ name: yarnQualities.name }).from(yarnQualities).where(and(eq(yarnQualities.id, inp.qualityId!), eq(yarnQualities.isSystem, false)));
      if (!q) throw badRequest('That yarn quality no longer exists — pick another', `inputs.${i}.qualityId`);
      rows.push({ item: 'twisted', qualityId: inp.qualityId!, qtyG, lotId: null, boxId: null, warpingQualityId: null });
      names.push(q.name);
    }
  }
  return { rows, names };
}

/**
 * After writing pending inputs: per stock bucket, what pending jobs reserve must fit in the Warping balance — 409 on the
 * first input of a bucket that doesn't (the transaction rolls back).
 */
async function assertWarpingFits(tx: Tx, rows: InputRow[], names: string[]) {
  const seen = new Set<string>();
  for (const [i, r] of rows.entries()) {
    const scope = inputScope(r);
    const key = JSON.stringify([r.item, r.qualityId, scope]);
    if (seen.has(key)) continue;
    seen.add(key);
    const balance = await balanceG(tx, 'warping', r.item, r.qualityId, scope);
    const reserved = await reservedG(tx, 'warping', r.item, r.qualityId, scope);
    if (reserved > balance) {
      throw conflict(`Not enough ${r.item === 'raw' ? 'raw yarn' : 'twisted yarn'} ${names[i]} free in ${YARN_ZONE_CONFIG.warping.label}: ${formatKg(balance)} in stock, ${formatKg(reserved)} would be reserved`, `inputs.${i}.qtyKg`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* DTOs                                                                 */
/* ------------------------------------------------------------------ */

type InputTable = typeof warpingJobInputs | typeof warpingPendingJobInputs;

async function inputsOf(tx: DbOrTx, table: InputTable, jobIds: number[]): Promise<(WarpingJobInput & { jobId: number })[]> {
  if (!jobIds.length) return [];
  const rows = await tx
    .select({
      id: table.id,
      jobId: table.jobId,
      item: table.item,
      qtyG: table.qtyG,
      qualityId: table.qualityId,
      qualityName: yarnQualities.name,
      isSystem: yarnQualities.isSystem,
      lotId: table.lotId,
      lotNo: yarnLots.lotNo,
      boxId: table.boxId,
      boxNo: yarnBoxes.boxNo,
      warpingQualityId: table.warpingQualityId,
      warpingQualityName: warpingQualities.name,
    })
    .from(table)
    .innerJoin(yarnQualities, eq(yarnQualities.id, table.qualityId))
    .leftJoin(yarnLots, eq(yarnLots.id, table.lotId))
    .leftJoin(yarnBoxes, eq(yarnBoxes.id, table.boxId))
    .leftJoin(warpingQualities, eq(warpingQualities.id, table.warpingQualityId))
    .where(inArray(table.jobId, jobIds))
    .orderBy(asc(table.id));
  return rows.map((r) => ({
    id: r.id,
    jobId: r.jobId,
    item: r.item,
    kind: inputKind(r),
    quality: r.warpingQualityId !== null ? { id: r.warpingQualityId, name: r.warpingQualityName ?? '—' } : { id: r.qualityId, name: r.qualityName },
    qtyG: r.qtyG,
    lot: r.lotId !== null ? { id: r.lotId, lotNo: r.lotNo ?? '—' } : null,
    box: r.boxId !== null ? { id: r.boxId, boxNo: r.boxNo ?? '—' } : null,
    qualityId: r.isSystem ? null : r.qualityId,
    warpingQualityId: r.warpingQualityId,
  }));
}

const uName = (col: 'started_by_user_id' | 'done_by_user_id') =>
  sql<string | null>`(SELECT u.name FROM users u WHERE u.id = "warping_jobs".${sql.raw(`"${col}"`)})`;

async function jobsWithDetails(tx: DbOrTx, rows: { id: number }[]): Promise<WarpingJob[]> {
  const ids = rows.map((r) => r.id);
  if (!ids.length) return [];
  const [jobs, inputs, jobBeams] = await Promise.all([
    tx
      .select({
        id: warpingJobs.id,
        jobNo: warpingJobs.jobNo,
        status: warpingJobs.status,
        note: warpingJobs.note,
        startedAt: warpingJobs.startedAt,
        startedRole: warpingJobs.startedRole,
        startedByName: uName('started_by_user_id'),
        doneAt: warpingJobs.doneAt,
        doneRole: warpingJobs.doneRole,
        doneByName: uName('done_by_user_id'),
        taar: warpingPendingJobs.taar,
        panna: warpingPendingJobs.panna,
        meters: warpingPendingJobs.meters,
        fullMeter: warpingPendingJobs.fullMeter,
      })
      .from(warpingJobs)
      .leftJoin(warpingPendingJobs, eq(warpingPendingJobs.id, warpingJobs.pendingJobId))
      .where(inArray(warpingJobs.id, ids)),
    inputsOf(tx, warpingJobInputs, ids),
    tx
      .select({
        id: beams.id,
        jobId: beams.warpingJobId,
        beamNo: beams.beamNo,
        beamCode: sql<string>`COALESCE(${beams.beamCode}, 'BM-' || ${beams.beamNo})`,
        zone: beams.zone,
        quality: sql<string>`COALESCE(${warpingQualities.name}, ${yarnQualities.name})`,
        taar: beams.taar,
        panna: beams.panna,
        meters: beams.meters,
        status: beams.status,
      })
      .from(beams)
      .innerJoin(yarnQualities, eq(yarnQualities.id, beams.qualityId))
      .leftJoin(warpingQualities, eq(warpingQualities.id, beams.warpingQualityId))
      .where(inArray(beams.warpingJobId, ids))
      .orderBy(beams.id),
  ]);
  return ids.flatMap((id): WarpingJob[] => {
    const j = jobs.find((x) => x.id === id);
    if (!j) return [];
    const own = inputs.filter((i) => i.jobId === id).map(({ jobId: _j, ...i }) => i);
    return [
      {
        id: j.id,
        jobNo: j.jobNo,
        status: j.status,
        note: j.note,
        inputs: own,
        totalG: own.reduce((s, i) => s + i.qtyG, 0),
        taar: j.taar,
        panna: j.panna,
        meters: j.meters,
        fullMeter: !!j.fullMeter,
        startedAt: j.startedAt,
        startedBy: { role: j.startedRole, userName: j.startedByName },
        doneAt: j.doneAt,
        doneBy: j.doneAt ? { role: j.doneRole, userName: j.doneByName } : null,
        beams: jobBeams.filter((b) => b.jobId === id).map(({ jobId: _jobId, ...b }) => b),
      },
    ];
  });
}

/** GET /yarn/warping/jobs?status= — in process: oldest first (work order); done: newest first. */
export async function listWarpingJobs(q: { status?: WarpingStatus; page: number; limit: number }): Promise<Paginated<WarpingJob>> {
  const where = q.status ? eq(warpingJobs.status, q.status) : undefined;
  const order = q.status === 'in_process' ? [warpingJobs.jobNo] : [desc(warpingJobs.jobNo)];
  const [rows, [{ total }]] = await Promise.all([
    db.select({ id: warpingJobs.id }).from(warpingJobs).where(where).orderBy(...order).limit(q.limit).offset((q.page - 1) * q.limit),
    db.select({ total: count() }).from(warpingJobs).where(where),
  ]);
  return { items: await jobsWithDetails(db, rows), page: q.page, limit: q.limit, total, hasMore: q.page * q.limit < total };
}

export async function getWarpingJob(id: number, tx: DbOrTx = db): Promise<WarpingJob> {
  const [job] = await jobsWithDetails(tx, [{ id }]);
  if (!job) throw notFound('Warping job');
  return job;
}

/* ------------------------------------------------------------------ */
/* pending jobs                                                         */
/* ------------------------------------------------------------------ */

async function pendingJobs(tx: DbOrTx, where: ReturnType<typeof eq>): Promise<WarpingPendingJob[]> {
  const rows = await tx
    .select({
      id: warpingPendingJobs.id,
      taar: warpingPendingJobs.taar,
      panna: warpingPendingJobs.panna,
      meters: warpingPendingJobs.meters,
      fullMeter: warpingPendingJobs.fullMeter,
      note: warpingPendingJobs.note,
      status: warpingPendingJobs.status,
      createdAt: warpingPendingJobs.createdAt,
      createdByName: sql<string | null>`(SELECT u.name FROM users u WHERE u.id = "warping_pending_jobs"."created_by_user_id")`,
    })
    .from(warpingPendingJobs)
    .where(where)
    .orderBy(asc(warpingPendingJobs.id));
  const inputs = await inputsOf(
    tx,
    warpingPendingJobInputs,
    rows.map((r) => r.id),
  );
  return rows.map((r) => {
    const own = inputs.filter((i) => i.jobId === r.id).map(({ jobId: _j, ...i }) => i);
    return {
      id: r.id,
      inputs: own,
      totalG: own.reduce((s, i) => s + i.qtyG, 0),
      taar: r.taar,
      panna: r.panna,
      meters: r.meters,
      fullMeter: r.fullMeter,
      note: r.note,
      createdAt: r.createdAt,
      createdBy: { userName: r.createdByName, role: null },
    };
  });
}

/** GET /yarn/warping/pending — jobs waiting to start, oldest first. */
export const listPendingJobs = () => pendingJobs(db, eq(warpingPendingJobs.status, 'pending'));

async function getPendingJob(tx: DbOrTx, id: number): Promise<{ id: number; status: string }> {
  const [row] = await tx.select({ id: warpingPendingJobs.id, status: warpingPendingJobs.status }).from(warpingPendingJobs).where(eq(warpingPendingJobs.id, id));
  if (!row) throw notFound('Warping job');
  return row;
}

const NOT_PENDING = 'This warping job is no longer pending — refresh and try again.';

/** POST /yarn/warping/pending (owners) — the inputs are reserved in Warping stock. */
export async function createPendingJob(role: RoleKey, input: unknown): Promise<WarpingPendingJob> {
  const data = warpingPendingJobSchema.parse(input);
  return db.transaction(async (tx) => {
    const { rows, names } = await resolveInputs(tx, data.inputs);
    const who = actor(role);
    const [job] = await tx
      .insert(warpingPendingJobs)
      .values({ taar: data.taar, panna: data.panna, meters: data.meters, fullMeter: data.fullMeter, note: data.note, status: 'pending', createdByUserId: who.userId })
      .returning({ id: warpingPendingJobs.id });
    await tx.insert(warpingPendingJobInputs).values(rows.map((r) => ({ ...r, jobId: job.id })));
    await assertWarpingFits(tx, rows, names);
    return (await pendingJobs(tx, eq(warpingPendingJobs.id, job.id)))[0];
  });
}

/** PUT /yarn/warping/pending/:id — replaces the inputs and the header while pending. */
export async function updatePendingJob(_role: RoleKey, id: number, input: unknown): Promise<WarpingPendingJob> {
  const data = warpingPendingJobSchema.parse(input);
  return db.transaction(async (tx) => {
    const done = await tx
      .update(warpingPendingJobs)
      .set({ taar: data.taar, panna: data.panna, meters: data.meters, fullMeter: data.fullMeter, note: data.note, updatedAt: nowIso() })
      .where(and(eq(warpingPendingJobs.id, id), eq(warpingPendingJobs.status, 'pending')))
      .returning({ id: warpingPendingJobs.id });
    if (!done.length) {
      await getPendingJob(tx, id);
      throw conflict(NOT_PENDING);
    }
    // Old inputs out first, so they don't count against the new ones.
    await tx.delete(warpingPendingJobInputs).where(eq(warpingPendingJobInputs.jobId, id));
    const { rows, names } = await resolveInputs(tx, data.inputs);
    await tx.insert(warpingPendingJobInputs).values(rows.map((r) => ({ ...r, jobId: id })));
    await assertWarpingFits(tx, rows, names);
    return (await pendingJobs(tx, eq(warpingPendingJobs.id, id)))[0];
  });
}

/** POST /yarn/warping/pending/:id/cancel — releases the reservation. */
export async function cancelPendingJob(role: RoleKey, id: number): Promise<{ id: number }> {
  return db.transaction(async (tx) => {
    const who = actor(role);
    const done = await tx
      .update(warpingPendingJobs)
      .set({ status: 'cancelled', cancelledAt: nowIso(), cancelledByUserId: who.userId, updatedAt: nowIso() })
      .where(and(eq(warpingPendingJobs.id, id), eq(warpingPendingJobs.status, 'pending')))
      .returning({ id: warpingPendingJobs.id });
    if (!done.length) {
      await getPendingJob(tx, id);
      throw conflict(NOT_PENDING);
    }
    return { id };
  });
}

/**
 * POST /yarn/warping/pending/:id/start — WJ-n In process. The pending row is marked started FIRST (its reservation
 * ends), then every input leaves Warping stock (`warping_issue`); a box at 0 becomes Used.
 */
export async function startPendingJob(role: RoleKey, id: number): Promise<WarpingJob> {
  return db.transaction(async (tx) => {
    const [pending] = await pendingJobs(tx, eq(warpingPendingJobs.id, id));
    if (!pending) throw notFound('Warping job');
    const at = nowIso();
    const [jobNo] = await allocateNumbers(tx, WARPING_JOB_COUNTER);
    const who = actor(role);
    const [job] = await tx
      .insert(warpingJobs)
      .values({ jobNo, status: 'in_process', note: pending.note, startedAt: at, startedByUserId: who.userId, startedRole: role, pendingJobId: id })
      .returning({ id: warpingJobs.id });
    const started = await tx
      .update(warpingPendingJobs)
      .set({ status: 'started', startedJobId: job.id, updatedAt: at })
      .where(and(eq(warpingPendingJobs.id, id), eq(warpingPendingJobs.status, 'pending')))
      .returning({ id: warpingPendingJobs.id });
    if (!started.length) throw conflict(NOT_PENDING);
    const stored = await tx
      .select({ item: warpingPendingJobInputs.item, qualityId: warpingPendingJobInputs.qualityId, qtyG: warpingPendingJobInputs.qtyG, lotId: warpingPendingJobInputs.lotId, boxId: warpingPendingJobInputs.boxId, warpingQualityId: warpingPendingJobInputs.warpingQualityId })
      .from(warpingPendingJobInputs)
      .where(eq(warpingPendingJobInputs.jobId, id))
      .orderBy(asc(warpingPendingJobInputs.id));
    await tx.insert(warpingJobInputs).values(stored.map((r) => ({ ...r, jobId: job.id })));
    const boxIds: number[] = [];
    for (const [i, r] of stored.entries()) {
      const shown = pending.inputs[i];
      await takeStock(tx, {
        zone: 'warping',
        item: r.item,
        qualityId: r.qualityId,
        ...(r.item === 'raw' ? { lotId: r.lotId } : { boxId: r.boxId, warpingQualityId: r.warpingQualityId }),
        qtyG: r.qtyG,
        kind: 'warping_issue',
        refType: 'job',
        refId: job.id,
        note: pending.note,
        role,
        createdAt: at,
        qualityName: shown?.box ? `box ${shown.box.boxNo}` : (shown?.quality.name ?? ''),
        field: `inputs.${i}.qtyKg`,
      });
      if (r.boxId !== null) boxIds.push(r.boxId);
    }
    if (boxIds.length) {
      // Boxes with nothing left are Used.
      await tx.run(sql`UPDATE yarn_boxes SET status = 'used', updated_at = ${at}
        WHERE id IN (${sql.join(
          boxIds.map((b) => sql`${b}`),
          sql`, `,
        )}) AND (SELECT COALESCE(SUM(m.qty_g), 0) FROM yarn_stock_moves m WHERE m.box_id = yarn_boxes.id) <= 0`);
    }
    return getWarpingJob(job.id, tx);
  });
}

/* ------------------------------------------------------------------ */
/* done → beams                                                         */
/* ------------------------------------------------------------------ */

const isBeamCodeUnique = (err: unknown) => /beams_beam_code_unique|beams\.beam_code/i.test(String((err as Error)?.message ?? err));

/** GET /yarn/beams/check — the live "beam no. is free" check (any case; old beams count as "BM-<n>"). */
export async function checkBeamCode(code: string): Promise<{ available: boolean }> {
  const [row] = await db
    .select({ id: beams.id })
    .from(beams)
    .where(sql`lower(COALESCE(${beams.beamCode}, 'BM-' || ${beams.beamNo})) = lower(${code.trim()})`)
    .limit(1);
  return { available: !row };
}

/** POST /yarn/warping/jobs/:id/done — creates the beams in their chosen zones; the job is Done. */
export async function finishWarpingJob(role: RoleKey, id: number, input: unknown): Promise<WarpingDoneResult> {
  const data = warpingJobDoneSchema.parse(input);
  try {
    return await db.transaction(async (tx) => {
      const [job] = await tx.select({ id: warpingJobs.id, jobNo: warpingJobs.jobNo, status: warpingJobs.status }).from(warpingJobs).where(eq(warpingJobs.id, id));
      if (!job) throw notFound('Warping job');
      if (job.status !== 'in_process') throw conflict(`${warpingJobLabel(job.jobNo)} is already done.`);
      const wqIds = [...new Set(data.beams.map((b) => b.warpingQualityId))];
      const wqs = await tx.select({ id: warpingQualities.id }).from(warpingQualities).where(and(inArray(warpingQualities.id, wqIds), eq(warpingQualities.isDeleted, false)));
      const missing = data.beams.findIndex((b) => !wqs.some((w) => w.id === b.warpingQualityId));
      if (missing >= 0) throw badRequest('That warping quality no longer exists — pick another', `beams.${missing}.warpingQualityId`);
      const codes = data.beams.map((b) => b.beamCode.trim());
      const taken = await tx
        .select({ code: sql<string>`COALESCE(${beams.beamCode}, 'BM-' || ${beams.beamNo})` })
        .from(beams)
        .where(sql`lower(COALESCE(${beams.beamCode}, 'BM-' || ${beams.beamNo})) IN (${sql.join(
          codes.map((c) => sql`${c.toLowerCase()}`),
          sql`, `,
        )})`);
      if (taken.length) {
        const i = codes.findIndex((c) => taken.some((t) => t.code.toLowerCase() === c.toLowerCase()));
        throw conflict(`Beam no. ${codes[i]} is already used`, `beams.${i}.beamCode`);
      }
      const who = actor(role);
      const at = nowIso();
      const done = await tx
        .update(warpingJobs)
        .set({ status: 'done', doneAt: at, doneByUserId: who.userId, doneRole: role, doneNote: data.note })
        .where(and(eq(warpingJobs.id, id), eq(warpingJobs.status, 'in_process')))
        .returning({ id: warpingJobs.id });
      if (!done.length) throw conflict('The job changed meanwhile — refresh and try again.');
      const sysQ = await systemQualityId(tx);
      const numbers = await allocateNumbers(tx, BEAM_COUNTER, data.beams.length);
      const created = await tx
        .insert(beams)
        .values(
          data.beams.map((b, i) => ({
            beamNo: numbers[i],
            beamCode: codes[i],
            zone: b.zone,
            qualityId: sysQ,
            warpingQualityId: b.warpingQualityId,
            taar: b.taar,
            panna: b.panna,
            meters: b.meters,
            status: 'in_stock' as const,
            warpingJobId: id,
            createdByUserId: who.userId,
            createdAt: at,
          })),
        )
        .returning({ id: beams.id, beamCode: beams.beamCode, zone: beams.zone });
      await tx.insert(beamMoves).values(
        created.map((b) => ({ beamId: b.id, kind: 'beam_created' as const, zone: b.zone, refType: 'job' as const, refId: id, note: data.note, ...who, createdAt: at })),
      );
      return { jobId: id, beams: created.map((b) => ({ id: b.id, beamCode: b.beamCode!, zone: b.zone })) };
    });
  } catch (err) {
    if (isBeamCodeUnique(err)) throw conflict('A beam no. on this job is already used — refresh and try again.', 'beams');
    throw err;
  }
}
