# Rivoora Textile — Sprint 25 — Insight dashboards (owner, partner, supervisor) with client-arranged layout

Prepared 06-11-2026 from the client's confirmed changes (CR-01 … CR-25, `Rivoora-Client-Change-Requests-3-4-Nov-2026`) and his answers of 06-11-2026. Sprints 21 → 25 must be built **in order**; this file is Sprint 25.

## 0. Read this first (rules for this sprint)

You are working on the live Rivoora Textile app (npm workspaces: `shared/`, `server/`, `client/`; Express + Drizzle + Turso; React 18 + Vite + Tailwind + Radix + TanStack Query). The client uses it every day.

**Safety (never break these)**
- The database is the **live Turso DB**. Migrations must be **additive only**: new tables, new nullable columns or columns with a default, new indexes. No dropping, renaming or retyping columns; no rewriting existing rows except a documented backfill.
- **Before running any migration against Turso, stop and tell me.** Remind me to export a backup first, and wait for my "go".
- Never run seed / wipe / reset scripts against Turso. Never put the Turso URL or token in code, the client, a commit, a log or a zip. Never commit `.env` files.
- Never `git init` and never force-push. Work on a branch `sprint-25` and commit after every phase with a clear message.
- **Existing behaviour must keep working** unless this prompt changes it on purpose. When you change a rule, change it in one place (shared helpers / `roles.ts` / `statuses.ts`), not by copying code.
- Server is the source of truth: every rule below is checked on the server (permissions with `requirePermission`, conditional updates inside one transaction, the hold / close guard in `middleware/hold-guard.ts`). The client only mirrors the rules to hide buttons and show messages.

**How to work**
1. Read `CLAUDE.md` (all sprint sections) and `PROJECT_STATE.md`, then the files named in each section of this prompt, **before planning**.
2. Write the plan to `docs/plans/sprint-25-plan.md`: phases, migrations (SQL shown), files touched, new endpoints, UI per breakpoint, tests, and a list of anything in this prompt that clashes with the code or is unclear. **Stop and wait for my approval of the plan.**
3. Build **one phase at a time**. At the end of each phase: `npm run typecheck`, `npm test`, `npm run build` all green, a short report (what changed, how to test it by hand), then commit. Don't start the next phase until I say so.
4. At the end: update `CLAUDE.md` (new "Sprint 25" section that supersedes older notes where they differ), `PROJECT_STATE.md`, `docs/flows/*` (role matrix, flow inventory), and add `scripts/check-sprint-25.mjs` (an API smoke script like the earlier ones, run against a local DB only).

**UI rules (every screen in this prompt)**
- Breakpoints as in `CLAUDE.md`: phone < 768, **tablet 768–1023**, desktop ≥ 1024. Nothing may overflow at 360 px.
- **Tablet is designed on its own, not as a stretched phone or a squeezed desktop.** On tablet:
  - forms use 2 columns (3 for short numeric fields); never one field per row;
  - lists are 2-column card grids (or a table when the desktop is a table and it fits);
  - touch targets ≥ 44 px (48 px on floor screens: supervisor, taka entry, yarn floor, godown);
  - bottom bar / icon rail as today; sticky action bar at the bottom of long forms.
- Desktop: tables or 3–5 column grids as the module already does, side panels (right drawer) for details where the module already uses them, keyboard-friendly forms (Enter → next field).
- Phone: single column, cards, bottom sheets for short dialogs, full-screen forms.
- Reuse the design system in `client/src/components/ui/*` (`Select`, `Segmented`, `Modal` / `ResponsiveModal`, `ConfirmDialog`, `StatusBadge`, date picker, `LoadMore`). Same colours, spacing and type as today. Every new dialog that asks for a **reason** uses the same component (a required textarea, min 3 characters, max 300).
- Every write shows a toast on success and an inline / field error on failure. Every destructive or "undo" action has a `ConfirmDialog` that says exactly what will happen.
- Taka entry and QC screens stay bilingual (`<Bi en hi />` / `bi()`); all other screens English.
- Lists: TanStack Query hooks in `features/*/api.ts`, invalidate only the affected keys; debounced search; filters in the URL where the module already does that.

**Words**: the client says "Jenish" (role key `jemish`), "Gaurang" (`gaurang`), "Supervisor" (production supervisor, `supervisor`), "Taka entry" (`taka_entry`), "QC" (`qc`), "Godown supervisor" (`godown_supervisor`), "Dhruvil" (`dhruvil`), "Yarn inventory supervisor" (`yarn_supervisor`).

---

## 1. What this sprint covers

Insight dashboards for three roles (C12) with a client-arranged layout (C11):
- **Owner dashboard** (Jenish),
- **Production partner dashboard** (Gaurang),
- **Supervisor dashboard**.

Depends on Sprints 21–24 (alerts, FY numbering, yarn). The three mockup PDFs `1-owner-jenish.pdf`, `2-partner-gaurang.pdf`, `3-supervisor.pdf` (I will put them in `docs/dashboards/`) were made only to **agree the list of cards with the client**. **Do not copy their look.** Use them only to understand what a card is about. The UI is designed fresh in §2A below — elegant, calm and useful — with **desktop and tablet designed separately**. This prompt decides which cards are built and how. Cards marked "not considered" must **not** be built.

---

## 2A. Dashboard UI design (new — do not copy the mockups)

Aim: a dashboard the owners open every morning and understand in 10 seconds. It should be **calm, elegant and useful**: few colours, lots of white space, big clear numbers, and every card answering one question. It must look like it belongs to the Rivoora app (same fonts, the maroon brand colour, same radius and shadows as `client/src/components/ui`) and be visibly more polished than the rest of the app.

### Visual language
- **Background:** the app's light neutral. **Cards:** white, radius as the design system (`rounded-xl`), 1 px hairline border, no heavy shadows (a soft shadow on hover only, desktop).
- **Type scale:** card title 13–14 px semibold; the main figure 28–32 px (desktop) / 26–28 px (tablet), tabular numbers; supporting text 12 px muted; never more than 3 text sizes in one card.
- **Colour:** neutral greys for everything; **one accent per card**:
  - the brand maroon for the main series;
  - status colours only for meaning — red = needs action, amber = watch, green = fine;
  - never a rainbow. Category charts use one hue in shades (maroon 100 → 700), with the selected / top item darkest.
- **Numbers:** always with unit and period ("1,240 pcs · last 30 days", "₹ 4.8 L", "860.50 m"). Indian number format (lakh / crore) for ₹ and big quantities. Changes as "▲ 12 % vs last month" in green / red, small.
- **Charts:** hand-made SVG, minimal:
  - no gridlines except a faint baseline;
  - no 3-D, no legends when a direct label fits;
  - bars with rounded tops;
  - lines 2 px with an end dot and its value;
  - donuts only for 2–5 parts, with the total in the centre;
  - sparkline next to a figure where a trend helps.

  Hover (desktop) / tap (tablet) shows a small tooltip with the exact value.
- **Badges:** small pill at the card's top-right ("3 overdue", "Fine").
- **Icons:** the app's icon set, one small muted icon per card title at most.

### Card anatomy (one component, `InsightCard`, with variants)
1. Header row: title · optional period chip · optional status badge · ⋯ menu ("Open list", "Change period", in Arrange mode: hide / wide).
2. Answer line: one muted sentence ("Orders booked this month vs the last 12 months").
3. Body by variant:
   - **Figure**: big number, unit, change vs previous period, optional sparkline;
   - **Chart**: bar / line / donut;
   - **Ranked list**: top 5 rows with a thin inline bar, name, value; "+ 12 more →";
   - **Table**: max 6 rows, compact;
   - **Split figure**: two or three figures side by side (e.g. "Fresh 1,240 pcs | Damaged 86 pcs").
4. Footer (optional): "Open list →" link.

States:
- loading = skeleton shapes of the same layout;
- empty = a friendly line ("No damage this week") with a muted icon, never a blank box;
- error = small inline retry.

Switches inside a card (Pcs | All-over m, Butta | Mill | Weavers, Pcs | Takas) use a compact `Segmented` in the header row.

### Page structure (all three dashboards)
- **Top bar:** dashboard name, a short greeting line with today's date, the global **period selector** (7 d · 30 d · 3 m · 6 m · 12 m · This FY; cards without a period ignore it), a refresh button with "updated 2 min ago", **Arrange** (Jenish / Gaurang), and for Jenish / Gaurang the switch between the three dashboards.
- **"Today" strip** first: 4–6 key figures in small figure cards (owner: open orders, in production, ready, dispatched today, needs attention; partner: on loom, waiting jobsheets, QC backlog, outside open, TFO running; supervisor: looms running / idle, started / completed today, damage today).
- **Needs attention** (where the dashboard has it) directly under the strip, styled as a soft red / amber panel listing the alert rows with links — the most useful thing on the page.
- Then the **sections**, each with a small section header (title + one muted line) and its cards.

### Desktop (≥ 1024 px) — designed for a 1440 px screen
- Content max width 1440 px, centred; 24 px gutters.
- **12-column grid.** Card widths: small = 3 cols, normal = 4 cols, wide = 6 cols, full = 12 cols. "Today" strip = one row of equal small cards.
- Section header on the left above its row; a section is one or two rows of cards with equal heights per row.
- Right-side **detail drawer**: tapping a figure first opens a drawer with the short filtered list (top 20 rows) and "Open full list →"; it doesn't leave the dashboard. Esc closes.
- Keyboard: arrow keys move focus between cards in Arrange mode; Tab order follows the visual order.
- Charts get their full detail here (axis labels, 12 bars, direct value labels).

### Tablet (768–1023 px) — designed separately, for portrait 820 px and landscape 1180 px use
- Not a shrunk desktop.
  - **Portrait (768–1023 px): a 2-column grid** (small and normal cards = 1 column, wide / full = 2 columns).
  - **Landscape tablets (1024–1279 px with a touch screen, `pointer: coarse` — e.g. 1180 px): a 3-column grid with the tablet interactions below**, not the desktop grid.
  - Add a `useIsTabletLayout()` hook for this rule and use it only for the dashboards.
- **Section tabs** instead of one long scroll: a sticky horizontal tab bar of section names under the top bar (swipeable), so a section fits on one or two screens; the "Today" strip and Needs attention stay at the top of the first tab ("Overview").
- Touch: card tap targets ≥ 48 px; switches as large `Segmented`; tooltips open on tap and close on tap outside.
- Tapping a figure opens a **bottom sheet** (half height, draggable to full) with the filtered list instead of a side drawer.
- Charts simplified: max 6 bars (last 6 months by default, swipe for more), larger value labels, fewer axis labels.
- Arrange mode: large drag handles + ↑ ↓ buttons on each card, "Done" in a sticky bottom bar.
- Pull-to-refresh on the page.

### Phone (< 768 px)
Usable, not specially designed: one column, the "Today" strip as a 2 × 3 grid, section tabs as on tablet, cards full width, lists in bottom sheets. No Arrange mode on phone.

### Quality bar (I will check these)
- Nothing on a card that doesn't help answer its question; max ~5 data points visible without interaction.
- Every figure has a unit and a period; every colour has a meaning.
- Equal card heights per row; consistent padding (16 px tablet, 20 px desktop); aligned baselines of figures across a row.
- Smooth: skeleton → content without layout jump; transitions ≤ 200 ms; no spinners on the whole page.
- Contrast WCAG AA for text and chart labels.

---

## 2. Common rules (every card)

- Every card: title, a one-line "what this answers", the figure / chart, a period chip where useful (7 d · 30 d · 3 m · 6 m · 12 m · FY), and a status badge (red / amber / green) where a threshold exists.
- **Tap a figure → the filtered list** it came from (orders list with filters in the URL, alerts page, inventory, yarn stock …). Never a dead end.
- Data comes from new read-only endpoints `GET /dashboard/<role>/cards?ids=` → one batch per screen, computed on request (no stored aggregates). Each card's maths is a **pure shared function** in `shared/src/insights/*.ts` with tests. Use only data the app already has; cards that need new data say so below.
- Respect permissions: no rates / ₹ for roles without `canSeeRate`, no client names for the supervisor.
- Charts: one small, dependency-light chart library already in the client if there is one; otherwise hand-made SVG (bars, lines, donut) — no heavy chart packages. Pcs and metres are **never added together**: where a card shows quantity, it has a **Pcs | All-over (m)** switch or two figures.
- ±10 % rule (Gaurang + Supervisor cards marked so): an item is listed only when the difference is **more than 10 % either way**.

### C11 · Dynamic layout ("client decides what is displayed where")
- Each dashboard is a set of **sections**, each with **cards**. Jenish and Gaurang (`canArrangeDashboards`) can open **Arrange** on any of the three dashboards: show / hide a card, move it up / down (and across sections), make it wide / normal, rename a section. Saved per dashboard (applies to everyone with that dashboard) in `dashboard_layouts` (dashboard key, JSON layout, updated by / at). **Reset to default** restores the order in this prompt.
- Arrange mode on tablet: big drag handles + ↑ ↓ buttons (drag must not be the only way); desktop: drag and drop; phone: ↑ ↓ buttons only.
- Layout: follow §2A (desktop and tablet grids are different designs, not one grid that reflows).

### Where the dashboards open
- Jenish: a **Dashboard** nav item (first item) → Owner dashboard. Gaurang: **Dashboard** → Production partner dashboard. Supervisor: **Dashboard** tab next to Jobsheets. Jenish and Gaurang can switch to view the other two dashboards (a `Segmented` at the top).
- Landing pages stay as today (Orders / Jobsheets); the dashboard is one tap away.

---

## 3. Owner dashboard (Jenish)

| Section | Card | What it shows / how | Tap → |
|---|---|---|---|
| Business pulse | Business at a glance | open orders (count, pcs, m), in production, ready, dispatched this month, value booked this month (₹) | orders list |
| | **Orders booked per month** | bars per month (12 m); **dropdown All-over (meters) \| Pcs** — quantity in the chosen unit, count on hover | orders of that month |
| | Order value booked | ₹ per month (12 m), this month vs last | orders |
| | Where the open orders are right now | open orders by status (stacked bar / list with counts) | orders by status |
| Clients | How much depends on the top 3 | share of booked value (6 m) from the top 3 clients, % with badge (> 50 % amber) | top 3 clients' orders |
| | Clients gone quiet | clients whose usual order gap (median of last 5 gaps) is passed by > 50 %, with last order date | that client's orders |
| Brokers & designs | Business by broker | value / qty per broker (period chip) | orders of broker |
| | Designs that sell again | designs ordered ≥ 2 times in 12 m, count + last order | orders of design |
| | Quality demand | qty per quality (period), pcs / m switch | orders of quality |
| Speed | Days from order to dispatch | median and 90th percentile days (orders dispatched in period) | dispatched orders |
| | Where the days go | average days per stage (jobsheet pending → production → butta → mill → godown → dispatch) from status history / taka events | — |
| | Oldest open orders | top 10 open orders by age with stage | order |
| | On-time delivery | % dispatched on or before the **promised date** — **needs a new optional field "Promised date" on the order** (add it to Add / Edit order); orders without it are left out | late orders |
| Quality & damage | Damage % of pcs | damaged pcs ÷ entered pcs (period), trend | damages |
| | Damage by type | machine / butta / mill / supervisor / weaver (donut) | damages of type |
| | Damage money at stake | open damaged pcs × order rate (₹) | damaged stock |
| | Top damage reasons | top 5 damage names | damages by name |
| | Designs with most damage | top 5 designs by damage % (min 50 pcs) | design damages |
| Returns & rework | Goods returned by month | pcs / m returned per month (old DC returns + new party GRs) | GR list |
| | Returns by client | returned qty and % of dispatched per client | that client's GRs |
| | Work done twice | takas sent back (re-butta / refinish) per month, % of takas | rework list |
| Stock | Stock at a glance | free stock fresh / damaged (pcs and m), value at last order rate (₹) | inventory |
| | Dead stock | free stock with no movement for 60+ days and no open order of that design | inventory filtered |
| | Stock that matches an open order | **TO CONFIRM by the client — build behind a hidden flag, off by default**: free stock whose design has an open order still needing qty | — |
| Vendors | **Job-work parties** (one card) | **dropdown Butta cutting \| Mill \| Outside weavers**: per party — takas / pcs out now, average days out, damage %, overdue count | party's challans / POs |
| | Challans out for too long | challans past the overdue limits (butta 3 d, mill 8 d), oldest first | challan |
| | Our goods lying outside | total takas / pcs / m at all parties now, by party | — |
| Looms & yarn | Loom utilisation | running hours ÷ available hours per loom (period) — **needs a setting "working hours per day"** (Settings, default 24 h) | machine view |
| | Frames woven per month | frames (pcs ÷ sections and loom m) per month | jobsheets |
| | Yarn bought vs used | kg received vs kg issued to TFO / warping / withdrawn per month | yarn movements |
| | Looms idle the most | top 5 looms by idle hours this month | machine |
| Attention & team | Needs your attention now | count + list: overdue alerts (Sprint 21), orders sent short, held orders > 7 d, damages open > 15 d, jobsheets sent > 24 h not started | alerts page |
| | Team activity today | per user: actions today (takas entered, QC done, challans, dispatches) | — |
| | Dispatch expected next 4 weeks | ready + in-godown qty by week (estimated from stage) | orders |
| | Today in numbers | today: orders booked, frames completed, takas entered, QC done, dispatched pcs / m | — |

**Not considered (do not build):** Top clients (6 months) · New vs repeat clients · Order mix · Orders sent short as a card (it is an **alert** instead) · How old is the stock · Damaged stock by type · Yarn rate trend · separate Butta / Mill / Weaver party cards (merged into Job-work parties).

---

## 4. Production partner dashboard (Gaurang)

| Section | Card | What it shows / how |
|---|---|---|
| Planning | Planning queue | orders Jobsheet pending / jobsheet created, oldest first, with qty |
| | Orders waiting for jobsheets | Jobsheet pending orders with days waiting |
| | **Jobsheets don't cover the order** | orders whose jobsheet frames / loom m (incl. outside POs) differ from the need by **more than ±10 %** |
| | Sent but not started | jobsheets Sent > 24 h, not started |
| Floor | Started & completed today | jobsheets started / completed today, by loom |
| Reliability | Machine damage per 100 frames | per loom (30 d), red above the factory average + 50 % |
| | **Completed short** | completed jobsheets whose taka-based frames / m differ from assigned by **more than ±10 %** |
| After the loom | **Cloth by stage right now** | qty per stage (at butta, butta QC, waiting mill, at mill, mill QC, godown, ready) with a **dropdown Pcs \| Takas** (and m for meter orders) |
| | QC backlog by age | takas waiting for Butta / Mill QC by age bucket (0–1 d, 2–3 d, > 3 d) |
| | Rework & refinish open | takas in re-butta / refinish now, by age |
| | Waiting to be sent out | takas waiting for butta / mill, by order |
| Outside & FG | Outside work this month | POs created / received qty this month |
| | Outside POs by weaver | open qty per weaver |
| | Late POs | POs past their due date |
| | Weaver quality | damage % per weaver (90 d) |
| | FG purchase awaiting goods | FG POs not fully received |
| Yarn | TFO machines | sections running / on hold / idle now |
| | Beams ready vs needed | beams in stock by warping quality vs jobsheets pending / sent (count) — beams are not linked to jobsheets, so this is a side-by-side count, not a match |
| | Low yarn | qualities whose available kg (stock − reserved) is below a per-quality minimum — **needs an optional "minimum kg" on yarn qualities** (add the field) |

**Not considered:** In-house vs outside (this month) · All looms right now · Frames per working day · Slowest looms (hours per frame) · Free in the next 24 hours · Machine changes per loom (30 days) · Pcs mismatch at taka entry · Idle hours lost this week · Orders stuck longest after the loom · Yarn stock by zone.

---

## 5. Supervisor dashboard

| Section | Card | What it shows |
|---|---|---|
| Floor today | Today on the floor | looms running / idle, jobsheets on loom, started / completed today |
| | Damage from my looms today | machine damage pcs today by loom |
| Performance | **Completed short** | his completed jobsheets differing by more than ±10 % (taka-based) |
| Priority | Orders waiting longest | sent jobsheets by waiting time (order number only, no client) |
| | On hold — don't start | held orders that have sent jobsheets |
| | Damage from looms this week | machine damage pcs per loom (7 d) |
| | Lined up per loom | sent jobsheets assigned per loom (count, frames) |
| Yarn | Beams ready | beams in stock by warping quality |
| | TFO machines | running / on hold / idle sections |
| | Warping in process | warping jobs in process + pending |
| | Yarn coming | yarn PO qty pending by quality (no rates) |

**Not considered:** Start these first · Empty looms · Finishing soon · Frames: today vs normal · Hours per frame · Machine changed this week · Best looms this week · Pcs mismatch · Beams used this week.

---

## 6. New data fields this sprint adds (additive)
- `orders.promised_date` (optional) — Add / Edit order, Order details; used by On-time delivery.
- Setting `working_hours_per_day` (Settings, default 24) — Loom utilisation.
- `yarn_qualities.min_kg` (optional) — Low yarn.
- `dashboard_layouts` table — C11.

## 7. Phases (suggested)
0. **Design first** (before any data work): build the dashboard shell, the card component in all its variants, the section headers, the filter bar and Arrange mode with sample data, for desktop and tablet separately. Send me screenshots (desktop 1440 + tablet 820 portrait + 1180 landscape) and wait for approval. A. Infrastructure: endpoints pattern, shared insight functions, card component, layout + Arrange (C11), nav. B. Owner dashboard. C. Production partner dashboard. D. Supervisor dashboard. E. Performance pass (each dashboard loads in < 1.5 s on the live DB size; add indexes if needed — additive) + docs.

## 8. Acceptance checklist
1. Each dashboard shows exactly the considered cards in the order above; no not-considered card exists.
2. Every figure taps through to a correctly filtered list.
3. Orders booked per month switches All-over (m) / Pcs; Job-work parties switches Butta / Mill / Weavers; Cloth by stage switches Pcs / Takas.
4. ±10 % cards list only items beyond 10 %.
5. Jenish rearranges / hides cards on a dashboard; everyone sees the new layout; Reset restores the default.
6. Rates and clients hidden where the role can't see them.
7. Desktop (1280 / 1440 / 1920 px) and tablet (820 portrait / 1180 landscape) each match their own §2A layout; phone (360 px) is usable; screenshots of every dashboard at those widths attached to the final report.
8. The UI passes the §2A quality bar: one accent per card, no clutter, every number labelled with its unit and period, loading skeletons and empty states present.
