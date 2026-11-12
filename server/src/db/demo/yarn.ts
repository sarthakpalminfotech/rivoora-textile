import { fyOf, UNITS_PER_KG, type RoleKey } from '@rivoora/shared';
import type { Clock, Rng } from './clock';
import type { UserIds } from './emit';
import { YARN_QUALITIES } from './masters';
import type { Sink } from './sink';

/**
 * Sprint 26 — the yarn side of the demo, written through the same ledger rules as the app: every quantity is a
 * `yarn_stock_moves` row (units = tenths of a gram), stock never goes below zero, TFO programs make boxes, warping jobs
 * make beams (with the leftover as a "remaining" box), Palti turns boxes into one box. POs + lots (one lot combined across
 * two challans), transfers, withdrawals (sell / in-house), pending programs / jobs that reserve stock, low-yarn qualities.
 */

const kg = (n: number) => Math.round(n * UNITS_PER_KG);

interface Bucket {
  zone: 'direct' | 'tfo' | 'warping';
  item: 'raw' | 'twisted';
  qualityId: number;
  lotId: number | null;
  boxId: number | null;
  wqId: number | null;
}
const keyOf = (b: Bucket) => `${b.zone}|${b.item}|${b.qualityId}|${b.lotId ?? ''}|${b.boxId ?? ''}|${b.wqId ?? ''}`;

interface Box {
  id: number;
  no: number;
  programId: number;
  lotId: number | null;
  wqId: number;
  rawQualityId: number;
  netG: number;
  zone: 'tfo' | 'warping' | 'direct';
  used: boolean;
  x: number;
}

export interface YarnRefs {
  qualityIds: number[];
  wqIds: number[];
  partyIds: number[];
  tfoMachineIds: number[];
  systemQualityId: number;
  paltiProgramId: number;
}

export class YarnSim {
  private bal = new Map<string, { b: Bucket; g: number }>();
  private boxes: Box[] = [];
  private lots: { id: number; partyId: number; qualityId: number; no: string }[] = [];
  private lotSeq = 0;
  private seq = { po: 0, box: 0, job: 0, beam: 0, beamCode: 0, adj: 0 };
  private sections = new Map<string, number>(); // "machine|A" → free from x
  readonly lowQualities: number[] = [];

  constructor(
    private readonly clock: Clock,
    private readonly rng: Rng,
    private readonly sink: Sink,
    private readonly users: UserIds,
    private readonly refs: YarnRefs,
  ) {
    for (const m of refs.tfoMachineIds) for (const s of ['A', 'B']) this.sections.set(`${m}|${s}`, 0);
  }

  private iso = (x: number) => this.clock.iso(x);

  private move(b: Bucket, g: number, kind: string, x: number, ref: { type: string; id: number } | null, role: RoleKey, note: string | null = null) {
    const k = keyOf(b);
    const cur = this.bal.get(k) ?? { b, g: 0 };
    if (cur.g + g < 0) throw new Error(`demo yarn: ${k} would go below zero`);
    cur.g += g;
    this.bal.set(k, cur);
    this.sink.add('yarn_stock_moves', {
      zone: b.zone, item: b.item, quality_id: b.qualityId, qty_g: g, kind, ref_type: ref?.type ?? null, ref_id: ref?.id ?? null, note, role, user_id: this.users[role],
      lot_id: b.lotId, box_id: b.boxId, warping_quality_id: b.wqId,
    }, this.iso(x));
  }

  private available(zone: Bucket['zone'], item: 'raw', qualityId?: number) {
    return [...this.bal.values()].filter((v) => v.b.zone === zone && v.b.item === item && v.g > kg(20) && (qualityId === undefined || v.b.qualityId === qualityId));
  }

  /* ---------- POs, receipts, lots ---------- */

  private po(x: number, partyId: number, lines: { qualityId: number; kgs: number }[], kind: 'full' | 'partly' | 'open' | 'closed' | 'cancelled', combineLot: boolean) {
    const r = this.rng;
    const id = this.sink.reserve('yarn_pos');
    const no = 2600 + ++this.seq.po;
    const lineIds = lines.map((l, i) =>
      this.sink.add('yarn_po_lines', { po_id: id, quality_id: l.qualityId, qty_g: kg(l.kgs), rate_paise: Math.round(r.u(165, 420)) * 100, sort_order: i }, this.iso(x)),
    );
    this.sink.add('yarn_po_events', { po_id: id, kind: 'created', note: null, role: 'jemish', user_id: this.users.jemish }, this.iso(x));
    let status = 'open';
    let closedX: number | null = null;
    let cancelledX: number | null = null;
    if (kind === 'cancelled') {
      status = 'cancelled';
      cancelledX = x + r.u(1, 4);
      this.sink.add('yarn_po_events', { po_id: id, kind: 'cancelled', note: 'Rate not agreed', role: 'jemish', user_id: this.users.jemish }, this.iso(cancelledX));
    } else if (kind !== 'open') {
      const challans = kind === 'full' ? (r.chance(0.5) ? 2 : 1) : 1;
      let rx = x + r.u(3, 10);
      const lotNos = lines.map(() => String(240 + ++this.lotSeq) + (r.chance(0.3) ? String.fromCharCode(65 + r.int(0, 5)) : ''));
      for (let c = 0; c < challans && rx <= this.clock.H; c++) {
        const rid = this.sink.reserve('yarn_receipts');
        this.sink.add('yarn_receipts', { id: rid, po_id: id, challan_no: String(r.int(1000, 9999)), receipt_date: this.clock.day(rx), zone: 'tfo', notes: null, received_by: 'yarn_supervisor', received_by_user_id: this.users.yarn_supervisor }, this.iso(rx));
        lines.forEach((l, i) => {
          const share = kind === 'partly' ? r.u(0.4, 0.7) : challans === 2 ? (c === 0 ? 0.55 : 0.45) : 1;
          const g = kg(Math.round(l.kgs * share));
          // the second challan of a combined lot adds to the SAME lot (same party + lot no. + quality)
          let lot = c > 0 && combineLot ? this.lots.find((lt) => lt.no === lotNos[i] && lt.partyId === partyId && lt.qualityId === l.qualityId) : undefined;
          if (!lot) {
            lot = { id: this.sink.reserve('yarn_lots'), partyId, qualityId: l.qualityId, no: c > 0 && !combineLot ? `${lotNos[i]}-${c + 1}` : lotNos[i] };
            this.sink.add('yarn_lots', { id: lot.id, lot_no: lot.no, party_id: partyId, quality_id: l.qualityId, created_by_user_id: this.users.yarn_supervisor }, this.iso(rx));
            this.lots.push(lot);
          }
          const lineId = this.sink.add('yarn_receipt_lines', { receipt_id: rid, po_line_id: lineIds[i], quality_id: l.qualityId, qty_g: g, boxes: r.int(8, 40), lot_id: lot.id }, this.iso(rx));
          const isZari = (YARN_QUALITIES[this.refs.qualityIds.indexOf(l.qualityId)]?.[0] ?? '').startsWith('Zari');
          const tfo = isZari ? 0 : Math.round(g * r.u(0.35, 0.5));
          const warp = isZari ? Math.round(g * 0.3) : Math.round((g - tfo) * r.u(0.5, 0.7));
          const direct = g - tfo - warp;
          for (const [zone, q] of [['tfo', tfo], ['warping', warp], ['direct', direct]] as const) {
            if (q <= 0) continue;
            this.sink.add('yarn_receipt_line_allocations', { receipt_line_id: lineId, zone, qty_g: q }, this.iso(rx));
            this.move({ zone, item: 'raw', qualityId: l.qualityId, lotId: lot.id, boxId: null, wqId: null }, q, 'receipt', rx, { type: 'receipt', id: rid }, 'yarn_supervisor');
          }
        });
        this.sink.add('yarn_po_events', { po_id: id, kind: 'received', note: `Challan received`, role: 'yarn_supervisor', user_id: this.users.yarn_supervisor }, this.iso(rx));
        rx += r.u(8, 18);
      }
      status = kind === 'full' ? 'received' : kind === 'partly' ? 'partly_received' : 'closed';
      if (kind === 'closed') {
        closedX = Math.min(this.clock.H - 1, x + r.u(20, 30));
        this.sink.add('yarn_po_events', { po_id: id, kind: 'closed', note: 'Party could not send the rest', role: 'jemish', user_id: this.users.jemish }, this.iso(closedX));
      }
    }
    this.sink.add('yarn_pos', {
      id, po_no: no, po_date: this.clock.day(x), party_id: partyId, remark: null, status, created_by: 'jemish', created_by_user_id: this.users.jemish,
      closed_at: closedX !== null ? this.iso(closedX) : null, closed_by_user_id: closedX !== null ? this.users.jemish : null,
      cancelled_at: cancelledX !== null ? this.iso(cancelledX) : null, cancelled_by_user_id: cancelledX !== null ? this.users.jemish : null, fy: fyOf(this.iso(x)),
    }, this.iso(x));
  }

  /* ---------- TFO ---------- */

  private freeSection(x: number): string | null {
    const free = [...this.sections.entries()].filter(([, f]) => f <= x).map(([k]) => k);
    return free.length ? this.rng.pick(free) : null;
  }

  private program(x: number, opts: { status: 'completed' | 'running' | 'on_hold' | 'box_pending' }) {
    const r = this.rng;
    const lots = this.available('tfo', 'raw');
    if (!lots.length) return;
    const src = r.pick(lots);
    const winding = r.u(1.8, 3.2);
    const maxRolls = Math.floor(src.g / kg(winding));
    if (maxRolls < 6) return;
    const rolls = Math.min(maxRolls, r.int(16, 48));
    const raw = kg(winding) * rolls;
    const sec = this.freeSection(x);
    if (!sec) return;
    const [machine, section] = sec.split('|');
    const sections = [{ m: Number(machine), s: section }];
    if (r.chance(0.3)) {
      const other = this.freeSection(x);
      if (other && other !== sec) sections.push({ m: Number(other.split('|')[0]), s: other.split('|')[1] });
    }
    const runDays = r.u(4, 9);
    const end = x + runDays;
    const status = opts.status;
    const stopped = status === 'completed' || status === 'box_pending';
    for (const s of sections) this.sections.set(`${s.m}|${s.s}`, status === 'running' ? Infinity : stopped ? end : x + runDays * 0.5);
    const id = this.sink.reserve('tfo_programs');
    const tpm = r.pick([450, 500, 600, 700, 800, 900]);
    const direction = r.pick(['S', 'Z', 'S', 'Z', 'SZ']);
    const qIdx = this.refs.qualityIds.indexOf(src.b.qualityId);
    const yq = YARN_QUALITIES[qIdx];
    this.move({ ...src.b }, -raw, 'tfo_issue', x, { type: 'program', id }, 'supervisor');
    const twisted = Math.round(raw * r.u(0.95, 0.985));
    const rollWeight = kg(r.u(0.18, 0.26));
    const madeRolls = status === 'on_hold' ? Math.floor(rolls * r.u(0.3, 0.6)) : rolls;
    const heldAt = status === 'on_hold' ? x + runDays * 0.5 : null;
    this.sink.add('tfo_programs', {
      id, machine_id: sections[0].m, section: sections[0].s, raw_quality_id: src.b.qualityId, raw_g: raw, output_quality_id: src.b.qualityId,
      denier_filament: yq ? `${yq[1]}/${yq[2]}` : null, tpm, direction, note: null, status, started_at: this.iso(x), started_by_user_id: this.users.supervisor, started_role: 'supervisor',
      stopped_at: stopped ? this.iso(end) : null, stopped_by_user_id: stopped ? this.users.supervisor : null, stopped_role: stopped ? 'supervisor' : null,
      twisted_g: status === 'completed' ? twisted : null, twisted_meters: null, returned_raw_g: null, stop_note: null, lot_id: src.b.lotId, rolls, winding_g: kg(winding),
      roll_weight_g: status === 'completed' ? rollWeight : null, rolls_made: status === 'on_hold' ? madeRolls : null, rolls_done: status === 'completed' ? rolls : 0, held_at: heldAt !== null ? this.iso(heldAt) : null,
    }, this.iso(x));
    for (const s of sections) this.sink.add('tfo_program_sections', { program_id: id, machine_id: s.m, section: s.s, is_running: status === 'running' }, this.iso(x));
    if (status === 'on_hold') this.sink.add('tfo_program_events', { program_id: id, kind: 'hold', rolls_made: madeRolls, rolls_left: rolls - madeRolls, note: 'Yarn breaking — waiting for the mechanic', role: 'supervisor', user_id: this.users.supervisor }, this.iso(heldAt!));
    if (status === 'box_pending') this.sink.add('tfo_program_events', { program_id: id, kind: 'stop_later', note: 'Boxes to be weighed tomorrow', role: 'supervisor', user_id: this.users.supervisor }, this.iso(end));
    if (status !== 'completed') return;
    const evId = this.sink.add('tfo_program_events', { program_id: id, kind: 'stopped', rolls, twisted_g: twisted, role: 'supervisor', user_id: this.users.supervisor }, this.iso(end));
    const nBoxes = Math.max(2, Math.round(rolls / r.int(5, 8)));
    const wq = this.refs.wqIds[(qIdx + (direction === 'Z' ? 1 : 0)) % this.refs.wqIds.length];
    let left = twisted;
    for (let b = 0; b < nBoxes; b++) {
      const net = b === nBoxes - 1 ? left : Math.round(twisted / nBoxes);
      left -= net;
      const boxRolls = Math.max(1, Math.round(rolls / nBoxes));
      const box: Box = { id: this.sink.reserve('yarn_boxes'), no: ++this.seq.box, programId: id, lotId: src.b.lotId, wqId: wq, rawQualityId: src.b.qualityId, netG: net, zone: 'tfo', used: false, x: end };
      this.sink.add('yarn_boxes', {
        id: box.id, box_no: String(box.no), program_id: id, lot_id: src.b.lotId, warping_quality_id: wq, rolls: boxRolls, gross_g: net + rollWeight * boxRolls, net_g: net, avg_g: 0,
        zone: 'tfo', status: 'in_stock', created_by_user_id: this.users.supervisor, fy: fyOf(this.iso(end)), kind: 'tfo', program_event_id: evId,
      }, this.iso(end));
      this.boxes.push(box);
      this.move({ zone: 'tfo', item: 'twisted', qualityId: this.refs.systemQualityId, lotId: src.b.lotId, boxId: box.id, wqId: wq }, net, 'tfo_output', end, { type: 'program', id }, 'supervisor');
    }
  }

  /** Boxes from TFO to Warping (one transfer per action). */
  private transferBoxes(x: number) {
    const ready = this.boxes.filter((b) => b.zone === 'tfo' && !b.used && b.x < x - 1);
    if (!ready.length) return;
    const pick = this.rng.sample(ready, Math.min(ready.length, this.rng.int(2, 6)));
    const tid = this.sink.add('yarn_transfers', { from_zone: 'tfo', to_zone: 'warping', what: 'twisted', note: null, role: 'supervisor', user_id: this.users.supervisor }, this.iso(x));
    for (const b of pick) {
      const bucket = (zone: Box['zone']): Bucket => ({ zone, item: 'twisted', qualityId: this.refs.systemQualityId, lotId: b.lotId, boxId: b.id, wqId: b.wqId });
      this.move(bucket('tfo'), -b.netG, 'transfer_out', x, { type: 'transfer', id: tid }, 'supervisor');
      this.move(bucket('warping'), b.netG, 'transfer_in', x, { type: 'transfer', id: tid }, 'supervisor');
      b.zone = 'warping';
    }
  }

  /* ---------- warping ---------- */

  private warping(x: number, done: boolean) {
    const r = this.rng;
    const boxes = this.boxes.filter((b) => b.zone === 'warping' && !b.used).slice(0, r.int(2, 5));
    const raws = this.available('warping', 'raw');
    if (!boxes.length && !raws.length) return;
    const id = this.sink.reserve('warping_jobs');
    const inputs: { b: Bucket; g: number; box?: Box }[] = [];
    for (const b of boxes) inputs.push({ b: { zone: 'warping', item: 'twisted', qualityId: this.refs.systemQualityId, lotId: b.lotId, boxId: b.id, wqId: b.wqId }, g: b.netG, box: b });
    if (raws.length && (r.chance(0.6) || !inputs.length)) {
      const src = r.pick(raws);
      inputs.push({ b: { ...src.b }, g: Math.min(src.g, kg(r.u(120, 380))) });
    }
    const issued = inputs.reduce((s, i) => s + i.g, 0);
    for (const i of inputs) {
      this.move(i.b, -i.g, 'warping_issue', x, { type: 'job', id }, 'supervisor');
      if (i.box) i.box.used = true;
      this.sink.add('warping_job_inputs', { job_id: id, item: i.b.item, quality_id: i.b.qualityId, qty_g: i.g, lot_id: i.b.lotId, box_id: i.b.boxId, warping_quality_id: i.b.wqId }, this.iso(x));
      if (i.box) this.sink.rows('yarn_boxes').find((row) => row.id === i.box!.id)!.status = 'used';
    }
    const end = x + r.u(1, 3);
    const denier = r.pick([75, 100, 150]);
    const usedG = done ? Math.round(issued * r.u(0.9, 0.985)) : null;
    const leftover = usedG !== null ? issued - usedG : null;
    this.sink.add('warping_jobs', {
      id, job_no: ++this.seq.job, status: done ? 'done' : 'in_process', note: null, started_at: this.iso(x), started_by_user_id: this.users.supervisor, started_role: 'supervisor',
      done_at: done ? this.iso(end) : null, done_by_user_id: done ? this.users.supervisor : null, done_role: done ? 'supervisor' : null, done_note: null, fy: fyOf(this.iso(x)),
      denier, used_g: usedG, leftover_g: leftover,
    }, this.iso(x));
    if (!done) return;
    const rawQ = inputs.find((i) => i.b.item === 'raw')?.b.qualityId ?? inputs[0].box?.rawQualityId ?? this.refs.qualityIds[0];
    const wq = inputs.find((i) => i.box)?.box?.wqId ?? this.refs.wqIds[0];
    const nBeams = r.int(2, 4);
    for (let k = 0; k < nBeams; k++) {
      const consumed = end < this.clock.H - 25 || (end < this.clock.H - 8 && r.chance(0.6));
      const consumedX = consumed ? Math.min(this.clock.H - 0.5, end + r.u(4, 20)) : null;
      const zone = r.chance(0.6) ? 'warping' : 'direct';
      const beamId = this.sink.add('beams', {
        beam_no: ++this.seq.beam, zone, quality_id: rawQ, taar: r.int(24, 48) * 100, panna: r.pick([46, 48, 50, 52]), meters: r.int(15, 45) * 100,
        status: consumedX !== null ? 'consumed' : 'in_stock', warping_job_id: id, consumed_at: consumedX !== null ? this.iso(consumedX) : null,
        consumed_by_user_id: consumedX !== null ? this.users.supervisor : null, consumed_note: consumedX !== null ? 'Put on loom' : null,
        created_by_user_id: this.users.supervisor, beam_code: String(++this.seq.beamCode), warping_quality_id: wq, remark: null, fy: fyOf(this.iso(end)),
      }, this.iso(end));
      this.sink.add('beam_moves', { beam_id: beamId, kind: 'beam_created', zone, ref_type: 'job', ref_id: id, role: 'supervisor', user_id: this.users.supervisor }, this.iso(end));
      if (consumedX !== null) this.sink.add('beam_moves', { beam_id: beamId, kind: 'consumed', zone, ref_type: null, ref_id: null, note: 'Put on loom', role: 'supervisor', user_id: this.users.supervisor }, this.iso(consumedX));
    }
    // leftover: a "remaining" box in Warping for the last TFO program whose boxes went in (else back to the raw lot)
    if (leftover && leftover > 0) {
      const prog = inputs.find((i) => i.box)?.box;
      if (prog) {
        const box: Box = { id: this.sink.reserve('yarn_boxes'), no: ++this.seq.box, programId: prog.programId, lotId: prog.lotId, wqId: prog.wqId, rawQualityId: prog.rawQualityId, netG: leftover, zone: 'warping', used: false, x: end };
        this.sink.add('yarn_boxes', { id: box.id, box_no: String(box.no), program_id: prog.programId, lot_id: prog.lotId, warping_quality_id: prog.wqId, rolls: 0, gross_g: leftover, net_g: leftover, avg_g: 0, zone: 'warping', status: 'in_stock', created_by_user_id: this.users.supervisor, fy: fyOf(this.iso(end)), kind: 'remaining', source_job_id: id }, this.iso(end));
        this.boxes.push(box);
        this.move({ zone: 'warping', item: 'twisted', qualityId: this.refs.systemQualityId, lotId: prog.lotId, boxId: box.id, wqId: prog.wqId }, leftover, 'warping_leftover', end, { type: 'job', id }, 'supervisor');
      } else {
        const raw = inputs.find((i) => i.b.item === 'raw')!;
        this.move(raw.b, leftover, 'warping_leftover', end, { type: 'job', id }, 'supervisor');
      }
    }
  }

  private withdraw(x: number, purpose: 'sell' | 'in_house') {
    const r = this.rng;
    const lots = this.available('direct', 'raw');
    if (!lots.length) return;
    const src = r.pick(lots);
    const g = Math.min(src.g, kg(r.u(25, purpose === 'sell' ? 180 : 90)));
    const id = this.sink.add('yarn_withdrawals', {
      zone: 'direct', what: 'raw', note: purpose === 'sell' ? 'Sold extra yarn' : 'For sampling looms', role: 'supervisor', user_id: this.users.supervisor, purpose,
      party_name: purpose === 'sell' ? r.pick(['Kamdhenu Weavers', 'Shiv Shakti Looms', 'Ambika Textiles']) : null, rate_paise: purpose === 'sell' ? Math.round(r.u(180, 380)) * 100 : null,
    }, this.iso(x));
    this.move({ ...src.b }, -g, 'withdraw', x, { type: 'withdrawal', id }, 'supervisor');
  }

  private palti(x: number) {
    const r = this.rng;
    const inputs = this.boxes.filter((b) => !b.used && b.zone !== 'direct').slice(0, 2);
    if (inputs.length < 2) return;
    const runId = this.sink.reserve('palti_runs');
    const total = inputs.reduce((s, b) => s + b.netG, 0);
    const net = Math.round(total * r.u(0.96, 0.99));
    const box: Box = { id: this.sink.reserve('yarn_boxes'), no: ++this.seq.box, programId: this.refs.paltiProgramId, lotId: null, wqId: inputs[0].wqId, rawQualityId: inputs[0].rawQualityId, netG: net, zone: 'warping', used: false, x };
    this.sink.add('palti_runs', { id: runId, run_date: this.clock.day(x), box_id: box.id, input_g: total, waste_g: total - net, note: 'Two half boxes made into one', role: 'supervisor', user_id: this.users.supervisor }, this.iso(x));
    for (const b of inputs) {
      this.move({ zone: b.zone, item: 'twisted', qualityId: this.refs.systemQualityId, lotId: b.lotId, boxId: b.id, wqId: b.wqId }, -b.netG, 'palti_issue', x, { type: 'palti', id: runId }, 'supervisor');
      this.sink.add('palti_run_inputs', { run_id: runId, zone: b.zone, item: 'twisted', quality_id: this.refs.systemQualityId, qty_g: b.netG, lot_id: b.lotId, box_id: b.id, warping_quality_id: b.wqId }, this.iso(x));
      b.used = true;
      this.sink.rows('yarn_boxes').find((row) => row.id === b.id)!.status = 'used';
    }
    this.sink.add('yarn_boxes', { id: box.id, box_no: String(box.no), program_id: this.refs.paltiProgramId, lot_id: null, warping_quality_id: box.wqId, rolls: r.int(4, 8), gross_g: net + kg(1.2), net_g: net, avg_g: 0, zone: 'warping', status: 'in_stock', created_by_user_id: this.users.supervisor, fy: fyOf(this.iso(x)), kind: 'palti', palti_run_id: runId }, this.iso(x));
    this.boxes.push(box);
    this.move({ zone: 'warping', item: 'twisted', qualityId: this.refs.systemQualityId, lotId: null, boxId: box.id, wqId: box.wqId }, net, 'palti_output', x, { type: 'palti', id: runId }, 'supervisor');
  }

  /* ---------- the whole 14 months ---------- */

  run() {
    const r = this.rng;
    const { H } = this.clock;
    const q = this.refs.qualityIds;
    // POs every ~11 days; the last few still open / partly received ("Yarn coming")
    let poIndex = 0;
    for (let x = 3; x < H - 1; x += r.u(8, 13)) {
      const recent = x > H - 30;
      const kind = poIndex === 7 ? 'cancelled' : poIndex === 15 ? 'closed' : recent ? (r.chance(0.5) ? 'open' : 'partly') : 'full';
      const lines = r.sample(q.slice(0, 12), r.int(1, 3)).map((qualityId) => ({ qualityId, kgs: r.int(6, 30) * 100 }));
      this.po(x, r.pick(this.refs.partyIds), lines, kind, poIndex % 6 === 2);
      poIndex += 1;
    }
    // the floor: TFO programs, transfers, warping jobs, withdrawals
    for (let x = 6; x < H - 9; x += r.u(1.2, 2.4)) {
      this.program(x, { status: 'completed' });
      if (r.chance(0.5)) this.transferBoxes(x + 0.5);
      if (r.chance(0.55)) this.warping(x + 1, true);
      if (r.chance(0.35)) this.withdraw(x + 0.7, r.chance(0.2) ? 'sell' : 'in_house');
      if (Math.abs(x - (H - 120)) < 1.3 || Math.abs(x - (H - 30)) < 1.3) this.palti(x + 0.8);
    }
    // now: programs running on ~10 sections, one on hold, one with box details pending
    for (const [ago, st] of [[8, 'completed'], [7, 'box_pending'], [6, 'on_hold']] as const) this.program(H - ago, { status: st });
    for (let i = 0; i < 9; i++) this.program(H - r.u(0.5, 5), { status: 'running' });
    this.transferBoxes(H - 2);
    this.warping(H - 1.5, false);
    this.warping(H - 0.7, false);
    this.withdraw(H - 0.4, 'in_house');
    this.pendingWork();
    this.manualAdjustments();
    this.minimums();
  }

  /** Pending TFO programs and warping jobs (they reserve stock). */
  private pendingWork() {
    const r = this.rng;
    const { H } = this.clock;
    for (let i = 0; i < 3; i++) {
      const lots = this.available('tfo', 'raw');
      if (!lots.length) break;
      const src = r.pick(lots);
      const winding = kg(r.u(2, 3));
      const rolls = Math.min(Math.floor((src.g * 0.5) / winding), r.int(12, 30));
      if (rolls < 4) continue;
      this.sink.add('tfo_pending_programs', {
        raw_quality_id: src.b.qualityId, lot_id: src.b.lotId, raw_g: winding * rolls, output_quality_id: src.b.qualityId, denier_filament: null, tpm: r.pick([500, 600, 800]),
        direction: r.pick(['S', 'Z']), note: i === 0 ? 'For order of Laxmi Narayan' : null, status: 'pending', created_by_user_id: this.users.jemish, rolls, winding_g: winding,
      }, this.clock.iso(H - r.u(0.5, 3)));
    }
    for (let i = 0; i < 2; i++) {
      const box = this.boxes.find((b) => b.zone === 'warping' && !b.used);
      const raws = this.available('warping', 'raw');
      const jobId = this.sink.add('warping_pending_jobs', { taar: r.int(30, 46) * 100, panna: 48, meters: r.int(20, 40) * 100, full_meter: false, note: null, status: 'pending', created_by_user_id: this.users.jemish }, this.clock.iso(H - r.u(0.5, 2)));
      if (box) {
        this.sink.add('warping_pending_job_inputs', { job_id: jobId, item: 'twisted', quality_id: this.refs.systemQualityId, qty_g: box.netG, lot_id: box.lotId, box_id: box.id, warping_quality_id: box.wqId }, this.clock.iso(H - 1));
        box.used = true; // reserved — not picked again
      }
      if (raws.length) {
        const src = r.pick(raws);
        this.sink.add('warping_pending_job_inputs', { job_id: jobId, item: 'raw', quality_id: src.b.qualityId, qty_g: Math.round(src.g * 0.3), lot_id: src.b.lotId, box_id: null, warping_quality_id: null }, this.clock.iso(H - 1));
      }
    }
  }

  private manualAdjustments() {
    const { H } = this.clock;
    const lots = this.available('direct', 'raw');
    const ref = { type: 'adjustment', id: ++this.seq.adj };
    this.move({ zone: 'direct', item: 'raw', qualityId: this.refs.qualityIds[13], lotId: null, boxId: null, wqId: null }, kg(42.5), 'manual_add', H - 40, ref, 'jemish', 'Old stock found in the store');
    if (lots.length) this.move({ ...lots[0].b }, -Math.min(lots[0].g, kg(12)), 'manual_remove', H - 12, { type: 'adjustment', id: ++this.seq.adj }, 'jemish', 'Wet cones thrown away');
  }

  /** Minimum kg: some qualities are set ABOVE their free stock (Low yarn), the others well below. */
  private minimums() {
    const stockOf = (qid: number) => [...this.bal.values()].filter((v) => v.b.item === 'raw' && v.b.qualityId === qid).reduce((s, v) => s + v.g, 0);
    YARN_QUALITIES.forEach((y, i) => {
      if (y[3] === null) return;
      const qid = this.refs.qualityIds[i];
      const stock = stockOf(qid);
      const low = i % 2 === 0; // 75D, 100D, 30s cotton, zari gold are low; 150D and 50D nylon are fine
      const min = low ? Math.max(kg(y[3]), Math.round(stock * 1.4)) : Math.min(kg(y[3]), Math.round(stock * 0.4));
      if (low) this.lowQualities.push(qid);
      const row = this.sink.rows('yarn_qualities').find((q) => q.id === qid);
      if (row) row.min_g = Math.max(kg(10), min);
    });
  }

  counters(): Record<string, number> {
    return { yarn_po_no: 2600 + this.seq.po, yarn_box_no: this.seq.box, warping_job_no: this.seq.job, beam_no: this.seq.beam, yarn_beam_code_no: this.seq.beamCode, yarn_adjustment_no: this.seq.adj };
  }
}
