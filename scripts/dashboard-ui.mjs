#!/usr/bin/env node
/**
 * Sprint 26 — dashboard UI review / visual check on the DEMO app, in the installed Chrome (playwright-core, channel
 * "chrome" — no browser download).
 *
 *   npm run test:dashboard-ui              → the check: 6 sizes × 3 dashboards; fails on horizontal scroll, anything
 *                                             overflowing its card, console errors, the wrong layout (tablet at 1180
 *                                             touch, desktop at 1280); screenshots → docs/screenshots/sprint-26/after/
 *   node scripts/dashboard-ui.mjs --review → every size of the spec (incl. 1280 at 125 % and 390 phone), every section,
 *                                             a drawer / sheet, Arrange; screenshots → …/before/ + metrics JSON
 *
 * It uses a running demo app (BASE_URL, default http://localhost:5180) or starts `npm run demo:dev` itself, and refuses
 * to run unless /api/health says the server is on the demo database.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REVIEW = process.argv.includes('--review');
const BASE = process.env.BASE_URL ?? 'http://localhost:5180';
const OUT = join(ROOT, 'docs', 'screenshots', 'sprint-26', process.argv.find((a) => a.startsWith('--dir='))?.slice(6) ?? (REVIEW ? 'before' : 'after'));
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);

const SIZES = [
  { key: '1920', w: 1920, h: 1080, touch: false, expect: 'desktop' },
  { key: '1440', w: 1440, h: 900, touch: false, expect: 'desktop' },
  { key: '1280', w: 1280, h: 720, touch: false, expect: 'desktop' },
  ...(REVIEW ? [{ key: '1280z125', w: 1024, h: 576, dpr: 1.25, touch: false, expect: 'desktop' }] : []),
  { key: '1180t', w: 1180, h: 820, touch: true, expect: 'tablet' },
  { key: '820t', w: 820, h: 1180, touch: true, expect: 'tablet' },
  { key: '768t', w: 768, h: 1024, touch: true, expect: 'tablet' },
  ...(REVIEW ? [{ key: '390', w: 390, h: 844, touch: true, expect: 'phone' }] : []),
];
const WHO = [
  { dashboard: 'owner', phone: '9999999999' },
  { dashboard: 'partner', phone: '8888888888' },
  { dashboard: 'supervisor', phone: '7777777777' },
];
const password = (phone) => `Rivoora@${phone.slice(0, 3)}`;

async function health() {
  try {
    const r = await fetch(`${BASE}/api/health`);
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

async function ensureApp() {
  let h = await health();
  let child = null;
  if (!h) {
    console.log('[ui] starting the demo app (npm run demo:dev)…');
    child = spawn('node', ['scripts/demo.mjs', 'dev'], { cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32' });
    for (let i = 0; i < 90 && !h; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      h = await health();
    }
  }
  if (!h) throw new Error(`the demo app did not answer at ${BASE}`);
  if (!h.demo) throw new Error(`${BASE} is NOT running on the demo database — refusing to look at live data`);
  return child;
}

/** Everything measured on the current screen (runs in the page). */
function measure() {
  const vw = window.innerWidth;
  const out = { hscroll: document.documentElement.scrollWidth > vw + 1, mode: document.querySelector('[data-dashboard-mode]')?.getAttribute('data-dashboard-mode') ?? (document.querySelector('nav[aria-label="Sections"]') ? 'tablet' : 'desktop'), overflow: [], cut: [], unequal: [], holes: [], baseline: [], small: [], scrollers: [] };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const cards = [...document.querySelectorAll('main article')].filter(visible);
  for (const card of cards) {
    const cr = card.getBoundingClientRect();
    const name = card.getAttribute('aria-label');
    for (const el of card.querySelectorAll('*')) {
      if (!visible(el)) continue;
      // inside a horizontal scroller the content may be wider (it scrolls) — reported separately
      let p = el.parentElement;
      let clipped = false;
      while (p && p !== card) {
        const s = getComputedStyle(p);
        if (s.overflowX !== 'visible') clipped = true;
        p = p.parentElement;
      }
      const r = el.getBoundingClientRect();
      if (!clipped && (r.right > cr.right + 1.5 || r.left < cr.left - 1.5)) out.overflow.push(`${name}: <${el.tagName.toLowerCase()}> ${(el.textContent ?? '').trim().slice(0, 40)}`);
      const s = getComputedStyle(el);
      if (s.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1 && el.children.length === 0) out.cut.push(`${name}: "${(el.textContent ?? '').trim().slice(0, 50)}"`);
      if ((s.overflowX === 'auto' || s.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1) out.scrollers.push(`${name}: scrolls sideways (${el.scrollWidth} > ${el.clientWidth})`);
    }
  }
  // rows of each grid: equal heights, holes, figure baselines
  for (const grid of [...document.querySelectorAll('main section > div.grid')].filter(visible)) {
    const gr = grid.getBoundingClientRect();
    const items = [...grid.children].filter(visible).map((el) => ({ el, r: el.getBoundingClientRect() }));
    const rows = new Map();
    for (const it of items) {
      const k = Math.round(it.r.top / 4);
      rows.set(k, [...(rows.get(k) ?? []), it]);
    }
    const list = [...rows.values()];
    const section = grid.closest('section')?.getAttribute('aria-label');
    list.forEach((row, i) => {
      const hs = row.map((x) => x.r.height);
      if (Math.max(...hs) - Math.min(...hs) > 2) out.unequal.push(`${section}: row ${i + 1} heights ${hs.map(Math.round).join(' / ')}`);
      const used = row.reduce((s, x) => s + x.r.width, 0);
      const free = gr.width - used - (row.length - 1) * parseFloat(getComputedStyle(grid).columnGap || '0');
      if (free > 40 && list.length > 1) out.holes.push(`${section}: row ${i + 1} leaves ${Math.round(free)} px empty`);
      const tops = row.map((x) => x.el.querySelector(':scope > div.flex-1')?.getBoundingClientRect().top ?? null).filter((t) => t !== null);
      if (tops.length > 1 && Math.max(...tops) - Math.min(...tops) > 6) out.baseline.push(`${section}: row ${i + 1} figures start at ${tops.map((t) => Math.round(t - Math.min(...tops))).join(' / ')} px`);
    });
  }
  if (matchMedia('(pointer: coarse)').matches)
    for (const b of [...document.querySelectorAll('main button, main a, main [role="tab"]')].filter(visible)) {
      const r = b.getBoundingClientRect();
      if (r.height < 44 || r.width < 44) out.small.push(`${(b.getAttribute('aria-label') ?? b.textContent ?? '').trim().slice(0, 40)} ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
  const pc = document.querySelector('main > div');
  out.contentWidth = pc ? Math.round(pc.getBoundingClientRect().width) : null;
  return out;
}

async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForFunction(() => !document.querySelector('main [aria-busy="true"], main .animate-pulse'), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(300);
}

const results = [];
const failures = [];
const child = await ensureApp();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
mkdirSync(OUT, { recursive: true });
try {
  for (const who of WHO) {
    if (only && !only.split(',').includes(who.dashboard)) continue;
    for (const size of SIZES) {
      const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: size.dpr ?? 1, hasTouch: size.touch, isMobile: size.touch, colorScheme: 'light' });
      const login = await ctx.request.post(`${BASE}/api/auth/login`, { data: { phone: who.phone, password: password(who.phone) } });
      if (!login.ok()) throw new Error(`login failed for ${who.dashboard}: ${login.status()}`);
      const page = await ctx.newPage();
      const errors = [];
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      page.on('pageerror', (e) => errors.push(String(e)));
      // A full-page capture would briefly drop the touch emulation (the page re-renders in the desktop layout), so the
      // viewport is made as tall as the page instead, then put back.
      const shot = async (part, opts = {}) => {
        const file = `${who.dashboard}-${size.key}-${part}.png`;
        if (opts.fullPage) {
          const h = await page.evaluate(() => document.documentElement.scrollHeight);
          await page.setViewportSize({ width: size.w, height: Math.min(h, 16000) });
          await page.waitForTimeout(250);
          await page.screenshot({ path: join(OUT, file) });
          await page.setViewportSize({ width: size.w, height: size.h });
          await page.waitForTimeout(150);
        } else await page.screenshot({ path: join(OUT, file), ...opts });
        return file;
      };
      await page.goto(`${BASE}/dashboard/${who.dashboard}`);
      await settle(page);
      const shots = [await shot('top')];
      const m = await page.evaluate(measure);
      const sections = [];
      const tabs = page.locator('nav[aria-label="Sections"] [role="tab"]');
      if ((await tabs.count()) > 0) {
        for (let i = 0; i < (await tabs.count()); i++) {
          const t = tabs.nth(i);
          const title = (await t.textContent())?.trim() ?? `tab${i}`;
          await t.click();
          await settle(page);
          const mm = await page.evaluate(measure);
          sections.push({ title, ...mm });
          shots.push(await shot(`tab-${i}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, { fullPage: true }));
        }
      } else {
        shots.push(await shot('full', { fullPage: true }));
        const tall = await page.evaluate(() => document.documentElement.scrollHeight);
        await page.setViewportSize({ width: size.w, height: Math.min(tall, 16000) });
        const secs = page.locator('main section[aria-label]:not([aria-label="Today"])');
        for (let i = 0; i < (await secs.count()); i++) {
          const s = secs.nth(i);
          const title = await s.getAttribute('aria-label');
          if (REVIEW) {
            const file = `${who.dashboard}-${size.key}-section-${i}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
            await s.screenshot({ path: join(OUT, file) });
            shots.push(file);
          }
        }
        await page.setViewportSize({ width: size.w, height: size.h });
      }
      // a drawer / sheet from a figure (owner: "Days from order to dispatch" → Median)
      if (who.dashboard === 'owner') {
        await page.goto(`${BASE}/dashboard/owner${(await tabs.count()) ? '?section=speed' : ''}`);
        await settle(page);
        const tap = page.locator('article[aria-label="Days from order to dispatch"] button[aria-label^="Median"]');
        if (await tap.count()) {
          await tap.first().click();
          await page.waitForSelector('[role="dialog"]', { timeout: 5000 }).catch(() => {});
          await page.waitForTimeout(400);
          shots.push(await shot('drawer'));
          await page.keyboard.press('Escape');
          await page.waitForTimeout(300);
        }
      } else if (REVIEW) {
        // no figure on this dashboard opens a drawer — show a chart tooltip instead (tap / hover a bar)
        const bar = page.locator('main article [data-bar], main article svg rect').first();
        if (await bar.count()) {
          if (size.touch) await bar.tap().catch(() => {});
          else await bar.hover().catch(() => {});
          await page.waitForTimeout(300);
          shots.push(await shot('tooltip'));
        }
      }
      // Arrange
      const arrange = page.getByRole('button', { name: 'Arrange' });
      if (REVIEW && (await arrange.count()) && (await arrange.isVisible())) {
        await page.goto(`${BASE}/dashboard/${who.dashboard}`);
        await settle(page);
        await page.getByRole('button', { name: 'Arrange' }).click();
        await page.waitForTimeout(500);
        shots.push(await shot('arrange'));
        shots.push(await shot('arrange-full', { fullPage: true }));
        await page.keyboard.press('Escape');
      }
      const row = { dashboard: who.dashboard, size: size.key, expect: size.expect, ...m, sections, errors, shots };
      results.push(row);
      const all = [m, ...sections];
      const problems = [];
      if (all.some((x) => x.hscroll)) problems.push('horizontal scroll');
      const over = [...new Set(all.flatMap((x) => x.overflow))];
      if (over.length) problems.push(`overflow: ${over.slice(0, 5).join(' | ')}`);
      if (errors.length) problems.push(`console: ${errors.slice(0, 3).join(' | ')}`);
      const modeOk = size.expect === 'phone' || (size.expect === 'tablet' ? m.mode.startsWith('tablet') : m.mode === 'desktop');
      if (!modeOk) problems.push(`layout ${m.mode}, expected ${size.expect}`);
      console.log(`${problems.length ? 'FAIL' : 'ok  '} ${who.dashboard.padEnd(10)} ${size.key.padEnd(9)} mode=${m.mode}${problems.length ? `\n      ${problems.join('\n      ')}` : ''}`);
      if (problems.length) failures.push(`${who.dashboard} ${size.key}: ${problems.join('; ')}`);
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  // the demo app this run started (on Windows the whole process tree, or the dev servers keep running)
  if (child) process.platform === 'win32' ? spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']) : child.kill();
}
writeFileSync(join(OUT, 'metrics.json'), JSON.stringify(results, null, 2));
if (REVIEW) console.log(`\n[ui] review screenshots + metrics in ${OUT}`);
else if (failures.length) {
  console.error(`\n[ui] ${failures.length} dashboard × size checks FAILED`);
  process.exit(1);
} else console.log(`\n[ui] all dashboard × size checks passed — screenshots in ${OUT}`);
process.exit(0);
