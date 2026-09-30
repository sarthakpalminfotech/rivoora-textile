# Rivoora Textile — Sprint 5: Order dashboard (order details page)

This continues the existing project. Read `CLAUDE.md` and `PROJECT_STATE.md` first. **Reuse the existing patterns and components**: `Tabs`, `StatusBadge`, `ImageThumb`/`Lightbox`, `EmptyState`, `Skeleton`, `ErrorState`, the Jobsheets card, the Takas card, the format helpers and theme tokens. The new screens must look like the rest of the app. Don't restyle or refactor other screens beyond what this document asks.

**How to work**
0. Run `git status`. If there are uncommitted changes, stop and tell me so I can commit them first.
1. Start in plan mode and show me the plan: page structure, stage config, the shared dashboard function, endpoints, and the mobile layout.
2. Build in the phases at the end. After each phase, run `npm run typecheck` and `npm test`, run the app, fix all errors, and give me a short summary.
3. At the end, update `CLAUDE.md` and `PROJECT_STATE.md`.

---

## 1. Goal

Jemish and Gaurang open an order and must understand **in one glance where the whole order stands**. Parts of one order are often at different stages at the same time: some jobsheets not yet sent, some on the loom, some already turned into takas, some takas at butta cutting.

The page works in **three levels**:
1. **Main stages** (big cards): Production → Butta cutting → Mill → Ready. They show counts only.
2. Click a main stage → its **sub-stage KPI cards** open below it, again counts only.
3. Click a sub-stage → the **details**: the actual jobsheet numbers or taka numbers in that sub-stage, each clickable.

Numbers first; numbers and details only when asked for.

This page is for **Jemish and Gaurang only** (the order details page is already restricted to them).

---

## 2. Page structure (`/orders/:id`)

From top to bottom:

1. **Order header card** (always visible, expanded; see §3)
2. **Tabs:** **Dashboard** (default) · **Jobsheets** (count) · **Takas** (count) · **Damages** (count, red when > 0) · **Order details** · **History**
3. The selected tab's content

**Tab contents:**
- **Dashboard:** the new dashboard (§4–§8).
- **Jobsheets:** the **existing Jobsheets card** moved here as-is (the actions, the send-to-supervisor selection mode, the tiles, warnings and card grid).
- **Takas:** the **existing Takas card** moved here as-is.
- **Damages:** new (§9).
- **Order details:** the existing Notes, Dates and Design cards, plus any detail fields not shown in the header.
- **History:** the existing Status history timeline.

The **Undo send for production** action stays in the header.

**URL state:** keep the selected tab, main stage and sub-stage in the URL (`?tab=dashboard&stage=production&sub=on_loom`), so going to a jobsheet and pressing Back returns to the same view.

**Phones:** tabs become a horizontally scrollable pill row, with the active pill in primary. They must never wrap or overflow the page.

---

## 3. Order header card (a little more expanded than now)

A clean white card at the top of the page:
- **Design thumbnail** (about 88px on desktop, 64px on phones), rounded.
  - **Clickable:** it opens the **full image in the existing `Lightbox`**.
  - It shows the variation image if one is set, otherwise the design image.
  - It has a visible focus state and `aria-label="View design image"`.
  - If there's no design, show a neutral placeholder that isn't clickable.
- **Order #N** (large) + status badge + the **Undo send for production** button when allowed (existing rules).
- A compact detail grid. On desktop, 4–6 columns in one or two rows; on phones, 2 columns with a **"More details"** toggle that shows the rest.
  - Client name + city
  - Phone (`tel:` link)
  - Material / quality
  - Design / variation code
  - Order quantity (with unit)
  - Jobsheet quantity (for pcs orders)
  - Order date
  - Rate (only when `canSeeRate`, as now)
- The "← Orders" back link stays above the card.

---

## 4. Dashboard: top progress bar

A full-width card directly under the tabs:
- **Left:** `114 / 304 pcs woven`, where woven pieces = actual woven frames × `SECTIONS_PER_BEAM` and 304 = the jobsheet quantity (fall back to the order quantity if there are no jobsheets).
- **Middle:** one horizontal **bar split by main stage** (Production / Butta cutting / Mill / Ready), each segment in its stage colour, with tiny legend labels under it on desktop. See §7 for how the shares are computed.
- **Right:** the % woven, and a **"N need attention"** pill (amber) when there are alerts (§8). Clicking it scrolls to the Alerts card. Hide the pill when N = 0.

---

## 5. Stage configuration (one shared config, easy to connect later)

Create `shared/src/pipeline.ts` with the **main stages**, their **sub-stages** and the **damage types**. Keep it **config-driven**, so later sprints only have to connect data instead of redesigning the page.

Each sub-stage has:
- `key`
- `label`
- `mainStage`
- `unit`: `jobsheets` or `takas`
- `colour`
- `connected`: true if the data exists today, false if it will be built in a later sprint

### Main stages and sub-stages

**1. Production** (connected)

| Sub-stage key | Label | Unit | Rule (today's data) |
|---|---|---|---|
| `not_sent` | Jobsheet pending (not sent) | jobsheets | jobsheet status `pending` |
| `with_supervisor` | Waiting to start | jobsheets | status `sent` |
| `on_loom` | On loom | jobsheets | status `ongoing` |
| `taka_pending` | Taka entry pending | jobsheets | status `completed` and no active takas |
| `taka_done` | Taka entry done · waiting for butta cutting | takas | active takas whose stage is `entered` (see §6) |

**2. Butta cutting** (not connected yet)

| Sub-stage key | Label | Unit |
|---|---|---|
| `at_butta` | At butta cutting | takas |
| `butta_qc` | Back, checking (QC) | takas |
| `butta_done` | Checked · waiting for mill | takas |

**3. Mill** (not connected yet). The whole order goes to the mill together for dyeing.

| Sub-stage key | Label | Unit |
|---|---|---|
| `at_mill` | At mill (dyeing) | takas |
| `mill_qc` | Back, checking (QC) | takas |

**4. Ready** (not connected yet)

| Sub-stage key | Label | Unit |
|---|---|---|
| `ready` | Ready | takas |

### Damage types

| Key | Label | Recorded when | Connected |
|---|---|---|---|
| `machine` | Machine damage | at taka entry (exists today) | yes |
| `butta` | Butta cutting damage | a **new** damage found at the QC after butta cutting | later |
| `mill` | Mill damage | a **new** damage found at the QC after the mill | later |

**Not-connected stages** always show **0**, in a slightly muted style, with a small grey **"Coming soon"** tag. Clicking them opens an empty-state detail ("This stage will be connected when it's built"). Write a clear comment in `pipeline.ts` and a section in `CLAUDE.md` saying: **when the butta cutting / mill / ready flows are built, set `connected: true` and map the data here. The dashboard page must not need changes.**

---

## 6. Small data change: taka stage

Add a column `takas.stage` (text, NOT NULL, default `entered`), with an index, in a new migration, and backfill existing takas as `entered`.
- Today every taka is `entered`, meaning Taka entry done and waiting for butta cutting.
- Future sprints will move takas to `at_butta`, `butta_qc`, `butta_done`, `at_mill`, `mill_qc` and `ready`.
- Keep the allowed values in `pipeline.ts`.
- Nothing else writes this column in this sprint.

---

## 7. Dashboard: main stage cards → sub-stage KPIs → details

### 7.1 Main stage cards
A row of **4 cards** (Production, Butta cutting, Mill, Ready). They're connected visually as steps, e.g. a thin line or small chevrons between the cards on desktop. **Phones:** a 2×2 grid.

Each card shows:
- a **stage colour dot** and the **name**
- a **big count** with its unit:
  - Production: `11 jobsheets`
  - the other stages: `N takas`
- a **secondary line**:
  - Production: `102 frames · 9 takas made`
  - Butta cutting / Mill / Ready: `N pcs` or the "Coming soon" tag
- a small **damage count** in red if damaged takas are in that stage (e.g. `1 damaged`)

**Behaviour:**
- Clicking a card **selects** it: a primary (maroon) ring and tint, with the others normal. The sub-stage area below updates.
- **Default selection:** Production, or the earliest main stage that has active work.
- Cards are real `<button>`s with focus states.

### 7.2 Summary line + sub-stage KPI cards
Under the selected main stage, a thin **summary line** of totals for that stage. For Production:

`Total jobsheets 11 · Total frames 102 · Woven 38 frames (114 pcs) · On loom 30 frames · Takas 9`

Below it, **one KPI card per sub-stage** of the selected main stage (desktop: one row; phones: a 2-column grid). Each shows:
- the sub-stage label
- a big count
- the unit
- one short secondary fact:
  - Not sent: `12 frames`
  - Waiting to start: `20 frames · oldest 30h` (amber if over the alert limit)
  - On loom: `30 frames · 3 machines`
  - Taka entry pending: `10 frames`
  - Taka entry done: `from 3 jobsheets · 1 damaged`

Clicking one **selects it** (same ring style) and opens the detail panel. Clicking it again closes the panel.

### 7.3 Detail panel (only after clicking a sub-stage)
A card below the KPIs, titled with the sub-stage name and count. Items load from the items endpoint (§10). Show a skeleton while loading.

**Jobsheet sub-stages:** a compact list (a table on md+, cards on phones), with each row clickable → `/jobsheets/:id`:
- Jobsheet number
- frames (actual/assigned when completed)
- picks
- machine(s)
- time in this stage (e.g. "sent 30h ago" in amber if over the limit, "running 4h 10m", "woven 3h ago")
- a "continued from 319" note when relevant

**Taka sub-stages:** takas **grouped by jobsheet**: a group header "Jobsheet 323 · 8/10 frames" (clickable), then taka number chips. Damaged takas are red, with their damage type label.

**Empty states:**
- "Nothing here right now"
- for not-connected stages: "This stage will be connected when it's built"

### 7.4 Damage strip (on the Dashboard, under the stages)
Three small tiles: **Machine damage N**, **Butta cutting damage** (Coming soon), **Mill damage** (Coming soon), plus the **total**. Clicking a tile opens the **Damages** tab filtered to that type.

---

## 8. Alerts: "Needs attention"

On the Dashboard, a card **"Needs attention"** below the damage strip, listing each alert with a short action link. Hide the card when there are no alerts.

Rules (as config in `pipeline.ts`, e.g. `ALERT_RULES`, so more can be added later):
1. **Not started for 24h:** a jobsheet sent to the supervisor (`sent`) whose `sent_at` is **more than 24 hours ago** and that hasn't been started. Text: "Jobsheet 328 sent to supervisor 30h ago, not started yet". Link → the jobsheet.
   Put the limit in one constant: `ALERT_NOT_STARTED_HOURS = 24`.
2. **The existing coverage warnings** (frames short or over, jobsheet quantity less or more than the order) move here, and keep their current texts.

The count of these alerts feeds the "N need attention" pill (§4).

---

## 9. Damages tab

- **Summary tiles** at the top: one per damage type from the config (Machine / Butta cutting / Mill) with counts, plus the total. Not-connected types show 0 with "Coming soon".
- **Filter pills:** All / Machine / Butta cutting / Mill, kept in the URL (`?tab=damages&type=machine`).
- **List of damaged takas:**
  - the taka number (large)
  - the damage type badge (red)
  - the jobsheet number (link)
  - the current stage of the taka
  - the date recorded
  - the taka note, if any
- Jemish and Gaurang edit takas through the existing **Edit takas** flow (link to it). Don't add a new edit flow here.
- Empty state: "No damaged takas".

---

## 10. Shared logic and API

**Pure function** `buildOrderDashboard(input, now)` in `shared/src/orderDashboard.ts`, used by the server:
- **Input:** the order (quantity, unit, jobsheet_pieces, target_frames) + its active jobsheets (status, frames, completed_frames, sent_at, started_at, completed_at, running machine) + its active takas (stage, is_damaged, damage_type, jobsheet_id).
- **Output:**
  - main stage counts + secondary facts
  - the sub-stage counts per the config
  - Production totals (jobsheets, frames, woven frames, woven pcs, on-loom frames, takas)
  - the **bar shares** (below)
  - damage counts per type
  - alerts

**Bar shares by main stage, measured in frames:**
- a jobsheet with no takas counts fully in **Production**
- a jobsheet with takas spreads its frames (actual frames if completed) over the main stages of its takas, **in proportion to the number of takas in each stage**; takas in `entered` still count as Production
- not-connected stages get 0 today

**Vitest tests** for:
- every sub-stage rule
- the bar shares (including a jobsheet whose takas are split across stages, using fake future stages)
- the 24h alert (23h → no alert, 25h → alert)
- damage counts
- orders with no jobsheets

**Endpoints** (Jemish/Gaurang; same visibility rule as `GET /orders/:id`):

| Method | Path | Purpose |
|---|---|---|
| GET | `/orders/:id/dashboard` | The `buildOrderDashboard` output (counts only). Use one or two aggregate queries; no per-jobsheet queries. |
| GET | `/orders/:id/dashboard/items?sub=<subStageKey>` | The items for one sub-stage (jobsheet rows or taka groups, as in §7.3). Fetched only when a sub-stage is clicked, and cached by React Query. |
| GET | `/orders/:id/damages?type=` | The Damages tab list + counts |

**Refresh:**
- Dashboard data refetches on window focus and every **60 seconds**.
- Invalidate the dashboard, items and damages queries after every jobsheet or taka mutation, next to the existing invalidations.

---

## 11. Special cases

- **Pending for production** (Jemish only): the Dashboard shows the header and an `EmptyState` "Not sent for production yet", with the existing Send for production action. The stage cards are hidden.
- **Jobsheet pending with no jobsheets yet:** the stage cards show 0 and an `EmptyState` "No jobsheets yet", with **Create jobsheets** (`canManageJobsheets`, pcs orders only).
- **Non-pcs orders:** the Production card shows "Jobsheets for kg / g / meter orders — coming soon". The other stages are shown as not connected.
- **Loading:** a skeleton of the header, bar and 4 cards. **Error:** `ErrorState` with Retry, only for the dashboard area; the header still shows.

---

## 12. Quality checklist

- The page reads clearly at **360px, 768px, 1024px and 1280px**, with no horizontal overflow. On phones: a 2×2 main-stage grid, 2-column sub-stage grid, scrollable tab pills and a collapsible header.
- The **design thumbnail opens the full image**, on desktop and phones.
- Everything clickable (stage cards, sub-stage cards, rows, chips, tiles) is a real button or link with a focus state.
- Colours for the stages come from the config. Damaged items are always red and also carry a text label (not colour alone).
- Moving the existing Jobsheets and Takas cards into tabs doesn't change their behaviour (the send-to-supervisor selection mode, edits and prints still work).
- The `connected: false` stages are documented in `CLAUDE.md` as "to connect later".

## 13. Build phases

1. **Migration + config:** `takas.stage`, `pipeline.ts` (stages, sub-stages, damage types, alert rules, constants).
2. **Shared `buildOrderDashboard` + tests.**
3. **Endpoints:** dashboard, items and damages.
4. **Page restructure:** the expanded header with the clickable design thumbnail, the tabs with URL state, and moving the existing cards into the Jobsheets, Takas, Order details and History tabs.
5. **Dashboard tab:** the progress bar, main stage cards, summary line, sub-stage KPIs, detail panel, damage strip and alerts.
6. **Damages tab.**
7. **Polish:** test every case as Jemish and Gaurang at all breakpoints, and update `CLAUDE.md` and `PROJECT_STATE.md`.
