# Rivoora Textile — Order Management (CLAUDE.md)

Guide for future development sessions. Keep this file updated when architecture, conventions or setup change.

## What this is

Order management + tracking for Rivoora Textile (saree / cloth power-loom maker). Sprint 1 = orders, order tracking
(Pending → Ready for production), and the masters orders depend on (Customers, Materials, Designs + variations).
Sprint 2 = Machine Master + jobsheets (printed loom instructions) for `pcs` orders, with the status Jobsheet created.
Sprint 3 = Supervisor role (tablet-first Jobsheets module: start / complete / change machine), sending jobsheets to the
supervisor, jobsheet statuses, order status driven by the jobsheets (In production → Production completed), Machine view.
Sprint 4 = Taka entry role (bilingual English + Hindi, phone-first): QR code on printed jobsheets, Scan jobsheet, taka
entry (auto-completes the jobsheet), Taka jobsheets list, takas on order / jobsheet details with edit, status Taka entry done.
Sprint 5 = Order dashboard: the order details page becomes header + tabs (Dashboard · Jobsheets · Takas · Damages · Order
details · History); a config-driven pipeline (Production → Butta cutting → Mill → Ready), `takas.stage`, Damages tab, alerts.
Specs: `rivoora-claude-code-prompt.md` (sprint 1), `rivoora-sprint2-jobsheets-prompt.md` (sprint 2),
`rivoora-sprint3-supervisor-prompt.md` (sprint 3), `rivoora-sprint4-taka-entry-prompt.md` (sprint 4),
`rivoora-sprint5-order-dashboard-prompt.md` (sprint 5).

## Monorepo layout (npm workspaces)

```
shared/   @rivoora/shared — TS source used by BOTH client and server (no build step)
  src/roles.ts      role config + permissions (single source of truth)
  src/statuses.ts   order + jobsheet status config, orderStatusForJobsheets(), jobsheetStatusLabel()
  src/units.ts      kg | pcs | g | meters
  src/codes.ts      normalizeCode(); variationCode() is only a placeholder suggestion (D101 → D101N1)
  src/production.ts SECTIONS_PER_BEAM = 3 (never hardcode 3 anywhere else)
  src/jobsheets.ts  ALL jobsheet maths (pure): planJobsheets, planFramesEdit (auto-adjust), coverage, change-machine helpers
  src/takas.ts      taka validation (digits, duplicates within ONE jobsheet), takaSummary(), QR url build/parse
  src/pipeline.ts   order pipeline config: MAIN_STAGES, SUB_STAGES, TAKA_STAGES, DAMAGE_TYPE_CONFIG, ALERT_RULES (see "Order dashboard")
  src/orderDashboard.ts  buildOrderDashboard(input, now) — pure; ALL dashboard counts / bar shares / alerts
  src/*.test.ts     vitest — `npm test` (jobsheets.test.ts, takas.test.ts, orderDashboard.test.ts)
  src/schemas.ts    zod request schemas (server validates with these)
  src/types.ts      API DTO types
server/   Express + Drizzle + Turso (libSQL)
  src/env.ts            loads server/.env, fails clearly if TURSO_* missing
  src/db/client.ts      the ONE shared db client
  src/db/schema.ts      Drizzle schema → `npm run db:generate` → server/drizzle/*.sql (committed)
  src/db/migrate.ts     applies migrations      src/db/seed.ts + patterns.ts   demo data + SVG patterns
  src/routes/*          thin Express routers    src/services/*   all SQL / business rules
                        (services/takas.ts: enter / edit / order takas / Taka list; taka-shared.ts avoids an import cycle;
                        services/dashboard.ts: order dashboard, sub-stage items, damages)
  src/middleware/role.ts  X-Role header → req.role; requirePermission(...)
  src/middleware/error.ts consistent `{ error: { message, field? } }`
  src/storage/*         image storage driver (local disk now; swap for R2/S3 in storage/index.ts)
  uploads/              uploaded images (gitignored, except uploads/demo/ seed images)
client/   Vite + React 18 + TS + Tailwind + Radix (shadcn-style components written in-repo)
  src/components/ui/*      design system (select.tsx = THE standard dropdown, modal.tsx, date-picker, …)
  src/components/layout/*  sidebar / tablet rail / mobile bottom nav, top bar, profile menu (role switch)
  src/features/orders/*    list + selection mode, filters, add order, saved-designs drawer, details page (header + tabs)
  src/features/orders/dashboard/*  order-header, dashboard-tab, damages-tab, view-state (URL tab/stage/sub/type), api
  src/features/masters/*   customers, materials, designs, machines (+ generic master-list scaffold)
  src/features/jobsheets/* order Jobsheets section (+ send selection), forms, details page, print route,
                           supervisor module (supervisor-jobsheets-page, run-dialogs, activity)
  src/features/machine-view/* the machine floor board
  src/features/takas/*     Taka entry role: scan-page (qr-scanner), jobsheet-qr-page (/j/:no), taka-jobsheets-page,
                           taka-entry-page; takas-card (order + jobsheet Takas blocks) + edit-takas-dialog (Jemish/Gaurang)
  src/lib/bilingual.tsx    bi('Submit','जमा करें') + <Bi en hi /> for the Taka entry screens
  src/config/roles.ts, statuses.ts   re-exports from shared (client-side mirror)
  src/lib/api.ts           fetch wrapper — adds X-Role, parses error JSON into ApiError
```

## Running

```bash
npm install
npm run db:migrate      # apply migrations to Turso
npm run db:seed         # demo data (idempotent; orders only seeded when the table is empty)
npm run dev             # server :4000 + client :5180 (Vite proxies /api and /uploads)
npm run typecheck       # all three packages
npm test                # shared vitest (jobsheet maths, takas, QR parsing, order dashboard)
npm run build           # server → server/dist (tsup), client → client/dist
npm start               # production: server also serves client/dist
```

The Vite dev server uses port **5180** (not 5173) and `host: true`, so it is reachable on the LAN for phone testing.
Client env (optional): `client/.env` → `VITE_PUBLIC_APP_URL` = the live HTTPS address printed in jobsheet QR codes
(build-time; falls back to `window.location.origin` with a warning bar on the print preview). The camera scanner
only works over HTTPS or localhost — on plain LAN http the Scan screen explains why and keeps manual entry.
To test API flows without touching Turso: `TURSO_DATABASE_URL=file:<path>.db TURSO_AUTH_TOKEN=x` works (libSQL file DB;
run migrate + seed against it first). Vite's proxy target can be changed with `API_URL=http://localhost:<port>`.

## Database (Turso / libSQL + Drizzle)

- Credentials only in `server/.env` (`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `PORT`). Never in code or the client.
  The token is read/write — the browser only ever talks to our API.
- Schema change workflow: edit `server/src/db/schema.ts` → `npm run db:generate` → review SQL in `server/drizzle/` →
  `npm run db:migrate`. Commit the migration files.
- All tables: `id`, `created_at`, `updated_at` (ISO strings). Masters are soft-deleted (`is_deleted`); deleting is
  blocked (409) when any order references the record. Variations are hard-deleted (only if unused).
- Unique among non-deleted rows via partial indexes: `lower(materials.name)`, `designs.code`.
- Variation codes are typed in by the user (not generated, not renamed with the design). Design codes and variation
  codes share one namespace — `isDesignCodeTaken` / `GET /designs/check-code` check both.
- `designs.material_id` (optional) = the material a design is only made in. Picking that design on a new order
  pre-selects the material (still changeable). Deleting a material unlinks it from designs.
- `orders.order_no` is assigned inside the insert transaction: `(SELECT COALESCE(MAX(order_no),0)+1 FROM orders)`,
  plus a unique index. Never generated on the client.
- Machines: soft-deleted, unique partial index on `machine_no` (non-deleted). Delete blocked (409) while the machine is
  on an active jobsheet — mark it inactive instead. Inactive machines are hidden from dropdowns.
- Jobsheets: `jobsheets` (soft delete) + `jobsheet_machines` (composite PK). `jobsheet_no` is global and **never
  reused**: numbers come from the `counters` row `jobsheet_no` (upsert `value = value + n … RETURNING`) inside the write
  transaction — never `MAX()+1`. The order's jobsheet plan lives on `orders`: `jobsheet_pieces`, `target_frames`,
  `frames_per_jobsheet` (reset to 0/0/null when the last active jobsheet is deleted).
- Takas (migration 0004): `takas` (`jobsheet_id`, denormalized `order_id`, `taka_no` TEXT digits — leading zeros kept,
  `is_damaged`, `damage_type` = `machine` when damaged, `entered_by`, soft delete). Numbers are unique **per jobsheet
  only** (partial unique index on `(jobsheet_id, taka_no) WHERE is_deleted = 0`); they repeat across jobsheets / orders.
  `jobsheets.taka_note` = one common note (entry appends a line; edit replaces it). Edits that renumber go through a
  temporary `~id` value so swaps never hit the unique index. Active takas per jobsheet = the `activeTakaCount` SQL.
- `takas.stage` (migration 0005, NOT NULL default `entered`, indexed): where the taka is — values in `TAKA_STAGES`
  (`shared/src/pipeline.ts`). Everything is `entered` today; nothing else writes it yet. Carried on the `Taka` DTO.
- Jobsheet workflow columns (migration 0003): `status` (pending | sent | ongoing | completed, indexed), `sent_at`,
  `started_at`, `completed_at`, `running_machine_id` (indexed), `completed_frames` (actual frames),
  `parent_jobsheet_id` + `suggested_machine_id` (set by Change machine). `jobsheet_events` = Activity timeline
  (`created | sent | pulled_back | started | completed | machine_changed | takas_entered | takas_edited`, machine, frames,
  note, role; taka events carry a summary like "3 takas (1 damage)" and are hidden from roles without `canViewTakas`) — write one for
  every action. Every state change is a conditional update on the current status (`WHERE status = …`) inside a
  transaction and ends with `recomputeOrderStatus(orderId, role, tx)`.
- Multi-row changes use transactions (`db.transaction`); read endpoints use `db.batch` (list + count in one round trip).
- **Drizzle gotcha:** in single-table queries Drizzle renders `${table.col}` unqualified. Inside raw correlated
  subqueries write the outer column explicitly (e.g. `"designs"."id"`), otherwise it binds to the inner table.

## Roles (no login yet)

- `X-Role: jemish | gaurang | supervisor | taka_entry` header on every `/api` call (client stores the role in localStorage
  `rivoora.role`). Missing/invalid header → 400. Permissions are enforced on the server via `requirePermission`.
- Permissions live in `shared/src/roles.ts`. Adding a role: add key + config there (incl. `landing` route), then add
  it to `visibleTo` of the order / jobsheet statuses it may see.
- Rate: returned by `GET /api/orders/:id` only when `canSeeRate`; the list endpoint never returns rate.
- Gaurang: orders from Jobsheet pending onwards, no add/send/undo, masters read-only — but full
  `canManageJobsheets` and `canManageMachines` (as Jemish).
- Supervisor (`landing: /jobsheets`): only `canViewJobsheetsModule`, `canRunJobsheets`, `canPrintJobsheets`,
  `canViewMachineView`. `canViewOrders` / `canViewMasters` are false → the orders, customers, materials, designs and
  machines routers (and the customer/material lookups) return 403 via `router.use(requirePermission(…))`; only
  `/lookup/machines`, `/jobsheets…` and `/machine-view` are open to him. No order status is `visibleTo` him; he never
  sees Pending jobsheets (404) and jobsheet details give him `order: null` (order number only, as plain text).
  "Restricted view" on the server = `!can(role, 'canViewOrders')`.
- Taka entry (`landing: /scan`, `bilingual: true`): only `canUseTakaModules`, `canEnterTakas`, `canViewTakas`. Sees
  jobsheets in **every** status (Pending included) via `/taka/jobsheets`, `/jobsheets/by-no`, `/jobsheets/:id` (restricted
  view: `order: null`, but `takas` + `takaNote`) and `POST /jobsheets/:id/takas`. Everything else is 403 (orders, masters,
  lookups incl. machines, machine view, supervisor list, print). Unknown client routes redirect him to `/scan`.
  Jemish / Gaurang: `canEditTakas` + `canViewTakas`. The supervisor: neither (takas + taka events are stripped for him).
- Bilingual screens: only roles with `bilingual` in their config. Use `<Bi en hi />` (stacked, or `layout="inline"`) and
  `bi(en, hi)` for strings (titles, toasts, aria). Noto Sans Devanagari is loaded globally (index.html + Tailwind `sans`
  fallback). Nav items carry an optional `hi` label. Other roles stay English-only.
- Client routes are wrapped in `RequirePermission` (redirects to the role's landing); `/` → `LandingRedirect`.
- Nav items carry a `permission` + `group` (`nav-items.ts`). Phone bottom nav = main items + a **More** bottom sheet
  for the masters (Jemish/Gaurang: Orders · Machine view · More; supervisor: Jobsheets · Machine view; Taka entry: Scan jobsheet · Jobsheets).
  `/jobsheets` and `/jobsheets/:id` are role-switched in `App.tsx` (`JobsheetsRoute`, `JobsheetRoute`).
- Switching role clears the React Query cache, re-mounts the router (`App.tsx`) and navigates to the role's landing.

## Status system

- Defined once in `shared/src/statuses.ts`: `key`, `label`, `sequence`, `badge` colours, `visibleTo` roles.
- Server filters lists by `visibleStatusKeys(role)` and 404s details the role can't see.
- Statuses: pending_production (10) → ready_production (20, label **"Jobsheet pending"** — key kept for existing data)
  → jobsheet_created (30, indigo) → in_production (40, sky) → production_completed (50, teal) → taka_entry_done (60, purple).
- Every status change writes `order_status_history` (only when the status actually changes). The details timeline
  labels a move to a lower sequence as "Moved back to …".
- From Jobsheet pending on, the order status is **derived from its active jobsheets** by ONE server function,
  `recomputeOrderStatus(orderId, role, tx)` (rules in the pure shared `orderStatusForJobsheets(jobsheets)` — items are `{ status, takaCount }` or plain
  status strings): none → ready_production · all Completed **and each has ≥ 1 active taka** → taka_entry_done · all
  Completed → production_completed · any Ongoing/Completed → in_production · else jobsheet_created. Call it at the end of every jobsheet write, in the same transaction. It never moves an order that
  is still pending_production.
- Undo send-for-production only while Jobsheet pending **and** 0 active jobsheets (409 otherwise; `OrderDetail.jobsheetCount`).
  Use `isReadyOrLater(status)` for "Jobsheet pending or any later status".
- Jobsheet statuses: `JOBSHEET_STATUSES` in `shared/src/statuses.ts` (stored in `jobsheets.status`) — pending (slate) →
  sent (amber) → ongoing (blue) → completed (green), each with `visibleTo` and optional `roleLabels` (the supervisor
  sees `sent` as "Pending"). Always render labels via `jobsheetStatusLabel(status, role)` /
  `<StatusBadge kind="jobsheet" …/>`. Only Pending jobsheets can be edited/deleted (409 "Pull it back … first");
  pull back only Sent → Pending.
- Auto-adjust (7.4) touches **only Pending** jobsheets: the last = highest-numbered Pending one. Coverage (7.5) counts
  `completed_frames` for Completed jobsheets (`effectiveFrames` / `coverageFrames`) — no auto-adjust, just warnings.

## API (all under /api, JSON)

- `GET /orders?search=&status=a,b&material=1,2&from=&to=&page=&limit=` — lean list (customer + material joined,
  plus `designCode` / `designThumbUrl` = variation, else design; search also matches design/variation codes)
- `GET /orders/:id` (incl. `jobsheetCount`, `jobsheetPieces`) · `POST /orders` · `POST /orders/send-to-production {orderIds}` · `POST /orders/:id/undo-production`
- Order dashboard (same visibility as `GET /orders/:id`): `GET /orders/:id/dashboard` (counts only — one batch: order,
  jobsheets, takas grouped by jobsheet/stage/damage → `buildOrderDashboard`) · `GET /orders/:id/dashboard/items?sub=<SubStageKey>`
  (`{kind:'jobsheets', jobsheets}` or `{kind:'takas', groups}`) · `GET /orders/:id/damages?type=machine|butta|mill`
  (`canViewTakas`; damaged takas + counts per type).
- `GET /orders/:id/jobsheets` (list + coverage + warnings) · `POST /orders/:id/jobsheets/generate` `{pieces, picks?,
  framesPerJobsheet, machineIds}` · `POST /orders/:id/jobsheets` `{frames, pieces, picks?, machineIds}` — pcs orders
  that are Jobsheet pending or later only (409), inactive machines 409.
- `POST /orders/:id/jobsheets/send {jobsheetIds}` — Pending → Sent (others skipped, 409 if none) · `POST /jobsheets/:id/pull-back`
  (Sent → Pending) — both `canManageJobsheets`.
- `GET|PUT|DELETE /jobsheets/:id` (GET is role-aware: status, times, running machine, parent/children, `events`;
  PUT/DELETE 409 unless Pending; PUT does the 7.4 auto-adjust in one transaction and returns
  `{updated, created, removed, detailsChanged, coverage, warnings}`) · `GET /jobsheets/print?ids=` (`canPrintJobsheets`,
  role-checked). Jobsheets of invisible orders → 404.
- Takas: `GET /jobsheets/by-no/:no` → `{id, jobsheetNo}` (any role; 404 if not visible, e.g. Pending for the supervisor) ·
  `GET /taka/jobsheets?tab=pending|done&search=&page=&limit=` (`canUseTakaModules`; every status; pending = no takas:
  Completed newest first → Ongoing → Sent → Pending; done = latest taka entry first; `counts`) · `POST /jobsheets/:id/takas
  {takas:[{takaNo,isDamaged}], note?}` (`canEnterTakas`; adds only; if not Completed → Completed with
  completed_frames = frames + a `completed` event "completed at taka entry"; appends the note; `takas_entered` event) ·
  `PUT /jobsheets/:id/takas {takas:[{id?,takaNo,isDamaged}], note}` (`canEditTakas`; replace-set, soft-deletes missing
  ids; new rows only on Completed jobsheets, 409 otherwise; `takas_edited` event) · `GET /orders/:id/takas` (grouped by
  jobsheet + total / damaged). Field errors come back as `takas.<index>.takaNo` (index in the submitted list).
- Supervisor: `GET /jobsheets?tab=all|pending|ongoing|completed&search=&page=&limit=` (Sent/Ongoing/Completed only; sorted
  Pending → Ongoing by number, Completed newest first; returns `counts` per tab) · `POST /jobsheets/:id/start {machineId}`
  (one of its active machines) · `POST /jobsheets/:id/complete {completedFrames}` · `POST /jobsheets/:id/change-machine
  {newMachineId, completedFrames, nextFrames}` (completes the current one; creates a new **Sent** jobsheet: new number,
  frames = next, picks copied, parent + suggested machine set, machines = all active; plan unchanged) — `canRunJobsheets`.
- `GET /machine-view` (`canViewMachineView`) — machines (active + inactive) with their ongoing jobsheets and
  `lastCompletedAt`, two queries in one batch.
- CRUD `/machines` (writes need `canManageMachines`), `GET /lookup/machines` (active only, by number).
- `GET /customers/:id/previous-designs` — latest order per design/variation for that client
- CRUD `/customers`, `/materials`, `/designs`, `/designs/:id/variations[/:variationId]`, `GET /designs/check-code?code=`
- `GET /lookup/customers?search=`, `GET /lookup/materials?search=` — id + name for dropdowns
- `POST /uploads?folder=designs|notes` (multipart `file`) → `{ url, thumbUrl }` (WebP ≤1600px + 320px thumb)
- Errors: `{ error: { message, field? } }` with proper status codes (400 validation, 403, 404, 409 conflict).

## Client conventions

- Server data only through TanStack Query hooks in `features/*/api.ts`; invalidate only affected keys.
  Query keys: `['orders','list',role,params]`, `['orders','detail',id]`, `['customers',…]`, `['lookup',…]`.
- Paginated lists use `useInfiniteList` (20/page) + `<LoadMore>` (infinite scroll with a button fallback).
- Search inputs are debounced 300 ms (`useDebounce`). Order filters live in the URL (`useOrderFilters`).
- Every select uses `components/ui/select.tsx` (`Select`, `MultiSelect`; `searchable` + `onSearchChange` for server search).
- Forms: react-hook-form + zod with string-valued form schemas; server field errors mapped inline via
  `applyServerFieldError`. Mutations that do this set `meta: { silentFieldErrors: true }`.
- Overlays: `Modal` (`center | right | bottom | fullscreen`). Forms, filters and pickers open **full screen on every
  breakpoint** (`ResponsiveModal` defaults to `fullscreen`; content is centred at a readable width via `size`).
  Exceptions: confirmations (`ConfirmDialog`) stay centred dialogs; the Saved designs drawer slides in from the right
  on tablet/desktop (full screen on phones).
- Orders list is a **card grid** on all breakpoints (1 / 2 / 3 / 4 / 5 columns at phone / md / lg / xl / 2xl) — no table.
  Each card: `#N` + status row, then a 64px design thumbnail beside client name + design code, then details.
- `.page-container` is capped at 1920px (not 1280px) so wide monitors use the side space. Screens add `2xl: 1536px`.
- Images: lists/cards show thumbnails only (`ImageThumb`, lazy + placeholder); the full image loads in the lightbox.
- Breakpoints: phone < 768 (bottom nav, cards, FAB), tablet 768–1023 (icon rail, 2-col order cards),
  desktop ≥ 1024 (sidebar, 3–4-col order grid; master lists still use tables). Nothing may overflow at 360px.
- Formatting helpers in `lib/format.ts`: dates `dd-MM-yyyy`, money `₹1,25,000.00` (en-IN), quantity with unit, `#N`.
- Theme tokens: CSS variables in `client/src/index.css` (primary maroon #8B1E3F, accent gold #C9A227), font DM Sans.
- Pages are lazy-loaded in `App.tsx`. `/orders/new` and `/print/jobsheets?ids=` are full-screen routes outside the app layout.
- Jobsheet query keys: `['jobsheets','order',orderId]`, `['jobsheets','detail',id]`, `['jobsheets','print',ids]`,
  `['jobsheets','list',params]` (supervisor), `['machine-view']`; every jobsheet mutation invalidates `['jobsheets']`,
  the order detail(s), the order lists and the machine view (`invalidateAfterWrite` in `features/jobsheets/api.ts`).
- Relative times ("started 2h 10m ago") use `useNow()` + `formatElapsed()` so they tick without refetching.
  The machine view refetches every 30 s and on window focus.
- Previews in forms call the shared functions (`planJobsheets`, `planFramesEdit`, `jobsheetQuantityWarning`) — never
  duplicate the maths in the client.
- QR codes: `jobsheetQrUrl(base, no)` = `${base}/j/${no}`; `parseJobsheetQr(text)` accepts `/j/<digits>` on ANY http(s)
  host (a domain change stays safe). Rendered with `qrcode` (SVG, level M, 2-module quiet zone, 28 mm) absolutely
  positioned top-right of the front page (the space right of the number box) with a `Scan · N` caption; nothing else moved.
  Scanner: `qr-scanner` (back camera, torch if supported, vibrate on success), dynamically imported on `/scan`, destroyed
  on unmount. A valid scan / typed number navigates to `/j/:no`, which resolves via `by-no` and redirects to `/jobsheets/:id`.
- Taka entry screen (`taka-entry-page.tsx`): identity card → info note (if not Completed) → Already entered chips →
  6 numeric fields (`inputMode=numeric`, digits only, Enter → next) with Damage toggles, Add more → note (+ disabled mic)
  → sticky Submit (above the bottom nav) → confirm dialog → success screen (Scan next / Back to list / Add more) →
  secondary details. Validation always via the shared `validateTakaNumbers`.
- Print route: CSS is injected with a `<style>` only while mounted (`@page A4, 10mm`), 2 pages per jobsheet (front +
  design back, `break-after: page`), Noto Sans Devanagari loaded only there; Print waits for images + font.
- Order details page (`/orders/:id`): "← Orders" → `OrderHeader` (design thumb opens the Lightbox, order # + status +
  Undo send for production, detail grid; phones show 4 fields + "More details") → tabs **Dashboard** (default) ·
  **Jobsheets** (the unchanged `OrderJobsheetsSection`) · **Takas** (the unchanged `OrderTakasCard`) · **Damages** ·
  **Order details** (notes, dates, design) · **History**. Tab / stage / sub-stage / damage type live in the URL via
  `useOrderView()` (`?tab=dashboard&stage=production&sub=on_loom`, `?tab=damages&type=machine`, history `replace`).
  Phones: tabs are a horizontally scrollable pill row (`scrollbar-none`). Tab counts come from the dashboard query.
- Order's jobsheet listing = card grid (`auto-fill, minmax(16rem, 1fr)` so it adapts to the column width): number,
  status badge, frames (`FramesValue`: actual/assigned when Completed, amber when short), picks, machines / "Running
  on". The whole card opens `/jobsheets/:id`, where Print / Edit / Delete / Pull back live. The ⬆ icon starts the
  **send-to-supervisor selection mode** with **all Pending jobsheets pre-selected** (untick to keep back; only Pending
  cards selectable).
- Takas card (`features/takas/takas-card.tsx`): summary (total / damaged = Machine damage), All / Damaged only, groups
  per jobsheet with chips (damaged red + damage-type label from `DAMAGE_TYPE_LABEL`), Edit takas (full-screen form).
  Query key `['takas','order',orderId]`; every jobsheet / taka write also invalidates `['takas']`. The supervisor's run
  mutations refresh everything on a 409 (the jobsheet may have been completed at taka entry meanwhile).
- Supervisor module `/jobsheets` (tablet-first, 48px buttons): URL-kept tab + search, card grid 1/2/3/4 cols, action
  buttons Start / Complete + Change machine. Dialogs in `features/jobsheets/run-dialogs.tsx` (`JobsheetRunDialogs`,
  centred on md+, bottom sheet on phones), reused on the details page. Busy hints come from the machine view query.
- Machine view `/machine-view` (`features/machine-view/`): stat pills filter All / Running / Idle, tile grid
  2/3/4/5/6 cols, running tiles green stripe + tint (max 3 rows, then "+N more"), idle "since …", inactive collapsed.

## Order dashboard (Sprint 5) — config-driven, **to connect later**

- Three levels: main stage cards (Production → Butta cutting → Mill → Ready) → sub-stage KPI cards → detail panel
  (items fetched only when a sub-stage is opened). Counts first; details only when asked for. Jemish / Gaurang only.
- Everything comes from `shared/src/pipeline.ts`: `MAIN_STAGES`, `SUB_STAGES` (key, label, mainStage, unit
  `jobsheets | takas`, colour, `connected`, `takaStages`), `TAKA_STAGES`, `DAMAGE_TYPE_CONFIG`, `ALERT_RULES`,
  `ALERT_NOT_STARTED_HOURS = 24`. Colours on the page come from this config only.
- Production sub-stages are jobsheets by status (`jobsheetSubStage`: pending → not_sent, sent → with_supervisor, ongoing →
  on_loom, completed without takas → taka_pending); every later sub-stage counts takas by `takas.stage`.
- **Not connected yet (`connected: false`)**: main stages `butta`, `mill`, `ready`; sub-stages `at_butta`, `butta_qc`,
  `butta_done`, `at_mill`, `mill_qc`, `ready`; damage types `butta`, `mill`. They show 0 with a grey "Coming soon" tag
  and an empty detail ("This stage will be connected when it's built").
  **When the butta cutting / mill / ready flows are built: move takas to the matching `takas.stage`, record `damage_type`
  `butta` / `mill` for new QC damage, set `connected: true` in `pipeline.ts` and map the data there. The dashboard page
  and `buildOrderDashboard` must not need changes.**
- All numbers come from the pure `buildOrderDashboard` (tests in `orderDashboard.test.ts`). Bar shares are frames: a
  jobsheet without takas counts fully in Production; otherwise its (actual) frames are spread over its takas' main
  stages by taka count. Alerts = Sent > 24 h and not started + the existing coverage warnings (same texts); new alert
  kinds go in `ALERT_RULES` + `buildOrderDashboard`.
- Client: `features/orders/dashboard/api.ts` — keys `['order-dashboard', orderId, 'summary' | 'items' | 'damages', …]`;
  summary refetches every 60 s and on focus. `invalidateAfterWrite` and send / undo production invalidate `['order-dashboard']`.
- Special cases: Pending for production → "Not sent for production yet" + Send for production; no jobsheets → "No
  jobsheets yet" + Create jobsheets (existing dialog); non-pcs → "Jobsheets for kg / g / meter orders — coming soon".
- Damages tab: tiles per damage type + total, filter pills (URL `type`), damaged taka cards; editing goes through the
  existing `EditTakasDialog` (no new edit flow).

## Not built yet (next sprints)

Login/auth, statuses after Taka entry done (dispatch etc.), butta cutting / mill / ready flows (the dashboard stages are wired but `connected: false`), butta / mill damage recording, jobsheets for kg / g / meter orders, further order
actions, voice notes (the mic icon is a placeholder with a "coming soon" tooltip), and cleanup of orphaned uploaded images.
