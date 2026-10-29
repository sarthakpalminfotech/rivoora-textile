import { and, asc, count, desc, eq, gte, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import {
  can,
  formatKg,
  kgToGrams,
  ratePaise,
  YARN_ZONE_CONFIG,
  yarnPoCanCancel,
  yarnPoCanClose,
  yarnPoCanEditAll,
  yarnPoCanReceive,
  yarnPoInputSchema,
  yarnPoLineFigures,
  yarnPoRemarkSchema,
  yarnPoStatusFor,
  yarnPoTotals,
  yarnReceiptInputSchema,
  type Paginated,
  type RoleKey,
  type YarnPoDetail,
  type YarnPoEventKind,
  type YarnPoListItem,
  type YarnPoListQuery,
  type YarnPoPrintData,
  type YarnPoStatus,
  type YarnPoWriteResult,
  type YarnReceiptResult,
  type YarnZone,
} from '@rivoora/shared';
import { db, type DbOrTx, type Tx } from '../db/client';
import {
  yarnLots,
  yarnParties,
  yarnPoEvents,
  yarnPoLines,
  yarnPos,
  yarnQualities,
  yarnReceiptLineAllocations,
  yarnReceiptLines,
  yarnReceipts,
  users,
} from '../db/schema';
import { badRequest, conflict, notFound } from '../lib/errors';
import { likePattern } from '../lib/http';
import { actor, addStock, allocateYarnPoNo, nowIso, qualityNames } from './yarn-ledger';

/**
 * Sprint 17 — Yarn POs: list / create / edit / close / cancel / print, and receiving a party's challan into a zone.
 * Received quantities are never stored on the PO: they are the sum of its receipt lines; the status is recomputed
 * with the shared `yarnPoStatusFor` after every receipt. Rates / amounts only for roles with `canSeeRate`.
 */

interface LineRow {
  id: number;
  poId: number;
  qualityId: number;
  qualityName: string;
  qtyG: number;
  ratePaise: number;
  receivedG: number;
}

/** The lines of some POs with what each has received (one aggregate query). */
async function linesOf(tx: DbOrTx, poIds: number[]): Promise<LineRow[]> {
  if (!poIds.length) return [];
  const rows = await tx
    .select({
      id: yarnPoLines.id,
      poId: yarnPoLines.poId,
      qualityId: yarnPoLines.qualityId,
      qualityName: yarnQualities.name,
      qtyG: yarnPoLines.qtyG,
      ratePaise: yarnPoLines.ratePaise,
      receivedG: sql<number>`COALESCE((SELECT SUM(rl.qty_g) FROM yarn_receipt_lines rl WHERE rl.po_line_id = "yarn_po_lines"."id"), 0)`,
    })
    .from(yarnPoLines)
    .innerJoin(yarnQualities, eq(yarnQualities.id, yarnPoLines.qualityId))
    .where(inArray(yarnPoLines.poId, poIds))
    .orderBy(asc(yarnPoLines.poId), asc(yarnPoLines.sortOrder), asc(yarnPoLines.id));
  return rows.map((r) => ({ ...r, receivedG: Number(r.receivedG) }));
}

const totalsOf = (lines: LineRow[]) => yarnPoTotals(lines);

/* ------------------------------------------------------------------ */
/* list                                                                 */
/* ------------------------------------------------------------------ */

export async function listYarnPos(role: RoleKey, q: YarnPoListQuery): Promise<Paginated<YarnPoListItem>> {
  const conds: (SQL | undefined)[] = [];
  if (q.status.length) conds.push(inArray(yarnPos.status, q.status));
  if (q.party.length) conds.push(inArray(yarnPos.partyId, q.party));
  if (q.quality.length) {
    conds.push(sql`EXISTS (SELECT 1 FROM yarn_po_lines l WHERE l.po_id = ${yarnPos.id} AND l.quality_id IN (${sql.join(q.quality.map((id) => sql`${id}`), sql`, `)}))`);
  }
  if (q.from) conds.push(gte(yarnPos.poDate, q.from));
  if (q.to) conds.push(lte(yarnPos.poDate, q.to));
  if (q.search) {
    const term = q.search.replace(/^#/, '').trim();
    const p = likePattern(term);
    conds.push(
      or(
        /^\d+$/.test(term) ? sql`CAST(${yarnPos.poNo} AS TEXT) LIKE ${likePattern(term, 'prefix')} ESCAPE '\\'` : undefined,
        sql`${yarnParties.name} LIKE ${p} ESCAPE '\\'`,
        sql`EXISTS (SELECT 1 FROM yarn_po_lines l JOIN yarn_qualities yq ON yq.id = l.quality_id WHERE l.po_id = ${yarnPos.id} AND yq.name LIKE ${p} ESCAPE '\\')`,
      ),
    );
  }
  const where = and(...conds);
  const [rows, [{ total }]] = await db.batch([
    db
      .select({
        id: yarnPos.id,
        poNo: yarnPos.poNo,
        poDate: yarnPos.poDate,
        status: yarnPos.status,
        partyId: yarnParties.id,
        partyName: yarnParties.name,
        createdAt: yarnPos.createdAt,
      })
      .from(yarnPos)
      .innerJoin(yarnParties, eq(yarnParties.id, yarnPos.partyId))
      .where(where)
      .orderBy(desc(yarnPos.poDate), desc(yarnPos.poNo))
      .limit(q.limit)
      .offset((q.page - 1) * q.limit),
    db.select({ total: count() }).from(yarnPos).innerJoin(yarnParties, eq(yarnParties.id, yarnPos.partyId)).where(where),
  ]);
  const lines = await linesOf(db, rows.map((r) => r.id));
  const seeRate = can(role, 'canSeeRate');
  const items = rows.map((r): YarnPoListItem => {
    const own = lines.filter((l) => l.poId === r.id);
    const t = totalsOf(own);
    return {
      id: r.id,
      poNo: r.poNo,
      poDate: r.poDate,
      status: r.status,
      party: { id: r.partyId, name: r.partyName },
      qualities: own.map((l) => l.qualityName),
      orderedG: t.orderedG,
      receivedG: t.receivedG,
      pendingG: yarnPoCanReceive(r.status) ? t.pendingG : 0,
      amountPaise: seeRate ? t.amountPaise : null,
      createdAt: r.createdAt,
    };
  });
  return { items, page: q.page, limit: q.limit, total, hasMore: q.page * q.limit < total };
}

/* ------------------------------------------------------------------ */
/* details                                                              */
/* ------------------------------------------------------------------ */

async function loadPo(tx: DbOrTx, id: number) {
  const [po] = await tx
    .select({
      id: yarnPos.id,
      poNo: yarnPos.poNo,
      poDate: yarnPos.poDate,
      status: yarnPos.status,
      remark: yarnPos.remark,
      partyId: yarnPos.partyId,
      createdBy: yarnPos.createdBy,
      createdByUserId: yarnPos.createdByUserId,
      createdAt: yarnPos.createdAt,
    })
    .from(yarnPos)
    .where(eq(yarnPos.id, id));
  if (!po) throw notFound('Yarn PO');
  return po;
}

export async function getYarnPo(role: RoleKey, id: number): Promise<YarnPoDetail> {
  const po = await loadPo(db, id);
  const [[party], receipts, receiptLines, events, [creator]] = await db.batch([
    db.select().from(yarnParties).where(eq(yarnParties.id, po.partyId)),
    db
      .select({
        id: yarnReceipts.id,
        challanNo: yarnReceipts.challanNo,
        receiptDate: yarnReceipts.receiptDate,
        zone: yarnReceipts.zone,
        notes: yarnReceipts.notes,
        role: yarnReceipts.receivedBy,
        userName: users.name,
        createdAt: yarnReceipts.createdAt,
      })
      .from(yarnReceipts)
      .leftJoin(users, eq(users.id, yarnReceipts.receivedByUserId))
      .where(eq(yarnReceipts.poId, id))
      .orderBy(desc(yarnReceipts.receiptDate), desc(yarnReceipts.id)),
    db
      .select({
        id: yarnReceiptLines.id,
        receiptId: yarnReceiptLines.receiptId,
        poLineId: yarnReceiptLines.poLineId,
        qualityId: yarnReceiptLines.qualityId,
        qualityName: yarnQualities.name,
        qtyG: yarnReceiptLines.qtyG,
        boxes: yarnReceiptLines.boxes,
        lotId: yarnReceiptLines.lotId,
        lotNo: yarnLots.lotNo,
      })
      .from(yarnReceiptLines)
      .innerJoin(yarnReceipts, eq(yarnReceipts.id, yarnReceiptLines.receiptId))
      .innerJoin(yarnQualities, eq(yarnQualities.id, yarnReceiptLines.qualityId))
      .leftJoin(yarnLots, eq(yarnLots.id, yarnReceiptLines.lotId))
      .where(eq(yarnReceipts.poId, id))
      .orderBy(asc(yarnReceiptLines.id)),
    db
      .select({ id: yarnPoEvents.id, kind: yarnPoEvents.kind, note: yarnPoEvents.note, role: yarnPoEvents.role, userName: users.name, createdAt: yarnPoEvents.createdAt })
      .from(yarnPoEvents)
      .leftJoin(users, eq(users.id, yarnPoEvents.userId))
      .where(eq(yarnPoEvents.poId, id))
      .orderBy(desc(yarnPoEvents.createdAt), desc(yarnPoEvents.id)),
    db.select({ name: users.name }).from(users).where(eq(users.id, po.createdByUserId ?? 0)),
  ]);
  const allocations = receiptLines.length
    ? await db
        .select({ receiptLineId: yarnReceiptLineAllocations.receiptLineId, zone: yarnReceiptLineAllocations.zone, qtyG: yarnReceiptLineAllocations.qtyG })
        .from(yarnReceiptLineAllocations)
        .where(inArray(yarnReceiptLineAllocations.receiptLineId, receiptLines.map((l) => l.id)))
    : [];
  const lines = await linesOf(db, [id]);
  const totals = totalsOf(lines);
  const seeRate = can(role, 'canSeeRate');
  const manage = can(role, 'canManageYarnPo');
  const open = yarnPoCanReceive(po.status);
  const state = { status: po.status, receivedG: totals.receivedG };
  return {
    id: po.id,
    poNo: po.poNo,
    poDate: po.poDate,
    status: po.status,
    remark: po.remark,
    party: { id: party.id, name: party.name, mobile: party.mobile, gstin: party.gstin, address: party.address },
    lines: lines.map((l) => {
      const f = yarnPoLineFigures(l, l.receivedG);
      return {
        id: l.id,
        quality: { id: l.qualityId, name: l.qualityName },
        qtyG: l.qtyG,
        ratePaise: seeRate ? l.ratePaise : null,
        amountPaise: seeRate ? f.amountPaise : null,
        receivedG: f.receivedG,
        pendingG: open ? f.pendingG : 0,
        overG: f.overG,
        progress: f.progress,
      };
    }),
    totals: {
      orderedG: totals.orderedG,
      receivedG: totals.receivedG,
      pendingG: open ? totals.pendingG : 0,
      amountPaise: seeRate ? totals.amountPaise : null,
      progress: totals.progress,
    },
    receipts: receipts.map((r) => {
      const own = receiptLines.filter((l) => l.receiptId === r.id);
      return {
        id: r.id,
        challanNo: r.challanNo,
        receiptDate: r.receiptDate,
        zone: r.zone,
        notes: r.notes,
        role: r.role,
        userName: r.userName,
        totalG: own.reduce((s, l) => s + l.qtyG, 0),
        lines: own.map((l) => ({
          id: l.id,
          poLineId: l.poLineId,
          quality: { id: l.qualityId, name: l.qualityName },
          qtyG: l.qtyG,
          boxes: l.boxes,
          lot: l.lotId !== null && l.lotNo !== null ? { id: l.lotId, lotNo: l.lotNo } : null,
          allocations: allocations.filter((a) => a.receiptLineId === l.id).map((a) => ({ zone: a.zone, qtyG: a.qtyG })),
        })),
        createdAt: r.createdAt,
      };
    }),
    events: events.map((e) => ({ id: e.id, kind: e.kind, note: e.note, role: e.role, userName: e.userName, createdAt: e.createdAt })),
    createdBy: { role: po.createdBy, userName: creator?.name ?? null },
    createdAt: po.createdAt,
    canEditAll: manage && yarnPoCanEditAll(state),
    canEditRemark: manage && po.status !== 'cancelled',
    canReceive: can(role, 'canReceiveYarn') && open,
    canClose: manage && yarnPoCanClose(state),
    canCancel: manage && yarnPoCanCancel(state),
  };
}

/* ------------------------------------------------------------------ */
/* writes                                                               */
/* ------------------------------------------------------------------ */

async function writeEvent(tx: Tx, poId: number, kind: YarnPoEventKind, role: RoleKey, note: string | null = null) {
  await tx.insert(yarnPoEvents).values({ poId, kind, note, ...actor(role) });
}

async function assertParty(tx: DbOrTx, partyId: number) {
  const [p] = await tx.select({ id: yarnParties.id }).from(yarnParties).where(and(eq(yarnParties.id, partyId), eq(yarnParties.isDeleted, false)));
  if (!p) throw badRequest('That party no longer exists — pick another', 'partyId');
}

type ParsedPo = ReturnType<typeof yarnPoInputSchema.parse>;

async function insertLines(tx: Tx, poId: number, lines: ParsedPo['lines']) {
  await tx.insert(yarnPoLines).values(
    lines.map((l, i) => ({ poId, qualityId: l.qualityId, qtyG: kgToGrams(l.qtyKg), ratePaise: ratePaise(l.rate), sortOrder: i })),
  );
}

/** Sprint 20: the PO number is assigned by the system (counter `yarn_po_no`), never typed. */
export async function createYarnPo(role: RoleKey, input: unknown): Promise<YarnPoWriteResult> {
  const data = yarnPoInputSchema.parse(input);
  return db.transaction(async (tx) => {
    await assertParty(tx, data.partyId);
    await qualityNames(tx, data.lines.map((l) => l.qualityId), 'lines');
    const poNo = await allocateYarnPoNo(tx);
    const [po] = await tx
      .insert(yarnPos)
      .values({ poNo, poDate: data.poDate, partyId: data.partyId, remark: data.remark, status: 'open', createdBy: role, createdByUserId: actor(role).userId })
      .returning({ id: yarnPos.id, poNo: yarnPos.poNo, status: yarnPos.status });
    await insertLines(tx, po.id, data.lines);
    await writeEvent(tx, po.id, 'created', role);
    return po;
  });
}

/**
 * PUT /yarn-pos/:id — the full form while nothing is received (lines replaced), else `{remark}` only (409 for
 * anything more). Cancelled POs can't be edited.
 */
export async function updateYarnPo(role: RoleKey, id: number, input: unknown): Promise<YarnPoWriteResult> {
  const remarkOnly = yarnPoRemarkSchema.safeParse(input);
  const full = remarkOnly.success ? null : yarnPoInputSchema.parse(input);
  return db.transaction(async (tx) => {
    const po = await loadPo(tx, id);
    if (po.status === 'cancelled') throw conflict('A cancelled PO can’t be edited.');
    const totals = totalsOf(await linesOf(tx, [id]));
    if (!full) {
      const remark = remarkOnly.success ? remarkOnly.data.remark : null;
      if ((remark ?? null) !== (po.remark ?? null)) {
        await tx.update(yarnPos).set({ remark }).where(eq(yarnPos.id, id));
        await writeEvent(tx, id, 'edited', role, 'Remark changed');
      }
      return { id, poNo: po.poNo, status: po.status };
    }
    if (!yarnPoCanEditAll({ status: po.status, receivedG: totals.receivedG })) {
      throw conflict('Yarn has been received on this PO — only the remark can change now.');
    }
    await assertParty(tx, full.partyId);
    await qualityNames(tx, full.lines.map((l) => l.qualityId), 'lines');
    // Nothing is received, so no receipt line points at these lines — replace them. The PO no. is never editable.
    await tx.delete(yarnPoLines).where(eq(yarnPoLines.poId, id));
    await insertLines(tx, id, full.lines);
    await tx.update(yarnPos).set({ poDate: full.poDate, partyId: full.partyId, remark: full.remark }).where(eq(yarnPos.id, id));
    await writeEvent(tx, id, 'edited', role);
    return { id, poNo: po.poNo, status: po.status };
  });
}

async function setStatus(role: RoleKey, id: number, to: 'closed' | 'cancelled'): Promise<YarnPoWriteResult> {
  return db.transaction(async (tx) => {
    const po = await loadPo(tx, id);
    const totals = totalsOf(await linesOf(tx, [id]));
    const state = { status: po.status, receivedG: totals.receivedG };
    if (to === 'closed' && !yarnPoCanClose(state)) {
      throw conflict(po.status === 'open' ? 'Nothing is received yet — cancel the PO instead.' : 'Only a partly received PO can be closed.');
    }
    if (to === 'cancelled' && !yarnPoCanCancel(state)) throw conflict('Only an open PO with nothing received can be cancelled.');
    const at = nowIso();
    const by = actor(role).userId;
    const res = await tx
      .update(yarnPos)
      .set(to === 'closed' ? { status: 'closed', closedAt: at, closedByUserId: by } : { status: 'cancelled', cancelledAt: at, cancelledByUserId: by })
      .where(and(eq(yarnPos.id, id), eq(yarnPos.status, po.status)))
      .returning({ id: yarnPos.id });
    if (!res.length) throw conflict('The PO changed meanwhile — refresh and try again.');
    await writeEvent(tx, id, to, role, to === 'closed' && totals.pendingG > 0 ? `Closed short: ${formatKg(totals.pendingG)} not received` : null);
    return { id, poNo: po.poNo, status: to };
  });
}

export const closeYarnPo = (role: RoleKey, id: number) => setStatus(role, id, 'closed');
export const cancelYarnPo = (role: RoleKey, id: number) => setStatus(role, id, 'cancelled');

/** 409 when a typed lot no. is already used by this party (lots are never edited or deleted). */
async function assertLotNosFree(tx: DbOrTx, partyId: number, entries: { lotNo: string; i: number }[]) {
  const seen = new Map<string, number>();
  for (const e of entries) {
    const key = e.lotNo.toLowerCase();
    if (seen.has(key)) throw conflict(`Lot "${e.lotNo}" is used twice in this challan`, `lots.${e.i}.lotNo`);
    seen.set(key, e.i);
  }
  if (!entries.length) return;
  const existing = await tx
    .select({ lotNo: yarnLots.lotNo })
    .from(yarnLots)
    .where(and(eq(yarnLots.partyId, partyId), inArray(sql`lower(${yarnLots.lotNo})`, [...seen.keys()])));
  if (existing.length) {
    const first = existing[0];
    const i = seen.get(first.lotNo.toLowerCase())!;
    throw conflict(`Lot "${first.lotNo}" already exists for this party`, `lots.${i}.lotNo`);
  }
}

/**
 * POST /yarn-pos/:id/receipts — Sprint 20: one transaction per challan — a receipt, one NEW lot per entry (unique per
 * party), its receipt line (with that lot), and its allocation rows (any kg not explicitly allocated goes to Direct
 * consumption). One ledger `receipt` row per allocation, tagged with the lot. Over-receipt is allowed (the screen warns).
 */
export async function receiveYarn(role: RoleKey, poId: number, input: unknown): Promise<YarnReceiptResult> {
  const data = yarnReceiptInputSchema.parse(input);
  return db.transaction(async (tx) => {
    const po = await loadPo(tx, poId);
    if (!yarnPoCanReceive(po.status)) {
      throw conflict(po.status === 'received' ? 'This PO is fully received.' : `This PO is ${po.status} — it can’t receive yarn.`);
    }
    const lines = await linesOf(tx, [poId]);
    const byLineId = new Map(lines.map((l) => [l.id, l]));
    data.lots.forEach((lot, i) => {
      if (!byLineId.has(lot.poLineId)) throw badRequest('A line is not on this PO — refresh and try again', `lots.${i}.poLineId`);
    });
    await assertLotNosFree(tx, po.partyId, data.lots.map((l, i) => ({ lotNo: l.lotNo, i })));

    const [receipt] = await tx
      .insert(yarnReceipts)
      .values({ poId, challanNo: data.challanNo, receiptDate: data.date, zone: 'direct', notes: data.notes, receivedBy: role, receivedByUserId: actor(role).userId })
      .returning({ id: yarnReceipts.id });

    const receivedByLine = new Map<number, number>();
    const totalByZone = new Map<YarnZone, number>();
    let totalG = 0;

    for (const lot of data.lots) {
      const qualityId = byLineId.get(lot.poLineId)!.qualityId;
      const lotTotalG = kgToGrams(lot.qtyKg);
      const [newLot] = await tx.insert(yarnLots).values({ lotNo: lot.lotNo, partyId: po.partyId, qualityId, createdByUserId: actor(role).userId }).returning({ id: yarnLots.id });
      const [receiptLine] = await tx
        .insert(yarnReceiptLines)
        .values({ receiptId: receipt.id, poLineId: lot.poLineId, qualityId, qtyG: lotTotalG, boxes: lot.boxes, lotId: newLot.id })
        .returning({ id: yarnReceiptLines.id });

      const allocG = new Map<YarnZone, number>();
      for (const a of lot.allocations) allocG.set(a.zone, (allocG.get(a.zone) ?? 0) + kgToGrams(a.qtyKg));
      const allocatedG = [...allocG.values()].reduce((s, v) => s + v, 0);
      const remainderG = lotTotalG - allocatedG;
      if (remainderG > 0) allocG.set('direct', (allocG.get('direct') ?? 0) + remainderG);

      for (const [zone, qtyG] of allocG) {
        if (qtyG <= 0) continue;
        await tx.insert(yarnReceiptLineAllocations).values({ receiptLineId: receiptLine.id, zone, qtyG });
        await addStock(tx, { zone, item: 'raw', qualityId, qtyG, kind: 'receipt', refType: 'receipt', refId: receipt.id, note: data.notes, role, lotId: newLot.id });
        totalByZone.set(zone, (totalByZone.get(zone) ?? 0) + qtyG);
      }
      receivedByLine.set(lot.poLineId, (receivedByLine.get(lot.poLineId) ?? 0) + lotTotalG);
      totalG += lotTotalG;
    }

    const byZone = [...totalByZone.entries()].map(([zone, qtyG]) => ({ zone, qtyG })).sort((a, b) => b.qtyG - a.qtyG);
    const descriptiveZone = byZone[0]?.zone ?? 'direct';
    if (descriptiveZone !== 'direct') await tx.update(yarnReceipts).set({ zone: descriptiveZone }).where(eq(yarnReceipts.id, receipt.id));

    const after = totalsOf(lines.map((l) => ({ ...l, receivedG: l.receivedG + (receivedByLine.get(l.id) ?? 0) })));
    const status: YarnPoStatus = yarnPoStatusFor({ status: po.status, orderedG: after.orderedG, receivedG: after.receivedG });
    if (status !== po.status) await tx.update(yarnPos).set({ status }).where(eq(yarnPos.id, poId));
    const zoneBreakdown = byZone.map((z) => `${YARN_ZONE_CONFIG[z.zone].label} ${formatKg(z.qtyG)}`).join(', ');
    await writeEvent(tx, poId, 'received', role, `Challan ${data.challanNo} · ${formatKg(totalG)} → ${zoneBreakdown}`);
    return { receiptId: receipt.id, poId, status, totalG, zone: descriptiveZone, byZone };
  });
}

/** GET /yarn-pos/:id/print — the printable PO (rates always: only `canManageYarnPo` may print). */
export async function getYarnPoPrint(id: number): Promise<YarnPoPrintData> {
  const po = await loadPo(db, id);
  const [party] = await db.select().from(yarnParties).where(eq(yarnParties.id, po.partyId));
  const lines = await linesOf(db, [id]);
  const t = totalsOf(lines);
  return {
    poNo: po.poNo,
    poDate: po.poDate,
    status: po.status,
    remark: po.remark,
    party: { name: party.name, mobile: party.mobile, address: party.address, gstin: party.gstin },
    lines: lines.map((l) => ({ quality: l.qualityName, qtyG: l.qtyG, ratePaise: l.ratePaise, amountPaise: yarnPoLineFigures(l, l.receivedG).amountPaise })),
    totalG: t.orderedG,
    totalPaise: t.amountPaise,
  };
}
