import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import {
  gramsToKg,
  kgToGrams,
  PROGRAM_STOP_ERROR_TEXT,
  TFO_SECTIONS,
  tfoProgramStartSchema,
  tfoProgramStopSchema,
  tfoSectionLabel,
  validateProgramStop,
  type Paginated,
  type RoleKey,
  type TfoBoard,
  type TfoProgram,
  type TfoSection,
} from '@rivoora/shared';
import { db, type DbOrTx } from '../db/client';
import { tfoMachines, tfoPrograms, yarnQualities, yarnStockMoves } from '../db/schema';
import { badRequest, conflict, notFound } from '../lib/errors';
import { actor, addStock, nowIso, qualityNames, takeStock } from './yarn-ledger';

/**
 * Sprint 17 — TFO: the machine board (every active machine with its two sections A / B and the running programs),
 * starting a program on a section (raw yarn leaves TFO raw stock: `tfo_issue`) and stopping it (twisted yarn into TFO
 * stock under the output quality: `tfo_output`; optional raw returned: `tfo_return`). One running program per
 * section (partial unique index + a check).
 */

const qName = (col: 'raw_quality_id' | 'output_quality_id') =>
  sql<string>`(SELECT q.name FROM yarn_qualities q WHERE q.id = "tfo_programs".${sql.raw(`"${col}"`)})`;
const uName = (col: 'started_by_user_id' | 'stopped_by_user_id') =>
  sql<string | null>`(SELECT u.name FROM users u WHERE u.id = "tfo_programs".${sql.raw(`"${col}"`)})`;

const programColumns = {
  id: tfoPrograms.id,
  machineId: tfoPrograms.machineId,
  machineNo: tfoMachines.machineNo,
  section: tfoPrograms.section,
  rawQualityId: tfoPrograms.rawQualityId,
  rawQualityName: qName('raw_quality_id'),
  rawG: tfoPrograms.rawG,
  outputQualityId: tfoPrograms.outputQualityId,
  outputQualityName: qName('output_quality_id'),
  windingMeter: tfoPrograms.windingMeter,
  denierFilament: tfoPrograms.denierFilament,
  tpm: tfoPrograms.tpm,
  direction: tfoPrograms.direction,
  note: tfoPrograms.note,
  status: tfoPrograms.status,
  startedAt: tfoPrograms.startedAt,
  startedRole: tfoPrograms.startedRole,
  startedByName: uName('started_by_user_id'),
  stoppedAt: tfoPrograms.stoppedAt,
  stoppedRole: tfoPrograms.stoppedRole,
  stoppedByName: uName('stopped_by_user_id'),
  twistedG: tfoPrograms.twistedG,
  twistedMeters: tfoPrograms.twistedMeters,
  returnedRawG: tfoPrograms.returnedRawG,
  stopNote: tfoPrograms.stopNote,
};


const programsFrom = (tx: DbOrTx) => tx.select(programColumns).from(tfoPrograms).innerJoin(tfoMachines, eq(tfoMachines.id, tfoPrograms.machineId));
type ProgramRow = Awaited<ReturnType<typeof programsFrom>>[number];

function toProgram(r: ProgramRow): TfoProgram {
  return {
    id: r.id,
    machineId: r.machineId,
    machineNo: r.machineNo,
    section: r.section,
    rawQuality: { id: r.rawQualityId, name: r.rawQualityName },
    rawG: r.rawG,
    outputQuality: { id: r.outputQualityId, name: r.outputQualityName },
    windingMeter: r.windingMeter,
    denierFilament: r.denierFilament,
    tpm: r.tpm,
    direction: r.direction,
    note: r.note,
    status: r.status,
    startedAt: r.startedAt,
    startedBy: { role: r.startedRole, userName: r.startedByName },
    stoppedAt: r.stoppedAt,
    stoppedBy: r.stoppedAt ? { role: r.stoppedRole, userName: r.stoppedByName } : null,
    twistedG: r.twistedG,
    twistedMeters: r.twistedMeters,
    returnedRawG: r.returnedRawG,
    stopNote: r.stopNote,
  };
}


export async function getProgram(id: number, tx: DbOrTx = db): Promise<TfoProgram> {
  const [row] = await programsFrom(tx).where(eq(tfoPrograms.id, id));
  if (!row) throw notFound('Program');
  return toProgram(row);
}

/** GET /yarn/tfo/board — active machines + running programs + the TFO raw stock (three queries, one round trip each). */
export async function tfoBoard(): Promise<TfoBoard> {
  const [machines, running, stock] = await Promise.all([
    db
      .select({ id: tfoMachines.id, machineNo: tfoMachines.machineNo, name: tfoMachines.name })
      .from(tfoMachines)
      .where(and(eq(tfoMachines.isDeleted, false), eq(tfoMachines.isActive, true)))
      .orderBy(asc(tfoMachines.machineNo)),
    programsFrom(db).where(eq(tfoPrograms.status, 'running')),
    db
      .select({
        id: yarnQualities.id,
        name: yarnQualities.name,
        denier: yarnQualities.denier,
        filament: yarnQualities.filament,
        g: sql<number>`COALESCE(SUM(${yarnStockMoves.qtyG}), 0)`,
      })
      .from(yarnStockMoves)
      .innerJoin(yarnQualities, eq(yarnQualities.id, yarnStockMoves.qualityId))
      .where(and(eq(yarnStockMoves.zone, 'tfo'), eq(yarnStockMoves.item, 'raw')))
      .groupBy(yarnQualities.id)
      .orderBy(sql`lower(${yarnQualities.name})`),
  ]);
  const programs = running.map((r) => toProgram(r));
  return {
    machines: machines.map((m) => ({
      ...m,
      sections: TFO_SECTIONS.map((section) => ({ section, program: programs.find((p) => p.machineId === m.id && p.section === section) ?? null })),
    })),
    runningSections: programs.filter((p) => machines.some((m) => m.id === p.machineId)).length,
    rawStock: stock
      .map((s) => ({ quality: { id: s.id, name: s.name, denier: s.denier, filament: s.filament }, rawG: Number(s.g) }))
      .filter((s) => s.rawG > 0),
  };
}

/** GET /yarn/tfo/programs?machineId=&section= — program history (newest first). */
export async function listPrograms(q: { page: number; limit: number; machineId?: number; section?: TfoSection }): Promise<Paginated<TfoProgram>> {
  const where = and(q.machineId ? eq(tfoPrograms.machineId, q.machineId) : undefined, q.section ? eq(tfoPrograms.section, q.section) : undefined);
  const [rows, [{ total }]] = await Promise.all([
    programsFrom(db).where(where).orderBy(desc(tfoPrograms.startedAt), desc(tfoPrograms.id)).limit(q.limit).offset((q.page - 1) * q.limit),
    db.select({ total: count() }).from(tfoPrograms).where(where),
  ]);
  return { items: rows.map((r) => toProgram(r)), page: q.page, limit: q.limit, total, hasMore: q.page * q.limit < total };
}

const isRunningUnique = (err: unknown) => /tfo_programs_running_unique|tfo_programs\.machine_id/i.test(String((err as Error)?.message ?? err));

/** POST /yarn/tfo/programs — starts a program on an idle section; the raw kg leave TFO raw stock now. */
export async function startProgram(role: RoleKey, input: unknown): Promise<TfoProgram> {
  const data = tfoProgramStartSchema.parse(input);
  try {
    return await db.transaction(async (tx) => {
      const [machine] = await tx
        .select({ id: tfoMachines.id, machineNo: tfoMachines.machineNo, isActive: tfoMachines.isActive })
        .from(tfoMachines)
        .where(and(eq(tfoMachines.id, data.machineId), eq(tfoMachines.isDeleted, false)));
      if (!machine) throw notFound('TFO machine');
      if (!machine.isActive) throw conflict(`TFO machine ${machine.machineNo} is inactive.`, 'machineId');
      const label = tfoSectionLabel(machine.machineNo, data.section);
      const [busy] = await tx
        .select({ id: tfoPrograms.id })
        .from(tfoPrograms)
        .where(and(eq(tfoPrograms.machineId, data.machineId), eq(tfoPrograms.section, data.section), eq(tfoPrograms.status, 'running')));
      if (busy) throw conflict(`A program is already running on ${label}.`, 'section');
      const names = await qualityNames(tx, [data.rawQualityId, data.outputQualityId], 'rawQualityId');
      const rawG = kgToGrams(data.rawKg);
      const who = actor(role);
      const [p] = await tx
        .insert(tfoPrograms)
        .values({
          machineId: data.machineId,
          section: data.section,
          rawQualityId: data.rawQualityId,
          rawG,
          outputQualityId: data.outputQualityId,
          windingMeter: data.windingMeter,
          denierFilament: data.denierFilament,
          tpm: data.tpm,
          direction: data.direction,
          note: data.note,
          status: 'running',
          startedAt: nowIso(),
          startedByUserId: who.userId,
          startedRole: role,
        })
        .returning({ id: tfoPrograms.id });
      await takeStock(tx, {
        zone: 'tfo',
        item: 'raw',
        qualityId: data.rawQualityId,
        qtyG: rawG,
        kind: 'tfo_issue',
        refType: 'program',
        refId: p.id,
        note: data.note,
        role,
        qualityName: names.get(data.rawQualityId)!,
        field: 'rawKg',
      });
      return getProgram(p.id, tx);
    });
  } catch (err) {
    if (isRunningUnique(err)) throw conflict('A program is already running on this section.', 'section');
    throw err;
  }
}

/**
 * POST /yarn/tfo/programs/:id/stop — the twisted kg produced (may differ from the raw kg issued) go into TFO stock under
 * the output quality; returned raw kg (≤ issued) go back to TFO raw stock. The section becomes idle.
 */
export async function stopProgram(role: RoleKey, id: number, input: unknown): Promise<TfoProgram> {
  const data = tfoProgramStopSchema.parse(input);
  return db.transaction(async (tx) => {
    const p = await getProgram(id, tx);
    if (p.status !== 'running') throw conflict(`The program on ${tfoSectionLabel(p.machineNo, p.section)} is already stopped.`);
    const twistedG = kgToGrams(data.twistedKg);
    const returnedG = kgToGrams(data.returnedRawKg ?? 0);
    const err = validateProgramStop({ rawG: p.rawG, twistedG, returnedG });
    if (err) throw badRequest(err === 'returned_too_much' ? `${PROGRAM_STOP_ERROR_TEXT[err]} (${gramsToKg(p.rawG)} kg)` : PROGRAM_STOP_ERROR_TEXT[err], err === 'returned_too_much' ? 'returnedRawKg' : 'twistedKg');
    const who = actor(role);
    const at = nowIso();
    const done = await tx
      .update(tfoPrograms)
      .set({
        status: 'completed',
        stoppedAt: at,
        stoppedByUserId: who.userId,
        stoppedRole: role,
        twistedG,
        twistedMeters: data.twistedMeters,
        returnedRawG: returnedG,
        stopNote: data.note,
      })
      .where(and(eq(tfoPrograms.id, id), eq(tfoPrograms.status, 'running')))
      .returning({ id: tfoPrograms.id });
    if (!done.length) throw conflict('The program changed meanwhile — refresh and try again.');
    if (twistedG > 0) {
      await addStock(tx, { zone: 'tfo', item: 'twisted', qualityId: p.outputQuality.id, qtyG: twistedG, kind: 'tfo_output', refType: 'program', refId: id, note: data.note, role, createdAt: at });
    }
    if (returnedG > 0) {
      await addStock(tx, { zone: 'tfo', item: 'raw', qualityId: p.rawQuality.id, qtyG: returnedG, kind: 'tfo_return', refType: 'program', refId: id, note: data.note, role, createdAt: at });
    }
    return getProgram(id, tx);
  });
}
