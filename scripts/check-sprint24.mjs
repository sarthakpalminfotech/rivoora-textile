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

// @@PHASE-C@@

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll Sprint 24 checks passed');
process.exit(failed ? 1 : 0);
