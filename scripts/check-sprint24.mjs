/**
 * Sprint 24 API flow check (yarn: combined lots, withdraw purpose, program-wise boxes, TFO hold / box details pending,
 * warping leftover, Palti, box stickers) against a running API on a LOCAL file database (never run against Turso):
 *
 *   TURSO_DATABASE_URL=file:/path/test.db TURSO_AUTH_TOKEN=x node scripts/check-sprint24.mjs [baseUrl]
 *
 * (migrate + seed the file first; start the API with the same env.) It creates its own masters with a unique suffix, so it
 * can run many times.
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

const PHONES = { jemish: '9999999999', gaurang: '8888888888', supervisor: '7777777777', yarn: '2222222222' };
const sessions = {};
async function login(who, phone) {
  const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, password: `Rivoora@${phone.slice(0, 3)}` }) });
  if (!res.ok) throw new Error(`login ${who} failed: ${res.status}`);
  sessions[who] = res.headers.get('set-cookie').split(';')[0];
}
for (const [who, phone] of Object.entries(PHONES)) await login(who, phone);
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
const tag = Date.now().toString(36);
const KG = 10_000; // yarn units per kg

const lotAvail = async (zone, qualityId, lotId) => (await ok('jemish', 'GET', `/yarn/lots?zone=${zone}&qualityId=${qualityId}`)).find((x) => x.id === lotId)?.availableG ?? 0;
const zone = (z) => ok('jemish', 'GET', `/yarn/zones/${z}`);

// ---------------------------------------------------------------- masters + a PO
const party = await ok('jemish', 'POST', '/yarn-parties', { name: `S24 Yarns ${tag}` });
const q75 = await ok('jemish', 'POST', '/yarn-qualities', { name: `75D s24 ${tag}` });
const q100 = await ok('jemish', 'POST', '/yarn-qualities', { name: `100D s24 ${tag}` });
const machinesNow = (await ok('jemish', 'GET', '/tfo-machines?limit=100')).items;
const nextNo = Math.max(0, ...machinesNow.map((m) => m.machineNo)) + 1;
const m1 = await ok('jemish', 'POST', '/tfo-machines', { machineNo: nextNo, name: `TFO s24a ${tag}`, isActive: true });
const m2 = await ok('jemish', 'POST', '/tfo-machines', { machineNo: nextNo + 1, name: `TFO s24b ${tag}`, isActive: true });
const po = await ok('jemish', 'POST', '/yarn-pos', {
  poDate: today,
  partyId: party.id,
  lines: [
    { qualityId: q75.id, qtyKg: 5000, rate: 200 },
    { qualityId: q100.id, qtyKg: 1000, rate: 150 },
  ],
});
const poDetail = await ok('jemish', 'GET', `/yarn-pos/${po.id}`);
const line75 = poDetail.lines.find((l) => l.quality.id === q75.id).id;
const line100 = poDetail.lines.find((l) => l.quality.id === q100.id).id;

// ---------------------------------------------------------------- A · CR-16 the same lot across challans is combined
const lot = `245-${tag}`;
const fresh = await ok('jemish', 'GET', `/yarn/lots/check?partyId=${party.id}&lotNo=${encodeURIComponent(lot)}`);
check(fresh.available === true && fresh.lot === null, 'A: a new lot no. is "New lot"');
await ok('yarn', 'POST', `/yarn-pos/${po.id}/receipts`, { challanNo: `C77-${tag}`, date: today, lots: [{ poLineId: line75, lotNo: lot, qtyKg: 600, allocations: [{ zone: 'tfo', qtyKg: 600 }] }] });
const existing = await ok('jemish', 'GET', `/yarn/lots/check?partyId=${party.id}&lotNo=${encodeURIComponent(lot.toUpperCase())}`);
check(existing.available === false && existing.lot?.receivedG === 600 * KG && existing.lot.challans.includes(`C77-${tag}`) && existing.lot.quality.id === q75.id, 'A: the check shows the existing lot (any case) with 600 kg and challan 77', existing);
await ok('yarn', 'POST', `/yarn-pos/${po.id}/receipts`, { challanNo: `C78-${tag}`, date: today, lots: [{ poLineId: line75, lotNo: lot.toUpperCase(), qtyKg: 400, allocations: [{ zone: 'tfo', qtyKg: 300 }, { zone: 'warping', qtyKg: 100 }] }] });
const after = await ok('jemish', 'GET', `/yarn/lots/check?partyId=${party.id}&lotNo=${encodeURIComponent(lot)}`);
check(after.lot?.id === existing.lot.id && after.lot.receivedG === 1000 * KG && after.lot.challans.length === 2, 'A: a second challan adds to the SAME lot (1000 kg, both challans)', after);
check((await lotAvail('tfo', q75.id, existing.lot.id)) === 900 * KG, 'A: TFO stock of the lot = 600 + 300 kg');
check((await lotAvail('warping', q75.id, existing.lot.id)) === 100 * KG, 'A: Warping stock of the lot = 100 kg');
const clash = await call('yarn', 'POST', `/yarn-pos/${po.id}/receipts`, { challanNo: `C79-${tag}`, date: today, lots: [{ poLineId: line100, lotNo: lot, qtyKg: 10 }] });
check(clash.status === 400 && clash.body?.error?.field === 'lots.0.lotNo' && /is 75D s24/.test(clash.body.error.message), 'A: same lot no. with another quality is refused on the field', clash.body);
await ok('yarn', 'POST', `/yarn-pos/${po.id}/receipts`, { challanNo: `C80-${tag}`, date: today, lots: [{ poLineId: line75, lotNo: `${lot}A`, qtyKg: 50, allocations: [{ zone: 'direct', qtyKg: 50 }] }] });
const lotA = await ok('jemish', 'GET', `/yarn/lots/check?partyId=${party.id}&lotNo=${encodeURIComponent(`${lot}a`)}`);
check(lotA.lot && lotA.lot.id !== existing.lot.id && lotA.lot.receivedG === 50 * KG, 'A: "245A" is a separate lot; "245a" finds it', lotA);
const dash = await ok('jemish', 'GET', `/yarn/lots/check?partyId=${party.id}&lotNo=${encodeURIComponent(lot.replace('-', ''))}`);
check(dash.available === true, 'A: "245" without the dash is not the same lot');

// ---------------------------------------------------------------- B1 · CR-17 withdraw purpose in every zone
const sell = await call('yarn', 'POST', '/yarn/withdrawals', { what: 'raw', zone: 'warping', qualityId: q75.id, lotId: existing.lot.id, qtyKg: 10, purpose: 'sell', partyName: 'Ramesh Traders', rate: 120.5 });
check(sell.status === 201, 'B1: withdraw from Warping (Sell, party + rate) works', sell.body);
check((await call('yarn', 'POST', '/yarn/withdrawals', { what: 'raw', zone: 'warping', qualityId: q75.id, lotId: existing.lot.id, qtyKg: 1, purpose: 'sell' })).status === 400, 'B1: Sell without a party is refused');
check((await call('yarn', 'POST', '/yarn/withdrawals', { what: 'raw', zone: 'tfo', qualityId: q75.id, lotId: existing.lot.id, qtyKg: 1 })).status === 400, 'B1: a withdraw without a purpose is refused');
check((await call('supervisor', 'POST', '/yarn/withdrawals', { what: 'raw', zone: 'tfo', qualityId: q75.id, lotId: existing.lot.id, qtyKg: 5, purpose: 'in_house', note: 'sample' })).status === 201, 'B1: Use in-house from TFO works');
const sellMoves = await ok('jemish', 'GET', '/yarn/moves?purpose=sell&limit=50');
const mine = sellMoves.items.find((m) => m.refId === sell.body.withdrawalId);
check(mine?.withdrawal?.purpose === 'sell' && mine.withdrawal.partyName === 'Ramesh Traders' && mine.withdrawal.ratePaise === 12050, 'B1: Movements filter Sell shows party + rate to Jenish', mine?.withdrawal);
check(sellMoves.items.every((m) => m.withdrawal?.purpose === 'sell'), 'B1: the Sell filter only lists sales');
const supMoves = await ok('supervisor', 'GET', '/yarn/moves?purpose=sell&limit=50');
const supRow = supMoves.items.find((m) => m.refId === sell.body.withdrawalId);
check(supRow?.withdrawal?.ratePaise === null && supRow.withdrawal.rateEntered === true, 'B1: the Supervisor sees "rate entered", not the rate', supRow?.withdrawal);
const inHouse = await ok('jemish', 'GET', '/yarn/moves?purpose=in_house&limit=50');
check(inHouse.items.length > 0 && inHouse.items.every((m) => m.withdrawal?.purpose === 'in_house'), 'B1: the In-house filter lists in-house withdrawals');

// ---------------------------------------------------------------- C · CR-20 hold / resume / complete made part · CR-21 stop · boxes later
const tfoLot = existing.lot.id;
const tfoBefore = await lotAvail('tfo', q75.id, tfoLot);
const [pend1] = await ok('jemish', 'POST', '/yarn/tfo/pending', { programs: [{ rawQualityId: q75.id, lotId: tfoLot, rolls: 12, windingKg: 10, tpm: 600, direction: 'S', denierFilament: '75/36' }] });
const p1 = await ok('yarn', 'POST', `/yarn/tfo/pending/${pend1.id}/start`, { sections: [{ machineId: m1.id, section: 'A' }] });
check(p1.status === 'running' && (await lotAvail('tfo', q75.id, tfoLot)) === tfoBefore - 120 * KG, 'C: program started (120 kg issued)');
check((await call('yarn', 'POST', `/yarn/tfo/programs/${p1.id}/hold`, { rollsMade: 6, rollsLeft: 5 })).status === 400, 'C: hold refuses made + left ≠ rolls started');
check((await call('yarn', 'POST', `/yarn/tfo/programs/${p1.id}/hold`, {})).status === 400, 'C: hold needs the rolls made');
const held = await ok('yarn', 'POST', `/yarn/tfo/programs/${p1.id}/hold`, { rollsMade: 6, rollsLeft: 6, reason: 'power cut' });
check(held.status === 'on_hold' && held.rollsMade === 6 && held.events.some((e) => e.kind === 'hold' && e.rollsLeft === 6 && e.note === 'power cut'), 'C: On hold with 6 made / 6 left, logged', held.events);
let board = await ok('jemish', 'GET', '/yarn/tfo/board');
check(board.onHold.some((p) => p.id === p1.id), 'C: the board lists it under On hold');
check(board.machines.find((m) => m.id === m1.id)?.sections.find((s) => s.section === 'A')?.program === null, 'C: its section 1A is idle again');
const [pend2] = await ok('jemish', 'POST', '/yarn/tfo/pending', { programs: [{ rawQualityId: q75.id, lotId: tfoLot, rolls: 2, windingKg: 5, tpm: 500, direction: 'Z' }] });
const p2 = await ok('supervisor', 'POST', `/yarn/tfo/pending/${pend2.id}/start`, { sections: [{ machineId: m1.id, section: 'A' }] });
check(p2.status === 'running', 'C: another program runs on the freed section');
check((await call('yarn', 'POST', `/yarn/tfo/programs/${p1.id}/resume`, { sections: [{ machineId: m1.id, section: 'A' }] })).status === 409, 'C: resume refuses a busy section');
const resumed = await ok('yarn', 'POST', `/yarn/tfo/programs/${p1.id}/resume`, { sections: [{ machineId: m2.id, section: 'A' }, { machineId: m2.id, section: 'B' }] });
check(resumed.status === 'running' && resumed.sections.length === 2 && resumed.sections.every((s) => s.machineId === m2.id), 'C: resumed on other sections (2A, 2B)', resumed.sections);
const box2 = (rolls, gross) => ({ rolls, grossKg: gross, avgKg: null, direction: null });
const part = await ok('yarn', 'POST', `/yarn/tfo/programs/${p1.id}/part`, { rollWeightKg: 0.5, boxes: [box2(3, 31), box2(3, 31)], note: 'made part' });
const partBoxes = part.boxes.filter((b) => b.eventId === part.events.find((e) => e.kind === 'part_done')?.id);
check(part.status === 'running' && part.rollsDone === 6 && partBoxes.length === 2 && part.twistedG === 59 * KG, 'C: Complete made part → 2 boxes (59 kg), still running', { status: part.status, rollsDone: part.rollsDone, twistedG: part.twistedG });
check(partBoxes.every((b) => typeof b.fy === 'string' && b.currentZone === 'tfo'), 'C: part boxes are in TFO with an FY');
check((await call('yarn', 'POST', `/yarn/tfo/programs/${p1.id}/part`, { rollWeightKg: 0.5, boxes: [box2(7, 70)] })).status === 400, 'C: a part can’t box more rolls than are left');
const later = await ok('yarn', 'POST', `/yarn/tfo/programs/${p1.id}/stop-later`, { note: 'boxes tomorrow' });
check(later.status === 'box_pending' && later.stoppedAt, 'C: Stop · enter boxes later → Box details pending');
board = await ok('jemish', 'GET', '/yarn/tfo/board');
check(board.boxPending.some((p) => p.id === p1.id) && !board.machines.find((m) => m.id === m2.id).sections.some((s) => s.program), 'C: listed under Box details pending, 2A / 2B free');
check((await call('yarn', 'POST', `/yarn/tfo/programs/${p1.id}/stop`, { rollWeightKg: 0.5, boxes: [box2(6, 61)] })).status === 409, 'C: a box-pending program is not stopped again');
const saved = await ok('supervisor', 'POST', `/yarn/tfo/programs/${p1.id}/boxes`, { rollWeightKg: 0.5, boxes: [box2(3, 31), box2(3, 30.5)], returnedRawKg: 1 });
check(saved.status === 'completed' && saved.boxes.length === 4 && saved.twistedG === (59 + 29.5 + 29) * KG && saved.returnedRawG === 1 * KG, 'C: Save boxes → Completed (4 boxes in all, raw returned)', { status: saved.status, boxes: saved.boxes.length, twistedG: saved.twistedG });
const heldP2 = await ok('yarn', 'POST', `/yarn/tfo/programs/${p2.id}/hold`, { rollsMade: 1, rollsLeft: 1 });
const stoppedP2 = await ok('yarn', 'POST', `/yarn/tfo/programs/${p2.id}/stop`, { rollWeightKg: 0.2, boxes: [box2(2, 9)] });
check(heldP2.status === 'on_hold' && stoppedP2.status === 'completed', 'C: a held program can be stopped directly');
const summary = await ok('jemish', 'GET', '/yarn/summary');
check(typeof summary.tfo.onHold === 'number' && typeof summary.tfo.boxPending === 'number', 'C: summary counts On hold / Box details pending');
const history = await ok('jemish', 'GET', '/yarn/tfo/programs?limit=100');
check(!history.items.some((p) => p.status === 'system'), 'C: the system program never shows in the history');

// @@PHASE-D@@

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll Sprint 24 checks passed');
process.exit(failed ? 1 : 0);
