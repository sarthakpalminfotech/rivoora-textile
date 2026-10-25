import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import {
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
  type YarnItem,
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
  tfoPrograms,
  users,
  warpingJobs,
  yarnPos,
  yarnQualities,
  yarnReceipts,
  yarnStockMoves,
  yarnTransfers,
  yarnWithdrawals,
} from '../db/schema';
import { badRequest, conflict } from '../lib/errors';
import { actor, addStock, nowIso, qualityNames, takeStock } from './yarn-ledger';

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
  const [stocks, qualities, zoneBeams] = await Promise.all([
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
      .where(eq(yarnStockMoves.zone, zone))
      .groupBy(yarnQualities.id)
      .orderBy(sql`lower(${yarnQualities.name})`),
    YARN_ZONE_CONFIG[zone].hasBeams ? listBeams({ zone: zone as BeamZone }) : Promise.resolve([]),
  ]);
  return {
    zone,
    stock: stocks.find((s) => s.zone === zone)!,
    qualities: qualities
      .map((q) => ({ quality: { id: q.id, name: q.name, denier: q.denier, filament: q.filament }, rawG: Number(q.rawG), twistedG: Number(q.twistedG) }))
      .filter((q) => q.rawG !== 0 || q.twistedG !== 0),
    beams: zoneBeams,
  };
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
}

const inList = (ids: (string | number)[]) => sql.join(ids.map((v) => sql`${v}`), sql`, `);

/** Yarn rows one by one, beam rows grouped per action (ref) + kind + zone ("3 beams"), newest first. */
export async function listMoves(q: Pick<YarnMovesQuery, 'page' | 'limit' | 'zone' | 'kind' | 'quality' | 'from' | 'to'>): Promise<Paginated<YarnMove>> {
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
  const where = (conds: SQL[]) => (conds.length ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``);
  const union = sql`
    SELECT 'yarn' AS source, 'y-' || m.id AS gkey, m.zone AS zone, m.kind AS kind, m.item AS item, m.quality_id AS quality_id,
           m.qty_g AS qty_g, NULL AS beams, NULL AS beam_nos, m.ref_type AS ref_type, m.ref_id AS ref_id, m.note AS note,
           m.role AS role, m.user_id AS user_id, m.created_at AS created_at, m.id AS sort_id
    FROM yarn_stock_moves m ${where(yarnConds)}
    UNION ALL
    SELECT 'beam', 'b-' || COALESCE(bm.ref_type, '') || '-' || COALESCE(bm.ref_id, MIN(bm.id)) || '-' || bm.kind || '-' || bm.zone,
           bm.zone, bm.kind, NULL, CASE WHEN COUNT(DISTINCT b.quality_id) = 1 THEN MIN(b.quality_id) END, NULL,
           COUNT(*), group_concat(b.beam_no), bm.ref_type, bm.ref_id, MAX(bm.note), MAX(bm.role), MAX(bm.user_id),
           MAX(bm.created_at), MAX(bm.id)
    FROM beam_moves bm JOIN beams b ON b.id = bm.beam_id ${where(beamConds)}
    GROUP BY bm.ref_type, bm.ref_id, bm.kind, bm.zone`;
  const [rows, [{ total }]] = await Promise.all([
    db.all<MoveRow>(sql`SELECT * FROM (${union}) x ORDER BY x.created_at DESC, x.sort_id DESC LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`),
    db.all<{ total: number }>(sql`SELECT COUNT(*) AS total FROM (${union}) x`),
  ]);
  const items = await decorateMoves(rows);
  return { items, page: q.page, limit: q.limit, total: Number(total), hasMore: q.page * q.limit < Number(total) };
}

/** Quality names, user names and the "what" line of each row — one query per kind of reference, not per row. */
async function decorateMoves(rows: MoveRow[]): Promise<YarnMove[]> {
  const idsOf = (type: YarnRefType) => [...new Set(rows.filter((r) => r.ref_type === type && r.ref_id).map((r) => Number(r.ref_id)))];
  const qualityIds = [...new Set(rows.map((r) => r.quality_id).filter((v): v is number => v !== null))];
  const userIds = [...new Set(rows.map((r) => r.user_id).filter((v): v is number => v !== null))];
  const [qualities, people, receipts, transfers, programs, jobs] = await Promise.all([
    qualityIds.length ? db.select({ id: yarnQualities.id, name: yarnQualities.name }).from(yarnQualities).where(inArray(yarnQualities.id, qualityIds)) : [],
    userIds.length ? db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds)) : [],
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
    return {
      key: r.gkey,
      source: r.source,
      zone: r.zone,
      kind: r.kind,
      item: r.item,
      quality: r.quality_id !== null ? { id: r.quality_id, name: qName.get(r.quality_id) ?? '—' } : null,
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
 * POST /yarn/transfers — one transaction: the transfer row, then a ledger `transfer_out` + `transfer_in` pair (yarn,
 * balance checked) or the beams' zone + `beam_moves` out / in rows (beams only Direct consumption ↔ Warping).
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
    } else {
      const names = await qualityNames(tx, [data.qualityId]);
      const qtyG = kgToGrams(data.qtyKg);
      const common = { item: data.what, qualityId: data.qualityId, qtyG, refType: 'transfer' as const, refId: t.id, note: data.note, role, createdAt: t.createdAt };
      await takeStock(tx, { ...common, zone: data.from, kind: 'transfer_out', qualityName: names.get(data.qualityId)! });
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
    } else {
      const names = await qualityNames(tx, [data.qualityId]);
      await takeStock(tx, {
        zone: data.zone,
        item: data.what,
        qualityId: data.qualityId,
        qtyG: kgToGrams(data.qtyKg),
        kind: 'withdraw',
        refType: 'withdrawal',
        refId: w.id,
        note: data.note,
        role,
        createdAt: w.createdAt,
        qualityName: names.get(data.qualityId)!,
      });
    }
    return { withdrawalId: w.id };
  });
}
