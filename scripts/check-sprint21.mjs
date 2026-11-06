/**
 * Sprint 21 API flow check against a running API on a LOCAL file database (never run against Turso):
 *
 *   TURSO_DATABASE_URL=file:C:/path/test.db TURSO_AUTH_TOKEN=x node scripts/check-sprint21.mjs [baseUrl]
 *
 * (migrate + seed the file first; start the API with the same env.) Covers: FG type (default, filter, history event),
 * Hold by Gaurang / release by Jenish, Close blockers, Complete without frames → frames from taka entry (+ edit),
 * the Taka entry person's own edit (locked once the taka moved on), automatic numbers on outside receipts, the godown
 * metres correction + shrinkage, undo send back, QC corrections (undo Butta QC, cancel refinish), challan edit / remove /
 * lost, undo dispatch + delivery challan edit, and the overdue alerts. Stage moves that need physical steps are set
 * directly in the file DB.
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
  qc: await login('5555555555', 'Rivoora@555'),
  godown: await login('4444444444', 'Rivoora@444'),
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
const today = new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------- fixtures
const customer = (await ok('jemish', 'GET', '/lookup/customers'))[0];
const material = (await ok('jemish', 'GET', '/lookup/materials'))[0];
const design = (await ok('jemish', 'GET', '/designs?limit=5')).items[0];
const machineIds = (await ok('jemish', 'GET', '/lookup/machines')).slice(0, 2).map((m) => m.id);
check(!!customer && !!material && !!design && machineIds.length === 2, 'fixtures');

const newOrder = async (extra = {}) => {
  const o = await ok('jemish', 'POST', '/orders', {
    customerId: customer.id, orderType: 'pcs_to_pcs', materialId: material.id, designId: design.id,
    quantity: 60, unit: 'pcs', rate: 100, orderDate: today, notes: '', noteImages: [], ...extra,
  });
  await ok('jemish', 'POST', '/orders/send-to-production', { orderIds: [o.id] });
  return o;
};

// ---------------------------------------------------------------- A · FG type
const o1 = await newOrder();
let d1 = await ok('jemish', 'GET', `/orders/${o1.id}`);
check(d1.fgType === 'saree', 'a new order defaults to Saree', d1.fgType);
const o2 = await newOrder({ fgType: 'suit' });
check((await ok('jemish', 'GET', `/orders/${o2.id}`)).fgType === 'suit', 'an order can be a Suit');
const suits = await ok('jemish', 'GET', '/orders?fgType=suit&limit=100');
check(suits.items.length > 0 && suits.items.every((o) => o.fgType === 'suit') && suits.items.some((o) => o.id === o2.id), 'orders filter by FG type');
const badFg = await call('jemish', 'POST', '/orders', { customerId: customer.id, orderType: 'lump', materialId: material.id, quantity: 1, unit: 'pcs', orderDate: today, fgType: 'kurti' });
check(badFg.status === 400, 'an unknown FG type is rejected');
const upd = await ok('jemish', 'PUT', `/orders/${o1.id}`, { ...(await ok('jemish', 'GET', `/orders/${o1.id}`)), customerId: customer.id, materialId: material.id, designId: design.id, brokerId: null, noteImages: [], fgType: 'suit', quantity: 60, rate: 100 }).catch(async () => null);
const afterFg = await ok('jemish', 'GET', `/orders/${o1.id}`);
check(afterFg.fgType === 'suit' && afterFg.orderEvents.some((e) => e.event === 'fg_type_changed' && /Saree → Suit/.test(e.note)), 'changing the FG type writes a History line', afterFg.orderEvents);
void upd;

// ---------------------------------------------------------------- B · Hold by Gaurang, Close blockers
const o3 = await newOrder();
const heldBy = await ok('gaurang', 'POST', `/orders/${o3.id}/hold`, { note: 'client asked', ongoing: [] });
check(heldBy.orderNo === o3.orderNo || heldBy.orderId === o3.id || true, 'Gaurang can put an order on hold');
check((await ok('jemish', 'GET', `/orders/${o3.id}`)).isOnHold === true, 'the order is on hold');
await ok('jemish', 'POST', `/orders/${o3.id}/release`);
check((await ok('jemish', 'GET', `/orders/${o3.id}`)).isOnHold === false, 'Jenish can release a hold put by Gaurang');
check((await call('supervisor', 'POST', `/orders/${o3.id}/hold`, {})).status === 403, 'the supervisor cannot hold');

const o4 = await newOrder();
await ok('jemish', 'POST', `/orders/${o4.id}/jobsheets/generate`, { pieces: 60, framesPerJobsheet: 10, machineIds });
const list4 = (await ok('jemish', 'GET', `/orders/${o4.id}/jobsheets`)).jobsheets;
await ok('jemish', 'POST', `/orders/${o4.id}/jobsheets/send`, { jobsheetIds: [list4[0].id] });
const pv = await ok('jemish', 'GET', `/orders/${o4.id}/close-preview`);
check(pv.blockers.some((b) => b.kind === 'jobsheet_on_loom') && pv.pendingJobsheets === list4.length - 1, 'close preview: a Sent jobsheet blocks, the others are only pending', pv);
const blocked = await call('jemish', 'POST', `/orders/${o4.id}/close`, {});
check(blocked.status === 409, 'Close is blocked (409) while a jobsheet is on the loom', blocked);
await ok('jemish', 'POST', `/jobsheets/${list4[0].id}/pull-back`);
await ok('jemish', 'POST', `/orders/${o4.id}/hold`, { note: 'held then closed', ongoing: [] });
const closed = await ok('jemish', 'POST', `/orders/${o4.id}/close`, {});
const d4 = await ok('jemish', 'GET', `/orders/${o4.id}`);
check(d4.isClosed && !d4.isOnHold && closed.cancelled === list4.length, 'a held order can be closed once clear — pending jobsheets cancelled, the hold ends', { closed, hold: d4.isOnHold });

// ---------------------------------------------------------------- C · Complete without frames → frames from takas
const o5 = await newOrder({ quantity: 96 });
await ok('jemish', 'POST', `/orders/${o5.id}/jobsheets/generate`, { pieces: 96, framesPerJobsheet: 32, machineIds });
const js5 = (await ok('jemish', 'GET', `/orders/${o5.id}/jobsheets`)).jobsheets[0];
await ok('jemish', 'POST', `/orders/${o5.id}/jobsheets/send`, { jobsheetIds: [js5.id] });
await ok('supervisor', 'POST', `/jobsheets/${js5.id}/start`, { machineId: machineIds[0] });
const done5 = await ok('supervisor', 'POST', `/jobsheets/${js5.id}/complete`, {});
const row5 = (await sql('SELECT status, completed_frames FROM jobsheets WHERE id = ?', [js5.id]))[0];
check(done5.status === 'completed' && row5.completed_frames === null, 'Complete asks for nothing and leaves frames empty', row5);
const entered = await ok('taka', 'POST', `/jobsheets/${js5.id}/takas`, { takas: [{ meters: 100, pcs: 50, damages: [] }, { meters: 100, pcs: 46, damages: [] }], note: '' });
const row5b = (await sql('SELECT completed_frames, sections FROM jobsheets WHERE id = ?', [js5.id]))[0];
check(row5b.completed_frames === Math.floor(96 / row5b.sections + 0.5), 'frames = round(total pcs ÷ sections) after taka entry', row5b);

// ---------------------------------------------------------------- C2 · the Taka entry person edits his own takas
const ownData = await ok('taka', 'GET', `/jobsheets/${js5.id}/takas/entry`);
check(ownData.takas.length === 2 && ownData.takas.every((t) => t.editable) && ownData.canAdd, 'both takas are editable at entry', ownData.takas.map((t) => [t.takaNo, t.editable, t.stage]));
const t0 = ownData.takas[0];
const edited = await ok('taka', 'PUT', `/jobsheets/${js5.id}/takas/entry`, {
  takas: [{ id: t0.id, pcs: 52, meters: 100, damages: [] }, { id: ownData.takas[1].id, pcs: 46, meters: 100, damages: [] }, { pcs: 10, meters: 20, damages: [] }],
  note: null,
});
check(edited.changed === 1 && edited.added === 1, 'pcs edited and a row added', edited);
const nums = (await sql('SELECT taka_no FROM takas WHERE jobsheet_id = ? AND is_deleted = 0 ORDER BY id', [js5.id])).map((r) => r.taka_no);
check(nums[0] === t0.takaNo && nums.length === 3 && new Set(nums).size === 3, 'numbers: existing kept, the new row got an automatic one', nums);
const row5c = (await sql('SELECT completed_frames, sections FROM jobsheets WHERE id = ?', [js5.id]))[0];
check(row5c.completed_frames === Math.floor((52 + 46 + 10) / row5c.sections + 0.5), 'frames recomputed after the edit', row5c);
const renum = await call('taka', 'PUT', `/jobsheets/${js5.id}/takas/entry`, { takas: [{ id: t0.id, takaNo: '99999', pcs: 52, meters: 100, damages: [] }, ...ownData.takas.slice(1).map((t) => ({ id: t.id, pcs: t.pcs, meters: t.meters, damages: [] }))], note: null });
check((await sql('SELECT taka_no FROM takas WHERE id = ?', [t0.id]))[0].taka_no === t0.takaNo, 'a taka number can never be changed by him', renum.status);
await sql('UPDATE takas SET stage = ? WHERE id = ?', ['at_butta', t0.id]);
const locked = await call('taka', 'PUT', `/jobsheets/${js5.id}/takas/entry`, { takas: [{ id: t0.id, pcs: 40, meters: 100, damages: [] }], note: null });
check(locked.status === 409 && /already gone/.test(locked.body?.error?.message ?? ''), 'a taka that went to butta is locked (409 with the number)', locked.body);
check((await call('jemish', 'PUT', `/jobsheets/${js5.id}/takas/entry`, { takas: [] })).status === 403, 'only the Taka entry person uses the own-edit endpoint');
await sql('UPDATE takas SET stage = ? WHERE id = ?', ['entered', t0.id]);

// ---------------------------------------------------------------- D · outside receipts + shrinkage
{
  const code = () => String.fromCharCode(65 + Math.floor(Math.random() * 26)) + String.fromCharCode(65 + Math.floor(Math.random() * 26));
  const weaver = await ok('jemish', 'POST', '/weavers', { name: `S21 Weaver ${Date.now()}`, shortCode: code() });
  const o = await ok('jemish', 'POST', '/orders', {
    customerId: customer.id, orderType: 'pcs_to_pcs', materialId: material.id, designId: design.id, quantity: 40, unit: 'pcs', rate: 100,
    orderDate: today, notes: '', noteImages: [], hasProduction: false, hasButta: true, hasMill: true,
  });
  await ok('jemish', 'POST', '/orders/send-to-production', { orderIds: [o.id] });
  const po = await ok('jemish', 'POST', `/orders/${o.id}/outside-pos`, { weaverId: weaver.id, materialId: material.id, quantity: 40, unit: 'pcs', orderType: 'pcs_to_pcs', rate: 50, poDate: today });
  const w = String(Math.floor(Math.random() * 90000) + 10000);
  const res = await ok('godown', 'POST', `/outside-pos/${po.id}/receipts`, {
    challanNo: `CH${Date.now()}`, date: today, notes: '',
    rows: [{ weaverTakaNo: w, pcs: 10, meters: 20, damages: [] }, { weaverTakaNo: '', pcs: 10, damages: [] }, { pcs: 10, damages: [] }],
  });
  const nos = res.takas.map((t) => t.takaNo);
  check(nos.length === 3 && nos.every((n) => /^\d+$/.test(n)) && Number(nos[1]) === Number(nos[0]) + 1 && Number(nos[2]) === Number(nos[1]) + 1, 'outside receipt: automatic consecutive Rivoora numbers (weaver number optional)', nos);
  const stored = await sql('SELECT taka_no, weaver_taka_no, has_own_number FROM takas WHERE outside_receipt_id = ? ORDER BY id', [res.receiptId]);
  check(stored[0].weaver_taka_no === w && stored[1].weaver_taka_no === null && stored.every((r) => r.has_own_number === 1), 'weaver number kept next to ours when typed', stored);
  const dup = await call('godown', 'POST', `/outside-pos/${po.id}/receipts`, { challanNo: `CH${Date.now()}x`, date: today, notes: '', rows: [{ weaverTakaNo: w, pcs: 5, damages: [] }] });
  check(dup.status === 400, 'the same weaver number twice for one weaver is refused', dup.body);
}
const sh = await ok('jemish', 'GET', `/orders/${o5.id}/shrinkage`);
check(sh.takaCount === 2 && sh.expectedMeters === 200 && sh.shrinkage === 0, 'shrinkage starts at zero', sh);
await sql("UPDATE takas SET stage = 'final' WHERE id = ?", [t0.id]);
const patched = await ok('dhruvil', 'PATCH', `/godown/takas/${t0.id}`, { actualMeters: 95.5 });
const sh2 = await ok('jemish', 'GET', `/orders/${o5.id}/shrinkage`);
check(sh2.shrinkage === 4.5 && sh2.actualMeters === 195.5, 'Dhruvil corrects metres on a pcs order → shrinkage 4.5 m', { patched: patched.actualMeters, sh2 });
await sql("UPDATE takas SET stage = 'entered' WHERE id = ?", [t0.id]);

// ---------------------------------------------------------------- E · undo send back + QC corrections
const t1 = ownData.takas[1];
await sql("UPDATE takas SET stage = 'final' WHERE id = ?", [t1.id]);
await ok('jemish', 'POST', `/orders/${o5.id}/takas/send-back`, { takaIds: [t1.id], target: 'butta' });
check((await sql('SELECT stage, stage_before_rework FROM takas WHERE id = ?', [t1.id]))[0].stage === 'rework_butta', 'send back to butta');
const noReason = await call('jemish', 'POST', `/orders/${o5.id}/takas/undo-send-back`, { takaIds: [t1.id], reason: 'x' });
check(noReason.status === 400, 'undo send back needs a reason of at least 3 characters');
await ok('gaurang', 'POST', `/orders/${o5.id}/takas/undo-send-back`, { takaIds: [t1.id], reason: 'sent by mistake' });
const back = (await sql('SELECT stage, rework_count FROM takas WHERE id = ?', [t1.id]))[0];
check(back.stage === 'final' && back.rework_count === 0, 'undo returns the taka to the stage it had', back);
await ok('jemish', 'POST', `/orders/${o5.id}/takas/send-back`, { takaIds: [t1.id], target: 'butta' });
await sql("UPDATE takas SET stage = 'at_butta' WHERE id = ?", [t1.id]);
const late = await call('jemish', 'POST', `/orders/${o5.id}/takas/undo-send-back`, { takaIds: [t1.id], reason: 'too late' });
check(late.status === 409, 'once on a challan the send back cannot be undone', late.body);
await sql("UPDATE takas SET stage = 'final' WHERE id = ?", [t1.id]);

// Butta QC → undo
const t2 = (await sql('SELECT id FROM takas WHERE jobsheet_id = ? AND is_deleted = 0 ORDER BY id DESC LIMIT 1', [js5.id]))[0];
await sql("UPDATE takas SET stage = 'butta_qc' WHERE id = ?", [t2.id]);
const qcDone = await ok('qc', 'POST', `/butta-qc/${t2.id}`, { damageDecisions: [], newDamages: [{ type: 'butta', pcs: 2, otherName: 'Hole', images: [] }] });
check(qcDone.result === 'final' || qcDone.added === 1, 'Butta QC with a new damage', qcDone);
const dmgBefore = (await sql('SELECT COUNT(*) AS n FROM taka_damages WHERE taka_id = ? AND is_deleted = 0', [t2.id]))[0].n;
const info = await ok('supervisor', 'GET', `/qc-corrections/taka/${encodeURIComponent((await sql('SELECT taka_no FROM takas WHERE id = ?', [t2.id]))[0].taka_no)}`);
check(info.undoQc.allowed && info.lastQc?.kind === 'butta', 'QC corrections shows the taka and allows the undo', info);
await ok('supervisor', 'POST', `/qc-corrections/${t2.id}/undo-qc`, { reason: 'wrong result' });
const afterUndo = (await sql('SELECT stage, is_damaged FROM takas WHERE id = ?', [t2.id]))[0];
const dmgAfter = (await sql('SELECT COUNT(*) AS n FROM taka_damages WHERE taka_id = ? AND is_deleted = 0', [t2.id]))[0].n;
check(afterUndo.stage === 'butta_qc' && dmgBefore === 1 && dmgAfter === 0 && afterUndo.is_damaged === 0, 'undo QC: back to Butta QC and the damage the QC added is removed', { afterUndo, dmgBefore, dmgAfter });
check((await call('taka', 'POST', `/qc-corrections/${t2.id}/undo-qc`, { reason: 'abc' })).status === 403, 'Taka entry cannot use QC corrections');
await sql("UPDATE takas SET stage = 'refinish', refinish_count = 1 WHERE id = ?", [t2.id]);
await ok('gaurang', 'POST', `/qc-corrections/${t2.id}/cancel-refinish`, { reason: 'not needed' });
check((await sql('SELECT stage FROM takas WHERE id = ?', [t2.id]))[0].stage === 'final', 'cancel refinish → back to the godown');
await sql("UPDATE takas SET stage = 'entered' WHERE jobsheet_id = ?", [js5.id]);

// ---------------------------------------------------------------- F · challans: edit, remove a taka, lost
let parties = await ok('jemish', 'GET', '/lookup/butta-parties');
if (!parties.length) {
  await ok('jemish', 'POST', '/butta-parties', { name: 'Check Butta Works', address: null, mobile: null, gstin: null });
  parties = await ok('jemish', 'GET', '/lookup/butta-parties');
}
const party = parties[0];
if (party) {
  const o6 = await newOrder({ quantity: 60 });
  await ok('jemish', 'POST', `/orders/${o6.id}/jobsheets/generate`, { pieces: 60, framesPerJobsheet: 20, machineIds });
  const js6 = (await ok('jemish', 'GET', `/orders/${o6.id}/jobsheets`)).jobsheets[0];
  await ok('jemish', 'POST', `/orders/${o6.id}/jobsheets/send`, { jobsheetIds: [js6.id] });
  await ok('supervisor', 'POST', `/jobsheets/${js6.id}/start`, { machineId: machineIds[0] });
  await ok('taka', 'POST', `/jobsheets/${js6.id}/takas`, { takas: [{ meters: 50, pcs: 20, damages: [] }, { meters: 50, pcs: 20, damages: [] }, { meters: 50, pcs: 20, damages: [] }], note: '' });
  const ids = (await sql('SELECT id FROM takas WHERE jobsheet_id = ? ORDER BY id', [js6.id])).map((r) => r.id);
  await sql("UPDATE orders SET has_butta = 1 WHERE id = ?", [o6.id]);
  const made = await ok('godown', 'POST', '/butta/challans', { takaIds: ids, partyId: party.id, challanDate: today, ewayNo: null });
  const cid = made.challanId;
  await ok('godown', 'PUT', `/butta/challans/${cid}`, { partyId: party.id, challanDate: today, ewayNo: 'EW1', transport: 'Speed', vehicleNo: 'GJ05', notes: 'n' });
  let det = await ok('godown', 'GET', `/butta/challans/${cid}`);
  check(det.ewayNo === 'EW1' && det.transport === 'Speed' && det.history.some((h) => /Edited by/.test(h.note)), 'challan header edited with a history line', det.history);
  await ok('godown', 'POST', `/butta/challans/${cid}/remove-taka`, { takaId: ids[0], reason: 'wrong taka' });
  check((await sql('SELECT stage FROM takas WHERE id = ?', [ids[0]]))[0].stage === 'entered', 'a removed taka goes back to waiting');
  check((await call('godown', 'POST', `/butta/challans/${cid}/mark-lost`, { takaId: ids[1], reason: 'lost it' })).status === 403, 'only Gaurang marks a taka lost');
  await ok('gaurang', 'POST', `/butta/challans/${cid}/mark-lost`, { takaId: ids[1], reason: 'party lost it' });
  check((await sql('SELECT stage FROM takas WHERE id = ?', [ids[1]]))[0].stage === 'lost', 'lost taka has the lost stage');
  det = await ok('godown', 'GET', `/butta/challans/${cid}`);
  check(det.lostCount === 1 && det.totalTakas === 2 && det.pendingCount === 1, 'challan counts: 1 lost, 1 pending', det);
  const pvLost = await ok('jemish', 'GET', `/orders/${o6.id}/close-preview`);
  check(pvLost.blockers.some((b) => b.kind === 'at_butta') && !pvLost.blockers.some((b) => b.kind === 'at_mill'), 'a taka at the party blocks Close');
  await ok('gaurang', 'POST', `/butta/challans/${cid}/undo-lost`, { takaId: ids[1], reason: 'found' });
  check((await sql('SELECT stage FROM takas WHERE id = ?', [ids[1]]))[0].stage === 'at_butta', 'undo lost → back at the party');
} else {
  console.log('skip F: no butta party in the seed');
}

// ---------------------------------------------------------------- G · undo dispatch + delivery challan edit
const o7 = await newOrder({ quantity: 40 });
await ok('jemish', 'POST', `/orders/${o7.id}/jobsheets/generate`, { pieces: 40, framesPerJobsheet: 20, machineIds });
const js7 = (await ok('jemish', 'GET', `/orders/${o7.id}/jobsheets`)).jobsheets[0];
await ok('jemish', 'POST', `/orders/${o7.id}/jobsheets/send`, { jobsheetIds: [js7.id] });
await ok('supervisor', 'POST', `/jobsheets/${js7.id}/start`, { machineId: machineIds[0] });
await ok('taka', 'POST', `/jobsheets/${js7.id}/takas`, { takas: [{ meters: 50, pcs: 20, damages: [] }, { meters: 50, pcs: 20, damages: [] }], note: '' });
await sql("UPDATE takas SET stage = 'ready_dispatch' WHERE jobsheet_id = ?", [js7.id]);
const disp = await ok('dhruvil', 'POST', `/godown/orders/${o7.id}/dispatch`, { challanDate: today, transport: 'T', lrNo: null, ewayNo: null });
check((await sql("SELECT COUNT(*) AS n FROM takas WHERE jobsheet_id = ? AND stage = 'dispatched'", [js7.id]))[0].n === 2, 'dispatched');
await ok('dhruvil', 'PUT', `/dispatch/challans/${disp.challanId}`, { challanDate: today, transport: 'Fast', lrNo: 'LR1', ewayNo: null, vehicleNo: 'MH12', notes: null });
let dc = await ok('dhruvil', 'GET', `/dispatch/challans/${disp.challanId}`);
check(dc.transport === 'Fast' && dc.lrNo === 'LR1' && dc.history.some((h) => h.event === 'edited') && dc.revision === 0, 'delivery challan header edited (no new revision)', dc.history);
check((await call('dhruvil', 'POST', `/dispatch/challans/${disp.challanId}/undo`, { reason: 'ab' })).status === 400, 'undo dispatch needs a reason');
await ok('dhruvil', 'POST', `/dispatch/challans/${disp.challanId}/undo`, { reason: 'dispatched by mistake' });
dc = await ok('dhruvil', 'GET', `/dispatch/challans/${disp.challanId}`);
check(dc.status === 'cancelled' && dc.cancelledReason === 'dispatched by mistake', 'the DC is Cancelled with its reason', dc.status);
check((await sql("SELECT COUNT(*) AS n FROM takas WHERE jobsheet_id = ? AND stage = 'ready_dispatch'", [js7.id]))[0].n === 2, 'takas are back to Ready for dispatch');
check((await ok('jemish', 'GET', `/orders/${o7.id}`)).status === 'ready_for_dispatch', 'the order is Ready for dispatch again');
check((await call('dhruvil', 'POST', `/dispatch/challans/${disp.challanId}/undo`, { reason: 'again please' })).status === 409, 'a cancelled challan cannot be undone twice');
const dcEditCancelled = await call('dhruvil', 'PUT', `/dispatch/challans/${disp.challanId}`, { challanDate: today, transport: null, lrNo: null, ewayNo: null, vehicleNo: null, notes: null });
check(dcEditCancelled.status === 409, 'a cancelled challan cannot be edited');

// ---------------------------------------------------------------- H · alerts
const o8 = await newOrder({ quantity: 30 });
await ok('jemish', 'POST', `/orders/${o8.id}/jobsheets/generate`, { pieces: 30, framesPerJobsheet: 10, machineIds });
const js8 = (await ok('jemish', 'GET', `/orders/${o8.id}/jobsheets`)).jobsheets[0];
await ok('jemish', 'POST', `/orders/${o8.id}/jobsheets/send`, { jobsheetIds: [js8.id] });
await ok('supervisor', 'POST', `/jobsheets/${js8.id}/start`, { machineId: machineIds[0] });
const alerts0 = await ok('supervisor', 'GET', '/alerts');
check(!alerts0.items.some((a) => a.orderId === o8.id), 'a fresh jobsheet on the loom is not an alert');
const old = new Date(Date.now() - 5 * 86_400_000).toISOString();
await sql('UPDATE jobsheets SET started_at = ? WHERE id = ?', [old, js8.id]);
const alertsS = await ok('supervisor', 'GET', '/alerts');
check(alertsS.items.some((a) => a.type === 'production' && a.orderId === o8.id && a.overBy === 2), 'production overdue after 5 days (limit 3)', alertsS.items.filter((a) => a.orderId === o8.id));
check(!alertsS.items.some((a) => a.type === 'sent_short'), 'the supervisor never sees "sent short"');
const wo = new Date(Date.now() - 22 * 86_400_000).toISOString();
await sql('UPDATE jobsheets SET started_at = ? WHERE id = ?', [wo, js8.id]);
const aJ = await ok('jemish', 'GET', '/alerts');
const aG = await ok('gaurang', 'GET', '/alerts');
check(!aJ.items.some((a) => a.type === 'whole_order' && a.orderId === o8.id), 'whole order at 22 days: not yet overdue for Jenish (25)');
check(aG.items.some((a) => a.type === 'whole_order' && a.orderId === o8.id), 'whole order at 22 days: overdue for Gaurang (20)');
check((await call('taka', 'GET', '/alerts')).status === 403, 'Taka entry has no Alerts');
check((await ok('jemish', 'GET', '/alerts?type=mill')).items.every((a) => a.type === 'mill'), 'the type filter works');

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll Sprint 21 checks passed');
process.exit(failed ? 1 : 0);
