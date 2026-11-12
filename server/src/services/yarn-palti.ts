import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';
import {
  boxNoWithFy,
  formatKg,
  kgToGrams,
  NO_BOX_LABEL,
  NO_LOT_LABEL,
  PALTI_LABEL,
  paltiCreateSchema,
  paltiTotals,
  tfoProgramLabel,
  YARN_ZONE_CONFIG,
  type Paginated,
  type PaltiRun,
  type RoleKey,
  type YarnBox,
  type YarnBoxSticker,
} from '@rivoora/shared';
import { db, type DbOrTx } from '../db/client';
import { paltiRunInputs, paltiRuns, tfoPrograms, users, warpingQualities, yarnBoxes, yarnLots, yarnQualities } from '../db/schema';
import { badRequest, conflict, notFound } from '../lib/errors';
import { actor, addStock, nowIso, qualityNames, systemQualityId, takeStock } from './yarn-ledger';
import { lockBoxes, noBoxTarget } from './yarn-stock';
import { allocateBoxNos } from './yarn-tfo';

/**
 * Sprint 24 (CR-25) — Palti: leftover yarn re-wound by hand into a new spindle / box. Not linked to the warping remaining kg
 * (though a remaining row may be picked as an input like any stock). Inputs come from ANY zone and leave stock at save
 * (`palti_issue`); the output is ONE new box (`yarn_boxes.kind = 'palti'`, automatic number from the box counter + FY,
 * `program_id` = the system program) in the chosen zone (`palti_output`). Net less than the inputs is recorded as waste.
 * Palti boxes then behave like TFO boxes everywhere (transfer, withdraw, warping input, stock screens, stickers).
 */

/** The one system program Palti boxes point to (`yarn_boxes.program_id` is NOT NULL) — created by migration 0026. */
async function paltiProgramId(tx: DbOrTx): Promise<number> {
  const [row] = await tx.select({ id: tfoPrograms.id }).from(tfoPrograms).where(eq(tfoPrograms.status, 'system')).limit(1);
  if (!row) throw new Error('System program row for Palti boxes is missing — migration 0026 did not run');
  return row.id;
}

async function toRuns(tx: DbOrTx, rows: { id: number }[]): Promise<PaltiRun[]> {
  const ids = rows.map((r) => r.id);
  if (!ids.length) return [];
  const [runs, inputs] = await Promise.all([
    tx
      .select({
        id: paltiRuns.id,
        date: paltiRuns.runDate,
        inputG: paltiRuns.inputG,
        wasteG: paltiRuns.wasteG,
        note: paltiRuns.note,
        role: paltiRuns.role,
        userName: users.name,
        createdAt: paltiRuns.createdAt,
        boxId: yarnBoxes.id,
        boxNo: yarnBoxes.boxNo,
        fy: yarnBoxes.fy,
        zone: yarnBoxes.zone,
        status: yarnBoxes.status,
        rolls: yarnBoxes.rolls,
        grossG: yarnBoxes.grossG,
        netG: yarnBoxes.netG,
        wqId: yarnBoxes.warpingQualityId,
        wqName: warpingQualities.name,
      })
      .from(paltiRuns)
      .leftJoin(users, eq(users.id, paltiRuns.userId))
      .leftJoin(yarnBoxes, eq(yarnBoxes.id, paltiRuns.boxId))
      .leftJoin(warpingQualities, eq(warpingQualities.id, yarnBoxes.warpingQualityId))
      .where(inArray(paltiRuns.id, ids)),
    tx
      .select({
        runId: paltiRunInputs.runId,
        zone: paltiRunInputs.zone,
        item: paltiRunInputs.item,
        qtyG: paltiRunInputs.qtyG,
        boxNo: yarnBoxes.boxNo,
        boxFy: yarnBoxes.fy,
        lotNo: yarnLots.lotNo,
        qualityName: yarnQualities.name,
        wqName: warpingQualities.name,
        hasBox: paltiRunInputs.boxId,
      })
      .from(paltiRunInputs)
      .innerJoin(yarnQualities, eq(yarnQualities.id, paltiRunInputs.qualityId))
      .leftJoin(yarnBoxes, eq(yarnBoxes.id, paltiRunInputs.boxId))
      .leftJoin(yarnLots, eq(yarnLots.id, paltiRunInputs.lotId))
      .leftJoin(warpingQualities, eq(warpingQualities.id, paltiRunInputs.warpingQualityId))
      .where(inArray(paltiRunInputs.runId, ids))
      .orderBy(asc(paltiRunInputs.id)),
  ]);
  return ids.flatMap((id): PaltiRun[] => {
    const r = runs.find((x) => x.id === id);
    if (!r) return [];
    return [
      {
        id: r.id,
        date: r.date,
        box:
          r.boxId !== null
            ? { id: r.boxId, boxNo: r.boxNo!, fy: r.fy!, zone: r.zone!, status: r.status!, warpingQuality: { id: r.wqId!, name: r.wqName ?? '—' }, rolls: r.rolls!, grossG: r.grossG!, netG: r.netG! }
            : null,
        inputG: r.inputG,
        wasteG: r.wasteG,
        inputs: inputs
          .filter((i) => i.runId === id)
          .map((i) => ({
            zone: i.zone,
            qtyG: i.qtyG,
            label:
              i.hasBox !== null
                ? `Box ${boxNoWithFy(i.boxNo ?? '—', i.boxFy)}${i.wqName ? ` · ${i.wqName}` : ''}`
                : i.item === 'raw'
                  ? `${i.qualityName} · ${i.lotNo ? `lot ${i.lotNo}` : NO_LOT_LABEL}`
                  : `${i.wqName ?? i.qualityName} · ${NO_BOX_LABEL}`,
          })),
        note: r.note,
        createdAt: r.createdAt,
        createdBy: { role: r.role, userName: r.userName },
      },
    ];
  });
}

/** GET /yarn/palti — the Palti boxes made, newest first. */
export async function listPaltiRuns(q: { page: number; limit: number }): Promise<Paginated<PaltiRun>> {
  const [rows, [{ total }]] = await Promise.all([
    db.select({ id: paltiRuns.id }).from(paltiRuns).orderBy(desc(paltiRuns.id)).limit(q.limit).offset((q.page - 1) * q.limit),
    db.select({ total: count() }).from(paltiRuns),
  ]);
  return { items: await toRuns(db, rows), page: q.page, limit: q.limit, total, hasMore: q.page * q.limit < total };
}

/** POST /yarn/palti — inputs leave stock, one new numbered box comes in (one transaction). */
export async function createPaltiRun(role: RoleKey, input: unknown): Promise<PaltiRun> {
  const data = paltiCreateSchema.parse(input);
  return db.transaction(async (tx) => {
    const at = nowIso();
    const who = actor(role);
    const [run] = await tx.insert(paltiRuns).values({ runDate: data.date, inputG: 0, note: data.note, role, userId: who.userId, createdAt: at }).returning({ id: paltiRuns.id });
    const sysQ = await systemQualityId(tx);
    const common = { kind: 'palti_issue' as const, refType: 'palti' as const, refId: run.id, note: data.note, role, createdAt: at };
    const taken: number[] = [];
    for (const [i, inp] of data.inputs.entries()) {
      const field = `inputs.${i}.qtyKg`;
      if (inp.kind === 'box') {
        const [box] = await lockBoxes(tx, [inp.boxId], inp.zone);
        const qtyG = inp.qtyKg === null ? box.remainingG - box.reservedG : kgToGrams(inp.qtyKg);
        if (qtyG <= 0) throw conflict(`Box ${boxNoWithFy(box.boxNo, box.fy)} has nothing free — refresh and try again.`, field);
        await takeStock(tx, { ...common, zone: inp.zone, item: 'twisted', qualityId: sysQ, boxId: box.id, warpingQualityId: box.warpingQuality.id, qtyG, qualityName: `box ${box.boxNo}`, field });
        await tx.insert(paltiRunInputs).values({ runId: run.id, zone: inp.zone, item: 'twisted', qualityId: sysQ, qtyG, boxId: box.id, warpingQualityId: box.warpingQuality.id });
        if (box.remainingG - qtyG <= 0) await tx.update(yarnBoxes).set({ status: 'used', updatedAt: at }).where(eq(yarnBoxes.id, box.id));
        taken.push(qtyG);
      } else if (inp.kind === 'no_box') {
        const { name, ...target } = await noBoxTarget(tx, inp, `inputs.${i}.qualityId`);
        const qtyG = kgToGrams(inp.qtyKg);
        await takeStock(tx, { ...common, zone: inp.zone, item: 'twisted', ...target, qtyG, qualityName: name, field });
        await tx.insert(paltiRunInputs).values({ runId: run.id, zone: inp.zone, item: 'twisted', qualityId: target.qualityId, qtyG, warpingQualityId: 'warpingQualityId' in target ? target.warpingQualityId : null });
        taken.push(qtyG);
      } else {
        const names = await qualityNames(tx, [inp.qualityId], `inputs.${i}.qualityId`);
        const lotId = inp.lotId ?? null;
        if (lotId !== null) {
          const [lot] = await tx.select({ qualityId: yarnLots.qualityId }).from(yarnLots).where(eq(yarnLots.id, lotId));
          if (!lot || lot.qualityId !== inp.qualityId) throw badRequest('That lot is not a lot of this quality', `inputs.${i}.lotId`);
        }
        const qtyG = kgToGrams(inp.qtyKg);
        await takeStock(tx, { ...common, zone: inp.zone, item: 'raw', qualityId: inp.qualityId, lotId, qtyG, qualityName: names.get(inp.qualityId)!, field });
        await tx.insert(paltiRunInputs).values({ runId: run.id, zone: inp.zone, item: 'raw', qualityId: inp.qualityId, qtyG, lotId });
        taken.push(qtyG);
      }
    }

    const netG = kgToGrams(data.output.netKg);
    const totals = paltiTotals(taken, netG);
    if (totals.overG > 0) throw badRequest(`Net can’t be more than the inputs (${formatKg(totals.inputG)})`, 'output.netKg');
    const [wq] = await tx.select({ id: warpingQualities.id }).from(warpingQualities).where(and(eq(warpingQualities.id, data.output.warpingQualityId), eq(warpingQualities.isDeleted, false)));
    if (!wq) throw badRequest('That warping quality no longer exists — pick another', 'output.warpingQualityId');
    const [boxNo] = await allocateBoxNos(tx, 1);
    const [box] = await tx
      .insert(yarnBoxes)
      .values({
        boxNo,
        programId: await paltiProgramId(tx),
        lotId: null,
        warpingQualityId: wq.id,
        rolls: data.output.rolls ?? 0,
        grossG: data.output.grossKg !== null ? kgToGrams(data.output.grossKg) : netG,
        netG,
        avgG: 0,
        zone: data.output.zone,
        status: 'in_stock',
        kind: 'palti',
        paltiRunId: run.id,
        createdByUserId: who.userId,
      })
      .returning({ id: yarnBoxes.id });
    await addStock(tx, { zone: data.output.zone, item: 'twisted', qualityId: sysQ, boxId: box.id, warpingQualityId: wq.id, qtyG: netG, kind: 'palti_output', refType: 'palti', refId: run.id, note: data.note, role, createdAt: at });
    await tx.update(paltiRuns).set({ boxId: box.id, inputG: totals.inputG, wasteG: totals.wasteG }).where(eq(paltiRuns.id, run.id));
    return (await toRuns(tx, [run]))[0];
  });
}

/* ------------------------------------------------------------------ */
/* Sprint 24 (CR-18): box stickers + the QR target                      */
/* ------------------------------------------------------------------ */

/** GET /yarn/boxes/print?ids= — sticker data of TFO / Palti / remaining boxes (any status), in the order asked. */
export async function boxStickers(ids: number[]): Promise<YarnBoxSticker[]> {
  const rows = await db
    .select({
      id: yarnBoxes.id,
      boxNo: yarnBoxes.boxNo,
      fy: yarnBoxes.fy,
      kind: yarnBoxes.kind,
      quality: warpingQualities.name,
      lot: yarnLots.lotNo,
      grossG: yarnBoxes.grossG,
      netG: yarnBoxes.netG,
      rolls: yarnBoxes.rolls,
      date: yarnBoxes.createdAt,
      programId: yarnBoxes.programId,
      zone: yarnBoxes.zone,
    })
    .from(yarnBoxes)
    .innerJoin(warpingQualities, eq(warpingQualities.id, yarnBoxes.warpingQualityId))
    .leftJoin(yarnLots, eq(yarnLots.id, yarnBoxes.lotId))
    .where(inArray(yarnBoxes.id, ids));
  return ids.flatMap((id) => {
    const r = rows.find((x) => x.id === id);
    if (!r) return [];
    const { programId, ...rest } = r;
    return [{ ...rest, source: r.kind === 'palti' ? PALTI_LABEL : tfoProgramLabel(programId) }];
  });
}

/** GET /yarn/boxes/:id — one box (the sticker QR opens it in its zone's stock screen). */
export async function getBox(id: number): Promise<Pick<YarnBox, 'id' | 'boxNo' | 'fy' | 'zone' | 'status' | 'kind'> & { zoneLabel: string }> {
  const [b] = await db.select({ id: yarnBoxes.id, boxNo: yarnBoxes.boxNo, fy: yarnBoxes.fy, zone: yarnBoxes.zone, status: yarnBoxes.status, kind: yarnBoxes.kind }).from(yarnBoxes).where(eq(yarnBoxes.id, id));
  if (!b) throw notFound('Box');
  return { ...b, zoneLabel: YARN_ZONE_CONFIG[b.zone].label };
}
