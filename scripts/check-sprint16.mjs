/**
 * Sprint 16 API flow check against a running API on a LOCAL file database (never run against Turso):
 *
 *   TURSO_DATABASE_URL=file:C:/path/test.db TURSO_AUTH_TOKEN=x node scripts/check-sprint16.mjs [baseUrl]
 *
 * (migrate + seed the file first; start the API with the same env.) Creates its own orders / weavers, so it can run many
 * times. One order of each kind end to end: P+B+M, P+M, P+B, P only, outside + B + M, outside + M, outside + B (no
 * mill), FG lump, FG pcs, in-house with a partial PO, close mid-way, hold an outside order — plus the steps guards,
 * weaver-number lookups, the printed numbers and the role scopes. The "existing orders unchanged" proof is separate:
 * scripts/check-sprint16-snapshot.mjs + server/src/db/check-sprint16-existing.ts.
 */
const base = process.argv[2] ?? 'http://localhost:4100';
if (!process.env.TURSO_DATABASE_URL?.startsWith('file:')) {
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
  const res = await fetch(`${base}/api${path}`, { method, headers: { Cookie: sessions[who], 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const ok = async (who, method, path, body) => {
  const r = await call(who, method, path, body);
  if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
const today = new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------- fixtures
const customer = (await ok('jemish', 'GET', '/lookup/customers'))[0];
const material = (await ok('jemish', 'GET', '/lookup/materials'))[0];
const design = ((await ok('jemish', 'GET', '/designs?limit=5')).items ?? [])[0];
const machineIds = (await ok('jemish', 'GET', '/lookup/machines')).slice(0, 2).map((m) => m.id);
const letters = 'ABCDEHJKLMNPQRTUVWXYZ';
const code = () => Array.from({ length: 3 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
const weaver = await ok('jemish', 'POST', '/weavers', { name: `Check Weaver ${Date.now()}`, shortCode: code() });
check(/^[A-Z]{3}$/.test(weaver.shortCode), 'weaver created with a short code');
check((await call('jemish', 'POST', '/weavers', { name: `X ${Date.now()}`, shortCode: 'FG' })).status === 400, 'FG is a reserved weaver code');
check((await call('jemish', 'POST', '/weavers', { name: `Y ${Date.now()}`, shortCode: weaver.shortCode })).status === 409, 'weaver codes are unique');
check((await call('godown', 'GET', '/weavers')).status === 403, 'Weaver master is for Jenish / Gaurang only');

const steps = (p, b, m) => ({ hasProduction: p, hasButta: b, hasMill: m });
const newOrder = async (s, { quantity = 60, orderType = 'pcs_to_pcs', send = true } = {}) => {
  const o = await ok('jemish', 'POST', '/orders', {
    customerId: customer.id, orderType, materialId: material.id, designId: design.id, quantity, unit: 'pcs', rate: 100, orderDate: today, notes: '', noteImages: [], ...s,
  });
  if (send) await ok('jemish', 'POST', '/orders/send-to-production', { orderIds: [o.id] });
  return o;
};
const order = (id) => ok('jemish', 'GET', `/orders/${id}`);
const takasOf = async (id) => {
  const t = await ok('jemish', 'GET', `/orders/${id}/takas`);
  return [...t.groups.flatMap((g) => g.takas), ...t.receipts.flatMap((r) => r.takas)];
};
const party = async (kind) => (await ok('jemish', 'POST', `/${kind}-parties`, { name: `${kind} ${Date.now()} ${Math.random()}` })).id;
async function produce(orderId, pieces = 30, takas = 2, pcs = 15) {
  await ok('jemish', 'POST', `/orders/${orderId}/jobsheets/generate`, { pieces, framesPerJobsheet: 100, machineIds });
  const [js] = (await ok('jemish', 'GET', `/orders/${orderId}/jobsheets`)).jobsheets;
  await ok('jemish', 'POST', `/orders/${orderId}/jobsheets/send`, { jobsheetIds: [js.id] });
  await ok('supervisor', 'POST', `/jobsheets/${js.id}/start`, { machineId: machineIds[0] });
  await ok('taka', 'POST', `/jobsheets/${js.id}/takas`, { takas: Array.from({ length: takas }, () => ({ meters: 50, pcs, damages: [] })), note: '' });
  return js;
}
async function butta(takaIds) {
  await ok('godown', 'POST', '/butta/challans', { takaIds, partyId: await party('butta'), challanDate: today });
  await ok('godown', 'POST', '/butta/receive', { takaIds });
  for (const id of takaIds) await ok('qc', 'POST', `/butta-qc/${id}`, { damageDecisions: [], newDamages: [] });
}
async function mill(takaIds) {
  const ch = await ok('godown', 'POST', '/mill/challans', { takaIds, partyId: await party('mill'), challanDate: today });
  await ok('godown', 'POST', `/mill/challans/${ch.challanId}/received-count`, { count: takaIds.length });
  for (const id of takaIds) {
    const t = await ok('jemish', 'GET', `/takas/${id}`);
    const open = t.damages.filter((x) => x.status === 'open').map((x) => ({ takaDamageId: x.id, resolvedPcs: 0, pcs: null }));
    await ok('qc', 'POST', `/mill-qc/${id}`, { damageDecisions: open, newDamages: [], result: 'final' });
  }
  return ch;
}
const stages = async (id) => (await takasOf(id)).map((t) => t.stage).sort().join();
const mainKeys = async (id) => (await ok('jemish', 'GET', `/orders/${id}/dashboard`)).mainStages.map((m) => m.key).join();
let weaverNo = 1000 + Math.floor(Math.random() * 8000);
const wno = () => String((weaverNo += 1));

// ---------------------------------------------------------------- in-house kinds
{
  const all = await newOrder(steps(true, true, true));
  await produce(all.id);
  check((await stages(all.id)) === 'entered,entered', 'P+B+M: taka entry → waiting for butta');
  check((await mainKeys(all.id)) === 'production,butta,mill,ready', 'P+B+M: all four stages');

  const pm = await newOrder(steps(true, false, true));
  await produce(pm.id);
  check((await stages(pm.id)) === 'waiting_mill,waiting_mill', 'P+M: taka entry → waiting for mill', await stages(pm.id));
  check((await mainKeys(pm.id)) === 'production,mill,ready', 'P+M: no Butta stage on the dashboard');
  check(!(await ok('godown', 'GET', '/butta/pending-orders?limit=100')).items.some((i) => i.orderId === pm.id), 'P+M: not in Butta Pending');
  check((await ok('godown', 'GET', '/mill/pending-orders?limit=100')).items.some((i) => i.orderId === pm.id), 'P+M: in Mill Pending');
  await mill((await takasOf(pm.id)).map((t) => t.id));
  check((await order(pm.id)).status === 'mill_qc_done', 'P+M: Mill QC done');

  const pb = await newOrder(steps(true, true, false));
  await produce(pb.id);
  await butta((await takasOf(pb.id)).map((t) => t.id));
  check((await stages(pb.id)) === 'final,final', 'P+B: Butta QC → final (no mill)', await stages(pb.id));
  check((await order(pb.id)).status === 'in_godown', 'P+B: status In godown');
  check(!(await ok('godown', 'GET', '/mill/pending-orders?limit=100')).items.some((i) => i.orderId === pb.id), 'P+B: never in Mill Pending');

  const p = await newOrder(steps(true, false, false));
  await produce(p.id);
  check((await stages(p.id)) === 'final,final', 'P only: taka entry → final');
  check((await mainKeys(p.id)) === 'production,ready', 'P only: Production + Ready');
  check((await ok('dhruvil', 'GET', '/godown/orders?limit=100')).items.some((i) => i.orderId === p.id), 'P only: in Dhruvil\'s Orders');
  // Rework stays allowed: Gaurang sends a final taka back to butta cutting; after QC it is final again.
  const [rt] = await takasOf(p.id);
  await ok('gaurang', 'POST', `/orders/${p.id}/takas/send-back`, { takaIds: [rt.id], target: 'butta' });
  check((await mainKeys(p.id)) === 'production,butta,ready', 'rework: the Butta stage shows while a taka is there');
  await butta([rt.id]);
  check((await stages(p.id)) === 'final,final', 'rework: after Butta QC back to final');

  // Steps guards.
  check((await call('jemish', 'PUT', `/orders/${p.id}/steps`, steps(false, false, false))).status === 400, 'untick Production with jobsheets → blocked');
  check((await call('jemish', 'PUT', `/orders/${pb.id}/steps`, steps(true, false, false))).status === 400, 'untick Butta after butta cutting → blocked');
  const re = await newOrder(steps(true, true, true));
  await produce(re.id);
  const after = await ok('gaurang', 'PUT', `/orders/${re.id}/steps`, steps(true, false, true));
  check(after.hasButta === false && after.orderEvents.some((e) => e.note === 'Steps changed: Butta removed'), 'untick Butta: saved + History entry');
  check((await stages(re.id)) === 'waiting_mill,waiting_mill', 'untick Butta: waiting takas move on to the mill', await stages(re.id));
  check(after.stepLocks.production !== null, 'step locks: Production locked (jobsheets exist)');
  check((await call('supervisor', 'PUT', `/orders/${re.id}/steps`, steps(true, true, true))).status === 403, 'supervisor cannot change steps');
}

// ---------------------------------------------------------------- outside production
const receipt = (rows) => ({ challanNo: `CH${Date.now()}`, date: today, notes: '', rows });
{
  const o = await newOrder(steps(false, true, true), { quantity: 40 });
  check((await order(o.id)).status === 'outside_production', 'outside: status At outside weaver after sending');
  check((await call('supervisor', 'GET', `/orders/${o.id}`)).status === 404, 'supervisor never sees an order without Production');
  check((await call('jemish', 'POST', `/orders/${o.id}/jobsheets/generate`, { pieces: 30, framesPerJobsheet: 10, machineIds })).status === 409, 'outside: no jobsheets');
  const po = await ok('jemish', 'POST', `/orders/${o.id}/outside-pos`, { weaverId: weaver.id, materialId: material.id, quantity: 40, unit: 'pcs', orderType: 'pcs_to_pcs', rate: 50, poDate: today });
  check(/^PO-\d+$/.test(po.label) && po.status === 'open', 'PO created (PO-n, Open)', po);
  const print = await ok('jemish', 'GET', `/outside-pos/${po.id}/print`);
  check(print.weaver.name === weaver.name && print.rate === 50, 'PO print data');
  check((await ok('godown', 'GET', `/outside-pos/${po.id}/print`)).rate === null, 'godown supervisor: no rate on the PO');
  const goods = await ok('godown', 'GET', '/receive-goods');
  check(goods.pos.some((x) => x.id === po.id && x.rate === null), 'Receive goods lists the open PO (no rate)');

  const w1 = wno();
  const w2 = wno();
  const res = await ok('godown', 'POST', `/outside-pos/${po.id}/receipts`, receipt([
    { weaverTakaNo: w1, pcs: 10, meters: 20, damages: [{ type: 'weaver', otherName: 'Hole', pcs: 1, images: [] }] },
    { weaverTakaNo: w2, ourTakaNo: `9${w2}`, pcs: 10 },
  ]));
  const nos = res.takas.map((t) => t.takaNo).sort();
  check(nos.includes(`${weaver.shortCode}${w1}`) && nos.includes(`9${w2}`), 'numbers: code + weaver number, or ours', nos);
  check((await stages(o.id)) === 'entered,entered', 'outside + Butta: received → waiting for butta');
  const dup = await call('godown', 'POST', `/outside-pos/${po.id}/receipts`, receipt([{ weaverTakaNo: w1, pcs: 5 }]));
  check(dup.status === 400 && dup.body.error.field === 'rows.0.weaverTakaNo', 'the same weaver number twice → blocked', dup.body);
  const clash = await call('godown', 'POST', `/outside-pos/${po.id}/receipts`, receipt([{ weaverTakaNo: wno(), ourTakaNo: `9${w2}`, pcs: 5 }]));
  check(clash.status === 400 && clash.body.error.field === 'rows.0.ourTakaNo', 'a used system number → blocked on "our number"', clash.body);
  const poAfter = await ok('jemish', 'GET', `/outside-pos/${po.id}`);
  check(poAfter.status === 'partly_received' && poAfter.receivedQty === 20 && poAfter.pendingQty === 20, 'PO: Partly received 20 / 40', poAfter);
  check((await call('jemish', 'PUT', `/outside-pos/${po.id}`, { weaverId: weaver.id, materialId: material.id, quantity: 50, unit: 'pcs', orderType: 'pcs_to_pcs', poDate: today })).status === 409, 'PO can\'t be edited once goods came');
  check((await order(o.id)).status === 'taka_entry_done', 'outside: stage rules once takas exist');
  const d = await ok('jemish', 'GET', `/orders/${o.id}/dashboard`);
  check(d.mainStages.map((m) => m.key).join() === 'outside,butta,mill,ready' && d.mainStages[0].count === 1, 'outside dashboard: Outside card first', d.mainStages.map((m) => m.key));
  check(d.subStages.some((s) => s.key === 'at_weaver' && s.count === 1) && !d.subStages.some((s) => s.unit === 'jobsheets'), 'outside dashboard: At outside weaver, no jobsheet sub-stages');
  check(d.damages.some((x) => x.type === 'weaver' && x.count === 1), 'Weaver damage on the dashboard strip');
  const tabs = await ok('jemish', 'GET', `/orders/${o.id}/takas`);
  check(tabs.groups.length === 0 && tabs.receipts.length === 1 && tabs.receipts[0].poNo === po.poNo, 'Takas tab: grouped by receipt');
  // Lookup by the weaver number (the physical taka may only carry it).
  const look = await ok('qc', 'GET', `/takas/lookup?no=${w1}`);
  check(look.length === 1 && look[0].takaNo === `${weaver.shortCode}${w1}`, 'lookup by weaver number');
  const ids = (await takasOf(o.id)).map((t) => t.id);
  await ok('godown', 'POST', '/butta/challans', { takaIds: ids, partyId: await party('butta'), challanDate: today });
  const recv = await ok('godown', 'POST', '/butta/receive', { takaNo: w1 });
  check(recv.results[0].code === 'received', 'Butta receive by the weaver number', recv.results);
  await ok('godown', 'POST', '/butta/receive', { takaIds: ids });
  const qcTaka = await ok('qc', 'GET', `/takas/by-no/${w1}`);
  check(qcTaka.source === 'outside_po' && qcTaka.weaverTakaNo === w1, 'QC opens it by the weaver number');
  for (const id of ids) {
    const t = await ok('jemish', 'GET', `/takas/${id}`);
    await ok('qc', 'POST', `/butta-qc/${id}`, { damageDecisions: t.damages.filter((x) => x.status === 'open').map((x) => ({ takaDamageId: x.id, resolvedPcs: 0, pcs: null })), newDamages: [] });
  }
  check((await stages(o.id)) === 'waiting_mill,waiting_mill', 'outside + B + M: Butta QC → waiting for mill');
  const ch = await mill(ids);
  const mp = await ok('godown', 'GET', `/mill/challans/${ch.challanId}/print`);
  check(mp.takas.some((t) => t.takaNo === w1) && mp.takas.some((t) => t.takaNo === `9${w2}`), 'mill challan prints the weaver\'s own number / ours', mp.takas);
  check((await ok('dhruvil', 'GET', '/godown/orders?limit=100')).items.some((i) => i.orderId === o.id), 'outside order flows into Dhruvil\'s Orders');
  // Split keeps the weaver number + letter.
  const big = (await takasOf(o.id)).find((t) => t.takaNo === `${weaver.shortCode}${w1}`);
  const split = await ok('dhruvil', 'POST', `/godown/takas/${big.id}/split`, { parts: [{ takaNo: big.takaNo, pcs: 5 }, { takaNo: `${big.takaNo}A`, pcs: 5 }] });
  const part = await ok('jemish', 'GET', `/takas/${split.parts[1].id}`);
  check(part.takaNo === `${weaver.shortCode}${w1}A` && part.weaverTakaNo === `${w1}A`, 'split part S1101A keeps weaver number 1101A', part);
  const docs = await ok('jemish', 'GET', `/orders/${o.id}/challans`);
  check(docs.pos.length === 1 && docs.receipts.length === 1, 'Docs tab: the PO and the receipt');
  const ms = await ok('jemish', 'GET', `/orders/${o.id}/milestones`);
  check(ms.poPlaced.length === 1 && ms.receivedOutside.length === 1, 'milestones: PO placed + received from weaver');
  check((await ok('jemish', 'GET', `/orders?kind=outside_production&limit=100`)).items.some((i) => i.id === o.id), 'orders list: kind filter');
  check(!(await ok('jemish', 'GET', `/orders?kind=fg_purchase&limit=100`)).items.some((i) => i.id === o.id), 'orders list: kind filter excludes other kinds');
  check((await ok('jemish', 'GET', `/orders?search=${w2}&limit=100`)).items.some((i) => i.id === o.id), 'orders search by weaver taka number');
  check((await ok('jemish', 'GET', `/orders?search=${po.label}&limit=100`)).items.some((i) => i.id === o.id), 'orders search by PO number');

  const om = await newOrder(steps(false, false, true), { quantity: 20 });
  const pom = await ok('gaurang', 'POST', `/orders/${om.id}/outside-pos`, { weaverId: weaver.id, materialId: material.id, quantity: 100, unit: 'meters', orderType: 'pcs_to_pcs', poDate: today });
  await ok('dhruvil', 'POST', `/outside-pos/${pom.id}/receipts`, receipt([{ weaverTakaNo: wno(), pcs: 20, meters: 100 }]));
  check((await stages(om.id)) === 'waiting_mill', 'outside + M: received → waiting for mill');
  check((await ok('jemish', 'GET', `/outside-pos/${pom.id}`)).status === 'received', 'a meters PO sums the meters (100 / 100 → Received)');

  const ob = await newOrder(steps(false, true, false), { quantity: 20 });
  const pob = await ok('jemish', 'POST', `/orders/${ob.id}/outside-pos`, { weaverId: weaver.id, materialId: material.id, quantity: 20, unit: 'pcs', orderType: 'pcs_to_pcs', poDate: today });
  await ok('godown', 'POST', `/outside-pos/${pob.id}/receipts`, receipt([{ weaverTakaNo: wno(), pcs: 20 }]));
  await butta((await takasOf(ob.id)).map((t) => t.id));
  check((await stages(ob.id)) === 'final' && (await order(ob.id)).status === 'in_godown', 'outside + B (no mill): Butta QC → final, In godown');
  const cancelPo = await ok('jemish', 'POST', `/orders/${ob.id}/outside-pos`, { weaverId: weaver.id, materialId: material.id, quantity: 5, unit: 'pcs', orderType: 'pcs_to_pcs', poDate: today });
  check((await ok('jemish', 'POST', `/outside-pos/${cancelPo.id}/cancel`)).status === 'cancelled', 'a PO with nothing received can be cancelled');
  check((await call('jemish', 'DELETE', `/weavers/${weaver.id}`)).status === 409, 'a weaver on a PO can\'t be deleted');
}

// ---------------------------------------------------------------- FG purchase
{
  const fg = await newOrder(steps(false, false, false), { quantity: 30, orderType: 'lump' });
  check((await order(fg.id)).status === 'awaiting_goods', 'FG: Awaiting goods');
  check((await ok('dhruvil', 'GET', '/receive-goods')).fgOrders.some((x) => x.orderId === fg.id), 'Receive goods lists the FG order');
  check((await call('jemish', 'POST', `/orders/${fg.id}/outside-pos`, { weaverId: weaver.id, materialId: material.id, quantity: 5, unit: 'pcs', orderType: 'lump', poDate: today })).status === 409, 'FG: no POs');
  const sup = wno();
  await ok('dhruvil', 'POST', `/orders/${fg.id}/fg-receipts`, { supplierName: 'Shree Traders', challanNo: 'F1', date: today, rows: [{ weaverTakaNo: sup, pcs: 15, damages: [] }, { weaverTakaNo: wno(), pcs: 15, damages: [] }] });
  const t = await takasOf(fg.id);
  check(t.every((x) => x.stage === 'final' && x.source === 'fg_purchase') && t.some((x) => x.takaNo === `FG${sup}`), 'FG lump: FG + supplier number, final', t.map((x) => x.takaNo));
  const again = await call('dhruvil', 'POST', `/orders/${fg.id}/fg-receipts`, { supplierName: 'Shree Traders', challanNo: 'F2', date: today, rows: [{ weaverTakaNo: sup, pcs: 5, damages: [] }] });
  check(again.status === 400 && again.body.error.field === 'rows.0.ourTakaNo', 'FG number already used → asks for our number', again.body);
  check((await order(fg.id)).status === 'in_godown', 'FG: In godown once received');
  check((await mainKeys(fg.id)) === 'purchase,ready', 'FG dashboard: Purchase + Ready');
  for (const x of t) await ok('dhruvil', 'PATCH', `/godown/takas/${x.id}`, { checked: true });
  await ok('dhruvil', 'POST', `/godown/orders/${fg.id}/ready-dispatch`, { takaIds: t.map((x) => x.id) });
  const dc = await ok('dhruvil', 'POST', `/godown/orders/${fg.id}/dispatch`, { challanDate: today });
  const dcd = await ok('dhruvil', 'GET', `/dispatch/challans/${dc.challanId}`);
  check(dcd.takas.some((x) => x.printNo === sup && x.takaNo === `FG${sup}`), 'delivery challan prints the supplier\'s own number', dcd.takas);
  check((await order(fg.id)).status === 'dispatched', 'FG: dispatched');

  const fgp = await newOrder(steps(false, false, false), { quantity: 50 });
  const lot = await ok('godown', 'POST', `/orders/${fgp.id}/fg-receipts`, { supplierName: 'Ram Traders', challanNo: 'R9', date: today, pcs: 50, damagedPcs: 2, damage: { type: 'weaver', otherName: 'Stain', pcs: 2, images: [] } });
  const lt = await ok('jemish', 'GET', `/takas/${lot.takas[0].id}`);
  check(lt.pcs === 50 && lt.stage === 'final' && lt.damages[0]?.foundAt === 'weaver', 'FG pcs: one received lot (50 pcs, weaver damage)', lt);
  check((await ok('godown', 'GET', '/receive-goods')).fgOrders.every((x) => x.customerName === null), 'godown supervisor: no client on Receive goods');
}

// ---------------------------------------------------------------- in-house with a partial PO
{
  const o = await newOrder(steps(true, true, true), { quantity: 300 });
  await ok('jemish', 'POST', `/orders/${o.id}/outside-pos`, { weaverId: weaver.id, materialId: material.id, quantity: 120, unit: 'pcs', orderType: 'pcs_to_pcs', poDate: today });
  await ok('jemish', 'POST', `/orders/${o.id}/jobsheets/generate`, { pieces: 180, framesPerJobsheet: 30, machineIds });
  const js = await ok('jemish', 'GET', `/orders/${o.id}/jobsheets`);
  check(js.coverage.targetFrames === 60 && js.warnings.length === 0 && js.outsidePos[0]?.pcs === 120, 'partial PO: 300 − 120 pcs → 60 frames needed, no warnings', js.coverage);
  const d = await ok('jemish', 'GET', `/orders/${o.id}/dashboard`);
  check(d.subStages.some((s) => s.key === 'outside_po' && s.count === 1), 'partial PO: "Given outside" sub-stage under Production');
  check(d.progress.targetPcs === 300, 'partial PO: target = jobsheets + PO pcs', d.progress);
}

// ---------------------------------------------------------------- close mid-way
{
  const o = await newOrder(steps(true, true, true), { quantity: 90 });
  await ok('jemish', 'POST', `/orders/${o.id}/jobsheets/generate`, { pieces: 90, framesPerJobsheet: 10, machineIds });
  const list = (await ok('jemish', 'GET', `/orders/${o.id}/jobsheets`)).jobsheets;
  await ok('jemish', 'POST', `/orders/${o.id}/jobsheets/send`, { jobsheetIds: list.map((j) => j.id) });
  await ok('supervisor', 'POST', `/jobsheets/${list[0].id}/start`, { machineId: machineIds[0] });
  await ok('supervisor', 'POST', `/jobsheets/${list[1].id}/start`, { machineId: machineIds[0] });
  await ok('taka', 'POST', `/jobsheets/${list[0].id}/takas`, { takas: [{ pcs: 15, damages: [] }, { pcs: 15, damages: [] }], note: '' });
  const [a, b] = (await takasOf(o.id)).map((t) => t.id);
  await ok('godown', 'POST', '/butta/challans', { takaIds: [a], partyId: await party('butta'), challanDate: today });
  const prev = await ok('jemish', 'GET', `/orders/${o.id}/close-preview`);
  check(prev.ongoing.length === 1 && prev.pendingJobsheets === 1 && prev.freeTakas === 1 && prev.outTakas === 1, 'close preview', prev);
  check((await call('jemish', 'POST', `/orders/${o.id}/close`, {})).status === 400, 'close needs the frames of the jobsheet on the loom');
  const closed = await ok('gaurang', 'POST', `/orders/${o.id}/close`, { note: 'client cancelled', ongoing: [{ jobsheetId: list[1].id, completedFrames: 3 }] });
  check(closed.completed === 1 && closed.cancelled === 1 && closed.freeTakas === 1 && closed.outTakas === 1, 'close: completed / cancelled / free stock / still out', closed);
  const det = await order(o.id);
  check(det.status === 'closed' && det.isClosed && det.orderEvents.some((e) => e.event === 'order_closed'), 'closed: status Closed + History');
  check((await ok('jemish', 'GET', `/orders/${o.id}/jobsheets`)).jobsheets.length === 2, 'the cancelled jobsheet is gone (soft deleted), no remaining one created');
  check((await ok('jemish', 'GET', `/takas/${b}`)).isFreeStock === true, 'taka with us → free stock');
  const w = await call('jemish', 'PUT', `/orders/${o.id}`, {});
  check(w.status === 409 && /closed/.test(w.body.error.message), 'writes on a closed order → 409 "is closed"', w.body);
  const r = await ok('godown', 'POST', '/butta/receive', { takaIds: [a] });
  check(r.results[0].code === 'received' && (await ok('jemish', 'GET', `/takas/${a}`)).isFreeStock === true, 'receiving still works — the taka becomes free stock');
  check((await call('qc', 'POST', `/butta-qc/${a}`, { damageDecisions: [], newDamages: [] })).status === 200, 'its QC still works');
  check(!(await ok('supervisor', 'GET', '/jobsheets?tab=all&limit=100')).items.some((i) => i.orderNo === o.orderNo), 'closed: hidden from the supervisor');
  check((await call('dhruvil', 'GET', `/godown/orders/${o.id}`)).status === 404, 'closed: hidden from Dhruvil\'s Orders');
  check((await ok('jemish', 'GET', '/orders?status=closed&limit=100')).items.some((i) => i.id === o.id), 'closed: still listed for Jenish (status Closed)');
}

// ---------------------------------------------------------------- hold an outside order
{
  const o = await newOrder(steps(false, true, true), { quantity: 20 });
  const po = await ok('jemish', 'POST', `/orders/${o.id}/outside-pos`, { weaverId: weaver.id, materialId: material.id, quantity: 20, unit: 'pcs', orderType: 'pcs_to_pcs', poDate: today });
  await ok('jemish', 'POST', `/orders/${o.id}/hold`, {});
  check((await call('jemish', 'POST', `/orders/${o.id}/outside-pos`, { weaverId: weaver.id, materialId: material.id, quantity: 5, unit: 'pcs', orderType: 'pcs_to_pcs', poDate: today })).status === 409, 'hold: a new PO is blocked');
  check((await call('jemish', 'POST', `/outside-pos/${po.id}/close`)).status === 409, 'hold: closing a PO is blocked');
  check(!(await ok('godown', 'GET', '/receive-goods')).pos.some((x) => x.id === po.id), 'hold: hidden from Receive goods');
  await ok('jemish', 'POST', `/orders/${o.id}/release`);
  check((await ok('godown', 'GET', '/receive-goods')).pos.some((x) => x.id === po.id), 'release: back on Receive goods');
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll Sprint 16 checks passed');
process.exit(failed ? 1 : 0);
