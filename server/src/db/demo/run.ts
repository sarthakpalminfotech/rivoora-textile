import { existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { addDays, fyOf, monthOf, ORDER_STATUSES, type RoleKey } from '@rivoora/shared';
import { env } from '../../env';
import { libsql } from '../client';
import type { UploadFolder } from '../../storage/types';
import { PATTERNS, type Palette, type PatternName } from '../patterns';
import { Aftermath } from './aftermath';
import { Clock, Rng } from './clock';
import { Emitter, setDamagePhotos, type UserIds } from './emit';
import { demoTargetProblem } from './guard';
import {
  BUTTA_PARTIES, DAMAGE_NAMES, DEMO_BROKERS, DEMO_CUSTOMERS, DEMO_QUALITIES, DESIGN_NAMES, MILL_PARTIES, WARPING_QUALITIES, WEAVERS, YARN_PARTIES, YARN_QUALITIES, ZERO_STOCK_QUALITY,
} from './masters';
import type { SimOrder, SimTaka } from './model';
import { OutsideSim } from './outside';
import { ProductionSim, stageAt, type DesignRef } from './production';
import { Sink } from './sink';
import { computeStatus } from './status';
import { StockSim } from './stock';
import { YarnSim } from './yarn';

/**
 * Sprint 26 — builds the whole demo data set (14 months up to today) and writes it in one transaction. Only ever called
 * by `demo-seed.ts` after the guard passed; the guard is checked again here on the loaded config.
 */

const PALETTES: Palette[] = [
  { base: '#FBF3E4', main: '#8B1E3F', accent: '#C9A227', light: '#E8C3A0' },
  { base: '#F4F1E1', main: '#1F6F4A', accent: '#C9A227', light: '#9FD3B5' },
  { base: '#EEF1F8', main: '#1E3A8A', accent: '#D4A017', light: '#93C5FD' },
  { base: '#FDF0F6', main: '#B0126B', accent: '#E0B000', light: '#F9A8D4' },
  { base: '#EAF7F6', main: '#0F766E', accent: '#E07A1F', light: '#99E2DA' },
  { base: '#FFF5E8', main: '#C2410C', accent: '#7C2D12', light: '#FDBA74' },
  { base: '#F5F0FB', main: '#5B21B6', accent: '#C9A227', light: '#C4B5FD' },
  { base: '#F5F5F4', main: '#1C1917', accent: '#C9A227', light: '#A8A29E' },
];
const PATTERN_NAMES = Object.keys(PATTERNS) as PatternName[];
const DEMO_DAYS = 426;
const IMAGE_FOLDER = 'demo-seed';

async function demoImage(name: string, svg: string): Promise<{ url: string; thumbUrl: string }> {
  const url = `/uploads/${IMAGE_FOLDER}/${name}.webp`;
  const thumbUrl = `/uploads/${IMAGE_FOLDER}/${name}-thumb.webp`;
  if (existsSync(join(env.uploadsDir, IMAGE_FOLDER, `${name}-thumb.webp`))) return { url, thumbUrl };
  const { localStorage } = await import('../../storage/local');
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  // local disk only (git-ignored folder, so the demo images never end up in a commit)
  return localStorage.saveImage(png, { folder: IMAGE_FOLDER as UploadFolder, baseName: name });
}

export interface DemoResult {
  counts: Record<string, number>;
  logins: { name: string; phone: string; role: string }[];
  notes: string[];
}

export async function buildDemo(now = new Date()): Promise<DemoResult> {
  const problem = demoTargetProblem(env.databaseUrl, process.env.ALLOW_DEMO_SEED);
  if (problem) throw new Error(`demo seed refused after loading the config: ${problem}`);

  /* ---------- what is in the fresh DB already (migrations + default users) ---------- */
  const tables = (await libsql.execute(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%drizzle%'`)).rows.map((r) => String(r.name));
  const columns = new Map<string, Set<string>>();
  const startIds = new Map<string, number>();
  for (const t of tables) {
    const info = await libsql.execute(`PRAGMA table_info("${t}")`);
    const cols = new Set(info.rows.map((r) => String(r.name)));
    columns.set(t, cols);
    if (cols.has('id')) {
      const m = await libsql.execute(`SELECT COALESCE(MAX(id), 0) AS m FROM "${t}"`);
      startIds.set(t, Number(m.rows[0].m));
    }
  }
  const userRows = (await libsql.execute('SELECT id, name, phone, role FROM users ORDER BY id')).rows;
  const users = Object.fromEntries(userRows.map((u) => [String(u.role), Number(u.id)])) as UserIds;
  const systemQualityId = Number((await libsql.execute('SELECT id FROM yarn_qualities WHERE is_system = 1 ORDER BY id LIMIT 1')).rows[0]?.id);
  const paltiProgramId = Number((await libsql.execute(`SELECT id FROM tfo_programs WHERE status = 'system' ORDER BY id LIMIT 1`)).rows[0]?.id);
  if (!systemQualityId || !paltiProgramId) throw new Error('demo seed: the migration system rows (system yarn quality / Palti program) are missing');

  const sink = new Sink(startIds);
  const clock = new Clock(now, DEMO_DAYS);
  const rng = new Rng(2026_11);
  const iso = (x: number) => clock.iso(x);
  const t0 = iso(0);

  /* ---------- masters ---------- */
  const existingSystem = (await libsql.execute('SELECT id FROM customers WHERE is_system = 1 LIMIT 1')).rows[0];
  const systemCustomerId = existingSystem ? Number(existingSystem.id) : sink.add('customers', { name: 'Stock (system)', is_system: 1, is_deleted: 1 }, t0);
  const customers = DEMO_CUSTOMERS.map(([name, city], i) => ({
    id: sink.add('customers', { name, city, phone: `98${String(24000000 + i * 137911).slice(0, 8)}`, address: `${city}`, gst_number: i % 3 === 0 ? `24AAB${String(1000 + i)}F1Z${i % 9}` : null }, t0),
    brokers: [] as number[],
  }));
  for (const [ci, name] of DEMO_BROKERS) customers[ci].brokers.push(sink.add('customer_brokers', { customer_id: customers[ci].id, name }, t0));
  const materialIds = DEMO_QUALITIES.map((name, i) => sink.add('materials', { name, code: name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() + (i + 1) }, t0));

  const designs: DesignRef[] = [];
  const photoList: { url: string; thumbUrl: string }[] = [];
  for (let i = 0; i < 120; i++) {
    const code = `D${201 + i}`;
    const retired = i >= 112;
    const zeroStock = i >= 109 && i < 112;
    const name = i === 5 ? 'Royal Kanjivaram Temple Border with Peacock Pallu and Golden Zari Butta' : `${DESIGN_NAMES[i % DESIGN_NAMES.length]}${i >= DESIGN_NAMES.length ? ` ${Math.floor(i / DESIGN_NAMES.length) + 1}` : ''}`;
    const img = await demoImage(code.toLowerCase(), PATTERNS[PATTERN_NAMES[i % PATTERN_NAMES.length]](PALETTES[(i * 3) % PALETTES.length]));
    if (i < 6) photoList.push(img);
    const butta = i % 4 !== 3;
    const quals = zeroStock ? [materialIds[ZERO_STOCK_QUALITY]] : [materialIds[i % 39], ...(i % 3 === 0 ? [materialIds[(i * 7 + 5) % 39]] : [])].filter((v, k, a) => a.indexOf(v) === k);
    const id = sink.add('designs', { code, name, image_url: img.url, thumb_url: img.thumbUrl, notes: null, butta_cutting: butta }, t0);
    for (const m of quals) sink.add('design_qualities', { design_id: id, material_id: m }, t0);
    designs.push({ idx: i, id, code, materialIds: quals, butta, retired, zeroStock });
  }
  setDamagePhotos(photoList);
  const machines = Array.from({ length: 30 }, (_, i) => sink.add('machines', { machine_no: i + 1, name: null, is_active: 1 }, t0));
  const buttaParties = BUTTA_PARTIES.map((name, i) => sink.add('butta_parties', { name, mobile: `97${String(10000000 + i * 8137)}`.slice(0, 10), address: 'Surat' }, t0));
  const millParties = MILL_PARTIES.map((name, i) => sink.add('mill_parties', { name, mobile: `99${String(20000000 + i * 7713)}`.slice(0, 10), address: 'Surat' }, t0));
  const weavers = WEAVERS.map(([name, code], i) => ({ id: sink.add('weavers', { name, short_code: code, mobile: `96${String(30000000 + i * 5113)}`.slice(0, 10), address: 'Surat' }, t0), code }));
  const damageIds = Object.fromEntries(DAMAGE_NAMES.map((n) => [n, sink.add('damages', { name: n }, t0)]));
  const yarnPartyIds = YARN_PARTIES.map((name) => sink.add('yarn_parties', { name, address: 'Surat' }, t0));
  const yarnQualityIds = YARN_QUALITIES.map(([name, denier, filament, min]) => sink.add('yarn_qualities', { name, denier, filament, min_g: min !== null ? min * 10_000 : null }, t0));
  const wqIds = WARPING_QUALITIES.map((name) => sink.add('warping_qualities', { name }, t0));
  const tfoMachineIds = Array.from({ length: 8 }, (_, i) => sink.add('tfo_machines', { machine_no: i + 1, name: null }, t0));

  /* ---------- orders ---------- */
  const sim = new ProductionSim(clock, rng, sink, { customers, designs, machines, buttaParties, millParties, damageIds });
  for (const p of sim.bookingPlan(338)) sim.book(p);
  // the lakh-pcs order (₹ in crores), booked in the middle of last month, still waiting for jobsheets
  const lastMonth = addDays(`${monthOf(clock.today)}-01`, -17);
  const lakh = sim.book({ customerIdx: 0, x: clock.xOfDay(lastMonth), forced: { kind: 'pbm', unit: 'pcs', qty: 245_000, rate: 46, promisedDay: addDays(lastMonth, 90), notes: 'Bulk order for the festival season — jobsheets in phases' } });
  lakh.sentX = lakh.createdX + 0.6;
  const H = clock.H;
  const byTime = () => [...sim.orders].sort((a, b) => a.createdX - b.createdX);
  const inHousePcs = (o: SimOrder) => (o.kind === 'pbm' || o.kind === 'pm') && o.unit === 'pcs' && o !== lakh;
  const designOf = (o: SimOrder) => designs[o.designIdx];
  for (const o of sim.orders) if (designOf(o).zeroStock) o.noFreeStock = true;
  // holds now (two of them older than 7 days), holds released in the past, orders closed early, orders sent short
  const holdable = byTime().filter((o) => inHousePcs(o) && o.createdX > H - 42 && o.createdX < H - 16);
  holdable.slice(0, 4).forEach((o, i) => {
    o.holdX = Math.min(H - 2, o.createdX + rng.u(4, 9) + (i < 2 ? -3 : 3));
    if (i < 2) o.holdX = Math.min(o.holdX, H - 9);
    o.holdBy = i % 2 === 0 ? 'jemish' : 'gaurang';
    o.holdMode = i < 2 ? 'before_start' : 'mid';
  });
  // jobsheets planned in phases (or more than ordered): the "Jobsheets don't cover the order" card
  byTime().filter((o) => inHousePcs(o) && o.holdX === null && o.createdX > H - 30 && o.createdX < H - 6).filter((_, i) => i % 4 === 1).slice(0, 4).forEach((o, i) => (o.phased = i === 3 ? 1.18 : rng.u(0.55, 0.8)));
  // outside production / FG purchase orders in the pipeline now (late PO, open POs, FG awaited)
  const recent = (from: number, to: number) => byTime().filter((o) => (o.kind === 'pbm' || o.kind === 'pm') && o.unit === 'pcs' && o.holdX === null && !o.phased && o !== lakh && o.createdX > H - from && o.createdX < H - to);
  recent(56, 40).slice(0, 2).forEach((o) => {
    sim.retype(o, 'outside');
    o.slowWeaver = true;
  });
  recent(26, 12).slice(0, 3).forEach((o) => sim.retype(o, 'outside'));
  recent(20, 4).slice(0, 3).forEach((o, i) => {
    sim.retype(o, 'fg');
    o.slowWeaver = i < 2; // the first one: nothing received yet; the second: one delivery so far
    if (i === 0) o.stall = 'entry';
  });
  // slow butta / mill parties (challans out too long) and orders that wait at one step today
  const plain = (from: number, to: number, kind: SimOrder['kind'] = 'pbm') => byTime().filter((o) => o.kind === kind && o.holdX === null && !o.phased && !o.closeEarly && !o.short && o !== lakh && o.qty < 600 && o.createdX > H - from && o.createdX < H - to);
  plain(42, 22).filter((_, i) => i % 3 === 0).slice(0, 4).forEach((o) => (o.slowParty = true));
  const stalls: [NonNullable<SimOrder['stall']>, number, number, SimOrder['kind']][] = [
    ['entry', 16, 9, 'pbm'], ['butta_send', 30, 18, 'pbm'], ['butta_qc', 38, 18, 'pbm'], ['mill_send', 48, 24, 'pbm'], ['mill_send', 60, 20, 'pm'], ['mill_qc', 52, 38, 'pbm'],
    ['godown', 58, 44, 'pbm'], ['godown', 80, 10, 'p'], ['dispatch', 62, 48, 'pbm'], ['dispatch', 50, 30, 'pm'], ['dispatch_half', 66, 46, 'pbm'], ['dispatch_half', 60, 40, 'pm'],
  ];
  for (const [stall, from, to, kind] of stalls) plain(from, to, kind).filter((o) => !o.slowParty && !o.stall).slice(0, stall === 'entry' ? 2 : 1).forEach((o) => (o.stall = stall));
  byTime().filter((o) => inHousePcs(o) && o.createdX < H - 120).slice(10, 13).forEach((o) => (o.pastHold = { x: o.createdX + 1, releasedX: o.createdX + rng.u(3, 6), by: rng.chance(0.5) ? 'jemish' : 'gaurang' }));
  const closeCands = byTime().filter((o) => inHousePcs(o) && o.createdX > H - 200 && o.createdX < H - 70 && o.qty >= 300 && !o.noFreeStock);
  closeCands.filter((_, i) => i % 5 === 0).slice(0, 6).forEach((o) => (o.closeEarly = true));
  byTime().filter((o) => inHousePcs(o) && o.createdX < H - 70 && !o.closeEarly && !o.pastHold).filter((_, i) => i % 23 === 7).slice(0, 5).forEach((o) => (o.short = true));
  byTime().filter((o, i) => i % 29 === 3 && o.kind !== 'fg').forEach((o) => {
    o.isOutside = true;
    o.outsideParty = rng.pick(['Mehta Agencies, Ahmedabad', 'Kolkata Saree Centre', 'Through Jayesh Agency']);
  });

  const outside = new OutsideSim(clock, rng, sink, sim, weavers);
  let specials = 0;
  for (const o of byTime()) {
    sim.run(o);
    if (o.kind === 'outside') outside.runOutside(o, specials === 2 ? 'closed' : specials === 5 ? 'cancelled' : undefined), (specials += 1);
    if (o.kind === 'fg') outside.runFg(o);
  }
  for (const o of sim.orders) sim.cut(o);
  // machine damage at today's taka entry (the supervisor's "damage today" cards)
  const todayTakas = sim.orders.flatMap((o) => o.takas).filter((t) => t.source === 'production' && t.createdX >= Math.floor(H) && t.order.unit === 'pcs');
  if (todayTakas.filter((t) => t.damages.length).length < 2) todayTakas.slice(0, 2).forEach((t) => sim.damage(t, 'machine', 'taka_entry', t.createdX + 0.0001, ['Hole', 'Missing pick'], 'taka_entry'));

  /* ---------- after the flow ---------- */
  const after = new Aftermath(clock, rng, sink, sim);
  const lastStage = (t: SimTaka) => t.moves[t.moves.length - 1]?.stage;
  // a few splits in the godown
  sim.orders
    .flatMap((o) => o.takas)
    .filter((t) => t.order.unit === 'pcs' && (t.pcs ?? 0) >= 12 && lastStage(t) === 'ready_dispatch' && t.order.holdX === null)
    .filter((_, i) => i % 97 === 11)
    .slice(0, 6)
    .forEach((t) => after.split(t, t.moves.find((m) => m.stage === 'ready_dispatch')!.x + 0.05));
  for (const o of byTime()) after.dispatch(o);
  // old challan goods returns (DC revisions)
  let grs = 0;
  for (const o of byTime().filter((x) => x.createdX < H - 120 && x.createdX > H - 300 && !x.noFreeStock && x.dispatches.length === 1 && !x.closeEarly)) {
    if (grs >= 2) break;
    if (o.takas.every((t) => lastStage(t) === 'dispatched') && after.goodsReturn(o)) grs += 1;
  }
  // one undone dispatch on an order that is ready now
  for (const o of byTime().reverse()) {
    if (o.dispatches.length || o.holdX !== null || !o.takas.length) continue;
    if (o.takas.every((t) => lastStage(t) === 'ready_dispatch') && after.undoDispatch(o)) break;
  }
  // three takas lost at a party (out for a long time)
  sim.trips
    .filter((tr) => tr.receiveX === null && tr.sendX < H - 9 && tr.taka.order.holdX === null && lastStage(tr.taka) === (tr.kind === 'butta' ? 'at_butta' : 'at_mill'))
    .slice(0, 3)
    .forEach((tr) => after.lose(tr, H - rng.u(1, 4)));

  /* ---------- stock: manual adds / removes, damaged lot, party returns ---------- */
  const stock = new StockSim(clock, sink, sim, sink, users, systemCustomerId);
  const retired = designs.filter((d) => d.retired);
  stock.addStock(retired[0], 'pcs', 36, false, H - 140);
  stock.addStock(retired[1], 'pcs', 18, true, H - 95);
  stock.addStock(designs[12], 'meters', 240, false, H - 30);
  stock.addStock(designs[30], 'pcs', 24, false, H - 6);
  const freeDamaged = sim.orders.flatMap((o) => o.takas).filter((t) => t.freeX !== null && t.deletedX === null && t.damages.some((d) => d.resolvedX === null));
  const lotTakas = [...freeDamaged.slice(0, 2), stock.addStock(retired[2], 'pcs', 9, true, H - 70)];
  stock.damagedLot(lotTakas, H - 20);
  const removable = sim.orders.flatMap((o) => o.takas).filter((t) => t.freeReason === 'moved' && t.deletedX === null && !t.damages.length);
  if (removable[0]) stock.removeStock(removable[0], 'sold', H - 45);
  if (removable[1]) stock.removeStock(removable[1], 'sample', H - 15);
  const dispatchedOf = (custIdx: number, from: number) =>
    sim.orders.filter((o) => o.customerIdx === custIdx && !o.noFreeStock).flatMap((o) => o.dispatches.filter((d) => d.revision === 0 && d.status === 'active' && d.x > from).flatMap((d) => d.takas)).filter((t) => lastStage(t) === 'dispatched' && t.freeX === null);
  const recentCust = [5, 6, 7, 8, 9].find((c) => dispatchedOf(c, H - 40).length >= 3) ?? 5;
  stock.partyReturnTakas(customers[recentCust].id, dispatchedOf(recentCust, H - 40).slice(0, 3), H - rng.u(5, 9), true);
  stock.partyReturnPcs(customers[recentCust].id, designs[sim.orders.find((o) => o.customerIdx === recentCust)?.designIdx ?? 3], 20, 0, H - 2, false);
  const olderCust = [2, 3, 4].find((c) => dispatchedOf(c, H - 140).length >= 2) ?? 2;
  stock.partyReturnTakas(customers[olderCust].id, dispatchedOf(olderCust, H - 140).slice(0, 2), H - rng.u(60, 80), true);
  stock.partyReturnPcs(customers[1].id, designs[sim.orders.find((o) => o.customerIdx === 1)?.designIdx ?? 1], 30, 6, H - 48, true);
  stock.partyReturnPcs(customers[3].id, designs[12], 45, 0, H - 36, false, 'meters');

  /* ---------- statuses, numbers, rows ---------- */
  const ordered = byTime();
  ordered.forEach((o, i) => (o.no = i + 1));
  for (const o of ordered) computeStatus(o, H);
  for (const o of stock.holderOrders()) o.status = 'closed';
  const emit = new Emitter(sink, clock, rng, users);
  // damage photos on a few QC damages
  sim.orders.flatMap((o) => o.takas.flatMap((t) => t.damages)).filter((d) => d.recordedAt === 'mill_qc' || d.recordedAt === 'butta_qc').filter((_, i) => i % 40 === 0).slice(0, 10).forEach((d) => (d.photo = true));
  emit.challans(sim.trips);
  for (const o of ordered) emit.order(o);
  stock.emitHolders(emit);
  emit.dispatches(after);
  emit.outside(outside);
  stock.writeAdjustments();

  /* ---------- yarn ---------- */
  const yarn = new YarnSim(clock, rng, sink, users, { qualityIds: yarnQualityIds, wqIds, partyIds: yarnPartyIds, tfoMachineIds, systemQualityId, paltiProgramId });
  yarn.run();

  /* ---------- counters (the next real number continues after the demo) ---------- */
  const allTakas = [...sim.orders, ...stock.holderOrders()].flatMap((o) => o.takas);
  const maxTaka = Math.max(10, ...allTakas.map((t) => Number(t.no)).filter(Number.isFinite));
  const maxJs = Math.max(0, ...sim.orders.flatMap((o) => o.jobsheets.filter((j) => !j.external).map((j) => j.no)));
  const counters: Record<string, number> = {
    jobsheet_no: maxJs,
    taka_no: maxTaka,
    butta_challan_no: sink.rows('challans').filter((c) => c.kind === 'butta').length,
    mill_challan_no: sink.rows('challans').filter((c) => c.kind === 'mill').length,
    dispatch_challan_no: Math.max(0, ...sink.rows('dispatch_challans').map((d) => Number(d.challan_no))),
    outside_po_no: outside.pos.length,
    dummy_taka_no: allTakas.filter((t) => /^D\d+$/.test(t.no)).length,
    party_return_no: sink.count('party_returns'),
    damaged_lot_no: sink.count('damaged_lots'),
    stock_holder_order_no: stock.holderOrders().length,
    ...yarn.counters(),
  };

  await libsql.execute('PRAGMA foreign_keys = OFF');
  const written = await sink.flush(libsql, columns, now.toISOString());
  await libsql.batch(
    Object.entries(counters).map(([name, value]) => ({ sql: 'INSERT INTO counters (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = MAX(value, excluded.value)', args: [name, value] })),
    'write',
  );
  const fk = await libsql.execute('PRAGMA foreign_key_check');
  await libsql.execute('PRAGMA foreign_keys = ON');
  if (fk.rows.length) throw new Error(`demo seed: ${fk.rows.length} foreign key problems, e.g. ${JSON.stringify(fk.rows.slice(0, 3))}`);

  const statuses = new Map<string, number>();
  const missing = ORDER_STATUSES.map((st) => st.key).filter((k) => !ordered.some((o) => o.status === k));
  for (const o of ordered) statuses.set(o.status, (statuses.get(o.status) ?? 0) + 1);
  const onLoom = sim.orders.flatMap((o) => o.jobsheets).filter((j) => !j.external && j.startX !== null && j.startX <= H && (j.endX === null || j.endX > H));
  return {
    counts: {
      rows: written,
      orders: ordered.length,
      jobsheets: sink.count('jobsheets'),
      takas: sink.count('takas'),
      'taka damages': sink.count('taka_damages'),
      'butta / mill challans': sink.count('challans'),
      'delivery challans': sink.count('dispatch_challans'),
      'outside POs': sink.count('outside_pos'),
      'yarn moves': sink.count('yarn_stock_moves'),
      'looms running now': new Set(onLoom.map((j) => j.machineId)).size,
      ...Object.fromEntries([...statuses.entries()].sort().map(([k, v]) => [`status ${k}`, v])),
    },
    logins: userRows.map((u) => ({ name: String(u.name), phone: String(u.phone), role: String(u.role) })),
    notes: [`steps waiting today: ${ordered.filter((o) => o.stall).map((o) => `${o.stall}(${o.kind}) → ${o.status}`).join(', ')}`, `order statuses not present: ${missing.join(', ') || 'none'}`, `low yarn qualities: ${yarn.lowQualities.length}`, `first demo day ${clock.startDay}, today ${clock.today} (FY ${fyOf(now)})`, `stage of a sample taka: ${stageAt(allTakas[0], H)}`],
  };
}

export type { RoleKey };
