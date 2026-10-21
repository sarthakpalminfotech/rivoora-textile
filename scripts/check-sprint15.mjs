/**
 * Sprint 15 API flow check against a running API on a LOCAL file database (never run against Turso):
 *
 *   TURSO_DATABASE_URL=file:C:/path/test.db TURSO_AUTH_TOKEN=x node scripts/check-sprint15.mjs [baseUrl]
 *
 * (migrate + seed the file first; start the API with the same env.) It creates its own orders, so it can run many
 * times. Covers: live jobsheet numbers (create / delete / edit / single add), supervisor Order view quality + machines,
 * QC meters / pcs read-only, refinish challans never mixed, Hold order (hidden lists, 409 writes, receive allowed,
 * ongoing jobsheets completed + remaining Pending), the godown supervisor Orders module.
 */
const base = process.argv[2] ?? 'http://localhost:4100';
const dbUrl = process.env.TURSO_DATABASE_URL;
if (!dbUrl?.startsWith('file:')) {
  console.error('Refusing to run: TURSO_DATABASE_URL must be a local file: database.');
  process.exit(2);
}

let failed = 0;
const check = (ok, what, extra) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok || extra === undefined ? '' : `  → ${JSON.stringify(extra)}`}`);
  if (!ok) failed += 1;
};

const PHONES = { jemish: '9999999999', gaurang: '8888888888', supervisor: '7777777777', taka: '6666666666', qc: '5555555555', godown: '4444444444', dhruvil: '3333333333' };
const sessions = {};
for (const [who, phone] of Object.entries(PHONES)) {
  const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, password: `Rivoora@${phone.slice(0, 3)}` }) });
  if (!res.ok) throw new Error(`login ${who} failed: ${res.status}`);
  sessions[who] = res.headers.get('set-cookie').split(';')[0];
}
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
const today = new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------- setup
const customer = (await ok('jemish', 'GET', '/lookup/customers'))[0];
const material = (await ok('jemish', 'GET', '/lookup/materials'))[0];
const design = ((await ok('jemish', 'GET', '/designs?limit=5')).items ?? [])[0];
const machineIds = (await ok('jemish', 'GET', '/lookup/machines')).slice(0, 2).map((m) => m.id);
check(!!customer && !!material && !!design && machineIds.length > 0, 'fixtures exist');

const newOrder = async (quantity) => {
  const o = await ok('jemish', 'POST', '/orders', {
    customerId: customer.id, orderType: 'pcs_to_pcs', materialId: material.id, designId: design.id,
    quantity, unit: 'pcs', rate: 100, orderDate: today, notes: '', noteImages: [],
  });
  await ok('jemish', 'POST', '/orders/send-to-production', { orderIds: [o.id] });
  return o;
};
const jobsheetsOf = async (orderId) => (await ok('jemish', 'GET', `/orders/${orderId}/jobsheets`));

// Jobsheets -> sent -> started -> taka entry. Returns { jobsheets, takaIds }.
async function produce(orderId, pieces, perJs, takasPerJs, takaPcs) {
  await ok('jemish', 'POST', `/orders/${orderId}/jobsheets/generate`, { pieces, framesPerJobsheet: perJs, machineIds });
  const list = (await jobsheetsOf(orderId)).jobsheets;
  await ok('jemish', 'POST', `/orders/${orderId}/jobsheets/send`, { jobsheetIds: list.map((j) => j.id) });
  for (const j of list) await ok('supervisor', 'POST', `/jobsheets/${j.id}/start`, { machineId: machineIds[0] });
  const takaIds = [];
  for (const j of list) {
    await ok('taka', 'POST', `/jobsheets/${j.id}/takas`, { takas: Array.from({ length: takasPerJs }, () => ({ meters: 100.5, pcs: takaPcs, damages: [] })), note: '' });
    for (const t of (await ok('jemish', 'GET', `/jobsheets/${j.id}`)).takas) if (!takaIds.includes(t.id)) takaIds.push(t.id);
  }
  return { jobsheets: list, takaIds };
}
const party = async (kind, name) => (await ok('jemish', 'POST', `/${kind}-parties`, { name: `${name} ${Date.now()}` })).id;

// ---------------------------------------------------------------- 1. live jobsheet numbers
{
  const o = await newOrder(300);
  await ok('jemish', 'POST', `/orders/${o.id}/jobsheets/generate`, { pieces: 300, framesPerJobsheet: 10, machineIds });
  let d = await jobsheetsOf(o.id);
  check(d.coverage.totalFrames === 100 && d.coverage.targetFrames === 100 && d.coverage.jobsheetPieces === 300 && d.warnings.length === 0, 'live: 300 pcs → 100 frames, no warnings', d.coverage);
  const last = d.jobsheets[d.jobsheets.length - 1];
  await ok('jemish', 'DELETE', `/jobsheets/${last.id}`);
  d = await jobsheetsOf(o.id);
  check(d.coverage.totalFrames === 90 && d.coverage.jobsheetPieces === 270 && d.warnings.length > 0, 'live: delete drops frames + jobsheet quantity and warns', d.coverage);
  check((await ok('jemish', 'GET', `/orders/${o.id}`)).jobsheetPieces === 270, 'live: order header quantity follows');
  await ok('jemish', 'PUT', `/jobsheets/${d.jobsheets[0].id}`, { frames: 12, machineIds });
  d = await jobsheetsOf(o.id);
  check(d.coverage.totalFrames === 90, 'live: edit with auto-adjust keeps the total', d.coverage);
  await ok('jemish', 'POST', `/orders/${o.id}/jobsheets`, { frames: 10, machineIds });
  d = await jobsheetsOf(o.id);
  check(d.coverage.totalFrames === 100 && d.warnings.length === 0, 'live: single add completes the plan, no warnings', d.coverage);
  for (const j of d.jobsheets) await ok('jemish', 'DELETE', `/jobsheets/${j.id}`);
  const back = await ok('jemish', 'GET', `/orders/${o.id}`);
  check(back.status === 'ready_production' && back.jobsheetPieces === 0, 'live: deleting the last jobsheet → Jobsheet pending', back.status);
}

// ---------------------------------------------------------------- 4. supervisor Order view: quality + machines
{
  const o = await newOrder(60);
  await ok('jemish', 'POST', `/orders/${o.id}/jobsheets/generate`, { pieces: 60, framesPerJobsheet: 10, machineIds });
  const list = (await jobsheetsOf(o.id)).jobsheets;
  await ok('jemish', 'POST', `/orders/${o.id}/jobsheets/send`, { jobsheetIds: list.map((j) => j.id) });
  const card = (await ok('supervisor', 'GET', '/jobsheets/orders?limit=100')).items.find((i) => i.orderId === o.id);
  const sorted = [...machineIds].sort((a, b) => a - b);
  check(card && card.quality === material.name && Array.isArray(card.machineNos) && card.machineNos.length === machineIds.length, 'supervisor order card: quality + merged machine numbers', card);
  void sorted;
  for (const j of list) await ok('jemish', 'POST', `/jobsheets/${j.id}/pull-back`);
}

// ---------------------------------------------------------------- 12 + 9. QC read-only, refinish challans not mixed
{
  const o = await newOrder(60);
  const { takaIds } = await produce(o.id, 60, 10, 2, 15);
  const bp = await party('butta', 'Butta');
  await ok('godown', 'POST', '/butta/challans', { takaIds, partyId: bp, challanDate: today });
  await ok('godown', 'POST', '/butta/receive', { takaIds });
  const before = await ok('jemish', 'GET', `/takas/${takaIds[0]}`);
  await ok('qc', 'POST', `/butta-qc/${takaIds[0]}`, { meters: 999, pcs: 999, damageDecisions: [], newDamages: [] });
  const after = await ok('jemish', 'GET', `/takas/${takaIds[0]}`);
  check(after.pcs === before.pcs && after.meters === before.meters, 'QC ignores meters / pcs sent by an old client', [before.pcs, after.pcs]);
  for (const id of takaIds.slice(1)) await ok('qc', 'POST', `/butta-qc/${id}`, { damageDecisions: [], newDamages: [] });
  const mp = await party('mill', 'Mill');
  const [a, b, c] = takaIds;
  const m1 = await ok('godown', 'POST', '/mill/challans', { takaIds: [a, b], partyId: mp, challanDate: today });
  await ok('godown', 'POST', `/mill/challans/${m1.challanId}/received-count`, { count: 2 });
  await ok('qc', 'POST', `/mill-qc/${a}`, { damageDecisions: [], newDamages: [], result: 'refinish', refinishNote: 'redo' });
  await ok('qc', 'POST', `/mill-qc/${b}`, { damageDecisions: [], newDamages: [], result: 'final' });
  const mix = await call('godown', 'POST', '/mill/challans', { takaIds: [a, c], partyId: mp, challanDate: today });
  check(mix.status === 409, 'refinish + normal takas on one challan → 409', mix.body);
  const rf = await ok('godown', 'POST', '/mill/challans', { takaIds: [a], partyId: mp, challanDate: today });
  check((await ok('godown', 'GET', `/mill/challans/${rf.challanId}`)).isRefinish === true, 'refinish challan is flagged');
  check((await ok('godown', 'GET', `/mill/challans/${rf.challanId}/print`)).isRefinish === true, 'its print carries FOR REFINISH');
  check((await ok('godown', 'GET', `/mill/challans/${m1.challanId}`)).isRefinish === false, 'a normal challan is not flagged');
}

// ---------------------------------------------------------------- 5. Hold order
{
  const o = await newOrder(60);
  await ok('jemish', 'POST', `/orders/${o.id}/jobsheets/generate`, { pieces: 60, framesPerJobsheet: 10, machineIds });
  const list = (await jobsheetsOf(o.id)).jobsheets;
  await ok('jemish', 'POST', `/orders/${o.id}/jobsheets/send`, { jobsheetIds: list.map((j) => j.id) });
  await ok('supervisor', 'POST', `/jobsheets/${list[0].id}/start`, { machineId: machineIds[0] });

  check((await call('gaurang', 'POST', `/orders/${o.id}/hold`, { ongoing: [{ jobsheetId: list[0].id, completedFrames: 4 }] })).status === 403, 'Gaurang cannot hold');
  check((await call('jemish', 'POST', `/orders/${o.id}/hold`, { ongoing: [] })).status === 400, 'hold needs the frames completed of every ongoing jobsheet');
  const held = await ok('jemish', 'POST', `/orders/${o.id}/hold`, { note: 'test', ongoing: [{ jobsheetId: list[0].id, completedFrames: 4 }] });
  check(held.completed === 1 && held.created.length === 1 && held.created[0].frames === 6, 'hold completes the ongoing jobsheet and creates the remaining Pending one', held);
  const detail = await ok('jemish', 'GET', `/orders/${o.id}`);
  check(detail.isOnHold && detail.holdEvents.length === 1, 'owner sees the hold + its History entry');

  check(!(await ok('supervisor', 'GET', '/jobsheets?tab=all&limit=100')).items.some((i) => i.orderNo === o.orderNo), 'supervisor: jobsheet list hides the held order');
  check(!(await ok('supervisor', 'GET', '/jobsheets/orders?limit=100')).items.some((i) => i.orderId === o.id), 'supervisor: Order view hides it');
  check((await call('supervisor', 'GET', `/orders/${o.id}`)).status === 404, 'supervisor: Orders module → 404');
  check(!(await ok('supervisor', 'GET', '/machine-view')).machines.some((m) => m.ongoing.some((j) => j.orderNo === o.orderNo)), 'machine view hides its running rows');
  const scan = await call('taka', 'GET', `/jobsheets/by-no/${list[0].jobsheetNo}`);
  check(scan.status === 409 && /होल्ड/.test(scan.body?.error?.message ?? ''), 'taka entry scan → bilingual hold message', scan.body);
  check(!(await ok('taka', 'GET', '/taka/jobsheets?tab=pending&limit=100')).items.some((i) => i.orderNo === o.orderNo), 'taka entry list hides it');
  check((await call('taka', 'POST', `/jobsheets/${list[0].id}/takas`, { takas: [{ pcs: 3, meters: 1, damages: [] }], note: '' })).status === 409, 'taka entry write → 409');
  const del = await call('jemish', 'DELETE', `/jobsheets/${held.created[0].id}`);
  check(del.status === 409 && /on hold/.test(del.body?.error?.message ?? ''), 'even Jenish cannot change a held order', del.body);
  check((await call('gaurang', 'POST', `/orders/${o.id}/jobsheets/send`, { jobsheetIds: [held.created[0].id] })).status === 409, 'Gaurang writes → 409');
  check((await ok('gaurang', 'GET', '/orders?limit=100')).items.find((i) => i.id === o.id)?.isOnHold === true, 'Gaurang still sees it, flagged');
  check((await call('gaurang', 'POST', `/orders/${o.id}/release`)).status === 403, 'Gaurang cannot release');
  await ok('jemish', 'POST', `/orders/${o.id}/release`);
  check((await ok('supervisor', 'GET', '/jobsheets?tab=all&limit=100')).items.some((i) => i.orderNo === o.orderNo), 'release: visible again');
  await ok('jemish', 'POST', `/orders/${o.id}/jobsheets/send`, { jobsheetIds: [held.created[0].id] });

  // takas at butta: receiving still works, nothing else
  const o2 = await newOrder(40);
  const { takaIds } = await produce(o2.id, 40, 7, 2, 7);
  const bp = await party('butta', 'HoldButta');
  const sent = takaIds.slice(0, 2);
  const ch = await ok('godown', 'POST', '/butta/challans', { takaIds: sent, partyId: bp, challanDate: today });
  await ok('jemish', 'POST', `/orders/${o2.id}/hold`, {});
  check(!(await ok('godown', 'GET', '/butta/pending-orders?limit=100')).items.some((i) => i.orderId === o2.id), 'butta Pending hides the held order');
  check((await call('godown', 'POST', '/butta/challans', { takaIds: takaIds.slice(2), partyId: bp, challanDate: today })).status === 409, 'a new butta challan is blocked');
  const rec = await call('godown', 'POST', '/butta/receive', { takaIds: sent });
  check(rec.status === 200 && rec.body.results.every((r) => r.code === 'received'), 'RECEIVE is still allowed on a held order', rec.body);
  const qc = await call('qc', 'POST', `/butta-qc/${sent[0]}`, { damageDecisions: [], newDamages: [] });
  check(qc.status === 409 && /होल्ड/.test(qc.body?.error?.message ?? ''), 'QC is blocked with the bilingual message', qc.body);
  check((await call('jemish', 'POST', `/butta/challans/${ch.challanId}/cancel`)).status === 409, 'cancelling a challan of a held order is blocked');
  check(!(await ok('dhruvil', 'GET', '/godown/orders?limit=100')).items.some((i) => i.orderId === o2.id), 'Dhruvil godown list hides it');
  await ok('jemish', 'POST', `/orders/${o2.id}/release`);
  check((await call('qc', 'POST', `/butta-qc/${sent[0]}`, { damageDecisions: [], newDamages: [] })).status === 200, 'after release QC works again');
}

// ---------------------------------------------------------------- 6. godown supervisor: Orders (read-only, butta onwards)
{
  const inProduction = await newOrder(60); // no takas yet → not in his module
  await ok('jemish', 'POST', `/orders/${inProduction.id}/jobsheets/generate`, { pieces: 60, framesPerJobsheet: 10, machineIds });
  const withTakas = await newOrder(60);
  const { takaIds } = await produce(withTakas.id, 60, 10, 2, 15);
  const bp = await party('butta', 'GodownButta');
  await ok('godown', 'POST', '/butta/challans', { takaIds: takaIds.slice(0, 2), partyId: bp, challanDate: today });

  const list = await ok('godown', 'GET', '/orders?limit=100');
  check(list.items.some((i) => i.id === withTakas.id), 'godown Orders: an order with takas is listed');
  check(!list.items.some((i) => i.id === inProduction.id), 'godown Orders: an order still only in production is not');
  check(list.items.every((i) => i.customerName === '' && i.brokerName === null), 'godown Orders: no client / broker names in the list');
  const detail = await ok('godown', 'GET', `/orders/${withTakas.id}`);
  check(detail.customer.name === '' && detail.customer.phone === null && !('rate' in detail), 'godown Orders: no client, phone or rate on the order');
  check((await call('godown', 'GET', `/orders/${inProduction.id}`)).status === 404, 'godown Orders: an order without takas → 404');
  const dash = await ok('godown', 'GET', `/orders/${withTakas.id}/dashboard`);
  check(!dash.mainStages.some((s) => s.key === 'production') && dash.mainStages.map((s) => s.key).join() === 'butta,mill,ready', 'godown dashboard: Butta cutting, Mill and Ready only', dash.mainStages.map((s) => s.key));
  check(dash.alerts.length === 0 && dash.production.jobsheets === 0, 'godown dashboard: no jobsheet KPIs or alerts');
  check((await call('godown', 'GET', `/orders/${withTakas.id}/dashboard/items?sub=on_loom`)).status === 404, 'godown dashboard: no jobsheet lists');
  check((await call('godown', 'GET', `/orders/${withTakas.id}/dashboard/items?sub=at_butta`)).status === 200, 'godown dashboard: butta takas open');
  for (const tab of ['takas', 'damages', 'challans', 'milestones']) {
    check((await call('godown', 'GET', `/orders/${withTakas.id}/${tab}`)).status === 200, `godown Orders: ${tab} tab data`);
  }
  check((await call('godown', 'GET', `/orders/${withTakas.id}/jobsheets`)).status === 403, 'godown Orders: no Jobsheets tab data');
  check((await call('godown', 'PUT', `/orders/${withTakas.id}`, {})).status === 403, 'godown Orders: read only (edit → 403)');
  check((await call('godown', 'POST', `/orders/${withTakas.id}/takas/send-back`, { takaIds: [takaIds[2]], target: 'butta' })).status === 403, 'godown Orders: no send-back');
  check((await call('godown', 'GET', `/jobsheets/${(await jobsheetsOf(withTakas.id)).jobsheets[0].id}`)).status === 403, 'godown: jobsheet details stay closed');
  await ok('jemish', 'POST', `/orders/${withTakas.id}/hold`, {});
  check(!(await ok('godown', 'GET', '/orders?limit=100')).items.some((i) => i.id === withTakas.id), 'godown Orders: a held order is hidden');
  await ok('jemish', 'POST', `/orders/${withTakas.id}/release`);
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
