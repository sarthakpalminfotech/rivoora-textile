import { and, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import {
  availableAfterReserved,
  beamLabel,
  kgToGrams,
  kindsForFilters,
  tfoSectionLabel,
  TRANSFER_ERROR_TEXT,
  validateTransfer,
  warpingJobLabel,
  YARN_ZONE_CONFIG,
  YARN_ZONES,
  yarnTransferSchema,
  yarnWithdrawSchema,
  type Beam,
  type BeamZone,
  type MoveKind,
  type Paginated,
  type RoleKey,
  type TfoSection,
  type YarnBox,
  type YarnItem,
  type YarnLotStock,
  type YarnMove,
  type YarnMovesQuery,
  type YarnRefType,
  type YarnSummary,
  type YarnZone,
  type YarnZoneData,
  type YarnZoneStock,
} from '@rivoora/shared';
import { db, type DbOrTx, type Tx } from '../db/client';
import {
  beamMoves,
  beams,
  tfoMachines,
  tfoPendingPrograms,
  tfoPrograms,
  users,
  warpingJobs,
  warpingPendingJobInputs,
  warpingPendingJobs,
  warpingQualities,
  yarnBoxes,
  yarnLots,
  yarnParties,
  yarnPos,
  yarnQualities,
  yarnReceipts,
  yarnStockMoves,
  yarnTransfers,
  yarnWithdrawals,
} from '../db/schema';
import { badRequest, conflict } from '../lib/errors';
import { actor, addStock, nowIso, qualityNames, systemQualityId, takeStock } from './yarn-ledger';

/**
 * Sprint 17 — Yarn inventory: the summary (KPIs + zone panels + recent movements), the zone screens (stock by quality,
 * beams), the movements ledger (yarn rows + beam actions in one list), transfers and Direct-consumption withdrawals.
 * Every read is a handful of aggregate queries (no per-zone / per-quality loops).
 */

/* ------------------------------------------------------------------ */
/* summary + zones                                                      */
/* ------------------------------------------------------------------ */

async function zoneStocks(tx: DbOrTx): Promise<YarnZoneStock[]> {
  const [moves, beamCounts] = await Promise.all([
    tx
      .select({ zone: yarnStockMoves.zone, item: yarnStockMoves.item, g: sql<number>`COALESCE(SUM(${yarnStockMoves.qtyG}), 0)` })
      .from(yarnStockMoves)
      .groupBy(yarnStockMoves.zone, yarnStockMoves.item),
    tx
      .select({ zone: beams.zone, n: sql<number>`COUNT(*)` })
      .from(beams)
      .where(eq(beams.status, 'in_stock'))
      .groupBy(beams.zone),
  ]);
  return YARN_ZONES.map((zone) => ({
    zone,
    rawG: Number(moves.find((m) => m.zone === zone && m.item === 'raw')?.g ?? 0),
    twistedG: Number(moves.find((m) => m.zone === zone && m.item === 'twisted')?.g ?? 0),
    beams: Number(beamCounts.find((b) => b.zone === zone)?.n ?? 0),
  }));
}

export async function yarnSummary(): Promise<YarnSummary> {
  const [zones, [tfo], [machines], [jobs], recent] = await Promise.all([
    zoneStocks(db),
    db.select({ n: sql<number>`COUNT(*)` }).from(tfoPrograms).where(eq(tfoPrograms.status, 'running')),
    db.select({ n: sql<number>`COUNT(*)` }).from(tfoMachines).where(and(eq(tfoMachines.isDeleted, false), eq(tfoMachines.isActive, true))),
    db.select({ n: sql<number>`COUNT(*)` }).from(warpingJobs).where(eq(warpingJobs.status, 'in_process')),
    listMoves({ page: 1, limit: 10, kind: [], quality: [] }),
  ]);
  return {
    totals: {
      rawG: zones.reduce((s, z) => s + z.rawG, 0),
      twistedG: zones.reduce((s, z) => s + z.twistedG, 0),
      beams: zones.reduce((s, z) => s + z.beams, 0),
    },
    zones,
    tfo: { runningSections: Number(tfo?.n ?? 0), activeMachines: Number(machines?.n ?? 0) },
    warping: { inProcess: Number(jobs?.n ?? 0) },
    recent: recent.items,
  };
}

const beamColumns = {
  id: beams.id,
  beamNo: beams.beamNo,
  zone: beams.zone,
  qualityId: beams.qualityId,
  qualityName: yarnQualities.name,
  taar: beams.taar,
  panna: beams.panna,
  meters: beams.meters,
  status: beams.status,
  warpingJobId: beams.warpingJobId,
  warpingJobNo: warpingJobs.jobNo,
  createdAt: beams.createdAt,
  consumedAt: beams.consumedAt,
  consumedNote: beams.consumedNote,
};

type BeamRow = Omit<Beam, 'quality'> & { qualityId: number; qualityName: string };
const toBeam = ({ qualityId, qualityName, ...r }: BeamRow): Beam => ({ ...r, quality: { id: qualityId, name: qualityName } });

export async function listBeams(q: { zone?: BeamZone; status?: Beam['status'] }): Promise<Beam[]> {
  const rows = await db
    .select(beamColumns)
    .from(beams)
    .innerJoin(yarnQualities, eq(yarnQualities.id, beams.qualityId))
    .leftJoin(warpingJobs, eq(warpingJobs.id, beams.warpingJobId))
    .where(and(q.zone ? eq(beams.zone, q.zone) : undefined, eq(beams.status, q.status ?? 'in_stock')))
    .orderBy(desc(beams.beamNo))
    .limit(500);
  return rows.map(toBeam);
}

export async function yarnZone(zone: YarnZone): Promise<YarnZoneData> {
  const [stocks, qualities, twistedByWq, boxCounts, zoneBeams] = await Promise.all([
    zoneStocks(db),
    db
      .select({
        id: yarnQualities.id,
        name: yarnQualities.name,
        denier: yarnQualities.denier,
        filament: yarnQualities.filament,
        rawG: sql<number>`COALESCE(SUM(CASE WHEN ${yarnStockMoves.item} = 'raw' THEN ${yarnStockMoves.qtyG} END), 0)`,
        twistedG: sql<number>`COALESCE(SUM(CASE WHEN ${yarnStockMoves.item} = 'twisted' THEN ${yarnStockMoves.qtyG} END), 0)`,
      })
      .from(yarnStockMoves)
      .innerJoin(yarnQualities, eq(yarnQualities.id, yarnStockMoves.qualityId))
      // Sprint 20: twisted rows under a warping quality carry the system yarn quality — listed by warping quality below.
      .where(and(eq(yarnStockMoves.zone, zone), eq(yarnQualities.isSystem, false)))
      .groupBy(yarnQualities.id)
      .orderBy(sql`lower(${yarnQualities.name})`),
    db
      .select({ id: warpingQualities.id, name: warpingQualities.name, g: sql<number>`COALESCE(SUM(${yarnStockMoves.qtyG}), 0)` })
      .from(yarnStockMoves)
      .innerJoin(warpingQualities, eq(warpingQualities.id, yarnStockMoves.warpingQualityId))
      .where(and(eq(yarnStockMoves.zone, zone), eq(yarnStockMoves.item, 'twisted')))
      .groupBy(warpingQualities.id)
      .orderBy(sql`lower(${warpingQualities.name})`),
    db
      .select({ id: yarnBoxes.warpingQualityId, n: sql<number>`COUNT(*)` })
      .from(yarnBoxes)
      .where(and(eq(yarnBoxes.zone, zone), eq(yarnBoxes.status, 'in_stock')))
      .groupBy(yarnBoxes.warpingQualityId),
    YARN_ZONE_CONFIG[zone].hasBeams ? listBeams({ zone: zone as BeamZone }) : Promise.resolve([]),
  ]);
  return {
    zone,
    stock: stocks.find((s) => s.zone === zone)!,
    qualities: qualities
      .map((q) => ({ quality: { id: q.id, name: q.name, denier: q.denier, filament: q.filament }, rawG: Number(q.rawG), twistedG: Number(q.twistedG) }))
      .filter((q) => q.rawG !== 0 || q.twistedG !== 0),
    warpingQualities: twistedByWq
      .map((w) => ({ quality: { id: w.id, name: w.name }, twistedG: Number(w.g), boxes: Number(boxCounts.find((b) => b.id === w.id)?.n ?? 0) }))
      .filter((w) => w.twistedG !== 0 || w.boxes > 0),
    beams: zoneBeams,
  };
}

/* ------------------------------------------------------------------ */
/* Sprint 20: lots + boxes                                              */
/* ------------------------------------------------------------------ */

/** GET /yarn/boxes/check — the live "box no. is free" check (unique across ALL boxes, any case). */
export async function checkBoxNo(boxNo: string): Promise<{ available: boolean }> {
  const [row] = await db
    .select({ id: yarnBoxes.id })
    .from(yarnBoxes)
    .where(sql`lower(${yarnBoxes.boxNo}) = lower(${boxNo.trim()})`)
    .limit(1);
  return { available: !row };
}

/** GET /yarn/lots/check — the live "lot no. is free for this party" check (lots are never edited or deleted). */
export async function checkLotNo(partyId: number, lotNo: string): Promise<{ available: boolean }> {
  const [row] = await db
    .select({ id: yarnLots.id })
    .from(yarnLots)
    .where(and(eq(yarnLots.partyId, partyId), sql`lower(${yarnLots.lotNo}) = lower(${lotNo})`))
    .limit(1);
  return { available: !row };
}

/** Reserved raw grams per lot (null = "No lot") of one quality in a zone — pending programs (TFO) / jobs (Warping). */
async function reservedByLot(tx: DbOrTx, zone: YarnZone, qualityId: number): Promise<Map<number | null, number>> {
  let rows: { lotId: number | null; g: number }[] = [];
  if (zone === 'tfo') {
    rows = await tx
      .select({ lotId: tfoPendingPrograms.lotId, g: sql<number>`COALESCE(SUM(${tfoPendingPrograms.rawG}), 0)` })
      .from(tfoPendingPrograms)
      .where(and(eq(tfoPendingPrograms.status, 'pending'), eq(tfoPendingPrograms.rawQualityId, qualityId)))
      .groupBy(tfoPendingPrograms.lotId);
  } else if (zone === 'warping') {
    rows = await tx
      .select({ lotId: warpingPendingJobInputs.lotId, g: sql<number>`COALESCE(SUM(${warpingPendingJobInputs.qtyG}), 0)` })
      .from(warpingPendingJobInputs)
      .innerJoin(warpingPendingJobs, eq(warpingPendingJobs.id, warpingPendingJobInputs.jobId))
      .where(and(eq(warpingPendingJobs.status, 'pending'), eq(warpingPendingJobInputs.item, 'raw'), eq(warpingPendingJobInputs.qualityId, qualityId)))
      .groupBy(warpingPendingJobInputs.lotId);
  }
  return new Map(rows.map((r) => [r.lotId, Number(r.g)]));
}

/** GET /yarn/lots — raw lots (+ "No lot") with stock of one quality in one zone, for the lot picker (available = balance − reserved). */
export async function listLotStock(zone: YarnZone, qualityId: number): Promise<YarnLotStock[]> {
  const [rows, reserved] = await Promise.all([
    db
      .select({
        lotId: yarnStockMoves.lotId,
        g: sql<number>`COALESCE(SUM(${yarnStockMoves.qtyG}), 0)`,
      })
      .from(yarnStockMoves)
      .where(and(eq(yarnStockMoves.zone, zone), eq(yarnStockMoves.item, 'raw'), eq(yarnStockMoves.qualityId, qualityId)))
      .groupBy(yarnStockMoves.lotId),
    reservedByLot(db, zone, qualityId),
  ]);
  const lotIds = rows.map((r) => r.lotId).filter((id): id is number => id !== null);
  const lots = lotIds.length
    ? await db
        .select({ id: yarnLots.id, lotNo: yarnLots.lotNo, partyName: yarnParties.name })
        .from(yarnLots)
        .innerJoin(yarnParties, eq(yarnParties.id, yarnLots.partyId))
        .where(inArray(yarnLots.id, lotIds))
    : [];
  const byId = new Map(lots.map((l) => [l.id, l]));
  return rows
    .map((r): YarnLotStock => {
      const lot = r.lotId === null ? null : byId.get(r.lotId);
      const reservedG = reserved.get(r.lotId) ?? 0;
      return { id: r.lotId, lotNo: lot?.lotNo ?? null, partyName: lot?.partyName ?? null, availableG: availableAfterReserved(Number(r.g), reservedG), reservedG };
    })
    .filter((l) => l.availableG > 0 || l.reservedG > 0)
    .sort((a, b) => (a.id === null ? -1 : b.id === null ? 1 : (a.lotNo ?? '').localeCompare(b.lotNo ?? '')));
}

const boxColumns = {
  id: yarnBoxes.id,
  boxNo: yarnBoxes.boxNo,
  zone: yarnBoxes.zone,
  status: yarnBoxes.status,
  warpingQualityId: yarnBoxes.warpingQualityId,
  warpingQualityName: warpingQualities.name,
  lotId: yarnBoxes.lotId,
  rolls: yarnBoxes.rolls,
  grossG: yarnBoxes.grossG,
  netG: yarnBoxes.netG,
  programId: yarnBoxes.programId,
  createdAt: yarnBoxes.createdAt,
};

type BoxRow = {
  id: number;
  boxNo: string;
  zone: YarnZone;
  status: YarnBox['status'];
  warpingQualityId: number;
  warpingQualityName: string;
  lotId: number | null;
  rolls: number;
  grossG: number;
  netG: number;
  programId: number;
  createdAt: string;
};

async function toBoxes(tx: DbOrTx, rows: BoxRow[]): Promise<YarnBox[]> {
  const lotIds = [...new Set(rows.map((r) => r.lotId).filter((id): id is number => id !== null))];
  const lots = lotIds.length
    ? await tx
        .select({ id: yarnLots.id, lotNo: yarnLots.lotNo, partyName: yarnParties.name })
        .from(yarnLots)
        .innerJoin(yarnParties, eq(yarnParties.id, yarnLots.partyId))
        .where(inArray(yarnLots.id, lotIds))
    : [];
  const lotById = new Map(lots.map((l) => [l.id, l]));
  const ids = rows.map((r) => r.id);
  const remaining = ids.length
    ? await tx
        .select({ boxId: yarnStockMoves.boxId, g: sql<number>`COALESCE(SUM(${yarnStockMoves.qtyG}), 0)` })
        .from(yarnStockMoves)
        .where(inArray(yarnStockMoves.boxId, ids))
        .groupBy(yarnStockMoves.boxId)
    : [];
  const remById = new Map(remaining.map((r) => [r.boxId, Number(r.g)]));
  return rows.map((r) => {
    const lot = r.lotId === null ? null : lotById.get(r.lotId);
    return {
      id: r.id,
      boxNo: r.boxNo,
      zone: r.zone,
      status: r.status,
      warpingQuality: { id: r.warpingQualityId, name: r.warpingQualityName },
      lot: lot ? { id: lot.id, lotNo: lot.lotNo, partyName: lot.partyName } : null,
      rolls: r.rolls,
      grossG: r.grossG,
      netG: r.netG,
      remainingG: remById.get(r.id) ?? 0,
      programId: r.programId,
      createdAt: r.createdAt,
    };
  });
}

function listBoxesRaw(tx: DbOrTx, where: SQL | undefined) {
  return tx
    .select(boxColumns)
    .from(yarnBoxes)
    .innerJoin(warpingQualities, eq(warpingQualities.id, yarnBoxes.warpingQualityId))
    .leftJoin(yarnLots, eq(yarnLots.id, yarnBoxes.lotId))
    .where(where)
    .orderBy(desc(yarnBoxes.id))
    .limit(500);
}

/** GET /yarn/boxes — box pickers and zone stock screens. */
export async function listBoxStock(q: { zone?: YarnZone; status?: YarnBox['status']; search?: string }): Promise<YarnBox[]> {
  const conds: (SQL | undefined)[] = [q.zone ? eq(yarnBoxes.zone, q.zone) : undefined, eq(yarnBoxes.status, q.status ?? 'in_stock')];
  if (q.search) {
    const p = `%${q.search.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    conds.push(or(sql`${yarnBoxes.boxNo} LIKE ${p} ESCAPE '\\'`, sql`${yarnLots.lotNo} LIKE ${p} ESCAPE '\\'`));
  }
  const rows = await listBoxesRaw(db, and(...conds));
  return toBoxes(db, rows);
}

/** In-stock boxes of the zone among `ids`, with their remaining kg; 409 when any of them is not (any more) there. */
async function lockBoxes(tx: Tx, ids: number[], zone: YarnZone): Promise<YarnBox[]> {
  const unique = [...new Set(ids)];
  const rows = await listBoxesRaw(tx, inArray(yarnBoxes.id, unique));
  const boxes = await toBoxes(tx, rows);
  const bad = unique.filter((id) => {
    const b = boxes.find((r) => r.id === id);
    return !b || b.status !== 'in_stock' || b.zone !== zone;
  });
  if (bad.length) {
    const nos = boxes.filter((b) => bad.includes(b.id)).map((b) => b.boxNo);
    throw conflict(`${nos.length ? nos.join(', ') : 'A selected box'} ${nos.length === 1 || !nos.length ? 'is' : 'are'} no longer in ${YARN_ZONE_CONFIG[zone].label} — refresh and try again.`, 'boxIds');
  }
  return boxes.filter((b) => unique.includes(b.id));
}

/* ------------------------------------------------------------------ */
/* movements                                                            */
/* ------------------------------------------------------------------ */

interface MoveRow {
  source: 'yarn' | 'beam';
  gkey: string;
  zone: YarnZone;
  kind: MoveKind;
  item: YarnItem | null;
  quality_id: number | null;
  qty_g: number | null;
  beams: number | null;
  beam_nos: string | null;
  ref_type: YarnRefType | null;
  ref_id: number | null;
  note: string | null;
  role: string | null;
  user_id: number | null;
  created_at: string;
  lot_id: number | null;
  box_id: number | null;
}

const inList = (ids: (string | number)[]) => sql.join(ids.map((v) => sql`${v}`), sql`, `);

/** Yarn rows one by one, beam rows grouped per action (ref) + kind + zone ("3 beams"), newest first. */
export async function listMoves(q: Pick<YarnMovesQuery, 'page' | 'limit' | 'zone' | 'kind' | 'quality' | 'from' | 'to' | 'search'>): Promise<Paginated<YarnMove>> {
  const kinds = kindsForFilters(q.kind);
  const yarnConds: SQL[] = [];
  const beamConds: SQL[] = [];
  if (q.zone) {
    yarnConds.push(sql`m.zone = ${q.zone}`);
    beamConds.push(sql`bm.zone = ${q.zone}`);
  }
  if (kinds.length) {
    yarnConds.push(sql`m.kind IN (${inList(kinds)})`);
    beamConds.push(sql`bm.kind IN (${inList(kinds)})`);
  }
  if (q.quality.length) {
    yarnConds.push(sql`m.quality_id IN (${inList(q.quality)})`);
    beamConds.push(sql`b.quality_id IN (${inList(q.quality)})`);
  }
  if (q.from) {
    yarnConds.push(sql`substr(m.created_at, 1, 10) >= ${q.from}`);
    beamConds.push(sql`substr(bm.created_at, 1, 10) >= ${q.from}`);
  }
  if (q.to) {
    yarnConds.push(sql`substr(m.created_at, 1, 10) <= ${q.to}`);
    beamConds.push(sql`substr(bm.created_at, 1, 10) <= ${q.to}`);
  }
  if (q.search) {
    const p = `%${q.search.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    yarnConds.push(sql`(
      EXISTS (SELECT 1 FROM yarn_lots yl WHERE yl.id = m.lot_id AND yl.lot_no LIKE ${p} ESCAPE '\\')
      OR EXISTS (SELECT 1 FROM yarn_boxes yb WHERE yb.id = m.box_id AND yb.box_no LIKE ${p} ESCAPE '\\')
    )`);
    beamConds.push(sql`0 = 1`); // beams carry no lot / box
  }
  const where = (conds: SQL[]) => (conds.length ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``);
  const union = sql`
    SELECT 'yarn' AS source, 'y-' || m.id AS gkey, m.zone AS zone, m.kind AS kind, m.item AS item, m.quality_id AS quality_id,
           m.qty_g AS qty_g, NULL AS beams, NULL AS beam_nos, m.ref_type AS ref_type, m.ref_id AS ref_id, m.note AS note,
           m.role AS role, m.user_id AS user_id, m.created_at AS created_at, m.id AS sort_id, m.lot_id AS lot_id, m.box_id AS box_id
    FROM yarn_stock_moves m ${where(yarnConds)}
    UNION ALL
    SELECT 'beam', 'b-' || COALESCE(bm.ref_type, '') || '-' || COALESCE(bm.ref_id, MIN(bm.id)) || '-' || bm.kind || '-' || bm.zone,
           bm.zone, bm.kind, NULL, CASE WHEN COUNT(DISTINCT b.quality_id) = 1 THEN MIN(b.quality_id) END, NULL,
           COUNT(*), group_concat(b.beam_no), bm.ref_type, bm.ref_id, MAX(bm.note), MAX(bm.role), MAX(bm.user_id),
           MAX(bm.created_at), MAX(bm.id), NULL, NULL
    FROM beam_moves bm JOIN beams b ON b.id = bm.beam_id ${where(beamConds)}
    GROUP BY bm.ref_type, bm.ref_id, bm.kind, bm.zone`;
  const [rows, [{ total }]] = await Promise.all([
    db.all<MoveRow>(sql`SELECT * FROM (${union}) x ORDER BY x.created_at DESC, x.sort_id DESC LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`),
    db.all<{ total: number }>(sql`SELECT COUNT(*) AS total FROM (${union}) x`),
  ]);
  const items = await decorateMoves(rows);
  return { items, page: q.page, limit: q.limit, total: Number(total), hasMore: q.page * q.limit < Number(total) };
}

/** Quality names, user names, lot / box info and the "what" line of each row — one query per kind, not per row. */
async function decorateMoves(rows: MoveRow[]): Promise<YarnMove[]> {
  const idsOf = (type: YarnRefType) => [...new Set(rows.filter((r) => r.ref_type === type && r.ref_id).map((r) => Number(r.ref_id)))];
  const qualityIds = [...new Set(rows.map((r) => r.quality_id).filter((v): v is number => v !== null))];
  const userIds = [...new Set(rows.map((r) => r.user_id).filter((v): v is number => v !== null))];
  const lotIds = [...new Set(rows.map((r) => r.lot_id).filter((v): v is number => v !== null))];
  const boxIds = [...new Set(rows.map((r) => r.box_id).filter((v): v is number => v !== null))];
  const [qualities, people, lots, boxRows, receipts, transfers, programs, jobs] = await Promise.all([
    qualityIds.length ? db.select({ id: yarnQualities.id, name: yarnQualities.name }).from(yarnQualities).where(inArray(yarnQualities.id, qualityIds)) : [],
    userIds.length ? db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds)) : [],
    lotIds.length ? db.select({ id: yarnLots.id, lotNo: yarnLots.lotNo }).from(yarnLots).where(inArray(yarnLots.id, lotIds)) : [],
    boxIds.length
      ? db
          .select({ id: yarnBoxes.id, boxNo: yarnBoxes.boxNo, warpingQualityId: yarnBoxes.warpingQualityId, warpingQualityName: warpingQualities.name })
          .from(yarnBoxes)
          .innerJoin(warpingQualities, eq(warpingQualities.id, yarnBoxes.warpingQualityId))
          .where(inArray(yarnBoxes.id, boxIds))
      : [],
    idsOf('receipt').length
      ? db
          .select({ id: yarnReceipts.id, challanNo: yarnReceipts.challanNo, poNo: yarnPos.poNo })
          .from(yarnReceipts)
          .innerJoin(yarnPos, eq(yarnPos.id, yarnReceipts.poId))
          .where(inArray(yarnReceipts.id, idsOf('receipt')))
      : [],
    idsOf('transfer').length
      ? db.select({ id: yarnTransfers.id, from: yarnTransfers.fromZone, to: yarnTransfers.toZone }).from(yarnTransfers).where(inArray(yarnTransfers.id, idsOf('transfer')))
      : [],
    idsOf('program').length
      ? db
          .select({ id: tfoPrograms.id, section: tfoPrograms.section, machineNo: tfoMachines.machineNo })
          .from(tfoPrograms)
          .innerJoin(tfoMachines, eq(tfoMachines.id, tfoPrograms.machineId))
          .where(inArray(tfoPrograms.id, idsOf('program')))
      : [],
    idsOf('job').length ? db.select({ id: warpingJobs.id, jobNo: warpingJobs.jobNo }).from(warpingJobs).where(inArray(warpingJobs.id, idsOf('job'))) : [],
  ]);
  const qName = new Map(qualities.map((q) => [q.id, q.name]));
  const uName = new Map(people.map((u) => [u.id, u.name]));
  const lotById = new Map(lots.map((l) => [l.id, l]));
  const boxById = new Map(boxRows.map((b) => [b.id, b]));
  const context = (r: MoveRow): string | null => {
    const id = Number(r.ref_id);
    switch (r.ref_type) {
      case 'receipt': {
        const x = receipts.find((v) => v.id === id);
        return x ? `PO ${x.poNo} · challan ${x.challanNo}` : null;
      }
      case 'transfer': {
        const x = transfers.find((v) => v.id === id);
        if (!x) return null;
        return r.kind === 'transfer_in' ? `From ${YARN_ZONE_CONFIG[x.from].label}` : `To ${YARN_ZONE_CONFIG[x.to].label}`;
      }
      case 'program': {
        const x = programs.find((v) => v.id === id);
        return x ? `Machine ${tfoSectionLabel(x.machineNo, x.section as TfoSection)}` : null;
      }
      case 'job': {
        const x = jobs.find((v) => v.id === id);
        return x ? warpingJobLabel(x.jobNo) : null;
      }
      default:
        return null;
    }
  };
  return rows.map((r) => {
    const beamNos = r.beam_nos ? r.beam_nos.split(',').map(Number).sort((a, b) => a - b) : [];
    const beamSign = r.kind === 'transfer_out' || r.kind === 'consumed' ? -1 : 1;
    const ctx = context(r);
    const box = r.box_id !== null ? boxById.get(r.box_id) : undefined;
    const lot = r.lot_id !== null ? lotById.get(r.lot_id) : undefined;
    // Box-tied twisted rows carry the sentinel quality_id — show the box's real (warping) quality instead.
    const quality = box
      ? { id: box.warpingQualityId, name: box.warpingQualityName }
      : r.quality_id !== null
        ? { id: r.quality_id, name: qName.get(r.quality_id) ?? '—' }
        : null;
    return {
      key: r.gkey,
      source: r.source,
      zone: r.zone,
      kind: r.kind,
      item: r.item,
      quality,
      qtyG: r.qty_g === null ? null : Number(r.qty_g),
      beams: r.source === 'beam' ? beamSign * Number(r.beams ?? 0) : null,
      beamNos,
      refType: r.ref_type,
      refId: r.ref_id === null ? null : Number(r.ref_id),
      context: r.source === 'beam' && beamNos.length ? [beamNos.slice(0, 4).map(beamLabel).join(', ') + (beamNos.length > 4 ? ` +${beamNos.length - 4}` : ''), ctx].filter(Boolean).join(' · ') : ctx,
      note: r.note,
      role: r.role,
      userName: r.user_id !== null ? (uName.get(r.user_id) ?? null) : null,
      createdAt: r.created_at,
      lot: lot ? { id: lot.id, lotNo: lot.lotNo } : null,
      box: box ? { id: box.id, boxNo: box.boxNo } : null,
    };
  });
}

/* ------------------------------------------------------------------ */
/* beams helper (transfer / consume)                                   */
/* ------------------------------------------------------------------ */

/** In-stock beams of the zone among `ids`; 409 when any of them is not (any more) there. */
async function lockBeams(tx: Tx, ids: number[], zone: YarnZone): Promise<{ id: number; beamNo: number }[]> {
  const unique = [...new Set(ids)];
  const rows = await tx
    .select({ id: beams.id, beamNo: beams.beamNo, zone: beams.zone, status: beams.status })
    .from(beams)
    .where(inArray(beams.id, unique));
  const bad = unique.filter((id) => {
    const b = rows.find((r) => r.id === id);
    return !b || b.status !== 'in_stock' || b.zone !== zone;
  });
  if (bad.length) {
    const nos = rows.filter((r) => bad.includes(r.id)).map((r) => beamLabel(r.beamNo));
    throw conflict(`${nos.length ? nos.join(', ') : 'A selected beam'} ${nos.length === 1 || !nos.length ? 'is' : 'are'} no longer in ${YARN_ZONE_CONFIG[zone].label} — refresh and try again.`, 'beamIds');
  }
  return rows.map((r) => ({ id: r.id, beamNo: r.beamNo }));
}

/* ------------------------------------------------------------------ */
/* transfer                                                             */
/* ------------------------------------------------------------------ */

/**
 * POST /yarn/transfers — one transaction: the transfer row, then (depending on `what`) a ledger `transfer_out` +
 * `transfer_in` pair for raw yarn (lot-scoped balance check) or twisted boxes (whole boxes, their zone updated too)
 * or "No box" twisted stock, or the beams' zone + `beam_moves` out / in rows (Direct consumption ↔ Warping only).
 */
export async function createTransfer(role: RoleKey, input: unknown): Promise<{ transferId: number }> {
  const data = yarnTransferSchema.parse(input);
  if (data.from === data.to) throw badRequest(TRANSFER_ERROR_TEXT.same_zone, 'to');
  if (data.what === 'beams') {
    const err = validateTransfer({ from: data.from, to: data.to, what: 'beams', beamIds: data.beamIds });
    if (err) throw badRequest(TRANSFER_ERROR_TEXT[err], err === 'no_beams' ? 'beamIds' : 'to');
  }
  return db.transaction(async (tx) => {
    const [t] = await tx
      .insert(yarnTransfers)
      .values({ fromZone: data.from, toZone: data.to, what: data.what, note: data.note, ...actor(role) })
      .returning({ id: yarnTransfers.id, createdAt: yarnTransfers.createdAt });
    if (data.what === 'beams') {
      const list = await lockBeams(tx, data.beamIds, data.from);
      const ids = list.map((b) => b.id);
      const moved = await tx
        .update(beams)
        .set({ zone: data.to })
        .where(and(inArray(beams.id, ids), eq(beams.zone, data.from), eq(beams.status, 'in_stock')))
        .returning({ id: beams.id });
      if (moved.length !== ids.length) throw conflict('A selected beam changed meanwhile — refresh and try again.', 'beamIds');
      const who = actor(role);
      await tx.insert(beamMoves).values(
        ids.flatMap((beamId) => [
          { beamId, kind: 'transfer_out' as const, zone: data.from, refType: 'transfer' as const, refId: t.id, note: data.note, ...who, createdAt: t.createdAt },
          { beamId, kind: 'transfer_in' as const, zone: data.to, refType: 'transfer' as const, refId: t.id, note: data.note, ...who, createdAt: t.createdAt },
        ]),
      );
    } else if (data.what === 'raw') {
      const names = await qualityNames(tx, [data.qualityId]);
      const qtyG = kgToGrams(data.qtyKg);
      const common = { item: 'raw' as const, qualityId: data.qualityId, qtyG, refType: 'transfer' as const, refId: t.id, note: data.note, role, createdAt: t.createdAt, lotId: data.lotId ?? null };
      await takeStock(tx, { ...common, zone: data.from, kind: 'transfer_out', qualityName: names.get(data.qualityId)! });
      await addStock(tx, { ...common, zone: data.to, kind: 'transfer_in' });
    } else if (data.boxIds.length) {
      const sysQ = await systemQualityId(tx);
      const list = await lockBoxes(tx, data.boxIds, data.from);
      const ids = list.map((b) => b.id);
      const moved = await tx
        .update(yarnBoxes)
        .set({ zone: data.to })
        .where(and(inArray(yarnBoxes.id, ids), eq(yarnBoxes.zone, data.from), eq(yarnBoxes.status, 'in_stock')))
        .returning({ id: yarnBoxes.id });
      if (moved.length !== ids.length) throw conflict('A selected box changed meanwhile — refresh and try again.', 'boxIds');
      for (const box of list) {
        const common = {
          item: 'twisted' as const,
          qualityId: sysQ,
          boxId: box.id,
          warpingQualityId: box.warpingQuality.id,
          qtyG: box.remainingG,
          refType: 'transfer' as const,
          refId: t.id,
          note: data.note,
          role,
          createdAt: t.createdAt,
        };
        await takeStock(tx, { ...common, zone: data.from, kind: 'transfer_out', qualityName: box.warpingQuality.name });
        await addStock(tx, { ...common, zone: data.to, kind: 'transfer_in' });
      }
    } else {
      const noBox = data.noBox!;
      const names = await qualityNames(tx, [noBox.qualityId]);
      const qtyG = kgToGrams(noBox.qtyKg);
      const common = {
        item: 'twisted' as const,
        qualityId: noBox.qualityId,
        boxId: null,
        qtyG,
        refType: 'transfer' as const,
        refId: t.id,
        note: data.note,
        role,
        createdAt: t.createdAt,
      };
      await takeStock(tx, { ...common, zone: data.from, kind: 'transfer_out', qualityName: names.get(noBox.qualityId)! });
      await addStock(tx, { ...common, zone: data.to, kind: 'transfer_in' });
    }
    return { transferId: t.id };
  });
}

/* ------------------------------------------------------------------ */
/* withdraw (Direct consumption)                                        */
/* ------------------------------------------------------------------ */

/**
 * POST /yarn/withdrawals — Direct consumption only: yarn used (ledger `withdraw`, balance checked) or beams consumed
 * (status Consumed with date / by / note, a `consumed` beam move). No loom link.
 */
export async function createWithdrawal(role: RoleKey, input: unknown): Promise<{ withdrawalId: number }> {
  const data = yarnWithdrawSchema.parse(input);
  if (data.what === 'twisted' && data.boxes.length) {
    const seen = new Set<number>();
    for (const b of data.boxes) {
      if (seen.has(b.boxId)) throw badRequest('A box appears twice', 'boxes');
      seen.add(b.boxId);
    }
  }
  return db.transaction(async (tx) => {
    const [w] = await tx
      .insert(yarnWithdrawals)
      .values({ zone: data.zone, what: data.what, note: data.note, ...actor(role) })
      .returning({ id: yarnWithdrawals.id, createdAt: yarnWithdrawals.createdAt });
    if (data.what === 'beams') {
      const list = await lockBeams(tx, data.beamIds, data.zone);
      const ids = list.map((b) => b.id);
      const who = actor(role);
      const done = await tx
        .update(beams)
        .set({ status: 'consumed', consumedAt: nowIso(), consumedByUserId: who.userId, consumedNote: data.note })
        .where(and(inArray(beams.id, ids), eq(beams.zone, data.zone), eq(beams.status, 'in_stock')))
        .returning({ id: beams.id });
      if (done.length !== ids.length) throw conflict('A selected beam changed meanwhile — refresh and try again.', 'beamIds');
      await tx.insert(beamMoves).values(
        ids.map((beamId) => ({ beamId, kind: 'consumed' as const, zone: data.zone, refType: 'withdrawal' as const, refId: w.id, note: data.note, ...who, createdAt: w.createdAt })),
      );
    } else if (data.what === 'raw') {
      const names = await qualityNames(tx, [data.qualityId]);
      await takeStock(tx, {
        zone: data.zone,
        item: 'raw',
        qualityId: data.qualityId,
        lotId: data.lotId ?? null,
        qtyG: kgToGrams(data.qtyKg),
        kind: 'withdraw',
        refType: 'withdrawal',
        refId: w.id,
        note: data.note,
        role,
        createdAt: w.createdAt,
        qualityName: names.get(data.qualityId)!,
      });
    } else if (data.boxes.length) {
      const sysQ = await systemQualityId(tx);
      const list = await lockBoxes(tx, data.boxes.map((b) => b.boxId), data.zone);
      const byId = new Map(list.map((b) => [b.id, b]));
      const toMarkUsed: number[] = [];
      for (const b of data.boxes) {
        const box = byId.get(b.boxId)!;
        const qtyG = kgToGrams(b.qtyKg);
        await takeStock(tx, {
          zone: data.zone,
          item: 'twisted',
          qualityId: sysQ,
          boxId: box.id,
          warpingQualityId: box.warpingQuality.id,
          qtyG,
          kind: 'withdraw',
          refType: 'withdrawal',
          refId: w.id,
          note: data.note,
          role,
          createdAt: w.createdAt,
          qualityName: box.warpingQuality.name,
          field: 'boxes',
        });
        if (box.remainingG - qtyG <= 0) toMarkUsed.push(box.id);
      }
      if (toMarkUsed.length) await tx.update(yarnBoxes).set({ status: 'used' }).where(inArray(yarnBoxes.id, toMarkUsed));
    } else {
      const noBox = data.noBox!;
      const names = await qualityNames(tx, [noBox.qualityId]);
      await takeStock(tx, {
        zone: data.zone,
        item: 'twisted',
        qualityId: noBox.qualityId,
        boxId: null,
        qtyG: kgToGrams(noBox.qtyKg),
        kind: 'withdraw',
        refType: 'withdrawal',
        refId: w.id,
        note: data.note,
        role,
        createdAt: w.createdAt,
        qualityName: names.get(noBox.qualityId)!,
      });
    }
    return { withdrawalId: w.id };
  });
}
