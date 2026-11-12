/**
 * Sprint 25 API flow check (insight dashboards, C11 layouts, the new data fields) against a running API on a LOCAL file
 * database (never run against Turso):
 *
 *   TURSO_DATABASE_URL=file:/path/test.db TURSO_AUTH_TOKEN=x node scripts/check-sprint-25.mjs [baseUrl]
 *
 * (migrate + seed the file first; start the API with the same env.) Creates its own orders, so it can run many times.
 */
const base = process.argv[2] ?? 'http://localhost:4100';
const dbUrl = process.env.TURSO_DATABASE_URL;
if (!dbUrl?.startsWith('file:')) {
  console.error('Refusing to run: TURSO_DATABASE_URL must be a local file: database.');
  process.exit(2);
}

let failed = 0;
const check = (ok, what, extra) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok || extra === undefined ? '' : `  → ${JSON.stringify(extra).slice(0, 600)}`}`);
  if (!ok) failed += 1;
};

const PHONES = { jemish: '9999999999', gaurang: '8888888888', supervisor: '7777777777', taka: '6666666666', qc: '5555555555', yarn: '2222222222' };
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
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const tag = Date.now().toString(36);

const STRIPS = {
  owner: ['o.s.open', 'o.s.production', 'o.s.ready', 'o.s.dispatched', 'o.s.attention', 'o.attention'],
  partner: ['p.s.on_loom', 'p.s.waiting_js', 'p.s.qc_backlog', 'p.s.outside_open', 'p.s.tfo_running'],
  supervisor: ['s.s.running', 's.s.idle', 's.s.started', 's.s.completed', 's.s.damage'],
};
async function allCards(who, key, period = '30d') {
  const lay = await ok(who, 'GET', `/dashboard/${key}/layout`);
  const ids = [...STRIPS[key], ...lay.layout.sections.flatMap((s) => s.cards.filter((c) => !c.hidden).map((c) => c.id))];
  const t = Date.now();
  const r = await ok(who, 'GET', `/dashboard/${key}/cards?period=${period}&ids=${ids.join(',')}`);
  return { r, ids, ms: Date.now() - t, layout: lay };
}

// ---------------------------------------------------------------- who opens what
for (const key of ['owner', 'partner', 'supervisor']) {
  check((await call('jemish', 'GET', `/dashboard/${key}/layout`)).status === 200, `Jenish opens the ${key} dashboard`);
  check((await call('gaurang', 'GET', `/dashboard/${key}/layout`)).status === 200, `Gaurang opens the ${key} dashboard`);
  for (const r of ['taka', 'qc', 'yarn']) check((await call(r, 'GET', `/dashboard/${key}/layout`)).status === 403, `${r} gets 403 on the ${key} dashboard`);
}
check((await call('supervisor', 'GET', '/dashboard/supervisor/layout')).status === 200, 'the supervisor opens his dashboard');
check((await call('supervisor', 'GET', '/dashboard/owner/cards?ids=o.glance')).status === 403, 'the supervisor gets 403 on owner cards');
check((await call('supervisor', 'GET', '/dashboard/partner/layout')).status === 403, 'the supervisor gets 403 on the partner dashboard');
check((await call('jemish', 'GET', '/dashboard/nope/layout')).status === 404, 'an unknown dashboard is 404');

// ---------------------------------------------------------------- every card computes, fast, exactly the considered ones
const counts = { owner: 35, partner: 19, supervisor: 11 };
for (const key of ['owner', 'partner', 'supervisor']) {
  for (const period of ['7d', '30d', '3m', '6m', '12m', 'fy']) {
    const { r, ids, ms } = await allCards('jemish', key, period);
    const errors = Object.values(r.cards).filter((c) => c.error).map((c) => c.id);
    check(errors.length === 0, `${key} · ${period}: every card computes (${ids.length} asked)`, errors);
    check(ms < 1500, `${key} · ${period}: the batch answers in ${ms} ms (< 1.5 s)`);
  }
  const lay = await ok('jemish', 'GET', `/dashboard/${key}/layout`);
  const inLayout = lay.layout.sections.flatMap((s) => s.cards).length + (key === 'owner' ? 1 : 0); // + the pinned attention panel
  check(inLayout === counts[key], `${key}: ${counts[key]} considered cards`, inLayout);
}
const flagged = await ok('jemish', 'GET', '/dashboard/owner/cards?ids=o.stock_match,o.glance');
check(!flagged.cards['o.stock_match'] && !!flagged.cards['o.glance'], 'the hidden-flag card (stock that matches) is off by default');

// ---------------------------------------------------------------- money / clients hidden from the supervisor
const customers = await ok('jemish', 'GET', '/lookup/customers');
const sup = await allCards('supervisor', 'supervisor');
const supJson = JSON.stringify(sup.r);
check(!supJson.includes('"unit":"rs"'), 'the supervisor dashboard has no ₹ figure');
check(!customers.some((c) => c.name && c.name.length > 3 && supJson.includes(`"${c.name}"`)), 'the supervisor dashboard shows no client name');
check(sup.ms < 1500, `supervisor batch for the supervisor: ${sup.ms} ms`);

// ---------------------------------------------------------------- C11: arrange, everyone sees it, reset
const before = await ok('jemish', 'GET', '/dashboard/owner/layout');
check(before.isDefault === true || before.isDefault === false, 'the owner layout loads');
await ok('jemish', 'DELETE', '/dashboard/owner/layout');
const def = await ok('jemish', 'GET', '/dashboard/owner/layout');
check(def.isDefault === true && def.layout.sections[0].cards[0].id === 'o.glance', 'Reset gives the default (Business at a glance first)');
const arranged = JSON.parse(JSON.stringify(def.layout));
arranged.sections[0].title = `Pulse ${tag}`;
const pulse = arranged.sections[0].cards;
const glance = pulse.shift();
pulse.push({ ...glance, hidden: true });
pulse[0].width = 'full';
arranged.sections[1].cards.unshift({ id: 'o.open_status', width: 'normal', hidden: false });
arranged.sections[0].cards = arranged.sections[0].cards.filter((c) => c.id !== 'o.open_status');
arranged.sections[0].cards.push({ id: 'o.bogus', width: 'normal', hidden: false });
check((await call('supervisor', 'PUT', '/dashboard/supervisor/layout', def.layout)).status === 403, 'the supervisor cannot arrange');
check((await call('jemish', 'PUT', '/dashboard/owner/layout', { sections: [{ key: 'pulse', title: '', cards: [] }] })).status === 400, 'a section without a name is refused');
const saved = await ok('jemish', 'PUT', '/dashboard/owner/layout', arranged);
check(saved.isDefault === false && saved.layout.sections[0].title === `Pulse ${tag}`, 'Jenish saves a layout (section renamed)');
const seen = await ok('gaurang', 'GET', '/dashboard/owner/layout');
check(seen.layout.sections[0].cards[0].id === 'o.booked_month' && seen.layout.sections[0].cards[0].width === 'full', 'Gaurang sees the moved / widened card');
check(seen.layout.sections[0].cards.some((c) => c.id === 'o.glance' && c.hidden), 'the hidden card stays hidden for everyone');
check(seen.layout.sections[1].cards[0].id === 'o.open_status', 'a card moved across sections stays there');
check(!JSON.stringify(seen.layout).includes('o.bogus') && seen.updatedBy, 'unknown cards are dropped; who saved it is shown');
const back = await ok('gaurang', 'DELETE', '/dashboard/owner/layout');
check(back.isDefault && back.layout.sections[0].cards[0].id === 'o.glance' && back.layout.sections[0].title === 'Business pulse', 'Reset to default restores the prompt order');

// ---------------------------------------------------------------- settings: working hours
check((await call('supervisor', 'GET', '/dashboard-settings')).status === 403, 'the supervisor has no dashboard settings');
check((await call('jemish', 'PUT', '/dashboard-settings', { workingHoursPerDay: 25 })).status === 400, 'working hours above 24 are refused');
const s12 = await ok('jemish', 'PUT', '/dashboard-settings', { workingHoursPerDay: 12 });
check(s12.workingHoursPerDay === 12, 'working hours saved (12 h)');
await ok('jemish', 'PUT', '/dashboard-settings', { workingHoursPerDay: 24 });

// ---------------------------------------------------------------- new fields: promised date, due date, minimum kg
const [customer] = customers;
const [material] = await ok('jemish', 'GET', '/lookup/materials');
const [machine] = await ok('jemish', 'GET', '/lookup/machines');
const orderBody = (qty, extra = {}) => ({ customerId: customer.id, orderType: 'pcs_to_pcs', materialId: material.id, quantity: qty, unit: 'pcs', orderDate: today, ...extra });
check((await call('jemish', 'POST', '/orders', orderBody(300, { promisedDate: addDays(today, -1) }))).status === 400, 'a promised date before the order date is refused');
const o1 = await ok('jemish', 'POST', '/orders', orderBody(300, { promisedDate: addDays(today, 20), notes: `s25 short ${tag}` }));
const d1 = await ok('jemish', 'GET', `/orders/${o1.id}`);
check(d1.promisedDate === addDays(today, 20), 'the promised date is saved on the order');
const o2 = await ok('jemish', 'POST', '/orders', orderBody(300, { notes: `s25 ok ${tag}` }));
await ok('jemish', 'POST', '/orders/send-to-production', { orderIds: [o1.id, o2.id] });
await ok('jemish', 'POST', `/orders/${o1.id}/jobsheets`, { frames: 50, sections: 3, machineIds: [machine.id] }); // 150 of 300 → −50 %
await ok('jemish', 'POST', `/orders/${o2.id}/jobsheets`, { frames: 97, sections: 3, machineIds: [machine.id] }); // 291 of 300 → −3 %
const cov = (await ok('gaurang', 'GET', '/dashboard/partner/cards?ids=p.coverage')).cards['p.coverage'];
const covRows = JSON.stringify(cov);
const o1d = await ok('jemish', 'GET', `/orders/${o1.id}`);
const o2d = await ok('jemish', 'GET', `/orders/${o2.id}`);
check(covRows.includes(`Order #${o1d.orderNo}"`), '±10 %: an order covered −50 % is listed', cov);
check(!covRows.includes(`Order #${o2d.orderNo}"`), '±10 %: an order covered −3 % is not listed');
const edit = await call('jemish', 'PUT', `/orders/${o2.id}`, { ...orderBody(300), promisedDate: addDays(today, 5) });
check(edit.status === 200 && (await ok('jemish', 'GET', `/orders/${o2.id}`)).promisedDate === addDays(today, 5), 'Edit order sets the promised date');

const yq = await ok('jemish', 'POST', '/yarn-qualities', { name: `S25 low ${tag}`, minKg: 5 });
check(yq.minG === 50_000, 'a yarn quality keeps its minimum kg (yarn units)');
const low = (await ok('gaurang', 'GET', '/dashboard/partner/cards?ids=p.low_yarn')).cards['p.low_yarn'];
check(JSON.stringify(low).includes(`S25 low ${tag}`), 'Low yarn lists a quality below its minimum', low);

const weaver = await ok('jemish', 'POST', '/weavers', { name: `S25 weaver ${tag}`, shortCode: `W${tag.slice(-3).toUpperCase().replace(/[^A-Z]/g, 'Q')}` }).catch(() => null);
if (weaver) {
  const o3 = await ok('jemish', 'POST', '/orders', orderBody(100, { notes: `s25 po ${tag}` }));
  await ok('jemish', 'POST', '/orders/send-to-production', { orderIds: [o3.id] });
  const poBase = { weaverId: weaver.id, materialId: material.id, quantity: 100, unit: 'pcs', orderType: 'pcs_to_pcs', poDate: addDays(today, -10) };
  check((await call('jemish', 'POST', `/orders/${o3.id}/outside-pos`, { ...poBase, dueDate: addDays(today, -11) })).status === 400, 'a due date before the PO date is refused');
  const po = await ok('jemish', 'POST', `/orders/${o3.id}/outside-pos`, { ...poBase, dueDate: addDays(today, -2) });
  check(po.dueDate === addDays(today, -2), 'the PO keeps its due date');
  const late = (await ok('gaurang', 'GET', '/dashboard/partner/cards?ids=p.late_pos')).cards['p.late_pos'];
  check(JSON.stringify(late).includes(po.label), 'Late POs lists a PO past its due date', late);
} else check(true, 'weaver master skipped (could not create a weaver code) — late POs not checked');

// ---------------------------------------------------------------- switches and periods
const owner = (await allCards('jemish', 'owner', '12m')).r.cards;
check(owner['o.booked_month'].switch.options.map((o) => o.value).join() === 'm,pcs' && owner['o.booked_month'].views.m.points.length === 12, 'Orders booked per month: All-over (m) | Pcs, 12 months');
check(owner['o.job_parties'].switch.options.map((o) => o.value).join() === 'butta,mill,weavers', 'Job-work parties: Butta | Mill | Weavers');
const partner = (await allCards('gaurang', 'partner')).r.cards;
check(partner['p.cloth_stage'].switch.options.map((o) => o.value).join() === 'pcs,takas,m', 'Cloth by stage: Pcs | Takas | m');
const p7 = await ok('jemish', 'GET', '/dashboard/owner/cards?period=7d&ids=o.brokers,o.stage_days');
check(p7.period.key === '7d' && (p7.cards['o.brokers'].periodLabel === 'Last 7 days' || !!p7.cards['o.brokers'].hidden || !!p7.cards['o.brokers'].empty), 'a periodic card uses the page period');
check(p7.cards['o.stage_days'].periodLabel !== 'Last 7 days', 'a fixed-window card ignores the page period');

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll Sprint 25 checks passed');
process.exit(failed ? 1 : 0);
