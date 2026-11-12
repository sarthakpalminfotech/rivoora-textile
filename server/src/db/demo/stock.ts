import { fyOf } from '@rivoora/shared';
import type { Clock } from './clock';
import type { Emitter, UserIds } from './emit';
import type { SimJs, SimOrder, SimTaka } from './model';
import type { DesignRef, Ids, ProductionSim } from './production';
import type { Sink } from './sink';

/**
 * Sprint 26 — finished stock in the demo: hidden holder orders for manual stock (dummy D-numbers), manual adds and
 * removes (Stock adjustments), one damaged lot sold, and party goods returns (pending and completed; takas / pcs mode).
 */

export class StockSim {
  private holders = new Map<string, SimOrder>();
  private dummy = 0;
  private holderSeq = 0;
  private returnSeq = 0;
  readonly adjustments: Record<string, unknown>[] = [];

  constructor(
    private readonly clock: Clock,
    private readonly ids: Ids,
    private readonly sim: ProductionSim,
    private readonly sink: Sink,
    private readonly users: UserIds,
    private readonly systemCustomerId: number,
  ) {}

  private iso = (x: number) => this.clock.iso(x);

  private holder(d: DesignRef, materialId: number, unit: 'pcs' | 'meters', x: number): SimOrder {
    const key = `${d.id}|${materialId}|${unit}`;
    const found = this.holders.get(key);
    if (found) return found;
    const o = this.sim.book({ customerIdx: 0, x: 1 });
    this.sim.orders.splice(this.sim.orders.indexOf(o), 1);
    // `book` registered it as a normal order — turn it into the hidden holder
    Object.assign(o, {
      no: -++this.holderSeq,
      kind: 'fg',
      customerId: this.systemCustomerId,
      brokerId: null,
      designIdx: d.idx,
      designId: d.id,
      materialId,
      unit,
      qty: 0,
      rate: 0,
      orderType: 'lump',
      blouse: null,
      promisedDay: null,
      createdX: x,
      sentX: null,
      hasProduction: false,
      hasButta: false,
      hasMill: false,
      isHolder: true,
      status: 'closed',
      notes: null,
      jobsheets: [],
      takas: [],
    } satisfies Partial<SimOrder>);
    this.holders.set(key, o);
    return o;
  }

  private externalJs(o: SimOrder, x: number): SimJs {
    const found = o.jobsheets.find((j) => j.external);
    if (found) return found;
    const js: SimJs = {
      id: this.ids.reserve('jobsheets'), no: -o.id, order: o, external: true, frames: 0, meters: null, sections: 3, createdX: x, sentX: null, startX: null, endX: x, entryX: x,
      deletedX: null, machineId: null, assigned: [], parentId: null, partialFrames: null, changedMachine: false, completedOnHold: false, floorUser: 'supervisor', takas: [],
    };
    o.jobsheets.push(js);
    return js;
  }

  private dummyNo() {
    this.dummy += 1;
    return `D${String(this.dummy).padStart(2, '0')}`;
  }

  /** One manual "Add stock" (a free taka on the holder order). */
  addStock(d: DesignRef, unit: 'pcs' | 'meters', qty: number, damaged: boolean, x: number, reason: 'manual_add' | 'goods_return' = 'manual_add'): SimTaka {
    const materialId = d.materialIds[0];
    const o = this.holder(d, materialId, unit, x);
    const js = this.externalJs(o, x);
    const t = this.sim.newTaka(o, js, {
      no: this.dummyNo(),
      pcs: unit === 'pcs' ? qty : null,
      meters: unit === 'meters' ? qty : null,
      createdX: x,
      enteredBy: 'jemish',
      freeX: x,
      freeReason: reason,
      freeBy: 'jemish',
    });
    t.moves = [{ x, stage: 'final', event: reason === 'manual_add' ? 'stock_added' : 'party_return', role: 'jemish', note: reason === 'manual_add' ? 'Opening stock counted in the godown' : 'Goods return' }];
    if (damaged) {
      const dmg = this.sim.damage(t, 'machine', 'inventory', x + 0.0001, ['Hole', 'Oil stain', 'Float'], 'jemish');
      dmg.pcs = unit === 'pcs' ? qty : null;
      dmg.meters = unit === 'meters' ? qty : null;
    }
    if (reason === 'manual_add')
      this.adjustments.push({ kind: 'add', design_id: d.id, material_id: materialId, unit, qty, condition: damaged ? 'damaged' : 'fresh', taka_id: t.id, remark: 'Opening stock counted in the godown', role: 'jemish', user_id: this.users.jemish, created_at: this.iso(x) });
    return t;
  }

  /** Remove stock: the taka leaves stock (sold / sample …). */
  removeStock(t: SimTaka, reason: 'sold' | 'sample' | 'scrap', x: number) {
    t.deletedX = x;
    t.removedReason = reason;
    t.moves.push({ x, stage: t.moves[t.moves.length - 1]?.stage ?? 'final', event: 'stock_removed', role: 'jemish', note: `Removed: ${reason}` });
    const qty = t.order.unit === 'meters' ? (t.actualMeters ?? t.meters ?? 0) : (t.actualPcs ?? t.pcs ?? 0);
    this.adjustments.push({ kind: 'remove', design_id: t.order.designId, material_id: t.order.materialId, unit: t.order.unit, qty, condition: null, taka_id: t.id, remark: reason === 'sold' ? 'Sold to a walk-in buyer' : reason === 'sample' ? 'Given as sample' : 'Scrapped', role: 'jemish', user_id: this.users.jemish, created_at: this.iso(x) });
  }

  /** A damaged lot sold (DL-1): damaged free takas leave stock, their damages close with stage sold_lot. */
  damagedLot(takas: SimTaka[], x: number) {
    const lotId = this.ids.reserve('damaged_lots');
    this.sink.add('damaged_lots', { id: lotId, lot_no: 1, lot_date: this.clock.day(x), buyer: 'Kapadia Rag Traders', amount: 18500, note: 'Damaged pieces sold by weight', role: 'jemish', user_id: this.users.jemish, fy: fyOf(this.iso(x)) }, this.iso(x));
    for (const t of takas) {
      t.deletedX = x;
      t.removedReason = 'sold_lot';
      for (const d of t.damages) if (d.resolvedX === null) Object.assign(d, { resolvedX: x, resolvedStage: 'sold_lot', resolvedBy: 'jemish', resolvedPcs: d.pcs ?? 0 });
      t.moves.push({ x, stage: t.moves[t.moves.length - 1]?.stage ?? 'final', event: 'sold_lot', role: 'jemish', note: 'Sold in DL-1' });
      this.sink.add('damaged_lot_takas', { lot_id: lotId, taka_id: t.id, pcs: t.actualPcs ?? t.pcs, meters: t.actualMeters ?? t.meters }, this.iso(x));
    }
  }

  /** A party goods return (Sprint 22): takas mode moves dispatched takas back to free stock. */
  partyReturnTakas(customerId: number, takas: SimTaka[], x: number, completed: boolean) {
    const id = this.ids.reserve('party_returns');
    this.sink.add('party_returns', {
      id, return_no: ++this.returnSeq, customer_id: customerId, received_date: this.clock.day(x), received_as: 'takas', received_qty: takas.length,
      note: 'Client sent back a few takas', status: completed ? 'completed' : 'pending', completed_at: completed ? this.iso(x + 0.3) : null, completed_by_role: completed ? 'dhruvil' : null,
      role: 'dhruvil', user_id: this.users.dhruvil, fy: fyOf(this.iso(x)),
    }, this.iso(x));
    for (const t of takas) {
      this.sink.add('party_return_takas', { return_id: id, taka_id: t.id }, this.iso(x));
      if (!completed) continue;
      t.freeX = x + 0.3;
      t.freeReason = 'goods_return';
      t.freeBy = 'dhruvil';
      t.moves.push({ x: x + 0.3, stage: 'final', event: 'party_return', role: 'dhruvil', note: `GR-${this.returnSeq}` });
    }
    if (completed && takas[0]) this.sim.damage(takas[0], 'unmarked', 'goods_return', x + 0.31, ['Colour bleed', 'Hole'], 'dhruvil');
  }

  /** A party goods return received as pcs (completed = organised into a fresh and a damaged line). */
  partyReturnPcs(customerId: number, d: DesignRef, pcs: number, damaged: number, x: number, completed: boolean, unit: 'pcs' | 'meters' = 'pcs') {
    const id = this.ids.reserve('party_returns');
    this.sink.add('party_returns', {
      id, return_no: ++this.returnSeq, customer_id: customerId, received_date: this.clock.day(x), received_as: unit, received_qty: pcs,
      note: completed ? 'Counted and organised' : 'Waiting to be counted', status: completed ? 'completed' : 'pending', completed_at: completed ? this.iso(x + 0.5) : null,
      completed_by_role: completed ? 'dhruvil' : null, role: 'dhruvil', user_id: this.users.dhruvil, fy: fyOf(this.iso(x)),
    }, this.iso(x));
    if (!completed) return;
    const fresh = this.addStock(d, unit, pcs - damaged, false, x + 0.5, 'goods_return');
    const lineId = this.sink.add('party_return_lines', { return_id: id, taka_id: fresh.id, material_id: d.materialIds[0], design_id: d.id, qty: pcs - damaged, blouse_option: null }, this.iso(x + 0.5));
    if (damaged > 0) {
      const bad = this.addStock(d, unit, damaged, true, x + 0.5, 'goods_return');
      const badLine = this.sink.add('party_return_lines', { return_id: id, taka_id: bad.id, material_id: d.materialIds[0], design_id: d.id, qty: damaged, blouse_option: null }, this.iso(x + 0.5));
      this.sink.add('party_return_line_damages', { line_id: badLine, type: 'unmarked', damage_id: bad.damages[0]?.damageId ?? null, other_name: null, qty: damaged }, this.iso(x + 0.5));
    }
    void lineId;
  }

  holderOrders(): SimOrder[] {
    return [...this.holders.values()];
  }

  writeAdjustments() {
    for (const a of this.adjustments) this.sink.add('stock_adjustments', a);
  }

  emitHolders(emit: Emitter) {
    for (const o of this.holders.values()) emit.order(o);
  }
}
