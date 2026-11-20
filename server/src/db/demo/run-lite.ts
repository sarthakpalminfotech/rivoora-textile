import { fyOf, ORDER_STATUSES } from '@rivoora/shared';
import { env } from '../../env';
import { libsql } from '../client';
import { Aftermath } from './aftermath';
import { Clock, Rng } from './clock';
import { Emitter, setDamagePhotos, type UserIds } from './emit';
import { demoTargetProblem } from './guard';
import { DAMAGE_NAMES } from './masters';
import type { SimOrder, SimTaka } from './model';
import { OutsideSim } from './outside';
import { ProductionSim, type DesignRef } from './production';
import { Sink } from './sink';
import { computeStatus } from './status';
import { StockSim } from './stock';
import type { DemoResult } from './run';

/**
 * Small demo data set (DEMO_LITE=1): a handful of clients, 8 qualities, 16 designs WITHOUT images, ~25 orders over the
 * last 75 days sitting at every step (production → butta cutting → mill → ready / dispatch), a few free-stock and damaged
 * pieces. Same simulation as the big demo, so every status / history row stays consistent. Local demo file only.
 */

const LITE_CUSTOMERS: [string, string][] = [
  ['Laxmi Narayan Silk Mills', 'Surat'],
  ['Rajhans Fashions', 'Mumbai'],
  ['Gokuldham Creations', 'Ahmedabad'],
  ['Patel Brothers Textiles', 'Surat'],
  ['Mahalaxmi Saree Centre', 'Jaipur'],
  ['Kesariya Sarees', 'Kolkata'],
];
const LITE_BROKERS: [number, string][] = [[0, 'Kishorbhai Dalal'], [1, 'Vinod Kothari'], [3, 'Pankaj Brokers']];
const LITE_QUALITIES = ['Crepe', 'Russian Silk', 'HO', 'Kanjivaram', 'Georgette', 'Banarasi', 'Chiffon', 'Dola Silk'];
const LITE_DESIGN_NAMES = ['Paisley', 'Peacock', 'Temple Border', 'Zari Butta', 'Floral Jaal', 'Mango Buti', 'Lotus', 'Kalka'];

export async function buildLiteDemo(now = new Date()): Promise<DemoResult> {
  const problem = demoTargetProblem(env.databaseUrl, process.env.ALLOW_DEMO_SEED);
  if (problem) throw new Error(`demo seed refused after loading the config: ${problem}`);

  const tables = (await libsql.execute(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%drizzle%'`)).rows.map((r) => String(r.name));
  const columns = new Map<string, Set<string>>();
  const startIds = new Map<string, number>();
  for (const t of tables) {
    const info = await libsql.execute(`PRAGMA table_info("${t}")`);
    const cols = new Set(info.rows.map((r) => String(r.name)));
    columns.set(t, cols);
    if (cols.has('id')) startIds.set(t, Number((await libsql.execute(`SELECT COALESCE(MAX(id), 0) AS m FROM "${t}"`)).rows[0].m));
  }
  const userRows = (await libsql.execute('SELECT id, name, phone, role FROM users ORDER BY id')).rows;
  const users = Object.fromEntries(userRows.map((u) => [String(u.role), Number(u.id)])) as UserIds;

  const sink = new Sink(startIds);
  const clock = new Clock(now, 75);
  const rng = new Rng(2026_11);
  const t0 = clock.iso(0);
  const H = clock.H;

  /* ---------- masters ---------- */
  const existingSystem = (await libsql.execute('SELECT id FROM customers WHERE is_system = 1 LIMIT 1')).rows[0];
  const systemCustomerId = existingSystem ? Number(existingSystem.id) : sink.add('customers', { name: 'Stock (system)', is_system: 1, is_deleted: 1 }, t0);
  const customers = LITE_CUSTOMERS.map(([name, city], i) => ({
    id: sink.add('customers', { name, city, phone: `98${String(24000000 + i * 137911).slice(0, 8)}`, address: city, gst_number: null }, t0),
    brokers: [] as number[],
  }));
  for (const [ci, name] of LITE_BROKERS) customers[ci].brokers.push(sink.add('customer_brokers', { customer_id: customers[ci].id, name }, t0));
  const materialIds = LITE_QUALITIES.map((name, i) => sink.add('materials', { name, code: name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() + (i + 1) }, t0));

  // 16 designs, NO image (the owner uploads the photos himself); every quality gets two designs
  const designs: DesignRef[] = [];
  for (let i = 0; i < 16; i++) {
    const code = `D${101 + i}`;
    const butta = i % 4 !== 3;
    const qual = materialIds[i % 8];
    const id = sink.add('designs', { code, name: `${LITE_DESIGN_NAMES[i % 8]}${i >= 8 ? ' II' : ''}`, image_url: null, thumb_url: null, notes: null, butta_cutting: butta }, t0);
    sink.add('design_qualities', { design_id: id, material_id: qual }, t0);
    designs.push({ idx: i, id, code, materialIds: [qual], butta, retired: false, zeroStock: false });
  }
  setDamagePhotos([]);
  const machines = Array.from({ length: 10 }, (_, i) => sink.add('machines', { machine_no: i + 1, name: null, is_active: 1 }, t0));
  const buttaParties = ['Maa Khodiyar Butta Works', 'Jalaram Cutting Centre'].map((name, i) => sink.add('butta_parties', { name, mobile: `97${String(10000000 + i * 8137)}`.slice(0, 10), address: 'Surat' }, t0));
  const millParties = ['Anupam Dyeing Mills', 'Laxmipati Process House'].map((name, i) => sink.add('mill_parties', { name, mobile: `99${String(20000000 + i * 7713)}`.slice(0, 10), address: 'Surat' }, t0));
  const weavers = [['Shree Textiles', 'S'], ['Mahadev Weaving', 'M']].map(([name, code], i) => ({ id: sink.add('weavers', { name, short_code: code, mobile: `96${String(30000000 + i * 5113)}`.slice(0, 10), address: 'Surat' }, t0), code }));
  const damageIds = Object.fromEntries(DAMAGE_NAMES.map((n) => [n, sink.add('damages', { name: n }, t0)]));

  /* ---------- orders ---------- */
  const sim = new ProductionSim(clock, rng, sink, { customers, designs, machines, buttaParties, millParties, damageIds });
  // [client, days ago, kind, qty, order type, wait step today]
  type Spec = [number, number, 'pbm' | 'pm' | 'p', number, 'lump' | 'pcs_to_pcs', SimOrder['stall'] | undefined];
  const specs: Spec[] = [
    // the order to screenshot: big, every step has some takas right now
    [0, 15, 'pbm', 360, 'pcs_to_pcs', undefined],
    // one step each
    [1, 8, 'pbm', 180, 'pcs_to_pcs', 'entry'],
    [2, 22, 'pbm', 150, 'lump', 'butta_send'],
    [3, 26, 'pbm', 165, 'pcs_to_pcs', 'butta_qc'],
    [4, 34, 'pbm', 150, 'pcs_to_pcs', 'mill_send'],
    [5, 38, 'pbm', 200, 'lump', 'mill_qc'],
    [0, 44, 'pbm', 180, 'pcs_to_pcs', 'godown'],
    [1, 50, 'pbm', 165, 'lump', 'dispatch'],
    [2, 52, 'pbm', 210, 'pcs_to_pcs', 'dispatch_half'],
    [3, 40, 'pm', 150, 'pcs_to_pcs', 'mill_send'],
    [4, 30, 'p', 120, 'lump', 'godown'],
    // in production now
    [5, 5, 'pbm', 240, 'pcs_to_pcs', undefined],
    [0, 3, 'pbm', 150, 'pcs_to_pcs', undefined],
    [2, 2, 'pm', 135, 'lump', undefined],
    [3, 1, 'pbm', 90, 'pcs_to_pcs', undefined],
    // not sent yet
    [1, 0.4, 'pbm', 120, 'pcs_to_pcs', undefined],
    [4, 0.2, 'pm', 90, 'lump', undefined],
    // finished a while ago
    [0, 70, 'pbm', 150, 'pcs_to_pcs', undefined],
    [1, 66, 'pbm', 180, 'lump', undefined],
    [5, 62, 'pm', 120, 'pcs_to_pcs', undefined],
    [2, 58, 'pbm', 135, 'pcs_to_pcs', undefined],
  ];
  for (const [customerIdx, daysAgo, kind, qty, orderType, stall] of specs) {
    sim.book({ customerIdx, x: H - daysAgo, forced: { kind, unit: 'pcs', qty, rate: 450 + Math.round(rng.u(0, 700)), orderType, stall, promisedDay: daysAgo < 20 ? clock.day(H - daysAgo + 30) : null } });
  }
  const byTime = () => [...sim.orders].sort((a, b) => a.createdX - b.createdX);
  // the two newest orders stay unsent: they are not run
  const unsent = new Set(byTime().filter((o) => o.createdX > H - 0.6));

  const outside = new OutsideSim(clock, rng, sink, sim, weavers);
  for (const o of byTime()) {
    if (unsent.has(o)) {
      o.sentX = null;
      continue;
    }
    sim.run(o);
  }
  for (const o of sim.orders) sim.cut(o);

  const after = new Aftermath(clock, rng, sink, sim);
  const lastStage = (t: SimTaka) => t.moves[t.moves.length - 1]?.stage;
  for (const o of byTime()) after.dispatch(o);

  /* ---------- a little free stock + damaged stock ---------- */
  const stock = new StockSim(clock, sink, sim, sink, users, systemCustomerId);
  stock.addStock(designs[2], 'pcs', 24, false, H - 20);
  stock.addStock(designs[3], 'pcs', 18, false, H - 12);
  stock.addStock(designs[6], 'pcs', 12, false, H - 7);
  const dmg1 = stock.addStock(designs[4], 'pcs', 9, true, H - 10);
  stock.addStock(designs[10], 'pcs', 6, true, H - 4);
  const freeDamaged = sim.orders.flatMap((o) => o.takas).filter((t) => t.freeX !== null && t.deletedX === null && t.damages.some((d) => d.resolvedX === null));
  if (freeDamaged.length + 1 >= 2) stock.damagedLot([...freeDamaged.slice(0, 1), dmg1], H - 2);

  /* ---------- statuses, numbers, rows ---------- */
  const ordered = byTime();
  ordered.forEach((o, i) => (o.no = i + 1));
  for (const o of ordered) computeStatus(o, H);
  for (const o of stock.holderOrders()) o.status = 'closed';
  const emit = new Emitter(sink, clock, rng, users);
  sim.orders.flatMap((o) => o.takas.flatMap((t) => t.damages)).filter((d) => d.recordedAt === 'mill_qc' || d.recordedAt === 'butta_qc').forEach((d) => (d.photo = false));
  emit.challans(sim.trips);
  for (const o of ordered) emit.order(o);
  stock.emitHolders(emit);
  emit.dispatches(after);
  emit.outside(outside);
  stock.writeAdjustments();

  /* ---------- counters ---------- */
  const allTakas = [...sim.orders, ...stock.holderOrders()].flatMap((o) => o.takas);
  const maxTaka = Math.max(10, ...allTakas.map((t) => Number(t.no)).filter(Number.isFinite));
  const counters: Record<string, number> = {
    jobsheet_no: Math.max(0, ...sim.orders.flatMap((o) => o.jobsheets.filter((j) => !j.external).map((j) => j.no))),
    taka_no: maxTaka,
    butta_challan_no: sink.rows('challans').filter((c) => c.kind === 'butta').length,
    mill_challan_no: sink.rows('challans').filter((c) => c.kind === 'mill').length,
    dispatch_challan_no: Math.max(0, ...sink.rows('dispatch_challans').map((d) => Number(d.challan_no))),
    dummy_taka_no: allTakas.filter((t) => /^D\d+$/.test(t.no)).length,
    party_return_no: sink.count('party_returns'),
    damaged_lot_no: sink.count('damaged_lots'),
    stock_holder_order_no: stock.holderOrders().length,
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
  for (const o of ordered) statuses.set(o.status, (statuses.get(o.status) ?? 0) + 1);
  const missing = ORDER_STATUSES.map((st) => st.key).filter((k) => !ordered.some((o) => o.status === k));
  return {
    counts: {
      rows: written,
      orders: ordered.length,
      jobsheets: sink.count('jobsheets'),
      takas: sink.count('takas'),
      'taka damages': sink.count('taka_damages'),
      'butta / mill challans': sink.count('challans'),
      'delivery challans': sink.count('dispatch_challans'),
      ...Object.fromEntries([...statuses.entries()].sort().map(([k, v]) => [`status ${k}`, v])),
    },
    logins: userRows.map((u) => ({ name: String(u.name), phone: String(u.phone), role: String(u.role) })),
    notes: [`order statuses not present: ${missing.join(', ') || 'none'}`, `today ${clock.today} (FY ${fyOf(now)})`, `last stage of first taka: ${allTakas[0] ? lastStage(allTakas[0]) : '—'}`],
  };
}
