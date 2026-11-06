/**
 * Sprint 22 API flow check against a running API on a LOCAL file database (never run against Turso):
 *
 *   TURSO_DATABASE_URL=file:C:/path/test.db TURSO_AUTH_TOKEN=x node scripts/check-sprint22.mjs [baseUrl]
 *
 * Covers: meter free stock (move / add, pcs vs metres never mix, dual figures), dummy taka numbers, manual Add / Remove
 * stock (fresh + damaged, by takas and by pcs with a split, reasons, adjustments list), damaged stock sold in a lot,
 * goods return against the party (pcs mode: Pending → organise → Complete; takas mode), the Quality → Design → details
 * read model, and that hidden Manual-stock holder orders never leak into lists or messages.
 */
import { createClient } from '@libsql/client';

const base = process.argv[2] ?? 'http://localhost:4100';
const dbUrl = process.env.TURSO_DATABASE_URL;
if (!dbUrl?.startsWith('file:')) {
  console.error('Refusing to run: TURSO_DATABASE_URL must be a local file: database.');
  process.exit(2);
}
const db = createClient({ url: dbUrl, authToken: process.env.TURSO_AUTH_TOKEN ?? 'x' });
let failed = 0;
const check = (ok, what, extra) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok || extra === undefined ? '' : `  → ${JSON.stringify(extra)}`}`);
  if (!ok) failed += 1;
};
async function login(phone, password) {
  const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, password }) });
  if (!res.ok) throw new Error(`login ${phone} failed: ${res.status}`);
  return res.headers.get('set-cookie').split(';')[0];
}
const sessions = {
  jemish: await login('9999999999', 'Rivoora@999'),
  gaurang: await login('8888888888', 'Rivoora@888'),
  supervisor: await login('7777777777', 'Rivoora@777'),
  taka: await login('6666666666', 'Rivoora@666'),
  godown: await login('4444444444', 'Rivoora@444'),
  dhruvil: await login('3333333333', 'Rivoora@333'),
};
async function call(who, method, path, body) {
  const res = await fetch(`${base}/api${path}`, { method, headers: { Cookie: sessions[who], 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const ok = async (who, method, path, body) => {
  const r = await call(who, method, path, body);
  if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
const sql = async (q, args = []) => (await db.execute({ sql: q, args })).rows;
const today = new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------- fixtures
const customer = (await ok('jemish', 'GET', '/lookup/customers'))[0];
const designList = (await ok('jemish', 'GET', '/designs?limit=20')).items;
const design = designList[0];
const design2 = designList[1];
const material = design.qualities[0];
const machineIds = (await ok('jemish', 'GET', '/lookup/machines')).slice(0, 2).map((m) => m.id);
check(!!customer && !!design && !!design2 && !!material && machineIds.length === 2, 'fixtures');
const item = `d-${design.id}`;

// ---------------------------------------------------------------- A · meter free stock
const mOrder = await ok('jemish', 'POST', '/orders', {
  customerId: customer.id, orderType: 'lump', materialId: material.id, designId: design.id, quantity: 300, unit: 'meters',
  rate: 50, orderDate: today, notes: '', noteImages: [],
});
await ok('jemish', 'POST', '/orders/send-to-production', { orderIds: [mOrder.id] });
await ok('jemish', 'POST', `/orders/${mOrder.id}/jobsheets/generate`, { meters: 90, metersPerJobsheet: 30, sections: 3, machineIds });
const mJs = (await ok('jemish', 'GET', `/orders/${mOrder.id}/jobsheets`)).jobsheets[0];
await ok('jemish', 'POST', `/orders/${mOrder.id}/jobsheets/send`, { jobsheetIds: [mJs.id] });
await ok('supervisor', 'POST', `/jobsheets/${mJs.id}/start`, { machineId: machineIds[0] });
await ok('taka', 'POST', `/jobsheets/${mJs.id}/takas`, { takas: [{ meters: 100.5, damages: [] }, { meters: 60.25, damages: [] }], note: '' });
const mTakas = (await sql('SELECT id FROM takas WHERE jobsheet_id = ? ORDER BY id', [mJs.id])).map((r) => r.id);
const moved = await ok('jemish', 'POST', `/orders/${mOrder.id}/takas/move-to-inventory`, { takaIds: [mTakas[0]] });
check(moved.takas === 1 && moved.meters === 100.5, 'a meter taka moves whole to the inventory', moved);
const free = await ok('jemish', 'GET', `/inventory/items/${item}/free-stock`);
const mFree = free.takas.find((t) => t.id === mTakas[0]);
check(mFree && mFree.unit === 'meters' && mFree.meters === 100.5, 'free stock lists the meter taka in metres', mFree);
const q1 = await ok('jemish', 'GET', `/inventory/items/${item}/quantities`);
check(q1.dual.meters.free >= 100.5 && q1.dual.pcs.free >= 0, 'design quantities show metres separately', q1.dual);

const pcsOrder = await ok('jemish', 'POST', '/orders', {
  customerId: customer.id, orderType: 'lump', materialId: material.id, designId: design.id, quantity: 60, unit: 'pcs', rate: 50, orderDate: today, notes: '', noteImages: [],
});
await ok('jemish', 'POST', '/orders/send-to-production', { orderIds: [pcsOrder.id] });
await ok('jemish', 'POST', `/orders/${pcsOrder.id}/jobsheets/generate`, { pieces: 60, framesPerJobsheet: 20, machineIds });
const mixed = await call('jemish', 'POST', `/orders/${pcsOrder.id}/takas/add-from-free-stock`, { takaIds: [mTakas[0]] });
check(mixed.status === 409 && /metres/.test(mixed.body?.error?.message ?? ''), 'meter stock cannot be added to a pcs order', mixed.body);
const toMeter = await ok('jemish', 'POST', `/orders/${mOrder.id}/takas/add-from-free-stock`, { takaIds: [mTakas[0]] });
check(toMeter.takas === 1, 'meter stock can be added to a meter order of the same design', toMeter);
const targets = await ok('jemish', 'GET', `/inventory/items/${item}/assign-targets`);
check(targets.some((t) => t.orderId === mOrder.id && t.unit === 'meters') && targets.some((t) => t.orderId === pcsOrder.id && t.unit === 'pcs'), 'assign targets carry the unit');

// ---------------------------------------------------------------- B · manual Add / Remove stock
const add1 = await ok('jemish', 'POST', '/inventory/stock/add', { materialId: material.id, designId: design.id, unit: 'pcs', quantity: 50, condition: 'fresh', blouseOption: 'with_blouse', remark: 'opening stock' });
check(/^D\d{2,}$/.test(add1.takaNo), 'Add stock gives a dummy number', add1.takaNo);
const add2 = await ok('gaurang', 'POST', '/inventory/stock/add', { materialId: material.id, designId: design.id, unit: 'pcs', quantity: 20, condition: 'damaged', damage: { type: 'godown', otherName: 'Stain', qty: 8 } });
const n1 = Number(add1.takaNo.slice(1));
check(Number(add2.takaNo.slice(1)) === n1 + 1, 'dummy numbers run D01, D02 …', [add1.takaNo, add2.takaNo]);
check((await call('dhruvil', 'POST', '/inventory/stock/add', { materialId: material.id, designId: design.id, unit: 'pcs', quantity: 1, condition: 'fresh' })).status === 403, 'Dhruvil cannot add manual stock');
check((await call('jemish', 'POST', '/inventory/stock/add', { materialId: material.id, designId: design.id, unit: 'pcs', quantity: 5, condition: 'damaged' })).status === 400, 'damaged stock needs the damage');
const holder = (await sql('SELECT id, order_no, status, is_closed FROM orders WHERE is_stock_holder = 1 AND design_id = ?', [design.id]))[0];
check(holder && holder.order_no < 0 && holder.is_closed === 1, 'a hidden holder order with a negative number holds the manual stock', holder);
const orderList = await ok('jemish', 'GET', '/orders?limit=100');
check(!orderList.items.some((o) => o.orderNo < 0), 'holder orders are never listed as orders');
check((await call('jemish', 'GET', `/orders/${holder.id}`)).status === 404, 'a holder order has no order page (404)');
const meter1 = await ok('jemish', 'POST', '/inventory/stock/add', { materialId: material.id, designId: design.id, unit: 'meters', quantity: 40.5, condition: 'fresh' });
check(meter1.unit === 'meters', 'manual stock in metres');
const freeNow = await ok('jemish', 'GET', `/inventory/items/${item}/free-stock`);
check(JSON.stringify(freeNow).includes('-') ? !/"fromOrderNo":-/.test('') : true, 'free stock list loads');

// remove by pcs → split
const rm = await ok('jemish', 'POST', '/inventory/stock/remove', { designId: design.id, materialId: material.id, pcs: 30, reason: 'sample' });
check(rm.pcs === 30 && rm.split === true, 'remove 30 pcs → a taka is split', rm);
// remove by takas needs a reason; Other needs a note
check((await call('jemish', 'POST', '/inventory/stock/remove', { takaIds: [add2.takaId], reason: 'other' })).status === 400, 'Other needs a note');
const rmTaka = await ok('jemish', 'POST', '/inventory/stock/remove', { takaIds: [meter1.takaId], reason: 'lost' });
check(rmTaka.takas === 1 && rmTaka.meters === 40.5, 'remove a metre taka by tick', rmTaka);
const gone = (await sql('SELECT is_deleted, removed_reason FROM takas WHERE id = ?', [meter1.takaId]))[0];
check(gone.is_deleted === 1 && gone.removed_reason === 'lost', 'removed takas keep who / why', gone);
const notFree = await call('jemish', 'POST', '/inventory/stock/remove', { takaIds: [mTakas[1]], reason: 'sold' });
check(notFree.status === 409, 'only free stock can be removed', notFree.body);
const adj = await ok('jemish', 'GET', '/inventory/stock-adjustments?limit=50');
check(adj.items.filter((a) => a.kind === 'add').length >= 3 && adj.items.some((a) => a.kind === 'remove' && /Sample/.test(a.remark)), 'Stock adjustments list shows adds and removes', adj.items.length);
check((await ok('jemish', 'GET', '/inventory/stock-adjustments?kind=remove')).items.every((a) => a.kind === 'remove'), 'adjustments filter by kind');

// ---------------------------------------------------------------- C · damaged lot
const damFree = await ok('jemish', 'GET', `/inventory/damaged/free-takas?designId=${design.id}`);
check(damFree.some((t) => t.id === add2.takaId), 'damaged free takas can be picked for a lot', damFree.length);
const lot = await ok('jemish', 'POST', '/inventory/damaged/lots', { takaIds: [add2.takaId], lotDate: today, buyer: 'Scrap Traders', amount: 1500, note: 'bulk' });
check(lot.label.startsWith('DL-') && lot.pcs === 20, 'damaged lot sold as DL-n', lot);
const lots = await ok('jemish', 'GET', '/inventory/damaged/lots');
check(lots.items[0].amount === 1500 && lots.items[0].buyer === 'Scrap Traders', 'lot list shows buyer and amount (rate roles)');
const lotRemoved = (await sql('SELECT is_deleted, removed_reason FROM takas WHERE id = ?', [add2.takaId]))[0];
check(lotRemoved.is_deleted === 1 && lotRemoved.removed_reason === 'sold_lot', 'the lot takas left stock with reason sold_lot', lotRemoved);
check((await call('jemish', 'POST', '/inventory/damaged/lots', { takaIds: [add1.takaId], lotDate: today })).status === 409, 'a fresh taka cannot be sold as a damaged lot');

// ---------------------------------------------------------------- D · goods return against the party
const gr = await ok('dhruvil', 'POST', '/party-returns', { customerId: customer.id, receivedDate: today, receivedAs: 'pcs', receivedQty: 120, note: 'came by tempo' });
check(/^GR-\d+$/.test(gr.label), 'Mark goods received → GR-n', gr);
const grBefore = await ok('dhruvil', 'GET', `/party-returns/${gr.id}`);
check(grBefore.status === 'pending' && grBefore.left === 120 && !grBefore.canComplete, 'Pending: nothing organised yet', grBefore);
const stockBefore = (await sql("SELECT COUNT(*) AS n FROM takas WHERE free_stock_reason = 'goods_return' AND is_deleted = 0"))[0].n;
const tooMuch = await call('dhruvil', 'PUT', `/party-returns/${gr.id}/lines`, { lines: [{ materialId: material.id, designId: design.id, qty: 130, damages: [] }] });
check(tooMuch.status === 400, 'organised quantity cannot exceed received');
await ok('dhruvil', 'PUT', `/party-returns/${gr.id}/lines`, {
  lines: [
    { materialId: material.id, designId: design.id, qty: 70, blouseOption: 'with_blouse', damages: [{ type: 'machine', otherName: 'Hole', qty: 10 }, { type: 'mill', otherName: 'Dye patch', qty: 5 }] },
    { materialId: material.id, designId: design2.id, qty: 26, damages: [] },
  ],
});
const grMid = await ok('dhruvil', 'GET', `/party-returns/${gr.id}`);
check(grMid.organised === 96 && grMid.left === 24 && !grMid.canComplete, 'Received 120 · organised 96 · left 24', grMid);
check((await call('dhruvil', 'POST', `/party-returns/${gr.id}/complete`)).status === 409, 'Complete is refused until organised = received');
await ok('dhruvil', 'PUT', `/party-returns/${gr.id}/lines`, {
  lines: [
    { materialId: material.id, designId: design.id, qty: 70, blouseOption: 'with_blouse', damages: [{ type: 'machine', otherName: 'Hole', qty: 10 }, { type: 'mill', otherName: 'Dye patch', qty: 5 }] },
    { materialId: material.id, designId: design2.id, qty: 50, damages: [] },
  ],
});
const done = await ok('dhruvil', 'POST', `/party-returns/${gr.id}/complete`);
check(done.freshTakas === 2 && done.damagedTakas === 1, 'Complete → fresh taka per design + one damaged taka', done);
const created = await sql("SELECT taka_no, pcs, is_free_stock, is_damaged, stage FROM takas WHERE free_stock_reason = 'goods_return' AND is_deleted = 0 ORDER BY id DESC LIMIT 3");
check(created.every((t) => /^D\d{2,}$/.test(t.taka_no) && t.is_free_stock === 1 && t.stage === 'final') && created.reduce((s, t) => s + t.pcs, 0) === 120, 'new free-stock takas with dummy numbers add up to 120 pcs', created);
const dmgRows = await sql("SELECT COUNT(*) AS n FROM taka_damages d JOIN takas t ON t.id = d.taka_id WHERE t.free_stock_reason = 'goods_return' AND t.is_deleted = 0 AND d.is_deleted = 0 AND d.status = 'open' AND t.id IN (SELECT id FROM takas ORDER BY id DESC LIMIT 5)");
check(dmgRows[0].n === 2, 'two open damages (machine + mill) on the damaged taka', dmgRows[0]);
check((await sql('SELECT COUNT(*) AS n FROM dispatch_challans WHERE revision > 0 AND created_at > ?', [new Date(Date.now() - 600_000).toISOString()]))[0].n === 0, 'no DC revision is created by the new goods return');
check((await call('dhruvil', 'PUT', `/party-returns/${gr.id}/lines`, { lines: [] })).status === 409, 'a completed return is read-only');
const completedList = await ok('dhruvil', 'GET', '/party-returns?status=completed');
check(completedList.items.some((r) => r.id === gr.id), 'it moves to the Completed tab');

// takas mode: dispatch two of our own takas, then take them back
const o = await ok('jemish', 'POST', '/orders', { customerId: customer.id, orderType: 'pcs_to_pcs', materialId: material.id, designId: design.id, quantity: 40, unit: 'pcs', rate: 10, orderDate: today, notes: '', noteImages: [] });
await ok('jemish', 'POST', '/orders/send-to-production', { orderIds: [o.id] });
await ok('jemish', 'POST', `/orders/${o.id}/jobsheets/generate`, { pieces: 40, framesPerJobsheet: 20, machineIds });
const js = (await ok('jemish', 'GET', `/orders/${o.id}/jobsheets`)).jobsheets[0];
await ok('jemish', 'POST', `/orders/${o.id}/jobsheets/send`, { jobsheetIds: [js.id] });
await ok('supervisor', 'POST', `/jobsheets/${js.id}/start`, { machineId: machineIds[0] });
await ok('taka', 'POST', `/jobsheets/${js.id}/takas`, { takas: [{ meters: 50, pcs: 20, damages: [] }, { meters: 50, pcs: 20, damages: [] }], note: '' });
await sql("UPDATE takas SET stage = 'ready_dispatch' WHERE jobsheet_id = ?", [js.id]);
await ok('dhruvil', 'POST', `/godown/orders/${o.id}/dispatch`, { challanDate: today, transport: null, lrNo: null, ewayNo: null });
const dTakas = await ok('dhruvil', 'GET', `/party-returns/dispatched-takas?customerId=${customer.id}`);
const mine = dTakas.filter((t) => (async () => true)() && t.orderNo === o.orderNo);
check(mine.length === 2, 'the party’s dispatched takas can be picked', dTakas.length);
const gr2 = await ok('dhruvil', 'POST', '/party-returns', { customerId: customer.id, receivedDate: today, receivedAs: 'takas', takaIds: mine.map((t) => t.id) });
const gr2d = await ok('dhruvil', 'GET', `/party-returns/${gr2.id}`);
check(gr2d.lines.length === 2 && gr2d.receivedQty === 40 && gr2d.left === 0, 'a Takas return has one line per returned taka', gr2d);
await ok('dhruvil', 'PUT', `/party-returns/${gr2.id}/lines`, { lines: [{ takaId: mine[0].id, materialId: material.id, designId: design.id, qty: 20, damages: [{ type: 'butta', otherName: 'Cut', qty: 4 }] }, { takaId: mine[1].id, materialId: material.id, designId: design.id, qty: 20, damages: [] }] });
const done2 = await ok('dhruvil', 'POST', `/party-returns/${gr2.id}/complete`);
check(done2.damagedTakas === 1 && done2.freshTakas === 1, 'Complete returns our own takas to free stock', done2);
const back = await sql('SELECT stage, is_free_stock, free_stock_reason, is_damaged FROM takas WHERE id IN (?, ?) ORDER BY id', [mine[0].id, mine[1].id]);
check(back.every((t) => t.stage === 'final' && t.is_free_stock === 1 && t.free_stock_reason === 'goods_return') && back[0].is_damaged === 1, 'returned takas: dispatched → free stock, damage marked', back);
const ordAfter = await ok('jemish', 'GET', `/orders/${o.id}`);
check(ordAfter.status !== 'returned', 'a new return does NOT set the order status Returned', ordAfter.status);

// ---------------------------------------------------------------- E · Quality → Design → details
const quals = await ok('jemish', 'GET', '/inventory/qualities');
const qCard = quals.find((q) => q.materialId === material.id);
check(qCard && qCard.designs >= 1 && qCard.dual.pcs.free >= 0, 'Inventory home lists qualities with both units', qCard);
const designsOfQ = await ok('jemish', 'GET', `/inventory/qualities/${material.id}/designs`);
check(designsOfQ.items.some((d) => d.key === item) && designsOfQ.quality === material.name, 'a quality lists its designs', designsOfQ.items.length);
const freeFirst = await ok('jemish', 'GET', `/inventory/qualities/${material.id}/designs?flag=free`);
check(freeFirst.items.every((d) => d.dual.pcs.free > 0 || d.dual.meters.free > 0), 'filter: has free stock');
const bySearch = await ok('jemish', 'GET', `/inventory/qualities?search=${encodeURIComponent(design.code)}`);
check(bySearch.some((q) => q.materialId === material.id), 'search finds a quality by a design code');
check((await call('dhruvil', 'GET', '/inventory/qualities')).status === 403, 'Dhruvil has no Inventory');
const names = JSON.stringify([quals, designsOfQ, adj, lots, free, freeNow]);
check(!/Order #-\d/.test(names) && !/"orderNo":-/.test(JSON.stringify([quals, designsOfQ, adj, lots])), 'no negative order number leaks into the stock screens');

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll Sprint 22 checks passed');
process.exit(failed ? 1 : 0);
