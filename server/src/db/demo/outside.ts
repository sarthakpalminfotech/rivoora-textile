import { nextTakaStage } from '@rivoora/shared';
import type { Clock, Rng } from './clock';
import { FG_SUPPLIERS } from './masters';
import type { SimJs, SimOrder } from './model';
import type { Ids, ProductionSim } from './production';

/**
 * Sprint 26 — outside production (POs to weavers) and FG purchase in the demo. Takas received from outside sit on the
 * order's hidden external jobsheet (number −order id, Completed, 0 frames) like the real app does.
 */

export interface SimPo {
  id: number;
  no: number;
  order: SimOrder;
  weaverId: number;
  qty: number;
  rate: number;
  poX: number;
  dueDay: string | null;
  status: 'open' | 'partly_received' | 'received' | 'closed' | 'cancelled';
  receivedQty: number;
  receivedTakas: number;
  closedX: number | null;
  cancelledX: number | null;
}

export interface SimReceipt {
  id: number;
  kind: 'outside_po' | 'fg';
  po: SimPo | null;
  order: SimOrder;
  weaverId: number | null;
  supplier: string | null;
  challanNo: string;
  x: number;
  takas: number;
  pcs: number;
  meters: number;
  damagedPcs: number;
}

/** Damage share per weaver (index in the weaver list) — the "Weaver quality" card ranks them. */
const WEAVER_DAMAGE = [0.02, 0.045, 0.09, 0.03, 0.13, 0.055, 0.015, 0.065];

export class OutsideSim {
  readonly pos: SimPo[] = [];
  readonly receipts: SimReceipt[] = [];
  private poSeq = 0;
  private weaverNo = new Map<number, number>();

  constructor(
    private readonly clock: Clock,
    private readonly rng: Rng,
    private readonly ids: Ids,
    private readonly sim: ProductionSim,
    private readonly weavers: { id: number; code: string }[],
  ) {}

  /** The weaver's own taka numbers run on per weaver. */
  private nextWeaverNo(id: number) {
    const n = (this.weaverNo.get(id) ?? 100 + id * 7) + 1;
    this.weaverNo.set(id, n);
    return n;
  }

  private externalJs(o: SimOrder, x: number): SimJs {
    const found = o.jobsheets.find((j) => j.external);
    if (found) return found;
    const js: SimJs = {
      id: this.ids.reserve('jobsheets'),
      no: -o.id,
      order: o,
      external: true,
      frames: 0,
      meters: null,
      sections: 3,
      createdX: x,
      sentX: null,
      startX: null,
      endX: x,
      entryX: x,
      deletedX: null,
      machineId: null,
      assigned: [],
      parentId: null,
      partialFrames: null,
      changedMachine: false,
      completedOnHold: false,
      floorUser: 'supervisor',
      takas: [],
    };
    o.jobsheets.push(js);
    return js;
  }

  /** Outside production: one or two POs, deliveries in a few challans with the weaver's damage rate. */
  runOutside(o: SimOrder, special?: 'closed' | 'cancelled') {
    const r = this.rng;
    const { H } = this.clock;
    if (o.sentX === null) return;
    const split = o.qty >= 240 && r.chance(0.3) ? 2 : 1;
    const ws = r.sample(this.weavers, split);
    let left = o.qty;
    ws.forEach((w, i) => {
      const qty = i === ws.length - 1 ? left : 3 * Math.round(o.qty / split / 3);
      left -= qty;
      const poX = o.sentX! + r.u(0.1, 1.5);
      if (poX > H) return;
      const po: SimPo = {
        id: this.ids.reserve('outside_pos'),
        no: ++this.poSeq,
        order: o,
        weaverId: w.id,
        qty,
        rate: Math.round(r.u(140, 260)),
        poX,
        dueDay: r.chance(0.75) ? this.clock.day(poX + r.int(16, 28)) : null,
        status: 'open',
        receivedQty: 0,
        receivedTakas: 0,
        closedX: null,
        cancelledX: null,
      };
      this.pos.push(po);
      if (special === 'cancelled' && i === 0) {
        po.status = 'cancelled';
        po.cancelledX = poX + r.u(1, 3);
        return;
      }
      const dmgRate = WEAVER_DAMAGE[this.weavers.indexOf(w) % WEAVER_DAMAGE.length];
      let x = poX + r.u(9, 22);
      let got = 0;
      let challan = r.int(100, 900);
      while (got < qty && x <= H) {
        const part = got === 0 && qty > 90 && r.chance(0.7) ? 3 * Math.round((qty * r.u(0.35, 0.6)) / 3) : qty - got;
        if ((special === 'closed' || o.slowWeaver) && got > 0) break;
        const rec = this.receive(o, po, w, x, Math.min(part, qty - got), dmgRate, `${w.code}-${challan++}`);
        got += rec.pcs;
        x += r.u(4, 11);
      }
      po.receivedQty = got;
      po.status = got >= qty ? 'received' : got > 0 ? 'partly_received' : 'open';
      if (special === 'closed' && got > 0 && got < qty) {
        po.status = 'closed';
        po.closedX = Math.min(H - 0.5, x - r.u(1, 3));
      }
    });
  }

  private receive(o: SimOrder, po: SimPo, w: { id: number; code: string }, x: number, pcs: number, dmgRate: number, challanNo: string): SimReceipt {
    const r = this.rng;
    const js = this.externalJs(o, x);
    const rec: SimReceipt = { id: this.ids.reserve('outside_receipts'), kind: 'outside_po', po, order: o, weaverId: w.id, supplier: null, challanNo, x, takas: 0, pcs: 0, meters: 0, damagedPcs: 0 };
    const n = Math.max(1, Math.round(pcs / r.u(12, 16)));
    const base = Math.floor(pcs / n);
    for (let k = 0; k < n; k++) {
      const p = base + (k < pcs - base * n ? 1 : 0);
      const t = this.sim.newTaka(o, js, {
        pcs: p,
        meters: Math.round(p * r.u(5.6, 6.2) * 100) / 100,
        createdX: x + k * 0.0004,
        source: 'outside_po',
        weaverId: w.id,
        weaverTakaNo: String(this.nextWeaverNo(w.id)),
        receiptId: rec.id,
        enteredBy: 'dhruvil',
      });
      if (r.chance(dmgRate * 4)) {
        const d = this.sim.damage(t, 'machine', 'outside_receipt', x + 0.0002, ['Float', 'Missing pick', 'Hole', 'Broken warp'], 'dhruvil');
        rec.damagedPcs += d.pcs ?? 0;
      }
      rec.takas += 1;
      rec.pcs += p;
      rec.meters += t.meters ?? 0;
      this.sim.flow(t, nextTakaStage({ hasButta: o.hasButta, hasMill: o.hasMill }, 'outside_receipt'));
    }
    po.receivedTakas += rec.takas;
    rec.meters = Math.round(rec.meters * 100) / 100;
    this.receipts.push(rec);
    return rec;
  }

  /** FG purchase: goods bought finished from a supplier, straight into the godown (some still awaited). */
  runFg(o: SimOrder) {
    const r = this.rng;
    const { H } = this.clock;
    if (o.sentX === null) return;
    const supplier = r.pick(FG_SUPPLIERS);
    let x = o.slowWeaver && o.stall === 'entry' ? H + 1 : o.sentX + r.u(6, 24);
    let got = 0;
    let challan = r.int(10, 400);
    while (got < o.qty && x <= H && !(o.slowWeaver && got > 0)) {
      const part = got === 0 && o.qty > 90 && r.chance(0.5) ? 3 * Math.round((o.qty * r.u(0.4, 0.6)) / 3) : o.qty - got;
      const js = this.externalJs(o, x);
      const rec: SimReceipt = { id: this.ids.reserve('outside_receipts'), kind: 'fg', po: null, order: o, weaverId: null, supplier, challanNo: `FG-${challan++}`, x, takas: 0, pcs: 0, meters: 0, damagedPcs: 0 };
      if (o.orderType === 'pcs_to_pcs') {
        const t = this.sim.newTaka(o, js, { pcs: part, meters: null, createdX: x, source: 'fg_purchase', receiptId: rec.id, isReceivedLot: true, enteredBy: 'dhruvil' });
        rec.takas = 1;
        rec.pcs = part;
        this.sim.flow(t, 'final');
      } else {
        const n = Math.max(1, Math.round(part / r.u(12, 16)));
        const base = Math.floor(part / n);
        for (let k = 0; k < n; k++) {
          const p = base + (k < part - base * n ? 1 : 0);
          const t = this.sim.newTaka(o, js, { pcs: p, meters: Math.round(p * r.u(5.5, 6.2) * 100) / 100, createdX: x + k * 0.0004, source: 'fg_purchase', receiptId: rec.id, enteredBy: 'dhruvil' });
          rec.takas += 1;
          rec.pcs += p;
          rec.meters += t.meters ?? 0;
          this.sim.flow(t, 'final');
        }
        rec.meters = Math.round(rec.meters * 100) / 100;
      }
      this.receipts.push(rec);
      got += part;
      x += r.u(5, 14);
    }
  }
}
