/**
 * Sprint 13 API flow check against a running API on a LOCAL file database (never run against Turso):
 *
 *   TURSO_DATABASE_URL=file:C:/path/test.db TURSO_AUTH_TOKEN=x node scripts/check-sprint13.mjs [baseUrl]
 *
 * (migrate + seed the file first; start the API with the same env.) It builds its own orders, so it can run many times.
 * Covers: blouse option, damage type required/optional, move to inventory (lump + pcs split), the free-stock order
 * rule, add from free stock, the re-butta fix (incl. split parts), goods return -> free stock + Returned status.
 * Stage changes that need physical steps (butta / mill) are set straight in the file DB.
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
  supervisor: await login('7777777777', 'Rivoora@777'),
  taka: await login('6666666666', 'Rivoora@666'),
  qc: await login('5555555555', 'Rivoora@555'),
  dhruvil: await login('3333333333', 'Rivoora@333'),
};
async function call(who, method, path, body) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { Cookie: sessions[who], 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}
const ok = async (who, method, path, body) => {
  const r = await call(who, method, path, body);
  if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
const sql = async (q, args = []) => (await db.execute({ sql: q, args })).rows;

// ---------------------------------------------------------------- setup
const customer = (await ok('jemish', 'GET', '/lookup/customers')).items?.[0] ?? (await ok('jemish', 'GET', '/lookup/customers'))[0];
const material = (await ok('jemish', 'GET', '/lookup/materials')).items?.[0] ?? (await ok('jemish', 'GET', '/lookup/materials'))[0];
const designs = await ok('jemish', 'GET', '/designs?limit=5');
const design = (designs.items ?? designs)[0];
const machines = await ok('jemish', 'GET', '/lookup/machines');
const machineIds = (machines.items ?? machines).slice(0, 2).map((m) => m.id);
check(!!customer && !!material && !!design && machineIds.length > 0, 'fixtures: customer, material, design, machines exist');

const newOrder = (orderType, blouseOption) =>
  ok('jemish', 'POST', '/orders', {
    customerId: customer.id, orderType, blouseOption, materialId: material.id, designId: design.id,
    quantity: 90, unit: 'pcs', rate: 100, orderDate: '2026-10-01', notes: '', noteImages: [],
  });
const A = await newOrder('lump', 'with_blouse');
const B = await newOrder('lump', null);
const C = await newOrder('pcs_to_pcs', 'without_blouse');
const [dA, dB, dC] = await Promise.all([A, B, C].map((o) => ok('jemish', 'GET', `/orders/${o.id}`)));
check(dA.blouseOption === 'with_blouse' && dB.blouseOption === null && dC.blouseOption === 'without_blouse', 'blouse option saved on create (optional)', [dA.blouseOption, dB.blouseOption, dC.blouseOption]);
const bad = await call('jemish', 'POST', '/orders', { customerId: customer.id, orderType: 'lump', blouseOption: 'maybe', materialId: material.id, quantity: 1, unit: 'pcs', orderDate: '2026-10-01' });
check(bad.status === 400, 'invalid blouse option → 400');

await ok('jemish', 'POST', '/orders/send-to-production', { orderIds: [A.id, B.id, C.id] });
const jsOf = {};
for (const o of [A, B, C]) {
  await ok('jemish', 'POST', `/orders/${o.id}/jobsheets/generate`, { pieces: 90, framesPerJobsheet: 30, machineIds });
  const list = await ok('jemish', 'GET', `/orders/${o.id}/jobsheets`);
  jsOf[o.id] = list.jobsheets[0].id;
}
const printed = await ok('jemish', 'GET', `/jobsheets/print?ids=${jsOf[A.id]}`);
check(printed[0].blouseOption === 'with_blouse', 'jobsheet print carries the blouse option');

// ---------------------------------------------------------------- damage type: required
const noType = await call('taka', 'POST', `/jobsheets/${jsOf[A.id]}/takas`, { takas: [{ pcs: 10, meters: 100, damages: [{ otherName: 'Hole', pcs: 1 }] }] });
check(noType.status === 400, 'taka entry: a damage without a type is rejected', noType.body);
const entered = await ok('taka', 'POST', `/jobsheets/${jsOf[A.id]}/takas`, {
  takas: [
    { pcs: 20, meters: 200, damages: [{ type: 'mill', otherName: 'Oil stain', pcs: 2 }] },
    { pcs: 20, meters: 200 }, { pcs: 20, meters: 200 }, { pcs: 20, meters: 200 }, { pcs: 10, meters: 100 },
  ],
});
const aTakas = entered.added;
check(aTakas.length === 5, 'taka entry on order A: 5 takas');
const damage = aTakas[0].damages[0];
check(damage?.foundAt === 'mill' && damage?.recordedAt === 'taka_entry', 'damage saved with the chosen type + recorded_at = taka_entry', damage);

await ok('taka', 'POST', `/jobsheets/${jsOf[B.id]}/takas`, { takas: [{ pcs: 30, meters: 300 }] });
const cEntered = await ok('taka', 'POST', `/jobsheets/${jsOf[C.id]}/takas`, { takas: [{ pcs: 30, meters: 300 }, { pcs: 30, meters: 300 }, { pcs: 30, meters: 300 }] });
const cTakas = cEntered.added;

// every A / B / C taka is final in the godown (steps outside this check)
await sql(`UPDATE takas SET stage='final', has_been_to_mill=1 WHERE order_id IN (?,?,?)`, [A.id, B.id, C.id]);
await sql(`UPDATE takas SET stage='waiting_mill', has_been_to_mill=0 WHERE id = ?`, [aTakas[4].id]);

// ---------------------------------------------------------------- move to inventory (lump)
const key = `d-${design.id}`;
const wrongKind = await call('jemish', 'POST', `/orders/${A.id}/takas/move-to-inventory`, { pcs: 5 });
check(wrongKind.status === 400, 'lump order rejects a pcs move');
const dhruvilMove = await call('qc', 'POST', `/orders/${A.id}/takas/move-to-inventory`, { takaIds: [aTakas[1].id] });
check(dhruvilMove.status === 403, 'QC role may not move stock');
const moved = await ok('dhruvil', 'POST', `/orders/${A.id}/takas/move-to-inventory`, { takaIds: [aTakas[1].id, aTakas[4].id], note: 'client cancelled' });
check(moved.takas === 2 && moved.pcs === 30, 'lump move: 2 takas / 30 pcs', moved);
let aList = await ok('jemish', 'GET', `/orders/${A.id}/takas`);
const aIds = aList.groups.flatMap((g) => g.takas.map((t) => t.id));
check(!aIds.includes(aTakas[1].id) && !aIds.includes(aTakas[4].id) && aIds.length === 3, 'order A no longer lists the moved takas');
const rowMoved = (await sql('SELECT order_id, is_free_stock, stage, free_stock_reason FROM takas WHERE id = ?', [aTakas[4].id]))[0];
check(Number(rowMoved.order_id) === A.id && Number(rowMoved.is_free_stock) === 1 && rowMoved.stage === 'waiting_mill' && rowMoved.free_stock_reason === 'moved', 'order_id stays the origin; an in-making taka keeps its stage', rowMoved);
const dash = await ok('jemish', 'GET', `/orders/${A.id}/dashboard`);
check(dash.takaCount === 3, 'dashboard counts only the 3 remaining takas', dash.takaCount);
let free = await ok('jemish', 'GET', `/inventory/items/${key}/free-stock`);
check(free.figures.total >= 30 && free.takas.some((t) => t.id === aTakas[1].id), 'inventory free stock lists the moved takas');
check(free.figures.ready >= 20 && free.figures.making >= 10, 'free ready vs in making', free.figures);
const dFree = await ok('dhruvil', 'GET', `/inventory/items/${key}/free-stock`);
check(dFree.takas.length === free.takas.length, 'Dhruvil reads the free stock without the Inventory permission');
const noInv = await call('dhruvil', 'GET', `/inventory/summary`);
check(noInv.status === 403, 'Dhruvil still has no Inventory screens');
const summary = await ok('jemish', 'GET', '/inventory/summary');
check(summary.freePcs >= 30, 'inventory summary: Free stock KPI', summary.freePcs);
const item = await ok('jemish', 'GET', `/inventory/items/${key}`);
check(item.free.total >= 30 && item.blouseCounts.with_blouse > 0, 'item details: free figures + blouse counts', item.blouseCounts);
const itemWithout = await ok('jemish', 'GET', `/inventory/items/${key}?blouse=without_blouse`);
check(itemWithout.free.total < item.free.total, 'blouse filter narrows the free stock (free is from order A = With blouse)', [itemWithout.free, item.free]);

// Edit takas on the jobsheet must not touch (or delete) the takas that became free stock.
const grp = aList.groups.find((g) => g.jobsheetId === jsOf[A.id]);
const editBody = {
  takas: grp.takas.map((t) => ({
    id: t.id, takaNo: t.takaNo, meters: t.meters, pcs: t.pcs,
    damages: t.damages.filter((d) => d.status === 'open').map((d) => ({ id: d.id, damageId: d.damageId, pcs: d.pcs })),
  })),
  note: null,
};
const edited = await call('jemish', 'PUT', `/jobsheets/${jsOf[A.id]}/takas`, editBody);
check(edited.status === 200, 'Edit takas on the jobsheet still saves', edited.body);
const stillThere = await sql('SELECT COUNT(*) AS n FROM takas WHERE id IN (?, ?) AND is_deleted = 0 AND is_free_stock = 1', [aTakas[1].id, aTakas[4].id]);
check(Number(stillThere[0].n) === 2, 'Edit takas did not delete the free-stock takas', stillThere);

// ---------------------------------------------------------------- add from free stock
const wrongTake = await call('jemish', 'POST', `/orders/${B.id}/takas/add-from-free-stock`, { pcs: 10 });
check(wrongTake.status === 400, 'lump order rejects a pcs add');
const added = await ok('jemish', 'POST', `/orders/${B.id}/takas/add-from-free-stock`, { takaIds: [aTakas[1].id] });
check(added.takas === 1 && added.pcs === 20, 'add from free stock: 1 taka / 20 pcs to order B', added);
const bList = await ok('jemish', 'GET', `/orders/${B.id}/takas`);
check(bList.groups.flatMap((g) => g.takas).some((t) => t.id === aTakas[1].id), 'order B now counts the allocated taka');
aList = await ok('jemish', 'GET', `/orders/${A.id}/takas`);
check(!aList.groups.flatMap((g) => g.takas).some((t) => t.id === aTakas[1].id), 'order A does not count it any more (exactly one order)');
free = await ok('jemish', 'GET', `/inventory/items/${key}/free-stock`);
check(!free.takas.some((t) => t.id === aTakas[1].id), 'it left the free stock');
const twice = await call('jemish', 'POST', `/orders/${B.id}/takas/add-from-free-stock`, { takaIds: [aTakas[1].id] });
check(twice.status === 409, 'a taka that is no longer free can not be added twice');

// ---------------------------------------------------------------- pcs-to-pcs move with a split
const tooMuch = await call('jemish', 'POST', `/orders/${C.id}/takas/move-to-inventory`, { pcs: 500 });
check(tooMuch.status === 400, 'pcs move: more than the godown has → 400');
const cMoved = await ok('jemish', 'POST', `/orders/${C.id}/takas/move-to-inventory`, { pcs: 45 });
check(cMoved.pcs === 45 && cMoved.split === true && cMoved.takas === 2, 'pcs move 45: one whole taka + a split part', cMoved);
const cRows = await sql('SELECT id, taka_no, pcs, is_free_stock, parent_taka_id, has_been_to_mill, stage, meters FROM takas WHERE order_id = ? ORDER BY id', [C.id]);
const partRow = cRows.find((r) => r.parent_taka_id !== null);
check(!!partRow && Number(partRow.is_free_stock) === 1 && /[A-Z]$/.test(partRow.taka_no) && Number(partRow.has_been_to_mill) === 1, 'split part: next letter number, free stock, inherits has_been_to_mill', partRow);
const parentRow = cRows.find((r) => r.id === partRow.parent_taka_id);
check(Number(parentRow.pcs) + Number(partRow.pcs) === 30, 'split keeps the pcs: kept + moved = 30');
check(Math.abs(Number(parentRow.meters) + Number(partRow.meters) - 300) < 0.01, 'split meters add up to the original');
const cNow = await ok('jemish', 'GET', `/orders/${C.id}/takas`);
const cPcs = cNow.groups.flatMap((g) => g.takas).reduce((n, t) => n + (t.actualPcs ?? t.pcs ?? 0), 0);
check(cPcs === 45, 'order C keeps 45 pcs', cPcs);

// ---------------------------------------------------------------- re-butta fix
// the split part (of a taka that has been to the mill) comes back from a re-butta: Butta QC must send it to FINAL.
await sql(`UPDATE takas SET stage='butta_qc', has_been_to_mill=0 WHERE id = ?`, [partRow.id]); // flag only on the PARENT: the part must inherit
const qc1 = await ok('qc', 'POST', `/butta-qc/${partRow.id}`, { meters: null, pcs: Number(partRow.pcs), damageDecisions: [], newDamages: [] });
const afterQc = (await sql('SELECT stage FROM takas WHERE id = ?', [partRow.id]))[0];
check(afterQc.stage === 'final', 'split part of a taka that has been to the mill → Butta QC → final (not the mill)', [qc1, afterQc]);
// a split part whose ancestors never went to the mill still goes to the mill
await sql(`UPDATE takas SET has_been_to_mill=0 WHERE id = ?`, [parentRow.id]);
await sql(`UPDATE takas SET stage='butta_qc', has_been_to_mill=0 WHERE id = ?`, [partRow.id]);
await ok('qc', 'POST', `/butta-qc/${partRow.id}`, { meters: null, pcs: Number(partRow.pcs), damageDecisions: [], newDamages: [] });
check((await sql('SELECT stage FROM takas WHERE id = ?', [partRow.id]))[0].stage === 'waiting_mill', 'a part of a taka that never went to the mill → waiting_mill');
// a normal taka
await sql(`UPDATE takas SET stage='butta_qc', has_been_to_mill=0, refinish_count=0, parent_taka_id=NULL WHERE id = ?`, [aTakas[2].id]);
await ok('qc', 'POST', `/butta-qc/${aTakas[2].id}`, { meters: null, pcs: 20, damageDecisions: [], newDamages: [] });
check((await sql('SELECT stage FROM takas WHERE id = ?', [aTakas[2].id]))[0].stage === 'waiting_mill', 'a normal taka → waiting_mill');
await sql(`UPDATE takas SET stage='butta_qc', has_been_to_mill=1 WHERE id = ?`, [aTakas[2].id]);
await ok('qc', 'POST', `/butta-qc/${aTakas[2].id}`, { meters: null, pcs: 20, damageDecisions: [], newDamages: [] });
check((await sql('SELECT stage FROM takas WHERE id = ?', [aTakas[2].id]))[0].stage === 'final', 'a re-butta taka (has been to the mill) → final');
const qcBad = await call('qc', 'POST', `/butta-qc/${aTakas[3].id}`, { pcs: 20, damageDecisions: [], newDamages: [{ otherName: 'Cut', pcs: 1 }] });
check(qcBad.status === 400 || qcBad.status === 409, 'QC: a new damage without a type is rejected');

// ---------------------------------------------------------------- godown damage type
await sql(`UPDATE takas SET stage='final' WHERE id = ?`, [aTakas[3].id]);
const gd = await call('dhruvil', 'POST', `/godown/takas/${aTakas[3].id}/damage`, { type: 'butta', otherName: 'Torn edge', pcs: 1, images: [] });
check(gd.status === 200, 'Dhruvil marks a damage with a chosen type', gd.body);
const gdNo = await call('dhruvil', 'POST', `/godown/takas/${aTakas[3].id}/damage`, { otherName: 'Torn edge', pcs: 1, images: [] });
check(gdNo.status === 400, 'godown damage without a type → 400');
const gdRow = (await sql(`SELECT found_at, recorded_at FROM taka_damages WHERE taka_id = ? ORDER BY id DESC LIMIT 1`, [aTakas[3].id]))[0];
check(gdRow.found_at === 'butta' && gdRow.recorded_at === 'godown', 'stored as type butta, recorded at godown', gdRow);

// ---------------------------------------------------------------- dispatch + goods return → free stock + Returned
await sql(`UPDATE takas SET stage='ready_dispatch', godown_checked_at='2026-10-01' WHERE order_id = ? AND is_free_stock = 0 AND allocated_order_id IS NULL AND is_deleted = 0`, [A.id]);
const aLeft = await ok('jemish', 'GET', `/orders/${A.id}/takas`);
const aLeftIds = aLeft.groups.flatMap((g) => g.takas.map((t) => t.id));
check(aLeftIds.length === 3, 'order A has 3 takas left to dispatch', aLeftIds);
const disp = await ok('dhruvil', 'POST', `/godown/orders/${A.id}/dispatch`, { challanDate: '2026-10-02' });
let aOrder = await ok('jemish', 'GET', `/orders/${A.id}`);
check(aOrder.status === 'dispatched', 'all remaining takas dispatched, no goods return → Dispatched', aOrder.status);
const returnedTaka = aLeftIds[0];
const gr = await ok('dhruvil', 'POST', `/dispatch/challans/${disp.challanId}/goods-return`, {
  returns: [{ takaId: returnedTaka, damages: [{ otherName: 'Dirty', pcs: 1 }] }], date: '2026-10-05', note: 'client returned',
});
check(gr.returnedTakas === 1, 'goods return of 1 taka', gr);
const grRow = (await sql('SELECT stage, is_free_stock, free_stock_reason, order_id FROM takas WHERE id = ?', [returnedTaka]))[0];
check(grRow.stage === 'final' && Number(grRow.is_free_stock) === 1 && grRow.free_stock_reason === 'goods_return' && Number(grRow.order_id) === A.id, 'GR: the returned taka is free stock (reason goods_return)', grRow);
const grDmg = (await sql('SELECT found_at, recorded_at FROM taka_damages WHERE taka_id = ? ORDER BY id DESC LIMIT 1', [returnedTaka]))[0];
check(grDmg.found_at === 'unmarked' && grDmg.recorded_at === 'goods_return', 'GR damage without a type → "not marked"', grDmg);
aOrder = await ok('jemish', 'GET', `/orders/${A.id}`);
check(aOrder.status === 'returned', 'order with a goods return and everything else dispatched → Returned', aOrder.status);
check(aOrder.returned?.takas === 1, 'order details carry the returned summary', aOrder.returned);
const dispList = await ok('dhruvil', 'GET', '/dispatched?status=returned');
check(dispList.items.some((o) => o.orderId === A.id) && dispList.items.every((o) => o.status === 'returned'), 'Dispatched list: Returned filter');
const damaged = await ok('jemish', 'GET', `/inventory/damaged/${key}`);
check(damaged.damaged >= 1, 'returned damaged pcs show in Inventory → Damaged (free stock)', damaged.damaged);
const grFree = await ok('jemish', 'GET', `/inventory/items/${key}/free-stock`);
check(grFree.takas.some((t) => t.id === returnedTaka && t.reason === 'goods_return'), 'returned taka is listed as free stock (Returned)');
const dmgTab = await ok('jemish', 'GET', `/orders/${B.id}/damages`);
check(Array.isArray(dmgTab.counts), 'damages tab endpoint still works');

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll Sprint 13 checks passed');
process.exit(failed ? 1 : 0);
