import { fyOf, framesFromTakaPcs, metersFromTakaMeters, type RoleKey } from '@rivoora/shared';
import type { Aftermath } from './aftermath';
import type { Clock, Rng } from './clock';
import type { Dispatch, SimDamage, SimOrder, SimTaka, Trip } from './model';
import type { OutsideSim } from './outside';
import type { Sink } from './sink';

/**
 * Sprint 26 — turns the simulated orders into rows (orders, history, holds, jobsheets + machines + events, takas +
 * damages + events, QC runs, butta / mill challans, delivery challans, goods returns, outside POs + receipts).
 */

export type UserIds = Record<RoleKey, number>;

const PHOTO_URLS: { url: string; thumbUrl: string }[] = [];
export function setDamagePhotos(list: { url: string; thumbUrl: string }[]) {
  PHOTO_URLS.splice(0, PHOTO_URLS.length, ...list);
}

export class Emitter {
  constructor(
    private readonly sink: Sink,
    private readonly clock: Clock,
    private readonly rng: Rng,
    private readonly users: UserIds,
  ) {}

  private iso = (x: number) => this.clock.iso(x);
  private happened = (x: number | null | undefined): x is number => x !== null && x !== undefined && x <= this.clock.H;

  /* ---------- challans (grouped per party per day) ---------- */

  challans(trips: Trip[]) {
    const c = this.clock;
    const groups = new Map<string, Trip[]>();
    for (const t of trips) {
      if (!this.happened(t.sendX)) continue;
      const key = `${t.kind}|${t.partyId}|${c.day(t.sendX)}`;
      groups.set(key, [...(groups.get(key) ?? []), t]);
    }
    const list = [...groups.values()].sort((a, b) => Math.min(...a.map((t) => t.sendX)) - Math.min(...b.map((t) => t.sendX)));
    const seq = { butta: 0, mill: 0 };
    // the latest trip of each taka per kind keeps the active challan row
    const latest = new Map<string, Trip>();
    for (const t of trips) {
      const k = `${t.taka.id}|${t.kind}`;
      if (!latest.has(k) || latest.get(k)!.sendX < t.sendX) latest.set(k, t);
    }
    let edited = false;
    let cancelledDone = false;
    for (const g of list) {
      const kind = g[0].kind;
      const x0 = Math.min(...g.map((t) => t.sendX));
      // one butta challan was made the day before by mistake and cancelled (its takas were sent again on this one)
      if (!cancelledDone && kind === 'butta' && g.length >= 3 && x0 > this.clock.H - 120 && x0 < this.clock.H - 60) {
        cancelledDone = true;
        const cx = x0 - 0.6;
        const cid = this.sink.add('challans', {
          kind, challan_no: ++seq[kind], party_id: g[0].partyId, challan_date: c.day(cx), status: 'cancelled', cancelled_at: this.iso(cx + 0.3), cancelled_by: 'godown_supervisor', created_by: 'godown_supervisor', fy: fyOf(this.iso(cx)),
        }, this.iso(cx));
        for (const t of g.slice(0, 3)) {
          this.sink.add('challan_takas', { challan_id: cid, kind, taka_id: t.taka.id, order_id: t.taka.order.id, meters: t.taka.meters, pcs: t.taka.pcs, is_active: 0 }, this.iso(cx));
          this.takaEvent(t.taka, cx, 'sent_butta', 'godown_supervisor', { challan_id: cid });
          this.takaEvent(t.taka, cx + 0.3, 'challan_cancelled', 'godown_supervisor', { challan_id: cid, note: 'Wrong party picked — challan cancelled' });
        }
        this.sink.add('challan_events', { challan_id: cid, event: 'edited', note: 'Cancelled: wrong party', role: 'godown_supervisor', user_id: this.users.godown_supervisor }, this.iso(cx + 0.3));
      }
      const isEdited = !edited && kind === 'mill' && x0 > this.clock.H - 40;
      if (isEdited) edited = true;
      const received = g.filter((t) => this.happened(t.receiveX)).length;
      const id = this.sink.add('challans', {
        kind,
        challan_no: ++seq[kind],
        party_id: g[0].partyId,
        challan_date: c.day(x0),
        eway_no: this.rng.chance(0.4) ? String(this.rng.int(100000000000, 999999999999)) : null,
        status: 'active',
        created_by: 'godown_supervisor',
        received_count: kind === 'mill' ? received : 0,
        transport: isEdited ? 'Shree Maruti Tempo' : null,
        vehicle_no: isEdited ? 'GJ-05-BX-4471' : null,
        notes: isEdited ? 'Vehicle changed after loading' : null,
        fy: fyOf(this.iso(x0)),
      }, this.iso(x0));
      if (isEdited) this.sink.add('challan_events', { challan_id: id, event: 'edited', note: 'Transport, vehicle no. and notes changed', role: 'godown_supervisor', user_id: this.users.godown_supervisor }, this.iso(x0 + 0.2));
      for (const t of g) {
        t.challanId = id;
        const tk = t.taka;
        t.challanTakaId = this.sink.add('challan_takas', {
          challan_id: id,
          kind,
          taka_id: tk.id,
          order_id: tk.order.id,
          meters: tk.actualMeters ?? tk.meters,
          pcs: tk.actualPcs ?? tk.pcs,
          is_active: latest.get(`${tk.id}|${kind}`) === t ? 1 : 0,
          received_at: this.happened(t.receiveX) ? this.iso(t.receiveX) : null,
          received_by: this.happened(t.receiveX) ? 'godown_supervisor' : null,
          qc_done_at: this.happened(t.qcX) ? this.iso(t.qcX) : null,
          is_refinish: t.isRefinish,
          lost_at: t.lostX !== null ? this.iso(t.lostX) : null,
          lost_by: t.lostX !== null ? 'gaurang' : null,
        }, this.iso(t.sendX));
        if (t.lostX !== null) this.sink.add('challan_events', { challan_id: id, event: 'taka_lost', note: `Taka ${tk.no} lost at the party`, role: 'gaurang', user_id: this.users.gaurang }, this.iso(t.lostX));
      }
    }
  }

  /* ---------- delivery challans + goods returns ---------- */

  dispatches(a: Aftermath) {
    const all = [...a.dispatches, ...a.cancelledDcs.filter((d) => !a.dispatches.includes(d))].sort((x, y) => x.x - y.x || x.revision - y.revision);
    let seq = 0;
    for (const d of all) if (d.revision === 0) d.no = ++seq;
    for (const d of all) if (d.revision > 0) d.no = all.find((p) => p.id === d.parentId)!.no;
    for (const d of all.sort((x, y) => x.revision - y.revision || x.x - y.x)) this.dc(d);
    for (const gr of a.goodsReturns) {
      const pcs = gr.takas.reduce((s, t) => s + (t.actualPcs ?? t.pcs ?? 0), 0);
      this.sink.add('goods_returns', {
        id: gr.id, challan_id: gr.dc.id, new_challan_id: gr.newDc.id, return_date: this.clock.day(gr.x), note: 'Client returned a few takas', role: 'dhruvil', user_id: this.users.dhruvil,
        returned_takas: gr.takas.length, returned_pcs: pcs, damaged_pcs: gr.damaged,
      }, this.iso(gr.x));
      gr.takas.forEach((t, i) => this.sink.add('goods_return_takas', { goods_return_id: gr.id, taka_id: t.id, pcs: t.actualPcs ?? t.pcs, damaged_pcs: i === 0 ? gr.damaged : 0 }, this.iso(gr.x)));
    }
  }

  private dc(d: Dispatch) {
    const at = this.iso(d.x);
    this.sink.add('dispatch_challans', {
      id: d.id, challan_no: d.no, revision: d.revision, parent_challan_id: d.parentId, order_id: d.order.id, challan_date: this.clock.day(d.x),
      transport: d.transport, lr_no: d.lrNo, eway_no: null, status: d.status, created_by: 'dhruvil', created_by_user_id: this.users.dhruvil,
      vehicle_no: d.vehicleNo, notes: null, cancelled_at: d.cancelledX !== null ? this.iso(d.cancelledX) : null, cancelled_by: d.cancelledX !== null ? 'dhruvil' : null,
      cancelled_reason: d.cancelReason, fy: fyOf(at),
    }, at);
    for (const t of d.takas) this.sink.add('dispatch_challan_takas', { challan_id: d.id, taka_id: t.id, taka_no: t.no, meters: t.actualMeters ?? t.meters, pcs: t.actualPcs ?? t.pcs }, at);
    if (d.status === 'cancelled') {
      this.sink.add('dispatch_challan_events', { challan_id: d.id, event: 'dispatch_undone', note: d.cancelReason, role: 'dhruvil', user_id: this.users.dhruvil }, this.iso(d.cancelledX!));
      this.sink.add('order_events', { order_id: d.order.id, event: 'dispatch_undone', note: `DC-${d.no} cancelled: ${d.cancelReason}`, role: 'dhruvil', user_id: this.users.dhruvil }, this.iso(d.cancelledX!));
    }
  }

  /* ---------- orders ---------- */

  order(o: SimOrder) {
    const c = this.clock;
    const created = this.iso(o.createdX);
    const sentJs = o.jobsheets.filter((j) => !j.external);
    this.sink.add('orders', {
      id: o.id,
      order_no: o.no,
      customer_id: o.customerId,
      material_id: o.materialId,
      design_id: o.designId,
      quantity: o.qty,
      unit: o.unit,
      rate: o.rate,
      order_date: c.day(o.createdX),
      notes: o.notes,
      status: o.status,
      sent_to_production_at: this.happened(o.sentX) ? this.iso(o.sentX) : null,
      frames_per_jobsheet: o.unit === 'pcs' && sentJs.length ? Math.max(...sentJs.map((j) => j.frames)) : null,
      meters_per_jobsheet: o.unit === 'meters' && sentJs.length ? Math.max(...sentJs.map((j) => j.meters ?? 0)) : null,
      broker_id: o.brokerId,
      order_type: o.orderType,
      blouse_option: o.blouse,
      is_on_hold: o.holdX !== null,
      held_at: o.holdX !== null ? this.iso(o.holdX) : null,
      held_by_user_id: o.holdBy ? this.users[o.holdBy] : null,
      hold_note: o.holdX !== null ? 'Client asked to wait — colour change pending' : null,
      released_at: o.pastHold ? this.iso(o.pastHold.releasedX) : null,
      has_production: o.hasProduction,
      has_butta: o.hasButta,
      has_mill: o.hasMill,
      is_closed: o.closeX !== null || o.isHolder,
      closed_at: o.closeX !== null ? this.iso(o.closeX) : null,
      closed_by_user_id: o.closeX !== null ? this.users.jemish : null,
      close_note: o.closeX !== null ? 'Client does not need the rest' : null,
      is_outside_order: o.isOutside,
      outside_party_name: o.outsideParty,
      is_stock_holder: o.isHolder,
      fg_type: o.fgType,
      promised_date: o.promisedDay,
      fy: fyOf(created),
    }, created);
    if (o.isHolder) {
      for (const j of o.jobsheets) this.jobsheet(j);
      for (const t of o.takas) this.taka(t);
      return;
    }
    for (const h of o.history) this.sink.add('order_status_history', { order_id: o.id, from_status: h.from, to_status: h.to, role: h.to === 'closed' ? 'jemish' : h.from === null || h.to === 'ready_production' ? 'jemish' : 'gaurang', changed_at: this.iso(h.x), user_id: this.users.jemish }, this.iso(h.x));
    if (o.holdX !== null) this.sink.add('order_hold_events', { order_id: o.id, event: 'held', note: 'Client asked to wait — colour change pending', role: o.holdBy!, user_id: this.users[o.holdBy!] }, this.iso(o.holdX));
    if (o.pastHold) {
      this.sink.add('order_hold_events', { order_id: o.id, event: 'held', note: 'Payment pending', role: o.pastHold.by, user_id: this.users[o.pastHold.by] }, this.iso(o.pastHold.x));
      this.sink.add('order_hold_events', { order_id: o.id, event: 'released', note: null, role: o.pastHold.by, user_id: this.users[o.pastHold.by] }, this.iso(o.pastHold.releasedX));
    }
    if (o.closeX !== null) this.sink.add('order_events', { order_id: o.id, event: 'order_closed', note: 'Client does not need the rest', role: 'jemish', user_id: this.users.jemish }, this.iso(o.closeX));
    for (const j of o.jobsheets) this.jobsheet(j);
    for (const t of o.takas) this.taka(t);
  }

  private jobsheet(j: (SimOrder['jobsheets'])[number]) {
    const H = this.clock.H;
    const status = j.external ? 'completed' : j.endX !== null && j.endX <= H ? 'completed' : j.startX !== null && j.startX <= H ? 'ongoing' : j.sentX !== null && j.sentX <= H ? 'sent' : 'pending';
    const takas = j.takas.filter((t) => t.parentId === null && !t.isReturnLot && t.deletedX === null);
    const entered = j.entryX !== null && j.entryX <= H && takas.length > 0;
    const pcs = takas.reduce((s, t) => s + (t.pcs ?? 0), 0);
    const m = takas.reduce((s, t) => s + (t.meters ?? 0), 0);
    const by: RoleKey = j.floorUser;
    this.sink.add('jobsheets', {
      id: j.id,
      jobsheet_no: j.no,
      order_id: j.order.id,
      frames: j.frames,
      created_by: j.external ? 'dhruvil' : 'gaurang',
      is_deleted: j.deletedX !== null,
      status,
      sent_at: !j.external && j.sentX !== null && j.sentX <= H ? this.iso(j.sentX) : null,
      started_at: !j.external && j.startX !== null && j.startX <= H ? this.iso(j.startX) : null,
      completed_at: status === 'completed' ? this.iso(j.endX!) : null,
      running_machine_id: j.startX !== null && j.startX <= H ? j.machineId : null,
      completed_frames: j.external ? 0 : status === 'completed' && entered && j.order.unit === 'pcs' ? framesFromTakaPcs(pcs, j.sections) : null,
      completed_meters: status === 'completed' && entered && j.order.unit === 'meters' ? metersFromTakaMeters(m, j.sections) : null,
      parent_jobsheet_id: j.parentId,
      is_external: j.external,
      sections: j.sections,
      meters: j.meters,
      fy: fyOf(this.iso(j.createdX)),
    }, this.iso(j.createdX));
    if (j.external) return;
    for (const mId of j.assigned) this.sink.add('jobsheet_machines', { jobsheet_id: j.id, machine_id: mId }, this.iso(j.createdX));
    const ev = (x: number, event: string, role: RoleKey, extra: Record<string, unknown> = {}) =>
      this.sink.add('jobsheet_events', { jobsheet_id: j.id, event, role, user_id: this.users[role], ...extra }, this.iso(x));
    ev(j.createdX, 'created', 'gaurang', { frames: j.frames || null });
    if (j.sentX !== null && j.sentX <= H) ev(j.sentX, 'sent', 'gaurang');
    if (j.startX !== null && j.startX <= H) ev(j.startX, 'started', by, { machine_id: j.machineId });
    if (status === 'completed') {
      if (j.changedMachine) ev(j.endX!, 'machine_changed', by, { machine_id: j.machineId, frames: j.partialFrames, note: 'Loom stopped — beam problem' });
      ev(j.endX!, 'completed', by, { machine_id: j.machineId, note: j.completedOnHold ? 'completed on hold' : null });
    }
    if (entered) ev(j.entryX!, 'takas_entered', 'taka_entry', { note: `${takas.length} taka${takas.length === 1 ? '' : 's'}${o2(takas)}` });
  }

  /* ---------- takas ---------- */

  private takaEvent(t: SimTaka, x: number, event: string, role: RoleKey, extra: Record<string, unknown> = {}) {
    this.sink.add('taka_events', { taka_id: t.id, event, role, user_id: this.users[role], ...extra }, this.iso(x));
  }

  private taka(t: SimTaka) {
    const H = this.clock.H;
    const last = t.moves[t.moves.length - 1];
    const stage = last?.stage ?? 'entered';
    const open = t.damages.some((d) => d.resolvedPcs < (d.pcs ?? 0) || (d.pcs === null && d.resolvedX === null));
    const ticked = (stage === 'ready_dispatch' || stage === 'dispatched') && t.checkedX !== null;
    this.sink.add('takas', {
      id: t.id,
      jobsheet_id: t.js.id,
      order_id: t.order.id,
      taka_no: t.no,
      is_damaged: open,
      entered_by: t.enteredBy,
      is_deleted: t.deletedX !== null && t.deletedX <= H,
      stage,
      meters: t.meters,
      pcs: t.pcs,
      refinish_count: t.refinishCount,
      parent_taka_id: t.parentId,
      actual_pcs: t.actualPcs,
      godown_checked_at: ticked ? this.iso(t.checkedX!) : null,
      godown_checked_by: ticked ? 'dhruvil' : null,
      rework_count: t.reworkCount,
      returned_at: t.returnedX !== null ? this.iso(t.returnedX) : null,
      returned_from_challan_id: t.returnedFromChallanId,
      is_return_lot: t.isReturnLot,
      is_free_stock: t.freeX !== null && t.freeX <= H,
      free_stock_at: t.freeX !== null ? this.iso(t.freeX) : null,
      free_stock_by: t.freeBy,
      free_stock_reason: t.freeReason,
      has_been_to_mill: t.hasBeenToMill,
      source: t.source,
      weaver_taka_no: t.weaverTakaNo,
      weaver_id: t.weaverId,
      has_own_number: t.source !== 'production',
      outside_receipt_id: t.receiptId,
      is_received_lot: t.isReceivedLot,
      actual_meters: t.actualMeters,
      removed_reason: t.removedReason,
      removed_by_user_id: t.removedReason ? this.users.jemish : null,
      removed_at: t.deletedX !== null ? this.iso(t.deletedX) : null,
      stage_before_rework: stage === 'rework_butta' ? t.stageBeforeRework : null,
      fy: fyOf(this.iso(t.createdX)),
      updated_at: this.iso(Math.max(t.createdX, last?.x ?? t.createdX, t.freeX ?? 0)),
    }, this.iso(t.createdX));
    for (const m of t.moves) {
      this.takaEvent(t, m.x, m.event, m.role, { challan_id: m.trip?.challanId || null, dispatch_challan_id: m.dcId ?? null, note: m.note ?? null });
      if (m.trip && (m.event === 'butta_qc_done' || m.event === 'mill_qc_done' || m.event === 'sent_refinish')) this.qcRun(t, m.trip, m.x, m.stage);
    }
    for (const d of t.damages) this.damage(t, d);
  }

  private qcRun(t: SimTaka, trip: Trip, x: number, result: string) {
    const before = t.damages
      .filter((d) => d.x < x - 0.0005)
      .map((d) => ({
        id: d.id,
        status: d.resolvedX !== null && d.resolvedX < x - 0.0005 ? 'resolved' : 'open',
        pcs: d.pcs,
        resolvedPcs: d.resolvedX !== null && d.resolvedX < x - 0.0005 ? d.resolvedPcs : 0,
        meters: d.meters,
        resolvedMeters: d.resolvedX !== null && d.resolvedX < x - 0.0005 && d.meters !== null ? d.meters : 0,
        resolvedAt: d.resolvedX !== null && d.resolvedX < x - 0.0005 ? this.iso(d.resolvedX) : null,
        resolvedBy: d.resolvedX !== null && d.resolvedX < x - 0.0005 ? d.resolvedBy : null,
        resolvedStage: d.resolvedX !== null && d.resolvedX < x - 0.0005 ? d.resolvedStage : null,
      }));
    const added = t.damages.filter((d) => Math.abs(d.x - x) < 0.0005 || (d.x >= x - 0.0005 && d.x <= x + 0.0005)).map((d) => d.id);
    this.sink.add('qc_runs', {
      taka_id: t.id,
      kind: trip.kind,
      result,
      changes: JSON.stringify({ before, addedIds: added, stageBefore: trip.kind === 'butta' ? 'butta_qc' : 'mill_qc', refinishCountBefore: trip.isRefinish ? t.refinishCount - 1 : t.refinishCount }),
      done_by_role: 'qc',
      done_by_user_id: this.users.qc,
    }, this.iso(x));
  }

  private damage(t: SimTaka, d: SimDamage) {
    const resolved = d.resolvedX !== null && d.resolvedPcs >= (d.pcs ?? 0);
    this.sink.add('taka_damages', {
      id: d.id,
      taka_id: t.id,
      damage_id: d.damageId,
      found_at: d.foundAt,
      pcs: d.pcs,
      status: resolved ? 'resolved' : 'open',
      resolved_at: d.resolvedX !== null ? this.iso(d.resolvedX) : null,
      resolved_by: d.resolvedBy,
      resolved_stage: d.resolvedStage,
      created_by: d.createdBy,
      resolved_pcs: d.resolvedPcs,
      recorded_at: d.recordedAt,
      meters: d.meters,
      resolved_meters: resolved && d.meters !== null ? d.meters : 0,
    }, this.iso(d.x));
    this.takaEvent(t, d.x, 'damage_added', d.createdBy, { taka_damage_id: d.id });
    if (d.resolvedX !== null) this.takaEvent(t, d.resolvedX, 'damage_resolved', d.resolvedBy ?? 'qc', { taka_damage_id: d.id });
    if (d.photo && PHOTO_URLS.length) {
      const p = PHOTO_URLS[d.id % PHOTO_URLS.length];
      this.sink.add('taka_damage_images', { taka_damage_id: d.id, image_url: p.url, thumb_url: p.thumbUrl, created_by: 'qc' }, this.iso(d.x));
    }
  }

  /* ---------- outside POs / receipts ---------- */

  outside(o: OutsideSim) {
    for (const p of o.pos) {
      const at = this.iso(p.poX);
      this.sink.add('outside_pos', {
        id: p.id, po_no: p.no, order_id: p.order.id, weaver_id: p.weaverId, material_id: p.order.materialId, quantity: p.qty, unit: 'pcs', order_type: p.order.orderType,
        rate: p.rate, po_date: this.clock.day(p.poX), notes: null, status: p.status, received_qty: p.receivedQty, received_takas: p.receivedTakas,
        closed_at: p.closedX !== null ? this.iso(p.closedX) : null, closed_by_user_id: p.closedX !== null ? this.users.gaurang : null, close_reason: p.closedX !== null ? 'Weaver stopped the design' : null,
        cancelled_at: p.cancelledX !== null ? this.iso(p.cancelledX) : null, created_by: 'gaurang', created_by_user_id: this.users.gaurang, fy: fyOf(at), due_date: p.dueDay,
      }, at);
    }
    for (const r of o.receipts) {
      this.sink.add('outside_receipts', {
        id: r.id, kind: r.kind, po_id: r.po?.id ?? null, order_id: r.order.id, weaver_id: r.weaverId, supplier_name: r.supplier, challan_no: r.challanNo,
        receipt_date: this.clock.day(r.x), notes: null, takas: r.takas, pcs: r.pcs, meters: r.meters, damaged_pcs: r.damagedPcs, created_by: 'dhruvil', created_by_user_id: this.users.dhruvil,
      }, this.iso(r.x));
    }
  }
}

const o2 = (takas: SimTaka[]) => {
  const d = takas.filter((t) => t.damages.some((x) => x.recordedAt === 'taka_entry')).length;
  return d ? ` (${d} damage${d === 1 ? '' : 's'})` : '';
};
