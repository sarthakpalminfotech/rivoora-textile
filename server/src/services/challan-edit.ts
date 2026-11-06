import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  challanEditSchema,
  challanLabel,
  challanTakaReasonSchema,
  CHALLAN_KIND_CONFIG,
  ROLES,
  type ChallanKind,
  type ChallanTakaActionResult,
  type RoleKey,
} from '@rivoora/shared';
import { db, type Tx } from '../db/client';
import { buttaParties, challanEvents, challans, challanTakas, millParties, takas } from '../db/schema';
import { conflict, notFound } from '../lib/errors';
import { currentUserId } from '../lib/request-context';
import { recomputeOrdersStatus, writeTakaEvents } from './taka-ops';

/**
 * Sprint 21 — editing a butta / mill challan and settling takas that will not come back.
 * - Edit (C3): party, date, e-way no., transport, vehicle, notes of an ACTIVE challan; a history line says what changed.
 * - Remove a taka (C3): only one not received back; it returns to the waiting stage it was sent from. Reason required.
 *   The last taka removed cancels the challan (its number is never reused).
 * - Mark lost / short at the party (C4, Gaurang): a taka not received becomes stage `lost`; its row is settled so the
 *   challan can complete. Reason required; can be undone (back to "at party").
 */

const now = () => new Date().toISOString();
const partyTable = (kind: ChallanKind) => (kind === 'butta' ? buttaParties : millParties);

async function loadActive(tx: Tx, kind: ChallanKind, id: number) {
  const [c] = await tx
    .select({ id: challans.id, challanNo: challans.challanNo, status: challans.status, partyId: challans.partyId, challanDate: challans.challanDate, ewayNo: challans.ewayNo, transport: challans.transport, vehicleNo: challans.vehicleNo, notes: challans.notes })
    .from(challans)
    .where(and(eq(challans.id, id), eq(challans.kind, kind)));
  if (!c) throw notFound('Challan');
  if (c.status === 'cancelled') throw conflict('This challan is cancelled.');
  return c;
}

async function addHistory(tx: Tx, challanId: number, role: RoleKey, event: 'edited' | 'taka_removed' | 'taka_lost' | 'lost_undone', note: string) {
  const at = now();
  await tx.insert(challanEvents).values({ challanId, event, note, role, userId: currentUserId(), createdAt: at, updatedAt: at });
}

const show = (v: string | null) => (v && v.trim() ? v : '–');

/** PUT /<kind>/challans/:id */
export async function editChallan(kind: ChallanKind, role: RoleKey, id: number, input: unknown): Promise<{ challanId: number; changed: number }> {
  const data = challanEditSchema.parse(input);
  return db.transaction(async (tx) => {
    const c = await loadActive(tx, kind, id);
    const parties = partyTable(kind);
    const [party] = await tx.select({ id: parties.id, name: parties.name }).from(parties).where(and(eq(parties.id, data.partyId), eq(parties.isDeleted, false)));
    if (!party) throw conflict('That party no longer exists. Pick another one.');
    const lines: string[] = [];
    if (data.partyId !== c.partyId) {
      const [old] = await tx.select({ name: parties.name }).from(parties).where(eq(parties.id, c.partyId));
      lines.push(`party ${old?.name ?? '–'} → ${party.name}`);
    }
    if (data.challanDate !== c.challanDate) lines.push(`date ${c.challanDate} → ${data.challanDate}`);
    if ((data.ewayNo ?? null) !== (c.ewayNo ?? null)) lines.push(`e-way no ${show(c.ewayNo)} → ${show(data.ewayNo)}`);
    if ((data.transport ?? null) !== (c.transport ?? null)) lines.push(`transport ${show(c.transport)} → ${show(data.transport)}`);
    if ((data.vehicleNo ?? null) !== (c.vehicleNo ?? null)) lines.push(`vehicle ${show(c.vehicleNo)} → ${show(data.vehicleNo)}`);
    if ((data.notes ?? null) !== (c.notes ?? null)) lines.push('notes changed');
    if (!lines.length) return { challanId: id, changed: 0 };
    await tx
      .update(challans)
      .set({ partyId: data.partyId, challanDate: data.challanDate, ewayNo: data.ewayNo, transport: data.transport, vehicleNo: data.vehicleNo, notes: data.notes, updatedAt: now() })
      .where(eq(challans.id, id));
    await addHistory(tx, id, role, 'edited', `Edited by ${ROLES[role].name}: ${lines.join(', ')}`);
    return { challanId: id, changed: lines.length };
  });
}

async function loadRow(tx: Tx, kind: ChallanKind, challanId: number, takaId: number) {
  const [row] = await tx
    .select({
      id: challanTakas.id,
      takaId: challanTakas.takaId,
      orderId: challanTakas.orderId,
      receivedAt: challanTakas.receivedAt,
      lostAt: challanTakas.lostAt,
      isRefinish: challanTakas.isRefinish,
      isActive: challanTakas.isActive,
      takaNo: takas.takaNo,
      stage: takas.stage,
    })
    .from(challanTakas)
    .innerJoin(takas, eq(takas.id, challanTakas.takaId))
    .where(and(eq(challanTakas.challanId, challanId), eq(challanTakas.takaId, takaId), eq(challanTakas.kind, kind)));
  if (!row || !row.isActive) throw notFound('Taka on this challan');
  return row;
}

/** POST /<kind>/challans/:id/remove-taka */
export async function removeTakaFromChallan(kind: ChallanKind, role: RoleKey, id: number, input: unknown): Promise<ChallanTakaActionResult> {
  const data = challanTakaReasonSchema.parse(input);
  const cfg = CHALLAN_KIND_CONFIG[kind];
  return db.transaction(async (tx) => {
    const c = await loadActive(tx, kind, id);
    const row = await loadRow(tx, kind, id, data.takaId);
    if (row.receivedAt) throw conflict(`Taka ${row.takaNo} has already been received back — it can't be removed from the challan.`);
    if (row.lostAt || row.stage === 'lost') throw conflict(`Taka ${row.takaNo} is marked lost — undo that first.`);
    const back = row.isRefinish ? (cfg.refinishStage ?? cfg.extraReadyStages?.[0] ?? cfg.readyStage) : cfg.readyStage;
    const moved = await tx
      .update(takas)
      .set({ stage: back })
      .where(and(eq(takas.id, row.takaId), eq(takas.stage, cfg.sentStage)))
      .returning({ id: takas.id });
    if (!moved.length) throw conflict(`Taka ${row.takaNo} changed meanwhile. Refresh and try again.`);
    // The row goes (the challan no longer lists, prints or counts it); a refinish trip re-activates the previous trip.
    await tx.delete(challanTakas).where(eq(challanTakas.id, row.id));
    if (row.isRefinish) {
      await tx
        .update(challanTakas)
        .set({ isActive: true, updatedAt: now() })
        .where(eq(challanTakas.id, sql`(SELECT MAX(p.id) FROM challan_takas p WHERE p.taka_id = ${row.takaId} AND p.kind = ${kind} AND p.id < ${row.id})`));
    }
    const label = challanLabel(c.challanNo, kind);
    await writeTakaEvents(tx, role, [{ takaId: row.takaId, event: 'removed_from_challan', challanId: id, note: `Removed from ${label} · ${data.reason}` }]);
    await addHistory(tx, id, role, 'taka_removed', `Taka ${row.takaNo} removed by ${ROLES[role].name} · ${data.reason}`);
    // The last taka gone: the challan is cancelled (its number is never reused).
    const [left] = await tx.select({ n: sql<number>`COUNT(*)` }).from(challanTakas).where(eq(challanTakas.challanId, id));
    let challanCancelled = false;
    if (Number(left?.n ?? 0) === 0) {
      await tx.update(challans).set({ status: 'cancelled', cancelledAt: now(), cancelledBy: role, updatedAt: now() }).where(eq(challans.id, id));
      await addHistory(tx, id, role, 'edited', 'Challan cancelled — its last taka was removed');
      challanCancelled = true;
    }
    await recomputeOrdersStatus(tx, role, [row.orderId]);
    return { challanId: id, takaId: row.takaId, takaNo: row.takaNo, challanCancelled };
  });
}

/** POST /<kind>/challans/:id/mark-lost (Gaurang) */
export async function markTakaLost(kind: ChallanKind, role: RoleKey, id: number, input: unknown): Promise<ChallanTakaActionResult> {
  const data = challanTakaReasonSchema.parse(input);
  const cfg = CHALLAN_KIND_CONFIG[kind];
  return db.transaction(async (tx) => {
    const c = await loadActive(tx, kind, id);
    const row = await loadRow(tx, kind, id, data.takaId);
    if (row.receivedAt) throw conflict(`Taka ${row.takaNo} has already been received back.`);
    if (row.lostAt) throw conflict(`Taka ${row.takaNo} is already marked lost.`);
    const moved = await tx
      .update(takas)
      .set({ stage: 'lost' })
      .where(and(eq(takas.id, row.takaId), eq(takas.stage, cfg.sentStage)))
      .returning({ id: takas.id });
    if (!moved.length) throw conflict(`Taka ${row.takaNo} changed meanwhile. Refresh and try again.`);
    const at = now();
    await tx.update(challanTakas).set({ lostAt: at, lostBy: role, updatedAt: at }).where(eq(challanTakas.id, row.id));
    await writeTakaEvents(tx, role, [{ takaId: row.takaId, event: 'marked_lost', challanId: id, note: `Lost / short at party on ${challanLabel(c.challanNo, kind)} · ${data.reason}` }]);
    await addHistory(tx, id, role, 'taka_lost', `Taka ${row.takaNo} marked lost / short by ${ROLES[role].name} · ${data.reason}`);
    await recomputeOrdersStatus(tx, role, [row.orderId]);
    return { challanId: id, takaId: row.takaId, takaNo: row.takaNo, challanCancelled: false };
  });
}

/** POST /<kind>/challans/:id/undo-lost (Gaurang) */
export async function undoTakaLost(kind: ChallanKind, role: RoleKey, id: number, input: unknown): Promise<ChallanTakaActionResult> {
  const data = challanTakaReasonSchema.parse(input);
  const cfg = CHALLAN_KIND_CONFIG[kind];
  return db.transaction(async (tx) => {
    const c = await loadActive(tx, kind, id);
    const row = await loadRow(tx, kind, id, data.takaId);
    if (!row.lostAt) throw conflict(`Taka ${row.takaNo} is not marked lost.`);
    const moved = await tx
      .update(takas)
      .set({ stage: cfg.sentStage })
      .where(and(eq(takas.id, row.takaId), inArray(takas.stage, ['lost'])))
      .returning({ id: takas.id });
    if (!moved.length) throw conflict(`Taka ${row.takaNo} changed meanwhile. Refresh and try again.`);
    await tx.update(challanTakas).set({ lostAt: null, lostBy: null, updatedAt: now() }).where(eq(challanTakas.id, row.id));
    await writeTakaEvents(tx, role, [{ takaId: row.takaId, event: 'lost_undone', challanId: id, note: `Lost mark undone on ${challanLabel(c.challanNo, kind)} · ${data.reason}` }]);
    await addHistory(tx, id, role, 'lost_undone', `Taka ${row.takaNo} lost mark undone by ${ROLES[role].name} · ${data.reason}`);
    await recomputeOrdersStatus(tx, role, [row.orderId]);
    return { challanId: id, takaId: row.takaId, takaNo: row.takaNo, challanCancelled: false };
  });
}
