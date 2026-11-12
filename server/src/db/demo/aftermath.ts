import type { Clock, Rng } from './clock';
import type { Dispatch, SimOrder, SimTaka, Trip } from './model';
import { stageAt, type Ids, type ProductionSim } from './production';

/**
 * Sprint 26 — what happens once takas are ready: splits, over-production moved to inventory, delivery challans (whole
 * or in parts), orders closed early, old challan goods returns (DC revisions), one undone dispatch, lost takas.
 */

const TRANSPORTS = ['VRL Logistics', 'Shree Maruti Courier', 'Gati', 'Own tempo', 'Patel Roadways'];

export interface GoodsReturnSim {
  id: number;
  dc: Dispatch;
  newDc: Dispatch;
  x: number;
  takas: SimTaka[];
  damaged: number;
}

export class Aftermath {
  readonly dispatches: Dispatch[] = [];
  readonly goodsReturns: GoodsReturnSim[] = [];
  readonly cancelledDcs: Dispatch[] = [];

  constructor(
    private readonly clock: Clock,
    private readonly rng: Rng,
    private readonly ids: Ids,
    private readonly sim: ProductionSim,
  ) {}

  private readyX = (t: SimTaka) => t.moves.find((m) => m.stage === 'ready_dispatch')?.x ?? null;
  private lastStage = (t: SimTaka) => t.moves[t.moves.length - 1]?.stage ?? null;

  private newDc(o: SimOrder, x: number, takas: SimTaka[]): Dispatch {
    const r = this.rng;
    const dc: Dispatch = {
      id: this.ids.reserve('dispatch_challans'),
      no: 0,
      revision: 0,
      parentId: null,
      order: o,
      x,
      takas,
      status: 'active',
      cancelledX: null,
      cancelReason: null,
      transport: r.pick(TRANSPORTS),
      lrNo: String(r.int(10000, 99999)),
      vehicleNo: r.chance(0.6) ? `GJ-05-${String.fromCharCode(65 + r.int(0, 25))}${String.fromCharCode(65 + r.int(0, 25))}-${r.int(1000, 9999)}` : null,
    };
    for (const t of takas) t.moves.push({ x, stage: 'dispatched', event: 'dispatched', role: 'dhruvil', dcId: dc.id });
    o.dispatches.push(dc);
    this.dispatches.push(dc);
    return dc;
  }

  /** Splits a ready taka into two (the original keeps its number; the part gets the next letter). */
  split(t: SimTaka, x: number) {
    if (t.pcs === null || t.pcs < 10) return;
    const part = Math.floor(t.pcs / 2);
    const keep = (t.actualPcs ?? t.pcs) - part;
    const child = this.sim.newTaka(t.order, t.js, {
      no: `${t.no}A`,
      pcs: part,
      meters: t.meters !== null ? Math.round(((t.actualMeters ?? t.meters) * part) / t.pcs * 100) / 100 : null,
      createdX: x,
      parentId: t.id,
      source: t.source,
      enteredBy: 'dhruvil',
      hasBeenToMill: t.hasBeenToMill,
      weaverId: t.weaverId,
    });
    child.moves = [{ x, stage: stageAt(t, x) ?? 'final', event: 'split', role: 'dhruvil', note: `Split from ${t.no}` }];
    child.checkedX = t.checkedX;
    t.actualPcs = keep;
    if (t.meters !== null) t.actualMeters = Math.round(((t.actualMeters ?? t.meters) - (child.meters ?? 0)) * 100) / 100;
    t.moves.push({ x, stage: stageAt(t, x) ?? 'final', event: 'split', role: 'dhruvil', note: `Split into ${t.no} and ${child.no}` });
    t.moves.sort((a, b) => a.x - b.x);
  }

  /** Dispatch for one order (after the flow was cut at now). */
  dispatch(o: SimOrder) {
    const r = this.rng;
    const { H } = this.clock;
    const limit = o.holdX ?? H;
    const have = o.takas.filter((t) => t.deletedX === null);
    if (!have.length || o.stall === 'dispatch') return;
    const qtyOf = (t: SimTaka) => (o.unit === 'meters' ? (t.actualMeters ?? t.meters ?? 0) : (t.actualPcs ?? t.pcs ?? 0));
    // over-production moved to inventory before dispatch (free stock, some of it ends up dead stock)
    const ready = have.filter((t) => this.readyX(t) !== null).sort((a, b) => this.readyX(a)! - this.readyX(b)!);
    const total = have.reduce((s, t) => s + qtyOf(t), 0);
    const allReady = ready.length === have.length;
    if (allReady && !o.closeEarly && !o.noFreeStock && total > o.qty * 1.04 && o.unit === 'pcs') {
      let extra = total - o.qty;
      for (const t of [...ready].reverse()) {
        if (qtyOf(t) > extra) continue;
        const x = this.readyX(t)! + r.u(0.2, 1.5);
        if (x > limit) continue;
        extra -= qtyOf(t);
        t.freeX = x;
        t.freeReason = 'moved';
        t.freeBy = 'dhruvil';
        t.moves.push({ x, stage: 'final', event: 'moved_to_inventory', role: 'dhruvil', note: 'Extra pcs — moved to inventory' });
      }
    }
    const left = ready.filter((t) => t.freeX === null);
    if (!left.length) return;
    const lastReady = this.readyX(left[left.length - 1])!;
    if (o.closeEarly) {
      // half goes out, then the order is closed and the rest becomes free stock
      const x1 = this.readyX(left[Math.floor(left.length / 2)])! + r.u(0.3, 1.5);
      if (x1 > H - 3 || !allReady) return;
      this.newDc(o, x1, left.slice(0, Math.max(1, Math.floor(left.length / 2))));
      o.closeX = Math.max(x1, lastReady) + r.u(1.5, 5);
      for (const t of have) {
        if (t.moves.some((m) => m.stage === 'dispatched') || t.freeX !== null) continue;
        t.freeX = o.closeX;
        t.freeReason = 'order_closed';
        t.freeBy = 'jemish';
        t.moves.push({ x: o.closeX, stage: 'final', event: 'moved_to_inventory', role: 'jemish', note: 'Order closed' });
      }
      return;
    }
    if (allReady && o.stall === 'dispatch_half') {
      // half went out; the client asked to hold the rest for a few days (Partly dispatched)
      const x1 = this.readyX(left[Math.floor(left.length / 2)])! + r.u(0.3, 1.5);
      if (x1 <= limit) this.newDc(o, x1, left.slice(0, Math.max(1, Math.floor(left.length / 2))));
      return;
    }
    if (allReady) {
      const partial = left.length >= 8 && r.chance(0.3);
      if (partial) {
        const half = Math.floor(left.length / 2);
        const x1 = this.readyX(left[half - 1])! + r.u(0.3, 2);
        if (x1 <= limit) this.newDc(o, x1, left.slice(0, half));
        const x2 = Math.max(x1, lastReady) + r.u(0.4, 3);
        if (x2 <= limit && x1 <= limit) this.newDc(o, x2, left.slice(half));
      } else {
        const x = lastReady + r.u(0.3, 3);
        if (x <= limit) this.newDc(o, x, left);
      }
    } else if (ready.length >= 8 && r.chance(0.35)) {
      // part of the order is ready: send what is ready (Partly dispatched)
      const send = left.slice(0, Math.max(1, Math.floor(left.length * 0.8)));
      const x = this.readyX(send[send.length - 1])! + r.u(0.3, 2);
      if (x <= limit) this.newDc(o, x, send);
    }
  }

  /** An old challan goods return: some takas came back → free stock, the DC gets revision R1 without them. */
  goodsReturn(o: SimOrder) {
    const r = this.rng;
    const dc = o.dispatches.find((d) => d.revision === 0 && d.takas.length >= 4);
    if (!dc) return false;
    const x = dc.x + r.u(4, 12);
    if (x > this.clock.H - 1) return false;
    const back = r.sample(dc.takas, r.int(2, 3));
    const gr: GoodsReturnSim = { id: this.ids.reserve('goods_returns'), dc, newDc: dc, x, takas: back, damaged: 0 };
    for (const t of back) {
      t.freeX = x;
      t.freeReason = 'goods_return';
      t.freeBy = 'dhruvil';
      t.returnedX = x;
      t.returnedFromChallanId = dc.id;
      t.moves.push({ x, stage: 'final', event: 'goods_returned', role: 'dhruvil', note: 'Returned by the client' });
    }
    const d = this.sim.damage(back[0], 'unmarked', 'goods_return', x + 0.001, ['Hole', 'Oil stain', 'Shade variation'], 'dhruvil');
    gr.damaged = d.pcs ?? 0;
    dc.status = 'revised';
    const rest = dc.takas.filter((t) => !back.includes(t));
    const rev: Dispatch = { ...dc, id: this.ids.reserve('dispatch_challans'), revision: 1, parentId: dc.id, x, takas: rest, status: 'active' };
    o.dispatches.push(rev);
    this.dispatches.push(rev);
    gr.newDc = rev;
    o.grX = x;
    this.goodsReturns.push(gr);
    return true;
  }

  /** Undo dispatch: the latest DC of a ready order was cancelled; its takas are back to Ready for dispatch. */
  undoDispatch(o: SimOrder) {
    const { H } = this.clock;
    const ready = o.takas.filter((t) => this.lastStage(t) === 'ready_dispatch' && t.freeX === null);
    if (ready.length < 2) return false;
    const x = Math.max(...ready.map((t) => this.readyX(t)!)) + 0.2;
    if (x > H - 0.5) return false;
    const dc = Object.assign(this.newDcBare(o, x, ready), { status: 'cancelled' as const, cancelledX: x + 0.15, cancelReason: 'Wrong transport booked — truck changed' });
    for (const t of ready) {
      t.moves.push({ x, stage: 'dispatched', event: 'dispatched', role: 'dhruvil', dcId: dc.id });
      t.moves.push({ x: x + 0.15, stage: 'ready_dispatch', event: 'dispatch_undone', role: 'dhruvil', dcId: dc.id, note: dc.cancelReason! });
    }
    this.cancelledDcs.push(dc);
    return true;
  }

  private newDcBare(o: SimOrder, x: number, takas: SimTaka[]): Dispatch {
    const dc = this.newDc(o, x, []);
    dc.takas = takas;
    return dc;
  }

  /** Takas lost at a party (their challan row is marked lost). */
  lose(trip: Trip, x: number) {
    trip.lostX = x;
    trip.taka.lostX = x;
    trip.taka.moves.push({ x, stage: 'lost', event: 'marked_lost', role: 'gaurang', trip, note: 'Party says the taka never reached them' });
  }
}
