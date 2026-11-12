import { beyondTolerance, framesFromTakaPcs, nextTakaStage, quietClient } from '@rivoora/shared';
import type { Clock, Rng } from './clock';
import { DEMO_CUSTOMERS, QUIET_CUSTOMERS } from './masters';
import type { Kind, Move, SimDamage, SimJs, SimOrder, SimTaka, Trip } from './model';

/**
 * Sprint 26 — the demo order / production simulation. Orders are booked over 14 months; their jobsheets queue on the
 * looms assigned to each order (so some looms stand idle while other jobsheets wait); taka entry, butta cutting, mill,
 * godown and dispatch follow with realistic delays. Only what happened before now (`clock.H`) is kept.
 */

export interface DesignRef {
  idx: number;
  id: number;
  code: string;
  materialIds: number[];
  butta: boolean;
  /** Only ordered long ago (dead stock), or only in the zero-stock quality. */
  retired: boolean;
  zeroStock: boolean;
}

export interface Masters {
  customers: { id: number; brokers: number[] }[];
  designs: DesignRef[];
  machines: number[];
  buttaParties: number[];
  millParties: number[];
  damageIds: Record<string, number>;
}

export interface Ids {
  reserve(table: string): number;
}

const MACHINE_DMG = ['Hole', 'Missing pick', 'Broken warp', 'Float', 'Reed mark', 'Starting mark', 'Thread pull'];
const BUTTA_DMG = ['Cut mark', 'Butta missing', 'Hole', 'Thread pull'];
const MILL_DMG = ['Colour bleed', 'Uneven dye', 'Shade variation', 'Oil stain', 'Patch'];
const GODOWN_DMG = ['Oil stain', 'Hole', 'Patch'];

export class ProductionSim {
  readonly orders: SimOrder[] = [];
  readonly trips: Trip[] = [];
  private looms = new Map<number, number>();
  private takaSeq = 10; // first taka number is 11 (TAKA_NO_START)
  private jsSeq = 300;

  constructor(
    private readonly clock: Clock,
    private readonly rng: Rng,
    private readonly ids: Ids,
    private readonly m: Masters,
  ) {
    for (const id of m.machines) this.looms.set(id, 0);
  }

  /* ------------------------------------------------------------------ */
  /* booking                                                              */
  /* ------------------------------------------------------------------ */

  /** Order days per customer: regular gaps, the quiet four stop 70–110 days ago, more orders in recent months. */
  bookingPlan(total: number): { customerIdx: number; x: number }[] {
    const { H } = this.clock;
    const r = this.rng;
    const out: { customerIdx: number; x: number }[] = [];
    const quietCount = QUIET_CUSTOMERS.length * 9;
    const regular = DEMO_CUSTOMERS.map((c, i) => ({ i, w: c[2] })).filter((c) => !QUIET_CUSTOMERS.includes(c.i));
    const sumW = regular.reduce((s, c) => s + c.w, 0);
    for (const q of QUIET_CUSTOMERS) {
      const gap = r.u(16, 24);
      let x = H - r.u(72, 108);
      for (let k = 0; k < 9 && x > 5; k++) {
        out.push({ customerIdx: q, x });
        x -= gap * r.u(0.8, 1.2);
      }
    }
    for (const c of regular) {
      const n = Math.max(3, Math.round(((total - quietCount) * c.w) / sumW));
      // dates from a density that grows towards today (a growing business)
      const days: number[] = [];
      for (let k = 0; k < n; k++) {
        const u = r.next();
        days.push(Math.min(H - 0.3, (H * (Math.sqrt(0.36 + 1.6 * u) - 0.6)) / 0.8));
      }
      days.sort((a, b) => a - b);
      // a regular client is never "quiet": if the last gap would make it look quiet, it ordered again recently
      const toDays = (xs: number[]) => xs.map((x) => this.clock.day(x));
      while (quietClient(toDays(days), this.clock.today)) days.push(H - r.u(0.3, 6));
      for (const x of days) out.push({ customerIdx: c.i, x });
    }
    return out.sort((a, b) => a.x - b.x);
  }

  /** Creates one order (not simulated yet). */
  book(p: { customerIdx: number; x: number; forced?: Partial<SimOrder> }): SimOrder {
    const r = this.rng;
    const { H } = this.clock;
    const cust = this.m.customers[p.customerIdx];
    const kindRoll = r.next();
    let kind: Kind = kindRoll < 0.6 ? 'pbm' : kindRoll < 0.8 ? 'pm' : kindRoll < 0.87 ? 'p' : kindRoll < 0.94 ? 'outside' : 'fg';
    if (p.forced?.kind) kind = p.forced.kind;
    const old = p.x < H - 240;
    const wantButta = kind === 'pbm' || (kind === 'outside' && r.chance(0.5));
    const candidates = this.m.designs.filter((d) => (d.retired ? old : true) && (d.zeroStock ? p.x < H - 150 && p.x > 20 : true) && (kind === 'fg' || kind === 'p' ? true : d.butta === wantButta));
    const favourites = candidates.filter((d) => (d.idx * 7 + p.customerIdx * 3) % 11 < 2);
    const design = favourites.length && r.chance(0.6) ? r.pick(favourites) : r.pick(candidates);
    const unit: 'pcs' | 'meters' = (kind === 'pbm' || kind === 'pm') && r.chance(0.15) ? 'meters' : 'pcs';
    const fgType = r.chance(0.7) ? 'saree' : 'suit';
    const qty = unit === 'pcs' ? 45 + 3 * Math.round(Math.pow(r.next(), 1.7) * 230) : 10 * Math.round((400 + Math.pow(r.next(), 1.5) * 2400) / 10);
    const rate = unit === 'pcs' ? Math.round(fgType === 'saree' ? r.u(380, 1350) : r.u(450, 1600)) : Math.round(r.u(95, 260));
    const createdX = this.clock.at(p.x, r.u(10, 18.5));
    const promised = r.chance(0.5) ? this.clock.day(p.x + r.int(25, 45)) : null;
    const o: SimOrder = {
      id: this.ids.reserve('orders'),
      no: 0,
      kind,
      customerIdx: p.customerIdx,
      customerId: cust.id,
      brokerId: cust.brokers.length && r.chance(0.6) ? r.pick(cust.brokers) : null,
      designIdx: design.idx,
      designId: design.id,
      materialId: design.zeroStock ? design.materialIds[0] : r.pick(design.materialIds),
      unit,
      qty,
      rate,
      orderType: unit === 'meters' ? 'lump' : r.chance(0.35) ? 'lump' : 'pcs_to_pcs',
      fgType,
      blouse: r.chance(0.35) ? 'with_blouse' : r.chance(0.55) ? 'without_blouse' : null,
      promisedDay: promised,
      createdX,
      sentX: null,
      hasProduction: kind === 'pbm' || kind === 'pm' || kind === 'p',
      hasButta: kind === 'pbm' || (kind === 'outside' && design.butta),
      hasMill: kind === 'pbm' || kind === 'pm' || kind === 'outside',
      sections: r.chance(0.08) ? 4 : 3,
      looms: r.sample(this.m.machines, r.int(5, 8)),
      buttaParty: r.pick(this.m.buttaParties),
      millParty: r.pick(this.m.millParties),
      holdX: null,
      holdBy: null,
      pastHold: null,
      closeX: null,
      closeEarly: false,
      short: false,
      isOutside: false,
      outsideParty: null,
      jobsheets: [],
      takas: [],
      dispatches: [],
      grX: null,
      notes: r.chance(0.15) ? r.pick(['Deliver in two lots.', 'Pack each saree in a box.', 'Same shade as the last lot.', 'Urgent — wedding season.']) : null,
      isHolder: false,
      status: 'pending_production',
      history: [],
      ...p.forced,
    };
    if (o.kind === 'outside') o.hasMill = true;
    // a few looms are rarely given work, so the floor always has idle looms
    if (o.looms.some((l) => this.m.machines.indexOf(l) >= 27) && r.chance(0.85)) o.looms = o.looms.filter((l) => this.m.machines.indexOf(l) < 27);
    if (!o.looms.length) o.looms = [this.m.machines[r.int(0, 26)]];
    this.orders.push(o);
    return o;
  }

  /** Makes a booked order an outside-production / FG purchase order (pcs). */
  retype(o: SimOrder, kind: 'outside' | 'fg') {
    o.kind = kind;
    o.unit = 'pcs';
    if (o.qty > 3000 || o.qty < 90) o.qty = 3 * this.rng.int(40, 140);
    o.hasProduction = false;
    o.hasButta = kind === 'outside' && this.m.designs[o.designIdx].butta;
    o.hasMill = kind === 'outside';
  }

  /* ------------------------------------------------------------------ */
  /* the flow of one order                                                */
  /* ------------------------------------------------------------------ */

  run(o: SimOrder) {
    const r = this.rng;
    const { H } = this.clock;
    if (o.sentX === null && !(o.createdX > H - 6 && r.chance(0.5))) o.sentX = o.createdX + (r.chance(0.3) ? r.u(0.02, 0.3) : r.u(0.3, 2.5));
    if (o.sentX === null || o.sentX > H) {
      o.sentX = null;
      return;
    }
    if (o.kind === 'outside' || o.kind === 'fg') return; // handled by the outside / FG simulation
    if (o.qty > 100_000) return; // the 2,45,000 pcs order waits for jobsheets
    const planX = o.sentX + (o.pastHold ? o.pastHold.releasedX - o.pastHold.x : 0) + r.u(0.2, 2.5);
    if (o.holdX !== null && o.holdMode === 'before_start') o.holdX = planX + 0.04;
    if (o.holdX !== null && o.holdMode === 'mid') o.holdX = Math.min(H - 2.5, planX + r.u(2.5, 5));
    if (planX > H || (o.holdX !== null && planX > o.holdX)) return;
    this.planJobsheets(o, planX);
    for (const js of [...o.jobsheets]) this.schedule(js);
    for (const js of [...o.jobsheets]) this.enterTakas(js);
    this.topUpIfShort(o);
  }

  private newJs(o: SimOrder, p: Partial<SimJs>): SimJs {
    const js: SimJs = {
      id: this.ids.reserve('jobsheets'),
      no: ++this.jsSeq,
      order: o,
      external: false,
      frames: 0,
      meters: null,
      sections: o.sections,
      createdX: 0,
      sentX: null,
      startX: null,
      endX: null,
      entryX: null,
      deletedX: null,
      machineId: null,
      assigned: [],
      parentId: null,
      partialFrames: null,
      changedMachine: false,
      completedOnHold: false,
      floorUser: 'supervisor',
      takas: [],
      ...p,
    };
    o.jobsheets.push(js);
    return js;
  }

  private planJobsheets(o: SimOrder, planX: number) {
    const r = this.rng;
    const chunks: { frames: number; meters: number | null }[] = [];
    if (o.unit === 'pcs') {
      let left = Math.ceil((o.qty * (o.phased ?? 1)) / o.sections);
      const fpj = r.int(9, 15);
      while (left > 0) {
        const f = left - fpj < 4 ? left : fpj;
        chunks.push({ frames: f, meters: null });
        left -= f;
      }
    } else {
      let left = Math.round((o.qty / o.sections) * 100) / 100;
      const mpj = r.int(70, 120);
      while (left > 0.001) {
        const m = left - mpj < 30 ? left : mpj;
        chunks.push({ frames: 0, meters: Math.round(m * 100) / 100 });
        left = Math.round((left - m) * 100) / 100;
      }
    }
    for (const c of chunks) {
      const held = o.holdMode === 'before_start';
      const createdX = held ? planX : planX + r.u(0, 0.15);
      let sentX: number | null = held ? planX + 0.02 : r.chance(0.35) ? createdX + r.u(0.01, 0.1) : createdX + r.u(0.1, 1.2);
      if (o.holdX !== null && sentX > o.holdX) sentX = null; // a held order's jobsheets are not sent
      this.newJs(o, { frames: c.frames, meters: c.meters, createdX, sentX, assigned: [] });
    }
  }

  /** Puts a sent jobsheet on the first free loom of its order's looms. */
  private schedule(js: SimJs) {
    const r = this.rng;
    const { H } = this.clock;
    const o = js.order;
    if (js.sentX === null || js.sentX > H) {
      if (js.sentX !== null && js.sentX > H) js.sentX = null;
      return;
    }
    const ready = js.sentX + r.u(0.05, 0.7);
    const options = o.looms;
    let best = options[0];
    for (const m of options) if ((this.looms.get(m) ?? 0) < (this.looms.get(best) ?? 0)) best = m;
    const start = Math.max(ready, this.looms.get(best) ?? 0) + r.u(0.02, 0.3);
    if (o.holdX !== null && start > o.holdX) return; // held before it started: stays Sent
    const rate = o.unit === 'pcs' ? r.u(3.6, 5.4) : r.u(28, 42);
    const work = o.unit === 'pcs' ? js.frames : (js.meters ?? 0);
    let end = start + work / rate;
    if (start > H) {
      // not started yet — it waits; the loom is not taken
      js.assigned = [...new Set([best, ...r.sample(o.looms, 1)])];
      return;
    }
    js.machineId = best;
    js.assigned = [...new Set([best, ...r.sample(o.looms, 1)])];
    js.startX = start;
    js.floorUser = r.chance(0.12) ? 'gaurang' : 'supervisor';
    // change machine part way (a new Sent jobsheet takes the rest)
    if (o.unit === 'pcs' && js.frames >= 10 && !js.parentId && r.chance(0.035) && start + 0.6 < H) {
      const at = start + (end - start) * r.u(0.35, 0.65);
      const done = Math.max(2, Math.round(js.frames * ((at - start) / (end - start))));
      js.endX = at;
      js.partialFrames = done;
      js.changedMachine = true;
      if (at > H - 33) js.floorUser = 'gaurang';
      this.looms.set(best, at);
      const child = this.newJs(o, { frames: js.frames - done, createdX: at, sentX: at + 0.01, parentId: js.id, assigned: [] });
      this.schedule(child);
      return;
    }
    // held while on the loom: completed on hold, the rest becomes a Pending jobsheet
    if (o.holdX !== null && end > o.holdX) {
      const done = Math.max(1, Math.round(js.frames * ((o.holdX - start) / (end - start))));
      end = o.holdX;
      js.partialFrames = done;
      js.completedOnHold = true;
      js.floorUser = o.holdBy ?? 'gaurang';
      if (js.frames - done > 0) this.newJs(o, { frames: js.frames - done, createdX: o.holdX, sentX: null, parentId: js.id, assigned: [best] });
    }
    js.endX = end;
    this.looms.set(best, end);
  }

  /** Taka entry after the jobsheet is completed (pcs from the frames, ±10 % cases on purpose). */
  private enterTakas(js: SimJs) {
    const r = this.rng;
    const { H } = this.clock;
    const o = js.order;
    if (js.endX === null || js.endX > H) return;
    let entryX = js.endX + (r.chance(0.12) ? r.u(1, 3.2) : r.u(0.04, 1.1));
    if (o.stall === 'entry' && js.endX > H - 3) entryX = H + 1;
    if (entryX > H || (o.holdX !== null && entryX > o.holdX)) return; // completed, waiting for taka entry
    js.entryX = entryX;
    const frames = js.partialFrames ?? js.frames;
    const roll = r.next();
    // most within ±4 %; some short / over by more than 10 % (the "Completed short" cards)
    let factor = roll < 0.85 ? r.u(0.985, 1.05) : roll < 0.925 ? r.u(0.8, 0.88) : r.u(1.12, 1.17);
    if (o.short) factor = r.u(0.8, 0.86);
    // the supervisor's own short completions are older than 30 days (his Performance section is empty this month)
    if (js.floorUser === 'supervisor' && (factor < 0.9 || factor > 1.1) && js.endX > H - 31) factor = r.u(0.99, 1.04);
    if (js.changedMachine || js.completedOnHold) factor = r.u(0.99, 1.03);
    if (o.unit === 'pcs') {
      let total = Math.max(3, Math.round(frames * js.sections * factor));
      // whole-frame rounding can push a small jobsheet past ±10 %: the supervisor's recent ones stay inside it
      if (js.floorUser === 'supervisor' && js.endX > H - 31 && beyondTolerance(framesFromTakaPcs(total, js.sections), frames)) total = frames * js.sections;
      const n = Math.max(1, Math.round(total / r.u(12.5, 15.5)));
      const base = Math.floor(total / n);
      for (let k = 0; k < n; k++) {
        const pcs = base + (k < total - base * n ? 1 : 0);
        this.newTaka(o, js, { pcs, meters: Math.round(pcs * (o.fgType === 'saree' ? r.u(5.6, 6.3) : r.u(2.4, 3)) * 100) / 100, createdX: entryX + k * 0.0004 });
      }
    } else {
      const cloth = Math.round((js.meters ?? 0) * js.sections * factor * 100) / 100;
      const n = Math.max(1, Math.round(cloth / r.u(90, 115)));
      for (let k = 0; k < n; k++) this.newTaka(o, js, { pcs: null, meters: Math.round((cloth / n) * 100) / 100, createdX: entryX + k * 0.0004 });
    }
    for (const t of js.takas) this.flow(t, nextTakaStage({ hasButta: o.hasButta, hasMill: o.hasMill }, 'taka_entry'));
  }

  /** An order with less pcs than ordered (and not short on purpose) gets one more jobsheet for the rest. */
  private topUpIfShort(o: SimOrder) {
    if (o.short || o.phased || o.unit !== 'pcs' || o.holdX !== null) return;
    const real = o.jobsheets.filter((j) => !j.external);
    if (!real.length || real.some((j) => j.entryX === null && j.endX === null && j.startX === null && j.sentX === null)) return;
    const pcs = o.takas.reduce((s, t) => s + (t.pcs ?? 0), 0);
    const all = real.every((j) => j.entryX !== null);
    if (!all || pcs >= o.qty) return;
    const last = real.reduce((a, b) => (a.entryX! > b.entryX! ? a : b));
    const js = this.newJs(o, { frames: Math.ceil((o.qty - pcs) / o.sections) + 1, createdX: last.entryX! + 0.2, sentX: last.entryX! + 0.25, assigned: o.looms.slice(0, 2) });
    this.schedule(js);
    this.enterTakas(js);
  }

  nextTakaNo(): string {
    return String(++this.takaSeq);
  }

  newTaka(o: SimOrder, js: SimJs, p: Partial<SimTaka>): SimTaka {
    const t: SimTaka = {
      id: this.ids.reserve('takas'),
      no: p.no ?? this.nextTakaNo(),
      order: o,
      js,
      pcs: null,
      meters: null,
      createdX: 0,
      moves: [],
      source: 'production',
      weaverId: null,
      weaverTakaNo: null,
      receiptId: null,
      isReceivedLot: false,
      enteredBy: 'taka_entry',
      freeX: null,
      freeReason: null,
      freeBy: null,
      deletedX: null,
      removedReason: null,
      lostX: null,
      parentId: null,
      actualPcs: null,
      actualMeters: null,
      checkedX: null,
      refinishCount: 0,
      reworkCount: 0,
      hasBeenToMill: false,
      stageBeforeRework: null,
      returnedX: null,
      returnedFromChallanId: null,
      isReturnLot: false,
      damages: [],
      trips: [],
      ...p,
    };
    js.takas.push(t);
    o.takas.push(t);
    return t;
  }

  damage(t: SimTaka, foundAt: SimDamage['foundAt'], recordedAt: string, x: number, names: string[], createdBy: SimDamage['createdBy']): SimDamage {
    const r = this.rng;
    const metersOrder = t.order.unit === 'meters';
    const pcs = metersOrder ? null : Math.max(1, Math.min(t.pcs ?? 1, r.chance(0.6) ? 1 : r.int(2, 3)));
    const d: SimDamage = {
      id: this.ids.reserve('taka_damages'),
      damageId: this.m.damageIds[r.pick(names)],
      foundAt,
      recordedAt,
      pcs,
      meters: metersOrder ? Math.round(r.u(1, 4.5) * 100) / 100 : null,
      x,
      createdBy,
      resolvedX: null,
      resolvedStage: null,
      resolvedBy: null,
      resolvedPcs: 0,
      photo: false,
    };
    t.damages.push(d);
    return d;
  }

  private resolveSome(t: SimTaka, x: number, stage: string, by: SimDamage['createdBy'], p: number) {
    for (const d of t.damages) {
      if (d.resolvedX !== null || d.x >= x || !this.rng.chance(p)) continue;
      d.resolvedX = x;
      d.resolvedStage = stage;
      d.resolvedBy = by;
      d.resolvedPcs = d.pcs ?? 0;
    }
  }

  private move(t: SimTaka, m: Move) {
    t.moves.push(m);
  }

  /**
   * The rest of a taka's life from `stage` at its creation: butta → QC → mill → QC → godown tick. Dispatch is decided per
   * order afterwards. Moves after now (or after the order's hold) are dropped later.
   */
  flow(t: SimTaka, stage: string, fromX = t.createdX) {
    const r = this.rng;
    const o = t.order;
    let x = fromX;
    if (fromX === t.createdX) {
      this.move(t, { x, stage, event: t.source === 'production' ? 'entered' : t.source === 'outside_po' ? 'received_outside' : 'received_fg', role: t.enteredBy });
      if (t.source === 'production' && r.chance(0.07)) this.damage(t, 'machine', 'taka_entry', x + 0.0001, MACHINE_DMG, 'taka_entry');
    }
    if (stage === 'entered') {
      x = this.butta(t, x, false);
      if (x < 0) return;
      stage = o.hasMill ? 'waiting_mill' : 'final';
    }
    if (stage === 'waiting_mill') {
      x = this.mill(t, x, false);
      if (x < 0) return;
    }
    this.godown(t, x);
  }

  /** A butta trip; returns when QC finished (or −1 when the taka is still out / lost). */
  private butta(t: SimTaka, x: number, rework: boolean): number {
    const r = this.rng;
    const o = t.order;
    const send = o.stall === 'butta_send' && !rework ? this.clock.H + 3 : x + r.u(0.2, 2.2);
    const out = o.slowParty || r.chance(0.05) ? r.u(4.2, 7) : r.u(1.2, 3.6);
    const trip: Trip = { kind: 'butta', partyId: o.buttaParty, taka: t, sendX: send, receiveX: send + out, qcX: null, isRefinish: rework, lostX: null, challanId: 0, challanTakaId: 0 };
    trip.qcX = o.stall === 'butta_qc' ? this.clock.H + 3 : trip.receiveX! + r.u(0.08, 1.6);
    t.trips.push(trip);
    this.trips.push(trip);
    this.move(t, { x: send, stage: 'at_butta', event: 'sent_butta', role: 'godown_supervisor', trip });
    this.move(t, { x: trip.receiveX!, stage: 'butta_qc', event: 'received_butta', role: 'godown_supervisor', trip });
    if (r.chance(0.06)) this.damage(t, 'butta', 'butta_qc', trip.qcX, BUTTA_DMG, 'qc');
    this.resolveSome(t, trip.qcX, 'butta_qc', 'qc', 0.4);
    const after = o.hasMill && !t.hasBeenToMill ? 'waiting_mill' : 'final';
    this.move(t, { x: trip.qcX, stage: after, event: 'butta_qc_done', role: 'qc', trip });
    return trip.qcX;
  }

  private mill(t: SimTaka, x: number, refinish: boolean): number {
    const r = this.rng;
    const o = t.order;
    const send = o.stall === 'mill_send' && !refinish ? this.clock.H + 3 : x + r.u(0.3, 2.6);
    const out = o.slowParty || r.chance(0.08) ? r.u(8.6, 12) : r.u(4.5, 8);
    const trip: Trip = { kind: 'mill', partyId: o.millParty, taka: t, sendX: send, receiveX: send + out, qcX: null, isRefinish: refinish, lostX: null, challanId: 0, challanTakaId: 0 };
    trip.qcX = o.stall === 'mill_qc' ? this.clock.H + 3 : trip.receiveX! + r.u(0.15, 1.7);
    t.trips.push(trip);
    this.trips.push(trip);
    this.move(t, { x: send, stage: 'at_mill', event: 'sent_mill', role: 'godown_supervisor', trip });
    this.move(t, { x: trip.receiveX!, stage: 'mill_qc', event: 'received_mill', role: 'godown_supervisor', trip });
    t.hasBeenToMill = t.hasBeenToMill || trip.receiveX! <= this.clock.H;
    if (r.chance(0.06)) this.damage(t, 'mill', 'mill_qc', trip.qcX, MILL_DMG, 'qc');
    this.resolveSome(t, trip.qcX, 'mill_qc', 'qc', 0.35);
    if (!refinish && r.chance(0.03)) {
      this.move(t, { x: trip.qcX, stage: 'refinish', event: 'sent_refinish', role: 'qc', trip });
      t.refinishCount += 1;
      return this.mill(t, trip.qcX + r.u(1, 5), true);
    }
    this.move(t, { x: trip.qcX, stage: 'final', event: 'mill_qc_done', role: 'qc', trip });
    return trip.qcX;
  }

  /** In the godown: sometimes sent back by the owner (rework), a few supervisor damages, shrinkage, the tick. */
  private godown(t: SimTaka, x: number) {
    const r = this.rng;
    const o = t.order;
    if (o.hasButta && t.reworkCount === 0 && r.chance(0.012)) {
      const back = x + r.u(0.5, 3.5);
      t.stageBeforeRework = 'final';
      t.reworkCount = 1;
      this.move(t, { x: back, stage: 'rework_butta', event: 'sent_back', role: 'jemish', note: 'Butta not clean — sent back' });
      const done = this.butta(t, back, true);
      x = done;
    }
    if (r.chance(0.015)) this.damage(t, 'godown', 'godown', x + r.u(0.1, 1), GODOWN_DMG, 'dhruvil');
    if (t.meters !== null && r.chance(0.4)) t.actualMeters = Math.round(t.meters * (r.chance(0.92) ? r.u(0.955, 0.995) : r.u(1.002, 1.01)) * 100) / 100;
    if (t.pcs !== null && t.pcs > 5 && r.chance(0.02)) t.actualPcs = t.pcs - 1;
    const tick = o.stall === 'godown' ? this.clock.H + 3 : x + r.u(0.3, 3);
    this.resolveSome(t, tick - 0.01, 'godown', 'dhruvil', 0.45);
    t.checkedX = tick;
    this.move(t, { x: tick, stage: 'ready_dispatch', event: 'ready_dispatch', role: 'dhruvil' });
  }

  /* ------------------------------------------------------------------ */
  /* after the flow: cut at now / hold, dispatch, close                   */
  /* ------------------------------------------------------------------ */

  /** Drops what has not happened yet (and, for a held order, every move after the hold). */
  cut(o: SimOrder) {
    const { H } = this.clock;
    const limit = o.holdX ?? H;
    for (const t of o.takas) {
      t.moves.sort((a, b) => a.x - b.x);
      t.moves = t.moves.filter((m) => m.x <= Math.min(H, limit) || (m.event === 'received_butta' || m.event === 'received_mill' ? m.x <= H && !!m.trip && m.trip.sendX <= limit : false));
      t.damages = t.damages.filter((d) => d.x <= Math.min(H, limit));
      for (const d of t.damages) if (d.resolvedX !== null && d.resolvedX > Math.min(H, limit)) Object.assign(d, { resolvedX: null, resolvedStage: null, resolvedBy: null, resolvedPcs: 0 });
      for (const trip of t.trips) {
        if (trip.receiveX !== null && trip.receiveX > H) trip.receiveX = null;
        if (trip.qcX !== null && (trip.qcX > Math.min(H, limit) || trip.receiveX === null)) trip.qcX = null;
      }
      t.trips = t.trips.filter((trip) => trip.sendX <= Math.min(H, limit));
      if (t.checkedX !== null && !t.moves.some((m) => m.stage === 'ready_dispatch')) t.checkedX = null;
      const reached = (s: string) => t.moves.some((m) => m.stage === s);
      if (!reached('final') && !reached('ready_dispatch')) {
        t.actualMeters = null;
        t.actualPcs = null;
      }
      t.hasBeenToMill = t.trips.some((trip) => trip.kind === 'mill' && trip.receiveX !== null);
    }
    this.trips.splice(0, this.trips.length, ...this.trips.filter((trip) => trip.taka.trips.includes(trip)));
  }
}

export const stageAt = (t: SimTaka, x: number): string | null => {
  let s: string | null = null;
  for (const m of t.moves) {
    if (m.x > x) break;
    s = m.stage;
  }
  return s;
};
