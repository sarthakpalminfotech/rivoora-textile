import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  BEAM_COUNTER,
  kgToGrams,
  WARPING_JOB_COUNTER,
  warpingJobDoneSchema,
  warpingJobLabel,
  warpingJobStartSchema,
  type Paginated,
  type RoleKey,
  type WarpingDoneResult,
  type WarpingJob,
  type WarpingStatus,
} from '@rivoora/shared';
import { db, type DbOrTx } from '../db/client';
import { beamMoves, beams, warpingJobInputs, warpingJobs, yarnQualities } from '../db/schema';
import { conflict, notFound } from '../lib/errors';
import { actor, allocateNumbers, nowIso, qualityNames, takeStock } from './yarn-ledger';

/**
 * Sprint 17 — Warping: a job (WJ-n) takes raw and / or twisted yarn out of Warping stock when it starts
 * (`warping_issue`, balance checked per item + quality — two rows of the same quality add up), and on Mark done
 * creates one or more beams (BM-n), each kept in Direct consumption or Warping (`beam_created`).
 */

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
      })
      .from(warpingJobs)
      .where(inArray(warpingJobs.id, ids)),
    tx
      .select({ id: warpingJobInputs.id, jobId: warpingJobInputs.jobId, item: warpingJobInputs.item, qualityId: warpingJobInputs.qualityId, qualityName: yarnQualities.name, qtyG: warpingJobInputs.qtyG })
      .from(warpingJobInputs)
      .innerJoin(yarnQualities, eq(yarnQualities.id, warpingJobInputs.qualityId))
      .where(inArray(warpingJobInputs.jobId, ids))
      .orderBy(warpingJobInputs.id),
    tx
      .select({
        id: beams.id,
        jobId: beams.warpingJobId,
        beamNo: beams.beamNo,
        zone: beams.zone,
        quality: yarnQualities.name,
        taar: beams.taar,
        panna: beams.panna,
        meters: beams.meters,
        status: beams.status,
      })
      .from(beams)
      .innerJoin(yarnQualities, eq(yarnQualities.id, beams.qualityId))
      .where(inArray(beams.warpingJobId, ids))
      .orderBy(beams.beamNo),
  ]);
  return ids.flatMap((id): WarpingJob[] => {
    const j = jobs.find((x) => x.id === id);
    if (!j) return [];
    const own = inputs.filter((i) => i.jobId === id);
    return [{
      id: j.id,
      jobNo: j.jobNo,
      status: j.status,
      note: j.note,
      inputs: own.map((i) => ({ id: i.id, item: i.item, quality: { id: i.qualityId, name: i.qualityName }, qtyG: i.qtyG })),
      totalG: own.reduce((s, i) => s + i.qtyG, 0),
      startedAt: j.startedAt,
      startedBy: { role: j.startedRole, userName: j.startedByName },
      doneAt: j.doneAt,
      doneBy: j.doneAt ? { role: j.doneRole, userName: j.doneByName } : null,
      beams: jobBeams.filter((b) => b.jobId === id).map(({ jobId: _jobId, ...b }) => b),
    }];
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

/** POST /yarn/warping/jobs — the inputs leave Warping stock now; the job is In process. */
export async function startWarpingJob(role: RoleKey, input: unknown): Promise<WarpingJob> {
  const data = warpingJobStartSchema.parse(input);
  return db.transaction(async (tx) => {
    const names = await qualityNames(tx, data.inputs.map((i) => i.qualityId), 'inputs');
    const [jobNo] = await allocateNumbers(tx, WARPING_JOB_COUNTER);
    const who = actor(role);
    const at = nowIso();
    const [job] = await tx
      .insert(warpingJobs)
      .values({ jobNo, status: 'in_process', note: data.note, startedAt: at, startedByUserId: who.userId, startedRole: role })
      .returning({ id: warpingJobs.id });
    await tx.insert(warpingJobInputs).values(data.inputs.map((i) => ({ jobId: job.id, item: i.item, qualityId: i.qualityId, qtyG: kgToGrams(i.qtyKg) })));
    // One ledger row per input row; each take sees the rows taken before it in this transaction.
    for (const [index, i] of data.inputs.entries()) {
      await takeStock(tx, {
        zone: 'warping',
        item: i.item,
        qualityId: i.qualityId,
        qtyG: kgToGrams(i.qtyKg),
        kind: 'warping_issue',
        refType: 'job',
        refId: job.id,
        note: data.note,
        role,
        createdAt: at,
        qualityName: names.get(i.qualityId)!,
        field: `inputs.${index}.qtyKg`,
      });
    }
    return getWarpingJob(job.id, tx);
  });
}

/** POST /yarn/warping/jobs/:id/done — creates the beams (BM-n) in their chosen zones; the job is Done. */
export async function finishWarpingJob(role: RoleKey, id: number, input: unknown): Promise<WarpingDoneResult> {
  const data = warpingJobDoneSchema.parse(input);
  return db.transaction(async (tx) => {
    const [job] = await tx.select({ id: warpingJobs.id, jobNo: warpingJobs.jobNo, status: warpingJobs.status }).from(warpingJobs).where(eq(warpingJobs.id, id));
    if (!job) throw notFound('Warping job');
    if (job.status !== 'in_process') throw conflict(`${warpingJobLabel(job.jobNo)} is already done.`);
    await qualityNames(tx, data.beams.map((b) => b.qualityId), 'beams');
    const who = actor(role);
    const at = nowIso();
    const done = await tx
      .update(warpingJobs)
      .set({ status: 'done', doneAt: at, doneByUserId: who.userId, doneRole: role, doneNote: data.note })
      .where(and(eq(warpingJobs.id, id), eq(warpingJobs.status, 'in_process')))
      .returning({ id: warpingJobs.id });
    if (!done.length) throw conflict('The job changed meanwhile — refresh and try again.');
    const numbers = await allocateNumbers(tx, BEAM_COUNTER, data.beams.length);
    const created = await tx
      .insert(beams)
      .values(
        data.beams.map((b, i) => ({
          beamNo: numbers[i],
          zone: b.zone,
          qualityId: b.qualityId,
          taar: b.taar,
          panna: b.panna,
          meters: b.meters,
          status: 'in_stock' as const,
          warpingJobId: id,
          createdByUserId: who.userId,
          createdAt: at,
        })),
      )
      .returning({ id: beams.id, beamNo: beams.beamNo, zone: beams.zone });
    await tx.insert(beamMoves).values(
      created.map((b) => ({ beamId: b.id, kind: 'beam_created' as const, zone: b.zone, refType: 'job' as const, refId: id, note: data.note, ...who, createdAt: at })),
    );
    return { jobId: id, beams: created.sort((a, b) => a.beamNo - b.beamNo) };
  });
}
