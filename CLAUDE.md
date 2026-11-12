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
Sprint 6 = client demo feedback: order number first wherever a jobsheet shows ("Order #26 (319)"), customer brokers +
order broker, order type (Lump / Pcs to pcs, required), default unit pcs, pcs per taka (required) + taka numbers with
`-` `/`, Damage master + damage name on takas, one-page print, supervisor "On-loom" label + Order view.
Sprint 7 = Butta cutting: taka numbers unique system-wide, Design "goes for butta cutting", damages as a list per taka (`taka_damages`), Butta parties master, Butta cutting module (/butta: Send → challan GSM-n, Receive), challan print (A4 landscape), Butta QC role, order statuses In butta cutting / Ready for mill, taka stages + history.
Sprint 12 = see the "Sprint 12" section; Sprint 13 = see the "Sprint 13" section at the end.
Sprint 24 = yarn: same lot combined across challans, withdraw Sell / Use in-house in every zone, program-wise box pickers, TFO hold / made part / boxes later, warping kg used + remaining, Palti boxes, box stickers — see the "Sprint 24" section at the end.
Sprint 23 = financial-year numbering (numbers restart every 1 April from 2027; `fy` columns, one number helper, FY-aware lookups + QR) and QC login limits (place, hours, extra time, heartbeat) — see the "Sprint 23" section at the end.
Sprint 17 = Yarn PO + Yarn inventory (zones Direct consumption · TFO · Warping, stock ledger in grams, TFO programs, warping → beams) — not linked to orders; see the "Sprint 17" section at the end.
Sprint 20 = yarn rework: auto PO no, lots, boxes, warping qualities, pending programs / jobs with reservations, typed beam numbers, Yarn inventory supervisor role, manual add / remove — see the "Sprint 20" section at the end (it supersedes Sprint 17 where they differ).
Sprint 8 = Butta QC partial resolve, damage images, Mill (generic challans), Docs tab, damage details, dashboard polish (see "Sprint 8" below).
Specs: `rivoora-sprint17-yarn-prompt.md`, `rivoora-sprint8-mill-prompt.md`, `rivoora-sprint7-butta-cutting-prompt.md`, `rivoora-claude-code-prompt.md` (sprint 1), `rivoora-sprint2-jobsheets-prompt.md` (sprint 2),
`rivoora-sprint3-supervisor-prompt.md` (sprint 3), `rivoora-sprint4-taka-entry-prompt.md` (sprint 4),
`rivoora-sprint5-order-dashboard-prompt.md` (sprint 5), `rivoora-sprint6-demo-feedback-prompt.md` (sprint 6).

## Monorepo layout (npm workspaces)

```
shared/   @rivoora/shared — TS source used by BOTH client and server (no build step)
  src/roles.ts      role config + permissions (single source of truth)
  src/statuses.ts   order + jobsheet status config, orderStatusForJobsheets(), jobsheetStatusLabel()
  src/units.ts      kg | pcs | g | meters (DEFAULT_UNIT = pcs)
  src/orderTypes.ts ORDER_TYPES lump | pcs_to_pcs + ORDER_TYPE_LABEL (not linked to the unit)
  src/codes.ts      normalizeCode(); variationCode() is only a placeholder suggestion (D101 → D101N1)
  src/production.ts SECTIONS_PER_BEAM = 3 (never hardcode 3 anywhere else)
  src/jobsheets.ts  ALL jobsheet maths (pure): planJobsheets, planFramesEdit (auto-adjust), coverage, change-machine helpers;
                    jobsheetRef(orderNo, jobsheetNo) "Order #26 (319)" / jobsheetRefShort "#26 (319)"
  src/takas.ts      taka validation (TAKA_NO_REGEX digits with - /, duplicates within ONE jobsheet), meters + pcs helpers,
                    damageLabel(), takaSummary(), QR url build/parse
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
                        services/dashboard.ts: order dashboard, sub-stage items, damages;
                        services/damages.ts: Damage master + resolveDamage (find-or-create "Other" names))
  src/middleware/role.ts  X-Role header → req.role; requirePermission(...)
  src/middleware/error.ts consistent `{ error: { message, field? } }`
  src/storage/*         image storage driver (local disk now; swap for R2/S3 in storage/index.ts)
  uploads/              uploaded images (gitignored, except uploads/demo/ seed images)
client/   Vite + React 18 + TS + Tailwind + Radix (shadcn-style components written in-repo)
  src/components/ui/*      design system (select.tsx = THE standard dropdown, modal.tsx, date-picker, segmented.tsx
                           (attached tappable options), jobsheet-ref.tsx (<JobsheetRef> order-first label), …)
  src/components/layout/*  sidebar / tablet rail / mobile bottom nav, top bar, profile menu (role switch)
  src/features/orders/*    list + selection mode, filters, add order, saved-designs drawer, details page (header + tabs)
  src/features/orders/dashboard/*  order-header, dashboard-tab, damages-tab, view-state (URL tab/stage/sub/type), api
  src/features/masters/*   customers (+ brokers), materials, designs, machines, damages (Damage master) (+ generic master-list scaffold)
  src/features/jobsheets/* order Jobsheets section (+ send selection), forms, details page, print route,
                           supervisor module (supervisor-jobsheets-page = Order | All views + SupervisorJobsheetList,
                           supervisor-order-jobsheets-page, run-dialogs, activity)
  src/features/machine-view/* the machine floor board
  src/features/takas/*     Taka entry role: scan-page (qr-scanner), jobsheet-qr-page (/j/:no), taka-jobsheets-page,
                           taka-entry-page; takas-card (order + jobsheet Takas blocks) + edit-takas-dialog (Jemish/Gaurang);
                           damage-dialog (the damage popup, both screens) + taka-no-keys (the – / helper keys)
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
- **Sprint 7 (migration 0008)** — read this first, it supersedes older taka notes: taka numbers are now UNIQUE ACROSS THE WHOLE SYSTEM (partial unique index `takas_taka_no_active_unique` on `taka_no` where not deleted; `migrate.ts` stops with a list of duplicates BEFORE migrating; live check `GET /takas/check?no=`, `takaUsedText` bilingual message, field error `takas.<i>.takaNo`). `designs.butta_cutting` (required Yes/No; backfilled true); `initialTakaStage(design)` in shared: butta design / no design → `entered`, else `waiting_mill`. Damages live in `taka_damages` (taka_id, damage_id, found_at machine|butta|mill, pcs, status open|resolved, resolved_at/by/stage); `takas.is_damaged` = has an open damage (recompute with `refreshIsDamaged` in the same tx); `takas.damage_type/damage_id` are DEPRECATED (not read/written). `taka_events` = taka history (entered, sent_butta, received_butta, receive_undone, butta_qc_done, damage_added/resolved/kept, edited, challan_cancelled) — write one per taka action via `writeTakaEvents`. `butta_parties`, `butta_challans` (challan_no from counters `butta_challan_no`, shown `GSM-n`, never reused, status active|cancelled), `butta_challan_takas` (meters/pcs at send, received_at/by, qc_done_at, is_active; one active row per taka). Taka stages: entered → at_butta → butta_qc → waiting_mill (`butta_done` removed). Order statuses `in_butta_cutting` (70) / `ready_for_mill` (80) come from `orderStatusForJobsheets(jobsheets, takaStages)`; every send/receive/QC/cancel ends with `recomputeOrdersStatus`. Server helpers: services/taka-ops.ts, taka-shared.ts (`takaColumns` + `mapTaka` — damages as JSON), butta.ts, butta-qc.ts, butta-parties.ts.
- Takas (migration 0004): `takas` (`jobsheet_id`, denormalized `order_id`, `taka_no` TEXT digits — leading zeros kept,
  `is_damaged`, `damage_type` = `machine` when damaged, `entered_by`, soft delete). Numbers WERE unique per jobsheet only (superseded by Sprint 7: unique system-wide) (partial unique index on `(jobsheet_id, taka_no) WHERE is_deleted = 0`); they repeat across jobsheets / orders.
  `jobsheets.taka_note` = one common note (entry appends a line; edit replaces it). Edits that renumber go through a
  temporary `~id` value so swaps never hit the unique index. Active takas per jobsheet = the `activeTakaCount` SQL.
- `takas.meters` (migration 0006, REAL, nullable): optional length per taka (> 0, ≤ 9999.99, 2 decimals). Entered on the
  Taka entry screen (number → meters → Damage per row) and in Edit takas; helpers `cleanMeters` / `parseMeters` /
  `formatMeters` / `totalMeters` in `shared/src/takas.ts`. Shown on every taka chip ("12 · 105.5 m") and as totals
  (`OrderTakas.totalMeters`, Takas card "Total meters" tile, taka event summaries "3 takas (1 damage) · 203.75 m").
- Sprint 6 (migration 0007): `customer_brokers` (customer_id, name ≤ 80, soft delete; partial unique
  `(customer_id, lower(name)) WHERE is_deleted = 0`) — saved with the customer in one transaction (renames go through a
  temporary `~id` name, removed brokers are soft-deleted and stay on old orders); `orders.broker_id` (nullable, must be
  one of the customer's brokers → 400 `brokerId`; an already-saved, since removed broker may stay on edit);
  `orders.order_type` (`lump` | `pcs_to_pcs`, NOT NULL default/backfill `pcs_to_pcs`; the API requires it);
  `takas.pcs` (INTEGER nullable; the API requires 1–9999 on new and CHANGED takas — an unchanged older taka without pcs
  may stay without); `damages` (Damage master: name unique case-insensitive among active, notes, soft delete, delete
  409 while an active taka uses it); `takas.damage_id` (WHAT the damage is; `damage_type` = WHERE stays `machine` for
  taka entry / Edit takas). Taka payloads carry `damage: {damageId} | {otherName} | null` (Edit takas also
  `{damageId: null}` = keep an older nameless damage); "Other" names are found case-insensitively or added to the
  master inside the taka transaction (also for the Taka entry role). The DTO name comes from `takaDamageName`
  (correlated subquery) — so `takaColumns` can't be used in RETURNING.
- Taka numbers: `^\d+([-/]\d+)*$`, max 15 (`TAKA_NO_REGEX`); duplicates exact per jobsheet. The QR stays `/j/<digits>`.
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
- `canManageDamages` (Jemish + Gaurang): Damage master writes (`/damages`, read with `canViewMasters`).
  `GET /lookup/damages` = `canViewMasters | canEnterTakas | canEditTakas` (not the supervisor).
- Permissions live in `shared/src/roles.ts`. Adding a role: add key + config there (incl. `landing` route), then add
  it to `visibleTo` of the order / jobsheet statuses it may see.
- Rate: returned by `GET /api/orders/:id` only when `canSeeRate`; the list endpoint never returns rate.
- Gaurang: orders from Jobsheet pending onwards, no add/send/undo, masters read-only — but full
  `canManageJobsheets` and `canManageMachines` (as Jemish), and `canEditOrder` (edit icon on the order header →
  `/orders/:id/edit`, the add-order form in edit mode incl. design selection). Role option `jobsheetsTabWhenPending`
  (Gaurang): order details open on the Jobsheets tab while the order is Jobsheet pending (an explicit `?tab=` wins).
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
  sees `sent` as "Pending" and `ongoing` as "On-loom"). Always render labels via `jobsheetStatusLabel(status, role)` /
  `<StatusBadge kind="jobsheet" …/>`. Only Pending jobsheets can be edited/deleted (409 "Pull it back … first");
  pull back only Sent → Pending.
- Auto-adjust (7.4) touches **only Pending** jobsheets: the last = highest-numbered Pending one. Coverage (7.5) counts
  `completed_frames` for Completed jobsheets (`effectiveFrames` / `coverageFrames`) — no auto-adjust, just warnings.

## API (all under /api, JSON)

- `GET /orders?search=&status=a,b&material=1,2&type=lump,pcs_to_pcs&from=&to=&page=&limit=` — lean list (customer +
  material + broker joined, `orderType`, `brokerName`, `designCode` / `designThumbUrl` = variation, else design; search
  also matches design/variation codes and broker names). Order bodies: `orderType` (required), `brokerId?`.
- Customers: body gains `brokers: [{id?, name}]`; `Customer.brokers`; search also matches broker names ·
  `GET /lookup/customers/:id/brokers` · CRUD `/damages` · `GET /lookup/damages?search=`.
- **Every jobsheet response carries `orderNo`** (lists, details, by-no, machine view, dashboard items, damages, takas
  groups, write results). Restricted roles still get only the order number.
- `GET /orders/:id` (incl. `jobsheetCount`, `jobsheetPieces`) · `POST /orders` · `PUT /orders/:id` (`canEditOrder`, same body as
  create, any status the role can see, status unchanged; unit locked once jobsheets exist → 400 `unit`; note images = full new set) · `POST /orders/send-to-production {orderIds}` · `POST /orders/:id/undo-production`
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
- Supervisor: `GET /jobsheets?tab=all|pending|ongoing|completed&search=&orderId=&page=&limit=` (Sent/Ongoing/Completed only;
  sorted Pending → Ongoing by number, Completed newest first; returns `counts` per tab; with `orderId` also `order`
  = {orderNo, design} header, 404 when that order has no visible jobsheets) · `GET /jobsheets/orders?search=` (Order view:
  one GROUP BY query — orders with Pending/On-loom work first by number, fully completed last by last completion; only
  number, design, counts) · jobsheet search = order no OR jobsheet no (prefix) OR design code, leading `#` ignored ·
  `POST /jobsheets/:id/start {machineId}`
  (one of its active machines) · `POST /jobsheets/:id/complete {completedFrames}` · `POST /jobsheets/:id/change-machine
  {newMachineId, completedFrames, nextFrames}` (completes the current one; creates a new **Sent** jobsheet: new number,
  frames = next, picks copied, parent + suggested machine set, machines = all active; plan unchanged) — `canRunJobsheets`.
- `GET /machine-view` (`canViewMachineView`) — machines (active + inactive) with their ongoing jobsheets and
  `lastCompletedAt`, two queries in one batch.
- CRUD `/machines` (writes need `canManageMachines`), `GET /lookup/machines` (active only, by number).
- `GET /customers/:id/previous-designs` — latest order per design/variation for that client (incl. that order's `notes`,
  shown on the tiles of the Saved designs drawer)
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
- Print route: CSS is injected with a `<style>` only while mounted (`@page A4, 10mm`), ONE page per jobsheet
  (`break-after: page`; the design back page was removed in Sprint 6), Noto Sans Devanagari loaded only there; Print
  waits for the font + QR only. Number box = "ORDER 26 (319)"; QR caption `Scan · 26 (319)`; assigned looms as small
  "Assigned: 7, 9" above an EMPTY Loom no box (the supervisor writes the loom used).
- Order number first: show jobsheets with `<JobsheetRef orderNo jobsheetNo />` (order number bold, bracket small/muted)
  or `jobsheetRef()` / `jobsheetRefShort()` for plain text (toasts, titles, aria). Never "Jobsheet 319" alone.
- Taka rows: number → meters → pcs (required) → Damage. The – / keys (`TakaNoKeys`) show only under the FOCUSED taka
  number field (pointer-down keeps focus). Damage opens `DamageDialog` (master name or "Other"; damaged rows offer
  Change / Remove). Chips: "6245 · 105.5 m · 12 pcs" + `damageLabel()` "Machine damage · Hole".
- Supervisor `/jobsheets`: Segmented `Order | All` (`?view=all`, default Order). Order view → `/jobsheets/order/:orderId`
  (header + the same `SupervisorJobsheetList` with `orderId`). Query key `['jobsheets','orders', params]`.
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

- Three levels: main stage cards (Production → Butta cutting → Mill → Ready) → sub-stage KPI cards → detail drawer
  (`DetailDrawer`: right-side `Modal`, full screen on phones; items fetched only when a sub-stage is opened; closing it
  clears `sub` from the URL). Counts first; details only when asked for. Jemish / Gaurang only.
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

## Hosting (Vercel + Cloudinary) and the installable app

- Live: Vercel project `rivoora-textiles` (region bom1, next to Turso ap-south-1), deployed only from the CLI:
  `npx vercel deploy --prod` (no git integration; `vercel.json` `git.deploymentEnabled: false`). The build runs on Vercel:
  `scripts/vercel-build.mjs` writes `.vercel/output` (client/dist as static + `server/src/index.ts` bundled as one CJS
  function, `@libsql/client` aliased to `/web`). Env on Vercel: `TURSO_*`, `CLOUDINARY_*`, `VITE_PUBLIC_APP_URL`.
- `server/src/index.ts` skips `listen` and the local `/uploads` static when `VERCEL` is set and default-exports the app.
- Images: `storage/cloudinary.ts` is used when `CLOUDINARY_*` env vars are set (Vercel); otherwise local disk (`npm run dev`).
  Local disk is lazy-imported so `sharp` never loads in the function. The client shrinks photos > 3 MB before upload
  (Vercel request limit 4.5 MB).
- PWA: `client/public/manifest.webmanifest`, `icons/`, `sw.js` (no caching — offline message for navigations only);
  registered in `main.tsx` in production builds only.

## Butta cutting (Sprint 7)

- Roles: `godown_supervisor` (landing /butta, English, restricted view: order no + design + quality, never the client) and `butta_qc` (landing /butta-qc, bilingual). Permissions `canUseButtaModule` (Jemish, Gaurang, Godown), `canCancelChallan`, `canManageButtaParties` (Jemish, Gaurang), `canButtaQc`. `/jobsheets` router is closed to the new roles; unknown routes redirect single-module roles to their landing.
- API: `/takas/check|by-no/:no|:id`, `/butta-parties`, `/lookup/butta-parties`, `/butta/pending-orders[/:id/takas]`, `/butta/challans[/:id|/:id/print|/:id/cancel]`, `/butta/receive[/:takaId/undo]`, `/butta-qc/pending`, `/butta-qc/:takaId`. Receive returns per-taka results (`not_found|not_sent|already_received|received`). Taka numbers with / go in URLs encoded.
- Client: features/butta (butta-page tabs Send/Receive in URL, send-pending, challan-cards, receive-screen, challan-details-page, challan-print-page A4 landscape from `CHALLAN_PAPER`/`COMPANY` constants, paging helper `paginateChallanTakas` 4×12 per page), features/butta-qc, features/takas (damage-dialog = `DamageDialog` + `TakaDamageControl` multi-damage, taka-chip, taka-drawer, taka-check live number check). `TickBox` (ui/tick-box.tsx) is the button checkbox with a partial state.
- Dashboard: butta + waiting_mill sub-stages connected; damage tiles count OPEN damages by found_at (+ pcs); Damages tab has Show resolved. Mill / ready flows still not connected.
- Local testing without Turso: `TURSO_DATABASE_URL=file:<path>.db TURSO_AUTH_TOKEN=x` then `npm run db:migrate`.

## Not built yet (next sprints)

Login/auth, statuses after Taka entry done (dispatch etc.), real-phone (Android/iPhone) check of the taka keypad + – / keys, butta cutting / mill / ready flows (the dashboard stages are wired but `connected: false`), butta / mill damage recording, jobsheets for kg / g / meter orders, further order
actions, voice notes (the mic icon is a placeholder with a "coming soon" tooltip), and cleanup of orphaned uploaded images.

## Sprint 8 — Butta QC fixes, damage images, Mill, Docs tab, dashboard polish (read this; it supersedes older butta notes)

Spec: `rivoora-sprint8-mill-prompt.md`. Migration `0009_sprint8_mill.sql` (hand-written on top of the generated diff; one transaction with a count check — it aborts and changes nothing if the butta challans don't move over intact; `npm run db:migrate` prints the before/after counts).

- **Challans are generic (one engine, `kind` = `butta` | `mill`)**: tables `challans` (`kind`, `challan_no`, `party_id` — no FK, the party table follows the kind) + `challan_takas` (`kind`; unique active row per `(taka_id, kind)`), counters `butta_challan_no` (GSM-n, continues) / `mill_challan_no` (MIL-n from 1). All kind rules live in `shared/src/challans.ts` `CHALLAN_KIND_CONFIG` (prefix, counter, `readyStage`, `notSentStages`, `sentStage`, `receivedStage`, labels, route). `challanLabel(no, kind='butta')`, `parseChallanNo(text, kind)`, `splitReadyTakas`, `isTakaReady`.
- Server: `services/challans.ts` + `routes/challans.ts` (`challansRouter(kind)` mounted at `/butta` and `/mill`: `counts`, `pending-orders[/:id/takas]`, `challans[/:id|/:id/print|/:id/cancel]`, `receive[/:takaId/undo]`), `services/parties.ts` + `routes/parties.ts` (`/butta-parties`, `/mill-parties`, lookups `/lookup/butta-parties|mill-parties`). Mill: pending = takas in `waiting_mill`; the drawer lists every not-yet-sent taka with its stage and a `ready` flag; send/receive/undo/cancel use conditional stage updates; receive of an `at_mill` taka → `mill_qc` (+ `received_mill` event). Permissions `canUseMillModule` (Jemish, Gaurang, Godown) and `canManageMillParties`.
- Statuses `in_mill` (90) and `received_from_mill` (100); `orderStatusForJobsheets` — earliest unfinished stage wins (any taka `entered`/`at_butta`/`butta_qc` blocks In mill). Dashboard: `at_mill` / `mill_qc` connected ("At mill (dyeing)", "Received · QC pending"); `ready` still not.
- Dashboard polish: bar and numbers in **pcs** (`barTotalPcs`, `BarShare.pcs`; a taka counts its own pcs, a taka without pcs gets its share of frames × `SECTIONS_PER_BEAM`); `MainStageCount.state` = `completed` | `skipped` | null (grey "✓ Completed" tag; visual only). `buildOrderDashboard` input gained `buttaTakas` and per-row `withoutPcs`.
- Damages: `taka_damages.resolved_pcs` — open pcs = `pcs − resolved_pcs`; a damage becomes `resolved` only when all pcs are; partial resolve keeps it `open` (`applyResolve`, `damageOpenPcs`, `damageLabelOf` shows open pcs + "(2 resolved)", `damageResolveSummary`). Butta QC decisions are `{takaDamageId, resolvedPcs}` (0 = not resolved); the Resolve popup is prefilled with the open pcs. New events `damage_partly_resolved`, `sent_mill`, `received_mill`; `taka_events.taka_damage_id` links damage events (damage details timeline).
- Damage images: `taka_damage_images`; Butta QC (only) uploads to `/uploads?folder=damages` (role may upload nothing else); new QC damages carry `images: [{url, thumbUrl}]` (max 10). Shown only in the taka drawer and the damage details screen (`DamageGallery`).
- New screens: Mill (`/mill`, `/mill/challans/:id`, `/print/mill-challan/:id`), Mill parties master, order **Docs** tab (`GET /orders/:id/challans`, butta + mill, cancelled included), damage details `/orders/:orderId/takas/:takaId/damages` (`GET /takas/:id/damages`).
- Client: `features/challans/*` (was `features/butta`) — every component takes `kind` (`ChallanModulePage`, `SendPending`, `ChallanList`, `ChallanDetailsPage`, `ChallanPrintPage`, `ReceiveTakaNumber`, `kind.ts` for routes/permissions); `features/masters/parties/parties-page.tsx` (kind prop); `features/butta-qc/api.ts` holds the QC hooks. The – / helper keys are gone (taka number fields use `inputMode="tel"`). Query keys: `['challans', kind, …]`; every write invalidates `['challans']`.
- Phone nav: at most 4 tabs; extra main items (e.g. Mill) move into the More sheet.
- Local testing without Turso as before; a throwaway API flow script (taka entry → butta → QC partial resolve → mill → docs) passed against a local file DB.

## Sprint 9 — Mill QC, refinish, godown final takas, split, ready for dispatch (read this; it supersedes older mill/ready notes)

Spec: `rivoora-sprint9-mill-qc-godown-prompt.md`. Migration `0010_sprint9_mill_qc_godown.sql` (additive columns only).

- **Stages** (`shared/pipeline.ts`): `final` (Mill QC done, with the godown) · `refinish` (waits in inventory to go back to the mill) · `ready_dispatch`. The old placeholder stage `ready` is gone. Sub-stages `refinish` (Mill), `final` + `ready_dispatch` (Ready, now connected). Damage type `godown` = "Supervisor marked"; `mill` is connected.
- **Order statuses** `mill_qc_done` (110) / `ready_for_dispatch` (120) in `orderStatusForJobsheets`; `final`/`refinish`/`ready_dispatch` count as "past the mill"; the earliest unfinished stage still wins (a refinish taka sent back pulls the order to In mill).
- **Columns**: `takas.refinish_count`, `parent_taka_id`, `actual_pcs` (null = same as `pcs`; every pcs total from the godown stage on uses `takaActualPcs`), `godown_checked_at/by`; `challan_takas.is_refinish`. New taka events: `mill_qc_done, sent_refinish, split, godown_checked, godown_unchecked, actual_pcs_changed, ready_dispatch`.
- **Taka numbers** may end in ONE capital letter (`1101A`, split parts): `TAKA_NO_REGEX`, `cleanTakaNo`, `compareTakaNo`. Split helpers (`nextSplitNumber`, `splitMeters`, `validateSplit`, actual-pcs helpers) are in `shared/takas.ts`; Mill QC open rules + godown KPIs / pcs bar / dispatch rules in `shared/godown.ts`. Tests: `shared/src/sprint9.test.ts`.
- **Mill QC role** (`mill_qc`, bilingual, `/mill-qc`, `canMillQc`): `GET /mill-qc/pending`, `GET /mill-qc/taka/:no` (state `qc | qc_not_received | checked | never_sent`), `POST /mill-qc/:takaId` (`result: final | refinish`; a taka still `at_mill` is marked received in the same transaction). Damage logic shared with Butta QC in `services/qc-shared.ts` (`applyQcChanges`). Client: `features/mill-qc/*`; the damage popup got `onRefinish`.
- **Refinish**: Mill → Send has a third sub-tab (`/mill/refinish-orders[/:orderId/takas]`, `counts.refinish`); sending uses the normal `POST /mill/challans` (`sendableStages`, old active mill row closed, `is_refinish`; cancelling puts them back to `refinish`).
- **Godown Orders** (`canUseGodownOrders`: godown supervisor, Jemish, Gaurang; nav hidden for roles that have Orders): `/godown/orders`, `/godown/orders/:orderId` (tabs Final takas | Damage via `?tab=damage`), `/godown/orders/:orderId/split/:takaId`. API under `/godown` (`services/godown.ts`): list, order, `PATCH /takas/:id` (tick / actual pcs, optimistic on the client), split, damage, refinish, `ready-dispatch`, `damages`. Never returns a client or rate. Dashboard queries use `COALESCE(actual_pcs, pcs)`.
- Local test flow without Turso: `TURSO_DATABASE_URL=file:<path>.db TURSO_AUTH_TOKEN=x`, `npm run db:migrate && db:seed`, `PORT=4100 npm run dev -w server`, `API_URL=http://localhost:4100 npm run dev -w client`.

### Sprint 9 follow-up changes (after the first build)

- **Split clears damage**: `splitTaka` resolves ALL open damages of the original taka (`resolved_stage = 'split'`, event note "cleared by split"). Only damages marked on the parts in the split (`found_at = godown`) are open afterwards. The old rule "existing damages stay on the original taka" no longer applies. The split screen shows an amber note when the taka was damaged.
- **Godown resolve**: `POST /godown/takas/:id/resolve` `{ takaDamageId? }` (`resolveGodownDamage`; one damage, or all open damages of a `final` taka; 409 if none open; `resolved_stage = 'godown'`). Client `useResolveGodownDamage`. Row ⋯ menu on Final takas: **Split** (actual pcs ≥ 2), **Mark resolved** (damaged takas), Mark damage, Send to refinish.
- **Godown Damage tab** (`godown-damages-tab.tsx`) rebuilt: summary line, one card per damaged taka (header + Details button), one row per open damage (name, "where found" tag, open pcs, photos, **Mark resolved** — only for `final` takas). Reads `GET /godown/orders/:orderId/damages`.
- **Owner/partner dashboard bar** (`ProgressCard` in `dashboard-tab.tsx`): the big number is now `barTotalPcs / targetPcs` (real-time pcs across all stages, e.g. 198 / 201 or 203 / 198); the % uses the same figures; labels are "pcs" and "of order". `progress.wovenPcs` is still returned by the API but no longer shown there.
- `RESOLVED_STAGE_LABEL` also knows `godown` and `split`.

### Left / not done (as of Sprint 9)

- Apply migration `0010_sprint9_mill_qc_godown.sql` to Turso with `npm run db:migrate` (only tested on a local file DB).
- Not verified in the browser: 360px / 768px layouts, Refinish sub-tab, godown Damage tab after the rebuild, Mill QC popups, dashboard additions. No real-phone check of Mill QC / godown screens.
- The `/godown/orders/:orderId` list `?tab=damage` count badge uses the same damages query; no pagination on the Damage tab.
- Godown damage popup has no photos (only Mill QC uploads damage photos).
- Dispatch itself, a full Inventory module (refinish takas only live in Mill → Refinish and on order details), and login/auth are still later work.
- Nothing from Sprint 9 is committed to git yet.

## Sprint 10 — Inventory (design-wise pcs), Damaged inventory, godown order screen (read this)

Spec: `rivoora-sprint10-inventory-prompt.md`. No migration (reads existing tables only).

- **Pcs definitions** live once in `shared/src/inventory.ts`: `orderInventoryPcs(order, jobsheets, takas)` → `{ordered, inMaking, inGodown, readyDispatch, inRefinish, damaged}` (null for non-pcs orders). In making = takas in `entered…mill_qc` + jobsheet pcs not yet takas (frames × `SECTIONS_PER_BEAM`; same rule as the dashboard bar — a test checks the sum equals `barTotalPcs`). Damaged = OPEN pcs (`pcs − resolved_pcs`) on `final` / `ready_dispatch` takas. Item key helpers `inventoryKey` (`d-<id>` | `v-<id>` | `none`; a variation wins), `parseInventoryKey`, `compareInventoryItems`, `inventoryBarShares`. `DEMO_STOCK_CLEARANCE` = the one demo entry (shown with a grey "Demo" tag). Tests: `shared/src/inventory.test.ts`.
- **Permission** `canViewInventory` (Jemish + Gaurang). Nav item `/inventory` (Boxes icon). Gaurang only sees orders whose status he may see (`visibleStatusKeys`).
- **API** `/inventory/*` (`routes/inventory.ts`, `services/inventory.ts`): `summary`, `items`, `items/:key`, `items/:key/orders`, `damaged`, `damaged/:key`, `damaged/:key/takas?type=&refinish=1&search=`. `loadOrderPcs` runs 3 aggregate queries (orders, jobsheets, takas grouped by order/jobsheet/stage with a correlated open-damage sum) and folds them with the shared function; item lists are grouped/paginated in memory (`lastClearedAt` is always null for now).
- **Client** `features/inventory/*`: `inventory-page` (KPI row, underline tabs `?section=damaged`, search `?q=`, card grids), `item-details-page` (`/inventory/items/:key`), `damaged-details-page` (`/inventory/damaged/:key`, `?type=&refinish=1&q=`), `parts.tsx` (KpiTile, ExpandingSearch, ItemHeader, BackLink). Query keys `['inventory', …]`; invalidated in `invalidateAfterWrite`, godown patch, and order writes.
- **Godown**: `GodownOrder.pcsKpis` (ready pcs, refinish pcs/takas, damaged pcs) — five-tile KPI row; `GET /godown/orders/:id/damages` now returns `stateCounts` + `typeCounts`; Damage tab has a state badge per taka and chip filters (`?state=final|ready_dispatch|refinish&dtype=…`).
- Gotcha: a horizontally scrolling chip row (`overflow-x-auto scrollbar-none`) inside a bordered `overflow-hidden` card froze the renderer; chips use `flex-wrap` instead.

## Sprint 11 — supervisor Orders, Start & print, auto taka numbers, one QC role (read this; it supersedes older notes)

- **Supervisor jobsheet cards** show the quality, ALL assigned looms ("Assigned looms") and a white round **print** button top-right of the design image (`canPrintJobsheets` → `/print/jobsheets?ids=`). `SupervisorJobsheetItem.quality`. Start dialog's button is **Start & print**: starts, then opens the print preview, whose top-left button is now **Close**. Print page shows the order type ("Lump" / "Pcs to pcs", `JobsheetPrintItem.orderType`) under the Design no box.
- **Change machine** no longer picks a machine: body is `{completedFrames, nextFrames}` only; the new Sent jobsheet gets all active machines and `suggested_machine_id` stays null (old rows may still have one). "Frames to make next" is set to the remaining frames as soon as "Frames completed" is picked (until the user edits it).
- **Taka numbers are system generated** (Taka entry only): `POST /jobsheets/:id/takas` takes `{takas:[{meters?, pcs, damages}], note}` — NO `takaNo`. `allocateTakaNumbers` (services/taka-ops.ts) bumps the `counters` row `taka_no` (first number `TAKA_NO_START` = 11, never reused) and skips numbers already used by an active taka. `GET /takas/next-numbers?count=` (`canEnterTakas`) only peeks (not reserved). Taka entry screen: `TAKA_ENTRY_DEFAULT_ROWS` = 3 rows with read-only numbers, "Add more"; a row counts once pcs / meters / a damage is typed, numbers follow the order rows are saved in. Amber bilingual warning (`PcsMismatchNote`) when pcs entered (existing + new) ≠ frames × `SECTIONS_PER_BEAM`. Edit takas (Jemish / Gaurang) still uses manual numbers.
- **Supervisor Orders** = the SAME Orders screens as the owner (list, details, Dashboard / Jobsheets / Takas / Damages / Docs / History tabs), read only. He has `canViewProductionOrders` + `canViewTakas`; `canSeeClient` (Jemish + Gaurang only) hides client, broker, phone and the client search (server blanks `customer`/`brokerName` in `listOrders`/`getOrder`; client hides the fields). He still has no `canViewOrders` (so jobsheet views stay restricted); the orders router, lookup/materials and the taka detail routes also accept `canViewProductionOrders`. Order statuses Jobsheet created → Taka entry done list him (orders still at Jobsheet pending are hidden from him) in `visibleTo` (`IN_PRODUCTION` in statuses.ts); write endpoints keep their own permissions. Nav item `/orders`; `RequirePermission` / `guard` accept an array (any of).
- **One QC role `qc`** (bilingual, landing `/qc`, `canButtaQc` + `canMillQc`) replaces `butta_qc` and `mill_qc`. `/qc` (features/qc/qc-home-page.tsx): one taka number box — stage `butta_qc` → `/butta-qc/taka/:no`, `entered`/`at_butta` → "not received" alert, anything else → `/mill-qc/taka/:no`; the pending list merges `/butta-qc/pending` and `/mill-qc/pending`, each row tagged **Butta** / **Mill**. `/butta-qc` and `/mill-qc` redirect to `/qc`; the QC API paths are unchanged.
- Not browser-verified: the new screens were only typechecked and the API flow (start → change machine → taka entry → production orders) was run against a local file DB.

- **Mill receive is a count** (migration 0011, `challans.received_count`): the godown supervisor enters how many takas came back per mill challan (`POST /mill/challans/:id/received-count {count}`, card on Mill → Receive and on the challan details; `ReceivedCountControl`). No taka numbers: `receivedCount` shown = max(counted, takas marked received at QC); a counted challan can't be cancelled. Mill QC pending (`/mill-qc/pending`) also lists `at_mill` takas on challans with a count > 0; QC save still marks them received. Butta cutting Receive is unchanged.
- **Dropdown scroll fix**: `Select`'s Radix Popover is `modal` (its list takes over react-remove-scroll's lock, which otherwise cancelled wheel/touch scrolling inside any dialog).

## Sprint 12 — Rework, Dhruvil (dispatch + GR), Move to order, Mark as fresh, Login & users (read this; it supersedes older role / header notes)

Spec: `rivoora-sprint12-dispatch-login-prompt.md`. Migration `0012_sprint12_dispatch_login.sql` (additive). `npm run db:migrate` also creates the 7 default users (idempotent, by phone).

- **Login replaces the X-Role header.** `users` + `sessions` (id = SHA-256 of a random 32-byte token in the httpOnly, SameSite=Lax, Secure-in-production cookie `rivoora_session`, 30 days). Passwords: Node `crypto.scrypt` (`server/src/lib/password.ts`). `POST /api/auth/login` (public) · `GET /auth/me` · `POST /auth/logout`. Every other `/api` route except `/health` sits behind `authMiddleware` (`middleware/role.ts`); `req.role` = the ACTING role, `req.user` / `req.userId` = the real user. Only roles with `canSwitchRoles` (Jemish, Gaurang) may send `X-Act-As: <role>` (`resolveActingRole` in `shared/src/auth.ts`); for others it is ignored. Rate limit: 5 wrong passwords per phone, 30 per IP per 15 min (in memory, per server instance). Password reset / deactivate / role change deletes the user's sessions. Default password = `defaultPassword(phone)` = `Rivoora@` + first 3 digits. Default users (phone → role): 9999999999 jemish, 8888888888 gaurang, 7777777777 supervisor, 6666666666 taka_entry, 5555555555 qc, 4444444444 godown_supervisor, 3333333333 dhruvil.
- `lib/request-context.ts` (AsyncLocalStorage) carries the real `user_id` into `taka_events`, `jobsheet_events`, `order_status_history` and the new dispatch rows (`currentUserId()`); `role` columns still hold the acting role.
- Client: `lib/auth-store.ts` (loading | out | in), `lib/role-store.ts` = the ACTING role (remembered only for role-switching users), `features/auth/*` (login page, `loadSession`/`login`/`logout`), `AuthGate` in `App.tsx` (logged out → login screen on the SAME URL, so QR links / deep links return after login; a 401 anywhere signs out). `useRole()` now also returns `user`, `canSwitch`, `isActingAs`. Profile menu = name + role + Switch role (switchers only) + Log out; `ActingAsBar` "Viewing as X · Back to Y". Login Autofill button controlled by `VITE_LOGIN_AUTOFILL` (default on; set `false` before real use).
- Users master (`/users`, `canManageUsers`: Jemish + Gaurang): `GET|POST /users`, `PUT /users/:id`, `POST /users/:id/reset-password`. Safety: can't deactivate / change the role of yourself; the last active user who can manage users can't be deactivated or moved. Client `features/masters/users/*`.
- **Rework** (`canReworkTakas`): `POST /orders/:id/takas/send-back {takaIds, target: butta|mill, note?}` (`services/rework.ts`). butta → stage `rework_butta`, `rework_count + 1`, clears the godown tick; mill → stage `refinish`, `refinish_count + 1`, note "Sent back by owner". Event `sent_back`. Selectable stages: `REWORK_SELECTABLE_STAGES` / `reworkSelectable()` (not `at_butta`, `at_mill`, `dispatched`). Butta challan engine: `CHALLAN_KIND_CONFIG.butta.extraReadyStages = ['rework_butta']`; a re-trip (`challan_takas.is_refinish`, for butta = a rework trip) closes the taka's old active row; cancelling puts it back to `rework_butta`. `stageAfterButtaQc` (shared/rework.ts): a taka with a mill challan row or `refinish_count > 0` goes to `final` after Butta QC, else `waiting_mill`. Pending lists carry `reworkCount` / `sentBackByOwner` (Re-butta / Re-mill tags: `features/takas/taka-tags.tsx`). Dashboard sub-stage `rework_butta` "Sent back to butta cutting · waiting".
- **Dhruvil** (role `dhruvil`, landing `/godown/orders`, sees client + rate): owns the godown Orders module (`canUseGodownOrders`); the godown supervisor kept only Butta cutting + Mill. New permissions `canDispatch`, `canGoodsReturn`, `canMoveTakas` (Dhruvil + owners), `canReworkTakas`, `canMarkFresh`, `canSwitchRoles`, `canManageUsers` (owners only). GodownOrder / card DTOs carry customer, broker, rate, orderType, status when allowed.
- **Dispatch** has its OWN tables (not the generic `challans`: they go to a client and a GR makes a REVISION of the same number, which the (kind, challan_no) unique index forbids): `dispatch_challans` (`challan_no` from counter `dispatch_challan_no`, `revision`, `parent_challan_id`, `status` active|revised), `dispatch_challan_takas` (taka no / meters / pcs snapshot), `goods_returns`, `goods_return_takas`. Label `dispatchChallanLabel(no, rev)` = `DC-12` / `DC-12 R1`. `POST /godown/orders/:id/dispatch` takes ALL `ready_dispatch` takas → stage `dispatched`, event `dispatched`. Order statuses `partly_dispatched` (130) / `dispatched` (140) take precedence once any taka is dispatched (`orderStatusForJobsheets`). `GET /dispatch/challans/:id[/print]`, `GET /dispatched`, `GET /dispatched/:orderId` (`services/dispatch.ts`, `routes/dispatch.ts`). Print `/print/dispatch-challan/:id` (lump = taka grid; pcs_to_pcs = Sr|Quality|Design|Pcs, no taka numbers; REVISED watermark). Dispatched module `/dispatched`, order screen `/dispatched/:orderId`.
- **GR** `POST /dispatch/challans/:id/goods-return`: lump `{returns:[{takaId, damages?}], date, note?}` → returned takas back to `final` (`returned_at`, `returned_from_challan_id`, event `goods_returned`, damages with `found_at = customer_return`); pcs_to_pcs `{returnedPcs, damagedPcs, damage?, date, note?}` → one **return lot** taka (`is_return_lot`, auto number, jobsheet of the challan's first taka, stage `final`) and the dispatched takas' `actual_pcs` shrink (`reducePcsAcrossRows`) so order pcs stay right. The old revision becomes `revised`, the new one has everything except the returned items. Damage photos upload for `canGoodsReturn` too.
- **Move to order** (`canMoveTakas`): `GET /godown/orders/:id/move-targets`, `POST /godown/takas/move` (`services/move.ts`): fresh `final` takas only (`canMoveTaka`), target = same design + variation, pcs, not fully dispatched. `takas.order_id` moves, `origin_order_id` keeps the first order, `challan_takas.order_id` follows, event `moved_order`. A moved taka keeps its jobsheet: the target order's Takas tab shows it in an extra group ("from Order #A") and the dashboard bar counts its own pcs.
- **Mark as fresh** (`canMarkFresh`): `POST /inventory/takas/:id/mark-fresh` resolves every open damage (`resolved_stage = 'inventory'`, label "Marked fresh in inventory").
- New taka stages `rework_butta`, `dispatched`; damage type `customer_return` ("Customer return"); `takas` columns `rework_count`, `returned_at`, `returned_from_challan_id`, `is_return_lot`, `origin_order_id`; taka events `sent_back`, `dispatched`, `goods_returned`, `moved_order`. Inventory "In making" includes `rework_butta`; dispatched pcs are never in godown stock.
- Tests: `shared/src/sprint12.test.ts`. `node scripts/check-auth.mjs [baseUrl]` checks that every router rejects a request without a session, login / logout / X-Act-As / deactivate / rate-limit behaviour.
- Local testing without Turso: `TURSO_DATABASE_URL=file:C:/path/test.db TURSO_AUTH_TOKEN=x` (Windows path form), `npx tsx src/db/migrate.ts`, `npx tsx src/db/seed.ts`, `PORT=4100 npx tsx src/index.ts`.
- Not done / to check: apply migration 0012 to Turso (`npm run db:migrate` — sprints 9–11 migrations must be applied first); no 360 / 768 / 1280px screenshot pass of the new screens (login, Users, send-back, Dispatch modal, Dispatched, GR, Move to order, Mark as fresh); the login rate limit is per server instance (serverless instances don't share it); `/uploads` static images are still public URLs.

## Sprint 13 — Free stock (Move to inventory), re-butta fix, damage-type radio, Returned status, Blouse option (read this; it supersedes "Move to order")

Spec: `rivoora-sprint13-free-stock-blouse-prompt.md`. Migration `0013_sprint13_free_stock_blouse.sql` (additive: new columns + two indexes, then data backfills; no table rebuild). Tests: `shared/src/sprint13.test.ts` + `node scripts/check-sprint13.mjs` (API flow, **local file DB only** — it refuses a non-`file:` URL).

- **Free stock** = takas that belong to no order. `takas.order_id` stays the ORIGIN order; new columns `is_free_stock`, `free_stock_at/by/reason` (`moved` | `goods_return`), `allocated_order_id`. **ONE rule** for "which order a taka counts for": not free AND `COALESCE(allocated_order_id, order_id)` — shared `effectiveOrderId` / `takaCountsForOrder` (shared/freeStock.ts) and its SQL twin `server/src/services/free-stock.ts` (`takaInOrder(orderId)`, `takaOrderId`, `takaNotFree`, `takaInOrderRaw`, `freeStockFields`). Every order-level query (dashboard, Takas tab, godown/Dhruvil lists + KPIs, statuses, dispatch, inventory per-order figures) uses them. Use them for any NEW order-level takas query. `recomputeOrdersStatus` also recomputes the orders that hold allocated takas of the touched origin orders.
- **Move to inventory** replaces Move to order (route, service, dialog removed; `canMoveTakas` → `canMoveToInventory`: Jemish, Gaurang, Dhruvil). `POST /orders/:id/takas/move-to-inventory` (lump `{takaIds, note?}` / pcs-to-pcs `{pcs, note?}`) and `POST /orders/:id/takas/add-from-free-stock` (lump `{takaIds}` / pcs `{pcs, blouse?}`) live in `services/inventory-moves.ts` and are registered BEFORE the Orders permission gate in `routes/orders.ts` (Dhruvil has no Orders access). Selectable stages: `MOVE_TO_INVENTORY_STAGES` (same set as rework); `at_butta` / `at_mill` / `dispatched` greyed with a reason. A moved in-making taka keeps its stage; `ready_dispatch` goes back to `final` (tick cleared). Pcs-to-pcs: `planPcsMove` picks final first, then ready_dispatch, largest first; a taka needed only partly is split (next letter number, meters by pcs, damages stay on the kept taka). Events `moved_to_inventory`, `allocated_from_free_stock`. Free stock can be assigned only to a pcs order of the SAME design/variation that can still receive it (`canReceiveFreeStock`).
- **Inventory**: `Free stock` KPI, "Free N" pill on item cards, item details Free stock section (figures ready / in making / damaged + free takas, tick + **Assign to order**), blouse toggle `?blouse=`. Free pcs are NOT in any order's Ordered / In making / Ready figures. API: `GET /inventory/items/:key/free-stock` (also for Dhruvil), `/items/:key/assign-targets`, `?blouse=` on summary / items / item / orders. Damaged inventory includes free damaged + refinish pcs. Item/blouse attribution of a free taka = its ORIGIN order.
- **Edit takas safety**: free-stock / assigned-away takas are excluded from the jobsheet's editable set (server `editTakas` + client `toTarget`), so Edit takas can never delete them. `Taka.allocatedOrderNo`, `isFreeStock` on the DTO; chips show "Free stock" / "In Order #n".
- **Re-butta fix**: `takas.has_been_to_mill` (backfilled; set on mill receive / Mill QC; copied to split parts and return lots). `stageAfterButtaQc({hasBeenToMill, ancestorHasBeenToMill, hasMillHistory, refinishCount})` returns `final` if the taka OR any ancestor (`parent_taka_id`) has been to the mill, else `waiting_mill` (`ancestorHasBeenToMill` in taka-ops walks the parents). Split parts also inherit the free-stock / allocation columns.
- **Damage type radio**: `taka_damages.found_at` is now the TYPE the person chose (`machine | butta | mill`), `taka_damages.recorded_at` = where (`taka_entry, edit_takas, butta_qc, mill_qc, godown, goods_return, split, inventory`). Every damage write requires `type` (zod `damageTypeRequired`) except goods return (`grDamageSchema`, optional). "Not marked" is stored as the VALUE `'unmarked'` in `found_at` (NOT NULL stays — no table rebuild); labelled "Damage type not marked". Old `godown` / `customer_return` values keep their legacy labels. `addNewDamages(..., recordedAt, ...)` takes the recording place, not the type. Client: `DamageTypeRadio` inside the shared `DamageDialog` (nothing pre-selected, Save disabled + hint, bilingual on QC / Taka entry; `typeOptional` for GR); payload helpers `entryPayload / qcEntryPayload / grEntryPayload / editEntryPayload`. Damages tab / godown chips show Machine / Butta / Mill always, "Not marked" and legacy types only when > 0.
- **Returned status** (`returned`, 145, visible to Jemish / Gaurang / Dhruvil): `orderStatusForJobsheets(jobsheets, takaStages, hadGoodsReturn)`; all remaining NON-free takas dispatched + the order had a GR gives Returned (else Dispatched); any non-dispatched non-free taka gives Partly dispatched. GR now sends returned takas / the return lot to FREE STOCK (reason `goods_return`; the revision DC-n R1 is unchanged). `OrderDetail.returned` / `DispatchedOrderDetail.returned` = `{takas, pcs, challanId, challanLabel}`; the Dispatched list has a status filter (`?status=`).
- **Blouse**: `orders.blouse_option` (`with_blouse | without_blouse`, nullable). Optional Segmented field on Add / Edit order (tap again to clear). `BlouseTag` (client/features/free-stock/blouse.tsx; renders nothing when unset) on order cards, header, Order details, supervisor jobsheet cards + order view, Taka entry + QC identity (Hindi), Dhruvil / godown order header, Dispatched module, free-stock rows; printed under the design no on the jobsheet ("WITH BLOUSE") and next to Design on the dispatch challan. The Add order stock panel is filtered by the chosen blouse ("Showing With blouse stock") or shows "With blouse 120 · Without 80 · Not set 40" + free stock.
- Client: `features/free-stock/*` (api, blouse, move-to-inventory-dialog, add-from-free-stock-dialog). Query keys live under `['inventory', ...]`; writes use `invalidateAfterDispatch`.
- Not done / to check: apply migration 0013 on Turso (`npm run db:migrate`, after 0010–0012); browser check only done at desktop width (inventory item + free stock, order Takas tab, damage popup) — no 360 / 768 px screenshot pass, no real-phone check of the radio cards; the Move to inventory / Add from free stock dialogs and the Returned screens were API-tested but not clicked through; a pcs-to-pcs partial move leaves open damages on the kept taka; the blouse toggle counts = ordered + free pcs.

## Sprint 14 — small client-feedback changes (read this; it supersedes older notes where they differ)

Spec: `rivoora-sprint14-small-changes-prompt.md`. No schema change, no migration. The owner is **Jenish** (role key stays `jemish`).

- **Owner name**: display name in `shared/src/roles.ts` / `DEFAULT_USERS` / README / comments is "Jenish". The role key `jemish` (DB, `X-Act-As`, permissions, tests) is unchanged. Existing DBs: `npm run db:rename-owner` (one-time, `server/src/db/rename-owner.ts`) sets `users.name = 'Jenish'` ONLY where `phone = '9999999999'` AND `name = 'Jemish'`; it is NOT part of `db:migrate`. Run it on Turso deliberately.
- **Add / Edit order stock panel** (`design-stock-panel.tsx`): always ALL stock of the design (no blouse filter, no "Showing … stock" caption); the quiet "With blouse · Without · Not set" line stays.
- **Orders list filters**: every filter is multi-select and comma-separated in the URL. New **Party** filter (`party=3,7`, `MultiSelect` on `useCustomerLookup`, hidden without `canSeeClient`; the server ignores `party` for such roles). Parsing lives in `shared/src/orderFilters.ts` (`parseIdList`, `parseKeyList`) and is used by `orderListQuerySchema`. There is no blouse filter on the list.
- **History tab** (`features/orders/history-tab.tsx`): `Overview | Detailed` toggle in the URL (`?hview=detailed`, default overview). Overview = the 7 main steps from the pure `orderMilestones()` in `shared/src/orderMilestones.ts` (steps, lots, Pending / Skipped, "Butta cutting took 4 days 6 h" / "2 d 3 h" pills; `formatSpan`). Raw times come from `GET /orders/:id/milestones` (`services/order-milestones.ts`: first jobsheet start, active butta / mill challans per lot + their received times, original dispatch challans). A design without butta cutting skips both butta steps. Detailed = the unchanged status timeline; `mainStepsOfHistory()` marks the first entry of each main step (primary dot + soft tint + the same time pill). Tests: `shared/src/sprint14.test.ts`.
- **Taka entry**: field order is taka number → **pcs** → meters → Damage (Enter: pcs → meters → next row's pcs; "Add more" focuses pcs).
- **Send popups** (Butta Send, Mill Send, Refinish): totals show Takas · **Pcs** · Meters; the selection bar and the order drawer footer show pcs too (`SelectedTotals.pcs`).
- **Challan cards** (`ChallanCard`: Receive → Challans and In butta cutting / In mill): `ChallanListItem.designs: ChallanDesign[]` (distinct per order, from ONE extra query in `listChallans`). `features/challans/design-preview.tsx`: `ChallanDesigns` (≤ 3 overlapping 40px thumbs + "+N") opens `DesignPreview` (full screen on phones, large modal on md+, ‹ › buttons, swipe, ← → keys, "2 / 3", full image only there). Clicks/keys never reach the card.
- **QC**: `/qc` is only the taka number box + Open (the pending list and `useQcPending` / `useMillQcPending` are gone; the server pending endpoints remain).
- **Dispatch dialog**: amber notice (not a blocker) "N takas (X pcs) still have damage" with an expandable list, from `useGodownDamages` filtered to `ready_dispatch` open damages. `DispatchDialog` takes `orderType`.
- **Inventory**: label "In godown" → **"Ready for order"** (item details tile, design stock panel); the KPI "Total in godown" → "Total ready for order". Labels only.
- **Docs → Challans**: `GET /orders/:id/challans` also returns delivery (dispatch) challans — every revision (`DC-12`, `DC-12 R1`, Active / Revised) as `OrderDeliveryChallan` (`kind: 'delivery'`) merged by the pure `mergeOrderChallans()` (`shared/orderDocs.ts`), only for roles with `canDispatch`. Cause of the bug: the query only read the generic `challans` tables; dispatch has its own tables. Client: `DeliveryRow` (badge "Delivery", print icon → `/print/dispatch-challan/:id`, row → `/dispatched/:orderId`).
- Gotcha: some files (`challans.ts`, `taka-entry-page.tsx`, `orders-page.tsx`, `godown-order-page.tsx`) have CRLF line endings — scripted multi-line replacements silently miss; use the Edit tool.

### Sprint 14 follow-up (client feedback)

- **Godown / Dhruvil Final takas**: no Expected pcs column; Actual pcs is read-only text. It changes only via the row ⋯ menu → **Edit pcs** (`EditPcsDialog` in `godown-order-page.tsx`, same `PATCH /godown/takas/:id {actualPcs}`). The inline Split button is gone (Split stays in the ⋯ menu). Rows never wrap: taka column (`TAKA_COL`, fixed 18rem from 640px) · actual pcs (`PCS_COL`) right beside it · ⋯ menu (ready-for-dispatch rows show a green check in that slot).
- **Split screen**: taka numbers are not typed. Part 1 keeps the original number; the others come from `nextSplitNumber` over the order's numbers + a `skip` set that grows when the live check (`useUsedTakaNumbers`) finds a number used elsewhere, so a clash moves to the next letter. The server still validates.
- **Inventory item details**: the Ready for order and Free stock KPIs are filters too (`?filter=godown|free`). `godown` = orders with final (in-godown) pcs; `GET /inventory/items/:key/orders?filter=godown`, rows now carry `godownPcs` + `makingPcs` and show the figure of the active filter. `free` hides the Orders list and shows only the Free stock section (empty state when none).
- **Work filters** (production supervisor Jobsheets + godown Butta cutting / Mill): `shared/src/workFilters.ts` (`WorkFilters` = looms, qualities, types, blouse, parties, from/to; URL / query keys `loom quality type blouse party from to`, comma lists; `workFilterQueryFields` spread into `jobsheetListQuerySchema`, `supervisorOrderListQuerySchema`, `buttaListQuerySchema`, `challanListQuerySchema`, `pendingTakasQuerySchema`). SQL in `server/src/services/work-filters.ts`: `rowFilters(f, dateCol?)` for queries joining jobsheets + orders (loom = assigned via `jobsheet_machines` OR `running_machine_id`), `challanFilters(f)` for the single-table challan list (party, challan date, and EXISTS over its takas). Client: `features/filters/work-filters.tsx` (`useWorkFilters`, `FiltersButton`, `WorkFiltersDialog` full screen with Loom tiles, `WorkFilterChips`). Supervisor fields: loom, quality, type, blouse, sent date (Order view → order jobsheets carries the filters). Godown: Pending / Refinish = loom, quality, type, blouse (the order drawer gets the same filters, so selecting an order selects only matching takas); challan lists add party + challan date; switching tab / sub-tab clears them. `/lookup/machines` and `/lookup/materials` are open to the Butta / Mill permissions (names only). Tests: `shared/src/workFilters.test.ts`.
- **Card images**: supervisor jobsheet / order cards, Butta / Mill pending order cards and the Taka entry jobsheet cards show a 64px design thumbnail beside the title (tap = full image), not a full-width image. The supervisor's print button sits top-right of the card.

### Navigation update (Masters hub, bottom bar on tablets)

- One **Masters** nav item (`/masters`, `features/masters/masters-page.tsx`) lists every master the role may open (`mastersFor(can)`); the individual masters are no longer nav items. `isMasterPath()` keeps Masters highlighted on every master screen.
- The bottom bar now shows on phones AND tablets (< 1024px); the sidebar is desktop only (≥ 1024px, always expanded, no icon rail). Bar order comes from `NavItem.phoneOrder` (Orders, Machine view, Inventory), the rest (Butta cutting, Mill, Masters, Dispatched…) go into **More**; with ≤ 4 items there is no More. Sticky action bars use `lg:` (not `md:`) to leave the bottom bar.

## Sprint 15 — live jobsheet numbers, Hold order, godown supervisor Orders, share photos, split damage picker (read this; it supersedes older notes where they differ)

Spec: `rivoora-sprint15-prompt.md`. Migration `0014_sprint15_hold_order.sql` (additive: table `order_hold_events`, `orders.is_on_hold / held_at / held_by_user_id / hold_note / released_at`, index on `is_on_hold`). Check script: `node scripts/check-sprint15.mjs` (local file DB only).

- **Live jobsheet numbers**: `orders.jobsheet_pieces` / `target_frames` are DEPRECATED (never read or written; columns stay). `orderJobsheetPlan(orderedPieces, jobsheets)` in `shared/jobsheets.ts` computes frames needed (ceil(pcs/3)), frames in jobsheets (`coverageFrames`) and jobsheet quantity (frames × 3); server SQL twin `services/jobsheet-live.ts`. `coverageWarnings` stays silent when frames == frames needed. The single-jobsheet Pieces field is read-only (frames × 3); previews use `jobsheetQuantityWarning(ordered, currentFrames, addFrames)`. `orders.frames_per_jobsheet` is still used.
- **Picks removed** from forms/screens/DTOs (column stays, unused); the print keeps a blank PICKS box.
- **Supervisor Order view** cards: `quality` + `machineNos[]` (one aggregate query).
- **Keyboard**: `hooks/useKeyboardInset.ts` (`useKeyboardInsetVar`, mounted once in `App`) publishes `--kb-inset` + `data-kb` on `<html>`; `index.css` lifts `.kb-bar` (sticky/fixed Save bars), `.kb-modal-*` (set in `modal.tsx`) and hides `.kb-hide-on-keyboard` (bottom nav, FAB). New sticky action bars must carry `kb-bar`.
- **QC**: meters / pcs are read-only; `qcSubmitSchema` has no meters/pcs (old clients' values are stripped); damage pcs are bounded by the taka's own pcs.
- **Challans**: counts are in takas ("Sent N takas · Received M"). A mill challan is `isRefinish` when all its takas are refinish trips (`challan_takas.is_refinish`); `mixesRefinishAndNormal` → 409 on mixing; print shows FOR REFINISH on the Quality Name row; `RefinishTag`.
- **Hold order** (`canHoldOrder` = Jenish only; `canSeeHeldOrders` = Jenish + Gaurang). ONE place for the rules: `middleware/hold-guard.ts` (mounted after auth in `index.ts`): WRITES on a held order → 409 "Order #26 is on hold" (bilingual for Taka entry / QC) for every role; NOT blocked: receive endpoints, mill received count, undo receive, hold/release. READS for other roles: 404 on order-level screens, 409 message on jobsheet/taka screens. LIST queries use `orderNotHeldFor(role)` / `takaOrderNotHeld` (`services/hold.ts`); butta/mill Pending + Refinish lists and QC pending lists hide held orders for everyone. `POST /orders/:id/hold {note?, ongoing:[{jobsheetId, completedFrames}]}` (`services/hold-order.ts`; shared `planHold`) completes ongoing jobsheets ("completed on hold") and creates a Pending jobsheet for the remaining frames (same machines, `parent_jobsheet_id`); `POST /orders/:id/release`. History tab shows "Put on hold" / "Released from hold" (`OrderDetail.holdEvents`). Client: `features/orders/hold/*` (HoldOrderDialog, ReleaseHoldDialog, OnHoldBadge, OnHoldBanner, HoldNotice for blocked scan/QC screens). **New write endpoints must be added to `WRITE_RULES` in hold-guard.ts.**
- **Godown supervisor Orders** (`canViewGodownOrders`, + `canViewTakas`): read-only Orders for orders with ≥ 1 active (non-free) taka (`services/godown-scope.ts`, enforced in `listOrders` and the hold-guard for `/orders/:id/*`). He sees order statuses from In production on. Dashboard = Butta cutting / Mill / Ready only (`withoutProduction`, no alerts, no jobsheet lists); tabs Dashboard · Takas · Damages · Docs · History; no client / broker / phone / rate; jobsheet references are plain text (`JobsheetLink`).
- **Share damage photos**: `lib/share-image.ts` (Web Share with the file, else `wa.me` + download), `ShareDamageButton` in `damage-gallery.tsx`; text from shared `damageShareMessage`.
- **Split damage picker**: `GET /godown/takas/:id/split-damages`; shared `splitPickerOptions / movedDamagePcsCheck / duplicateMovedDamages / splitDamageLabel` (`shared/splitDamage.ts`); split body `parts[].damages[]` accepts `{fromTakaDamageId, pcs}` (moved: same type, name, marked date, place, photos; the original is closed with `resolved_stage='split'`) or a new damage. Client `godown/split-damage-picker.tsx`.
- Not done / to check: real-phone checks (keyboard bars, share sheet); 360 / 768 / 1280 px screenshot pass; Mill Send → Pending drawer was checked in a browser at desktop width (opens from the right, ready takas pre-selected, others greyed); apply migration 0014 on Turso (`npm run db:migrate`, after 0010–0013).

## Sprint 17 — Yarn PO + Yarn inventory (zones: Direct consumption · TFO · Warping) (read this before touching yarn)

Spec: `rivoora-sprint17-yarn-prompt.md`. Migration `0016_sprint17_yarn.sql` (16 NEW tables + indexes, nothing else). A separate area: **not linked to orders, jobsheets or takas**; the hold guard never matches `/yarn*` routes. Check script: `node scripts/check-sprint17.mjs` (local file DB only; reconciles summary / zone screens / ledger after every step).

- **Quantities are integer GRAMS** in every table (`qty_g`, `raw_g`, `twisted_g`, `returned_raw_g`) — the spec's `qty_kg` became `qty_g` so totals never drift. Rates are integer **paise per kg** (`rate_paise`), amounts paise (`amountPaise(g, ratePaise)`). The API and screens speak kg (≤ 3 decimals): `kgToGrams`, `gramsToKg`, `parseKgText`, `cleanKgText`, `formatKg`. DTO fields end in `G` / `Paise`.
- **Pure rules** in `shared/src/yarn.ts` (zones + `YARN_ZONE_CONFIG` accents / action labels, ledger kinds + `MOVE_KIND_SIGN`, `MOVE_FILTERS` → kinds, balances, `checkTake`, `validateTransfer` / `validateWithdraw` / `validateProgramIssue` / `validateProgramStop` / `validateWarpingInputs` / `validateBeam`, `canMoveBeams` / `transferTargets`, PO `yarnPoStatusFor` / `yarnPoTotals` / `yarnPoLineFigures` / `overReceiptText` / can-edit/close/cancel, labels `WJ-n` / `BM-n` / `3A`). Zod in `shared/src/yarnSchemas.ts`, DTOs in `shared/src/yarnTypes.ts`. Tests: `shared/src/yarn.test.ts`.
- **The ledger** `yarn_stock_moves` (zone, item raw|twisted, quality, signed `qty_g`, kind, `ref_type`/`ref_id` → receipt | transfer | withdrawal | program | job, note, user, role) is the ONLY source of yarn quantities: balance = SUM per zone + item + quality. Every yarn change goes through `server/src/services/yarn-ledger.ts` (`addStock`, `takeStock` — checks the balance inside the write transaction, 409 "Only 12.5 kg of raw yarn 75D in TFO"). Beams are rows in `beams` (zone direct|warping, status in_stock|consumed) with history in `beam_moves` (beam_created, transfer_out/in, consumed — one row per beam per action and zone). The movements list (`GET /yarn/moves`) is a UNION of yarn rows and beam rows grouped per action.
- Extra tables beyond the spec's list: `yarn_po_events` (PO activity), `yarn_transfers` and `yarn_withdrawals` (the transfer / withdrawal ids the ledger pair points to).
- **Masters** (Masters hub, `canManageYarnMasters` = Jenish + Gaurang): Yarn parties, Yarn qualities (raw AND twisted), TFO machines (sections A top / B bottom; can't be deleted or made inactive while a program runs). Quick-add party / quality from the PO form is allowed with `canManageYarnPo` (POST only). Lookups `/lookup/yarn-parties`, `/lookup/yarn-qualities`.
- **Yarn PO** (`/yarn-po`; view `canViewYarn`, write `canManageYarnPo`, receive `canReceiveYarn`): PO no typed + unique over every PO (cancelled included; live check `GET /yarn-pos/check-no`). Received kg are never stored on the PO — they are the sum of receipt lines; status recomputed after each receipt. Full edit only while nothing is received (lines replaced); after that `PUT {remark}` only (409 otherwise). Close = partly received only (closed short); Cancel = open with nothing received. A fully received PO takes no more challans; inside one challan more than pending is allowed (amber warning). Rate / amount are `null` for roles without `canSeeRate` (the supervisors). Print `/print/yarn-po/:id` (`canManageYarnPo`).
- **Inventory** (`/yarn`, `/yarn/:zone`, `/yarn/movements`; `canUseYarnInventory` = Jenish, Gaurang, Supervisor, Godown supervisor). Transfer between any zones (beams only Direct ↔ Warping); Withdraw = Direct consumption only (`POST /yarn/withdrawals` rejects other zones); TFO = Run program; Warping = Start warping.
- **TFO**: one running program per (machine, section) — partial unique index `tfo_programs_running_unique` + a check. Start takes the raw kg out of TFO raw stock (`tfo_issue`); Stop adds twisted kg under the output quality (`tfo_output`, may differ from raw — not "wastage") and optional returned raw ≤ issued (`tfo_return`). History: `GET /yarn/tfo/programs?machineId=&section=`.
- **Warping**: start = inputs (raw and/or twisted, rows of the same quality add up) leave Warping stock (`warping_issue`); Mark done = one or more beams (counter `beam_no`, BM-n) kept in Direct consumption or Warping; job counter `warping_job_no` (WJ-n). Counters are allocated inside the write transaction (a rolled-back write uses no number).
- **Client** `client/src/features/yarn/*` (api.ts — keys `['yarn', …]`, every write invalidates `['yarn']`; parts.tsx; dialog.tsx `YarnDialog` = side sheet ≥ 1024px, centred 760 / 880px on tablets, full screen on phones, and a closing dialog takes no taps; po-*, receive-page, inventory-page, zone-page, movements, stock-dialogs, tfo-board, warping, zone-actions) and `client/src/features/masters/yarn/*`. `Select` gained an optional `panelClassName` (wider dropdown than its trigger).
- **Nav**: Yarn inventory + Yarn PO are main items without `phoneOrder`, so on phones / tablets they sit in **More**. Side effect of the max-4 bar rule: the godown supervisor now has 6 items, so **Receive goods** moved from his bar into More (bar: Orders, Butta cutting, Mill). Landings are unchanged for every role.
- Not done / to check: apply migration 0016 on Turso (`npm run db:migrate`, after 0010–0015); real tablet / phone check (touch targets, keyboard over the sticky bars); existing screens with one-field-per-row on tablets are listed in PROJECT_STATE.md (Sprint 17) for a follow-up.

## Sprint 18 — Design library by quality (no variations), Upload many, sections per beam, Outside order, Dhruvil design library (read this before touching designs or jobsheet maths)

Spec: `rivoora-sprint18-designs-small-changes-prompt.md`. Migration `0017_sprint18_designs_sections_outside.sql` (generated DDL + ONE hand-written, checked data change in the same transaction). Check script: `node scripts/check-sprint18.mjs` (local file DB only; includes the §6 goods-return end-to-end check). Tests: `shared/src/sprint18.test.ts`.

- **No variations.** Every design is standalone with its own code + image. Migration 0017 turned each `design_variations` row into a new design (variation code + image, parent's name / notes / butta cutting / material; a variation of a deleted design → a deleted design), recorded in `design_variation_map (variation_id, new_design_id)`, and moved `orders.design_id` to it (`orders.variation_id` → NULL). Checks inside the SQL (`__s18_check`: new designs = variations, map rows, same code + image per pair, orders before = after, no duplicate active codes, qualities) abort and change nothing on a mismatch; `migrate.ts` prints the plan + counts. `npm run db:s18-report` (READ ONLY) shows what it will change on the DB in `.env`. `design_variations`, `orders.variation_id` and `designs.material_id` stay in the DB, DEPRECATED, never read. Codes on old prints don't change.
- **Qualities**: `design_qualities (design_id, material_id)` unique pair; a design has ≥ 1 (zod `designQualityIds`, `materialIds` in the body). Older designs without one show under **No quality** (`NO_QUALITY_LABEL`, `?quality=none`). A design in several qualities appears under each. Deleting a material deletes its `design_qualities` rows. SQL helpers in `services/designs.ts`: `designQualitiesJson` / `parseQualities`, `designQualityNames` (inventory header `quality` = "A, B").
- **API**: `GET /designs?quality=<id|none>&search=` · `GET /designs/qualities?search=&qualitySearch=&designs=N` (`DesignQualityGroup[]`: one per quality with designs, by name, No quality last; newest N designs each — one window query) · `GET /designs/check-codes?codes=` · `POST /designs/bulk {designs:[{code,name?,imageUrl,thumbUrl,materialIds,buttaCutting}]}` (one transaction, all or nothing, field errors `designs.<i>.code|materialIds`) · variation routes removed. A design uploaded from the order form gets the ORDER's quality (`insertDesignFromOrder`).
- **Permissions**: `canViewDesignLibrary` (Jenish, Gaurang, Dhruvil) gates the designs router + client routes; `canManageDesigns` (Jenish + Gaurang — the spec names both, so Gaurang now manages designs) gates writes, bulk and design uploads. Dhruvil: nav item "Design library" (`hideWith: canViewMasters`), no write buttons, server 403.
- **Inventory keys** are `d-<id>` | `none` (`inventoryKey({designId})`). `parseInventoryKey('v-9')` = `legacy_variation`; `inventoryRouter.param('key')` → `resolveInventoryKey` maps it through `design_variation_map`, so old links answer as the new design (header `key` = `d-…`).
- **Client**: `features/masters/designs/` — `designs-page.tsx` (level 1 quality cards `QualityCard`; `?quality=` = that quality's designs; first-level search shows matching designs above matching qualities; `DesignCard` shows "+2 qualities"), `design-detail-page.tsx`, `design-form.tsx` (Qualities required; `initialQualities` from a quality page), `qualities-select.tsx` (MultiSelect + chips + quick-add material via the exported `MaterialFormDialog onSaved`), `upload-many-page.tsx` (`/designs/upload`, full screen: pick / drop many images → background upload 3 at a time with retry → review grid with Apply quality / butta to all, live code check incl. the page → Add all → quality view). Saved designs drawer: library grouped by quality (`orderQualityGroups`: the order's quality first, No quality last), "Show all N" per group, one tap picks; `qualityOnPick` → keep / fill in the single quality / `QualityChooser` ("Which quality?").
- **Sections per beam**: `jobsheets.sections` (1–12, default 3; `SECTIONS_PER_BEAM` is only the default). Every pcs figure = effective frames × THAT jobsheet's sections: shared `jobsheetPcs` / `coveragePieces` / `latestSections`, `orderJobsheetPlan` (frames needed = ceil(pcs ÷ latest run's sections), `Coverage.sections`), `coverageWarnings` (on target when pcs cover the order by < one frame), `jobsheetQuantityWarning(ordered, currentPIECES, addFrames, sections)`, `planJobsheets(pieces, fpj, sections)`; SQL `liveJobsheetPieces`, the dashboard bar, inventory "in making", mill expected. Generate / single take `sections` (default 3); PUT takes optional `sections` (Pending only); change machine, hold remaining and auto-adjust copy the source / last jobsheet's sections. UI: Sections field in Create / Add / Edit (live preview "304 pcs ÷ 4 sections = 76 frames"), "Frames needed (at N sections)", "× 4 sections" on cards, jobsheet details, taka entry pcs warning (frames × js.sections), print "Sections: N" under the pcs.
- **Outside order** (not Sprint 16's Outside production): `orders.is_outside_order`, `outside_party_name` (required when ticked, cleared when unticked). Checkbox + Party name on Add / Edit order; violet `OutsideOrderTag` ("Outside order · party") on card, header, Order details (roles with `canSeeClient`; the server blanks the name for others); list filter `outside=yes|no` (`OUTSIDE_ORDER_FILTERS`) + chip; search matches the party name.
- **GR (§6)**: verified end to end by `check-sprint18.mjs` — lump (3 returned, 1 damaged → DC-n R1 without them, free stock 2 fresh + 1 damaged, Inventory → Damaged, Add from free stock to another order, Returned status, both prints, Docs, Dispatched, history) and pcs to pcs (return lot 15 pcs / 4 damaged, R1 = 45 pcs, Returned, usable via Add from free stock). No fixes were needed.
- Not done / to check: apply migration 0017 on Turso (export a backup first; run `npm run db:s18-report`, then `npm run db:migrate`; needs 0010–0016); no 360 / 768 / 1024 / 1280px screenshot pass (the Chrome extension was not connected) and no real phone / tablet check of Upload many, the drawer groups, the chooser or the Sections fields.

## After Sprint 18 — small changes

- **Butta / Mill Send → Pending cards**: a small ↗ button top-right of each order card opens the takas side panel (the same `TakasDrawer` as tapping the card); ready takas are pre-selected, untick to keep some back.
- **Inventory leaves out fully dispatched orders** (`DISPATCHED_ORDER_STATUSES` = `dispatched`, `returned` in `shared/inventory.ts`): `loadOrderPcs` skips them, so they are not in Ordered, the figures or an item's order list (Partly dispatched orders stay). An item card stays listed when it has free stock even if all its orders are dispatched. **History** button on the item's Orders section → `/inventory/items/:key/dispatched` (`GET /inventory/items/:key/dispatched`, `listDispatchedItemOrders`: ordered / dispatched pcs, last delivery challan date, challan count).

## Sprint 20 — Yarn lots, boxes, pending programs / jobs, Yarn inventory supervisor (read this before touching yarn; it supersedes Sprint 17 where they differ)

Spec: `rivoora-sprint20-yarn-lots-boxes-prompt.md`. ONE migration: `0019_wet_nomad.sql` (phase 1, additive only: tables `yarn_lots`, `warping_qualities`, `yarn_boxes`, `tfo_pending_programs`, `warping_pending_jobs`, `warping_pending_job_inputs`, `yarn_receipt_line_allocations`; nullable columns `lot_id` / `box_id` / `warping_quality_id` on the ledger and inputs, `beams.beam_code` (backfilled `BM-<n>`) + `beams.warping_quality_id`, `tfo_programs.lot_id` / `pending_program_id`, `warping_jobs.pending_job_id`, `yarn_qualities.is_system` + ONE reserved "system" quality row). `migrate.ts` snapshots every zone / item / quality balance and the program / job / beam counts before and compares after. `db:migrate` also creates the default user **Yarn supervisor 2222222222**. Phases 6–10 need no migration. Check scripts: `scripts/check-sprint20.mjs` + the updated `check-sprint17.mjs` (local file DB only). Tests: `shared/src/yarn20.test.ts`.

- **Ledger scopes.** Raw rows carry `lot_id` (null = "No lot": pre-Sprint-20 stock + manual adds). Twisted rows: a TFO box → `box_id` + `warping_quality_id`, and `quality_id` = the SYSTEM row (`systemQualityId()`; never pickable — lookups / `qualityNames` exclude `is_system`); "No box" twisted = old rows under a YARN quality, or manual adds under a WARPING quality (system `quality_id` + `warping_quality_id`). `balanceG` / `reservedG` / `takeStock` take a `StockScope` `{lotId?, boxId?, warpingQualityId?}`. Reads that group by quality must exclude `is_system` and list warping-quality stock separately (`YarnZoneData.warpingQualities`, `noBox`, `listNoBoxStock`); movements show the box / warping quality name.
- **Reservations.** Pending TFO programs reserve TFO raw (quality + lot); pending warping jobs reserve their Warping inputs (lot / box / no-box bucket). `takeStock` subtracts `reservedG` for every take (transfers, withdraw, manual remove), so reserved yarn can't leave; pickers show "X available · reserved Y" (`availableText`; lot picker `own` adds back what the program / job being edited holds). Creating / editing pending rows inserts first, then `assertReservationFits` (409, transaction rolls back). Starting marks the pending row `started` FIRST, then issues.
- **TFO** (`services/yarn-tfo.ts`): `POST /yarn/tfo/pending {programs:[…]}` (`canPlanYarn`: owners; many at once; direction S / Z / SZ) · `PUT /yarn/tfo/pending/:id` · `POST …/:id/cancel` · `POST …/:id/start {machineId, section}` (floor) · `POST /yarn/tfo/programs/:id/stop {warpingQualityId, boxes:[{boxNo, rolls, grossKg, netKg ≤ gross, avgKg, zone: tfo|warping|direct}], returnedRawKg?, twistedMeters?, note?}` → boxes (unique box no any case, `GET /yarn/boxes/check`), `tfo_output` per box into TFO, then one transfer per destination; returned raw back on the program's lot. The old direct start endpoint is gone. `GET /yarn/tfo/board` also returns `pending` and `rawStock` with reserved / available.
- **Warping** (`services/yarn-warping.ts`): `POST /yarn/warping/pending {inputs:[{kind:'raw',qualityId,lotId}|{kind:'box',boxId}|{kind:'no_box',qualityId|warpingQualityId}, qtyKg], taar, panna, meters | fullMeter, note}` (owners) · `PUT` / `cancel` / `start` (floor; start = WJ-n, a box at 0 → Used) · `POST /yarn/warping/jobs/:id/done {beams:[{beamCode, warpingQualityId, taar, panna, meters, zone}]}` (typed beam no. unique any case incl. old `BM-n`, `GET /yarn/beams/check`; meters required per beam; `beam_no` still comes from the counter, internal only). Show beams by `beamCode` everywhere (`YarnMove.beamCodes`). Beam quality shown = warping quality, else the old yarn quality.
- **Manual add / remove** (`canAdjustYarnStock`: Jenish, Gaurang): `POST /yarn/adjustments/add` (raw → No lot, twisted → No box under a warping quality; kind `manual_add`) · `POST /yarn/adjustments/remove` (raw / boxes + kg / no box / beams; remark required; kind `manual_remove`; beams get the new status **`removed`** + beam move `removed` — `consumed` stays "used on a loom"). Rows of one action share `ref_type = 'adjustment'`, `ref_id` from counter `yarn_adjustment_no` (no table). Movements filter `manual`.
- **Roles.** New `yarn_supervisor` ("Yarn inventory supervisor", English, landing `/yarn`): `canViewYarn` + `canReceiveYarn` + `canUseYarnInventory` (= `YARN_FLOOR`) only. The production supervisor keeps `YARN_FLOOR`; the **godown supervisor has no yarn access** any more. `canPlanYarn` (create programs / jobs) and `canAdjustYarnStock` are owners only. Warping-quality quick add stays open to `canUseYarnInventory` (needed on Stop / Mark done). Role matrix: `docs/flows/ROLE_MATRIX.md`.
- **Client** (`client/src/features/yarn/`): `tfo-board.tsx` (programs lists, Create programs rows, Edit, Start = machine / section tiles, full-screen `MachineViewDialog`), `tfo-stop.tsx` (box grid on tablets, cards on phones, totals in the footer, "N boxes stay in TFO" confirm), `warping.tsx` (job form with Raw / Box / No box rows, Full meter, Mark done beams grid with live beam-no check), `manual-stock.tsx`, `zone-stock.tsx` (Stock tab cards), `zone-page.tsx` (tabs in `?tab=`: TFO Running | Pending | Stock; Warping In process | Pending | Stock | Beams | Done; Direct Stock | Beams), `stock-dialogs.tsx` (`useStockPick` exported: lot-aware raw, "No box" from `/yarn/no-box`, boxes respect reservations), `parts.tsx` (`LotSelect` with reservations, `WarpingQualitySelect` with ➕). Receive challan: summary on the right from 1024px.
- Not done / to check: real phone / tablet check of the new screens; the Turso migration (see PROJECT_STATE.md Sprint 20).

### Sprint 20b — client feedback on TFO + 4 decimals of kg (read this; it supersedes the Sprint 20 TFO notes where they differ)

Migration `0020_sprint20b_tfo_rolls_sections_units.sql` (additive DDL + two checked data changes in the same transaction; `migrate.ts` confirms every yarn balance / PO / box / program total is exactly ×10 afterwards, and the 0019 balance check accounts for it when both run together).

- **Yarn units are TENTHS OF A GRAM**: 1 kg = `UNITS_PER_KG` = 10,000; kg have up to 4 decimals (`KG_DECIMALS`). The `*_g` columns, `*G` DTO fields and `kgToGrams` / `gramsToKg` keep their names but mean these units — 0020 multiplied every older yarn quantity by 10. `amountPaise` divides by 10,000. Client code must use `gramsToKg` / `kgText` (never `/ 1000`). Yarn number inputs (TPM, panna, meters, winding / roll / box kg) take 4 decimals; the PO rate stays 2 (money in paise).
- **Create program**: raw quality · lot · **rolls** · **winding kg** → raw kg = rolls × winding kg (`rawFromRolls`; worked out by the server, read-only on screen) · TPM · direction · denier / filament · note. No output quality (the Sprint 17 column `output_quality_id` is filled with the raw quality, unused). Columns `rolls`, `winding_g` on `tfo_pending_programs` / `tfo_programs`; `winding_meter` is old data only.
- **Start on several sections**: `POST /yarn/tfo/pending/:id/start {sections:[{machineId, section}]}` — any machines, both sections of one machine allowed. Table `tfo_program_sections` (partial unique running row per machine + section; backfilled from every program); `tfo_programs.machine_id/section` = the first section. Board, history (`?machineId=&section=` via EXISTS), machines master "running" and movement context ("Machine 3A, 3B, 5A", `programSectionsLabel`) read the sections table. One Stop frees every section.
- **Stop**: `{rollWeightKg, boxes:[{rolls, grossKg, avgKg?, direction? (S/Z, only for S + Z programs)}], returnedRawKg?, twistedMeters?, note?}`. Net = gross − roll weight × rolls (`boxNetG`; must be > 0); avg kg optional (stored 0 = empty, DTO null); box numbers from counter `yarn_box_no` starting at 1, skipping numbers already used; every box stays in TFO (no destination; move later with Transfer); output quality per direction = `tfoOutputQualityName` → "75/36 Poly 75D-600-S" (denier/filament, space, raw quality-TPM-direction), found case-insensitively in Warping qualities or created there. `tfo_programs.roll_weight_g` keeps the roll weight. The live box-no check endpoint is gone.
- Stock tab groups boxes under their quality ("2 boxes · 7.7 kg").

### Sprint 20c — stock screen, part start, TFO withdraw, auto beam numbers (read this; it supersedes Sprint 20 / 20b where they differ)

Migration `0021_sprint20c_beam_remark.sql` (additive: `beams.remark`). Tests in `shared/src/yarn20.test.ts` ("Sprint 20c"), API flow in `scripts/check-sprint20.mjs`.

- **Stock screen** `/yarn/:zone/stock` (`features/yarn/stock-page.tsx`; the zone screen shows a Stock card that opens it, its Stock / Beams tabs are gone and old `?tab=stock|beams` links redirect). URL: `view=beams` (zones with beams), `q`, `type=raw|twisted`, `quality=r-<yarn quality>,w-<warping quality>`, `group=program|quality` (default program in TFO, quality elsewhere). Filtering is client-side over `GET /yarn/zones/:zone`, which now also returns `programs: YarnBoxProgram[]` (sections label, raw quality, lot, TPM, direction, rolls, dates) for its boxes.
- **Part start**: `POST /yarn/tfo/pending/:id/start {sections, rolls?}` — `rolls` < the program's rolls starts that many (raw = rolls × winding kg) and the pending row keeps the rest (rolls + raw_g reduced, still reserved, `startedProgramId` unset); `checkStartRolls` / `START_ROLLS_ERROR_TEXT` in shared. Older programs without rolls start whole.
- **Withdraw in TFO**: `yarnWithdrawSchema` zone = `WITHDRAW_ZONES` (`direct`, `tfo`; beams Direct only); box `qtyKg` null = whole box; in TFO a box always goes whole (`withdrawWholeBoxes`). The TFO zone panel / header have a Withdraw button (`zoneHasExtraWithdraw`); `WithdrawDialog` takes `zone`. In Direct, ticking a box pre-fills its whole free kg.
- **Beams at Mark done**: body `beams: [{warpingQualityId, taar, panna, meters, remark?}]` (a typed `beamCode` / `zone` from old clients is ignored). Beam no. = counter `yarn_beam_code_no` ("1", "2", … skipping any code already used, any case, incl. `BM-n`); every new beam is created in **Warping**. `GET /yarn/beams/check` and `useCheckBeamCode` are gone. `Beam.remark` = `beams.remark`, else the job's done note; shown after the meters (stock screen, beam pickers).

## Sprint 21 — FG type, Hold by Gaurang, Close only when cleared, Complete without frames, own taka edit, auto receipt numbers, shrinkage, undo / correct actions, challan edit / lost, undo dispatch, overdue alerts (read this; it supersedes older notes where they differ)

Spec: `rivoora-sprint21-orders-production-dispatch-prompt.md`. ONE migration `0022_loud_callisto.sql` (additive only: tables `challan_events`, `dispatch_challan_events`, `qc_runs`; nullable columns `challans.transport / vehicle_no / notes`, `challan_takas.lost_at / lost_by`, `dispatch_challans.vehicle_no / notes / cancelled_at / cancelled_by / cancelled_reason`, `takas.stage_before_rework`; `orders.fg_type` DEFAULT 'saree' so every old order is a Saree). Tests: `shared/src/sprint21.test.ts`, `closeBlockers.test.ts`, `overdue.test.ts`; API flow: `node scripts/check-sprint21.mjs` (local file DB only). Not applied to Turso yet.

- **A · FG type** (`shared/fgTypes.ts`): `orders.fg_type` saree | suit, required Segmented on Add / Edit order (default Saree), chip on cards / header, Order details, jobsheet print ("FG: Saree"), supervisor + taka entry cards, filter `GET /orders?fgType=`; a change writes an `order_events` row `fg_type_changed` ("FG type Saree → Suit"). Not on the delivery challan. A2 (Gaurang + Dispatched) was already in place.
- **B · Hold / Close**: `canHoldOrder` now Jenish + Gaurang (either releases). **Close** (`shared/closeBlockers.ts` `closeBlockers()`, `services/close-order.ts`): blocked (409 with the list) while a jobsheet is Sent / Ongoing, a Completed jobsheet has no takas, takas are `at_butta` / `butta_qc` / `at_mill` / `mill_qc` / `refinish` / `rework_butta`, or an outside PO is open; Pending jobsheets are cancelled, takas with us become free stock, dispatched stay, `lost` takas stay; a held order can be closed (the hold ends; `close` removed from the hold-guard write rule). The "frames entered" step is gone. The dialog shows the blockers (cards / 2-col / table) or the summary.
- **C1 · Complete without frames**: `POST /jobsheets/:id/complete` takes nothing (`completed_frames` stays NULL → "Waiting for taka entry" chip). `services/jobsheet-frames.ts` `syncCompletedFromTakas` runs in the same transaction after taka entry / Edit takas / own edit: pcs orders `completed_frames = round-half-up(Σ pcs ÷ sections)`, meter orders `completed_meters = Σ meters ÷ sections` (shared `framesFromTakaPcs`, `metersFromTakaMeters`). Change machine / Hold / Close still ask frames.
- **C2 · Taka entry edits his own takas**: `canEditOwnTakaEntry`; `takaEditableAtEntry(taka, firstStage)` = still in the first stage of the order's route (`nextTakaStage(order,'taka_entry')`), not free stock / allocated / a split part. `GET|PUT /jobsheets/:id/takas/entry` reuse the Edit takas core (`editTakasCore(..., own)`): numbers never change, new rows get automatic numbers and only while ALL takas are editable, locked rows → 409 "Taka N has already gone to … — ask Jenish / Gaurang" (bilingual). `TakaJobsheetItem.editableCount` decides the "Edit takas / टाका बदलें" button on Done cards; `OwnEditTakasDialog` (tablet = 2 takas side by side).
- **D · Receipts + shrinkage**: outside / FG lump receipts take OUR number from the taka-entry counter (`allocateTakaNumbers`); the weaver's own number is optional (`takas.weaver_taka_no`, `validateWeaverTakaNos`), `has_own_number` = true; the receipt form shows "Auto". Godown ⋯ → **Edit taka** = actual pcs + actual METERS (all orders; `PATCH /godown/takas/:id` already accepted both). `orderShrinkage()` (shared/godown.ts) + `GET /orders/:id/shrinkage` → "Metres" block on the Order details tab (expected / actual / shrinkage % / gain).
- **E · Undo**: `takas.stage_before_rework` is written by `sendBackTakas`; `POST /orders/:id/takas/undo-send-back {takaIds, reason}` (`canReworkTakas`) works only while the taka's LAST event is that `sent_back` and it is still `rework_butta` / `refinish` (not on a challan); falls back to `final`. Order Takas tab: Select → "Undo send back (n)". **QC corrections** (`canUndoQc`: Jenish, Gaurang, supervisor; `/qc-corrections` screen + nav): `qc_runs` stores what each Butta / Mill QC submit changed (`services/qc-runs.ts`: damage snapshot before + ids added); `POST /qc-corrections/:takaId/undo-qc` (the taka's last event must be the QC's own, stage unchanged, not ticked in the godown) restores damages exactly and returns the taka to `butta_qc` / `mill_qc`; `/cancel-refinish` → `final`. Every reason uses the shared `<ReasonDialog>` (min 3, max 300; `REASON_MIN/MAX`, `reasonField` in schemas.ts). QC submits made before migration 0022 have no run and cannot be undone.
- **F · Challans**: `canEditChallan` (owners + godown supervisor): `PUT /butta|mill/challans/:id` (party, date, e-way, transport, vehicle, notes; history in `challan_events`), `POST …/remove-taka {takaId, reason}` (only unreceived; the `challan_takas` row is deleted, the taka goes back to its waiting stage; last taka → challan cancelled). `canMarkLostAtParty` (Gaurang only): `POST …/mark-lost` / `undo-lost` → taka stage **`lost`** (`TAKA_STAGES`, dashboard sub-stage "Lost at party" card; left out of totals / bar / done checks and of the order status recompute; Close never frees it); the row's `lost_at` counts as settled (`lostSql`); list chip "N lost".
- **G · Dispatch**: `canUndoDispatch` (Dhruvil, Jenish, Gaurang): `POST /dispatch/challans/:id/undo {reason}` — latest ACTIVE DC, 409 when a goods return touches it; takas back to `ready_dispatch`, DC status **`cancelled`** (+ reason; number never reused; print = CANCELLED watermark + reason, red badge in lists / Docs), events `dispatch_undone`, order status recomputed, order history line. `PUT /dispatch/challans/:id` edits date / transport / LR / vehicle / e-way / notes of an active DC (no new revision; `dispatch_challan_events` history). Order milestones and inventory ignore cancelled DCs.
- **H · Alerts** (`shared/overdue.ts`, `OVERDUE_LIMITS`: production 3 d from `started_at`; butta 3 d / mill 8 d from the challan date per pending taka; whole order 25 d Jenish / 20 d Gaurang + supervisor from the first jobsheet start until dispatched / closed; "sent short" for Dispatched / Closed orders with dispatched < ordered, owners only). `GET /alerts?type=` (`canViewAlerts`: Jenish, Gaurang, supervisor) is computed on request (`services/alerts.ts`; held / closed orders left out); client `features/alerts` (page: cards / 2-col / table + type Segmented, nav item with a count badge, red "Overdue" chip on order cards, banner on the order page). No push / SMS.
- **Not built (by the spec)**: the hold notification to Supervisor + Gaurang (agreed, prototype only); finished stock / goods return changes (Sprint 22); FY numbering, QC login limits (23); yarn (24); insight dashboards (25).
- **To check**: apply migration 0022 on Turso (export a backup first; `npm run db:migrate`); no 360 / 820 / 1180 / 1440 px screenshot pass yet; `check-sprint16.mjs` still asserts the old "code + weaver number" receipt numbering (superseded by CR-07); challan prints do not show "W <weaver no>" next to our number; the Butta Send / Mill Refinish pending lists have no Undo send back button (the order Takas tab has it).

## Sprint 22 — Finished stock, goods return against the party, inventory by quality (read this; it supersedes older inventory / goods-return notes where they differ)

Spec: `rivoora-sprint22-finished-stock-gr-inventory-prompt.md`. Built on top of Sprint 21 (branch `sprint-22` starts from `sprint-21`). ONE migration `0023_fuzzy_weapon_omega.sql` (additive: tables `damaged_lots`, `damaged_lot_takas`, `party_returns`, `party_return_takas`, `party_return_lines`, `party_return_line_damages`, `party_return_images`; it also relies on the Sprint 19 columns `orders.is_stock_holder`, `takas.removed_*`, table `stock_adjustments` that were already in 0018). Tests: `shared/src/sprint22.test.ts`; API flow `node scripts/check-sprint22.mjs` (local file DB only, ~55 checks). **Not applied to Turso** (apply 0022 first).

- **A1 · Meter stock**: Move to inventory / Add from free stock now work for meter (all-over) orders (whole takas; they are always lump). Pcs and metres never mix: `loadFreeCandidates` refuses cross-unit (409 "This stock is in metres — … meter order only"), assign targets carry `unit`, the free-stock list carries `unit` and actual metres. Shared `shared/src/stock22.ts`: `DualStock { pcs, meters }`, `dualText(pcs, m)` ("1,240 pcs · 860.50 m"), `orderInventoryMeters()` (the meter twin of `orderInventoryPcs`). The legacy pcs-only inventory screens are unchanged; the new screens use the dual read model.
- **A2 · Dummy taka numbers**: `nextDummyTakaNo(tx)` (taka-ops.ts, counter `dummy_taka_no`, D01 … D99, D100 …, never reused; Sprint 23 makes it yearly in this one helper). Used by manual Add stock, goods-return lines without taka numbers. Chips show a grey "dummy" hint (`isDummyTakaNo`). Users never type them (validation unchanged).
- **B · Manual stock** (`canAdjustFinishedStock`: Jenish + Gaurang): `services/stock-adjust.ts`. **Holder orders** (`holderOrderId`): one hidden order per (design, quality, unit, blouse) — `is_stock_holder = 1`, status `closed`, `order_no` NEGATIVE (counter `stock_holder_order_no`), customer = the reserved "Stock (system)" customer. Exclusions: `listOrders`, inventory `orderScope`, hold-guard (`/orders/:id/*` → 404 for a holder), `formatOrderNo` / `jobsheetRef` / `jobsheetRefShort` show "Manual stock" for a negative number — never show or build text from a raw `orderNo`; use `orderRefText`. `POST /inventory/stock/add` (ONE free-stock taka, stage `final`, reason `manual_add`, damaged → open damage of any of Machine / Butta / Mill / Supervisor), `POST /inventory/stock/remove` (tick takas, or a pcs amount: planPcsMove + split; reason Sold / Sample / Lost / Damaged-scrap / Other (+ note); takas get `is_deleted` + `removed_at/by/reason`), `GET /inventory/stock/removable`, `GET /inventory/stock-adjustments` (filters kind / dates / design / user). Every add / remove writes `stock_adjustments` + a taka event (`stock_added`, `stock_removed`).
- **C · Damaged lots** (`services/damaged-lots.ts`): `POST /inventory/damaged/lots` (damaged FREE takas only; open damages closed with `resolved_stage = 'sold_lot'`; takas removed with reason `sold_lot`; `damaged_lots` DL-n from counter `damaged_lot_no`), `GET /inventory/damaged/lots[/:id]`, `GET /inventory/damaged/free-takas`. The amount is null for roles without `canSeeRate`. Lot print: not built.
- **D · Goods return against the party** (`services/party-returns.ts`, router `/party-returns`, `canGoodsReturn`: Dhruvil, Jenish, Gaurang): GR-n (counter `party_return_no`), Pending → organise lines → Complete. Received as Pcs / Meters / Takas (never mixed). Takas mode: our dispatched takas of that client, one line each; Complete moves them dispatched → free stock (`goods_return`, damage marks → open damages) and recomputes their order's status. Pcs / meters mode: per design line a fresh free-stock taka + a separate damaged taka (several damage rows), dummy numbers, owner = the holder order. Complete needs organised = received; the GR is read-only afterwards. **No DC revision and no Returned order status** for new returns; the old challan-linked GR (`/dispatch/challans/:id/goods-return`) stays for old data but its button was replaced by a link to the new flow. Client: `features/stock/goods-return-*.tsx` (nav item Goods return).
- **E · Inventory screens**: `/inventory` = qualities (`GET /inventory/qualities`, search quality / design code, filters has free stock / has damaged / Saree / Suit), `/inventory/quality/:materialId` = design cards (`GET /inventory/qualities/:id/designs`, sort free-first / code), design details (`/inventory/items/:key`, unchanged sections) now start with the dual quantity tiles (`GET /inventory/items/:key/quantities`) and the actions Create order · Add stock · Remove stock (+ the existing Assign to order). Old URLs keep working: `/inventory?section=damaged` and `?view=designs` render the earlier all-designs screen. `/orders/new?designId=&qualityId=` pre-selects the design and its quality (new orders only). `services/stock-qualities.ts` is the read model (`loadStockCells`: one cell per quality + design, both units).
- **Not built / to check**: the lot print; "Create order" on a design in several qualities uses the quality it has stock in, else its first; the legacy KPI tiles on the all-designs screen are still pcs only; no browser / 360–1440 px screenshot pass; apply migrations 0022 + 0023 on Turso (backup first).

## Sprint 23 — financial-year numbering, QC login limits (read this; it supersedes older numbering notes)

Spec: `rivoora-sprint23-fy-numbering-qc-login-prompt.md`. Plan + decisions: `docs/plans/sprint-23-plan.md`. Migrations `0024_easy_red_hulk.sql` (Phase A: `fy` columns + documented backfill from `created_at` in IST, unique indexes become per FY — the old global ones are DROPPED and recreated) and `0025_tiresome_tarot.sql` (Phase B: 5 new tables + nullable / defaulted `sessions` columns, additive). Tests: `shared/src/fy.test.ts`, `sprint23.test.ts`, `loginLimits.test.ts`; API flow `node scripts/check-sprint23.mjs` (local file DB only; it starts extra servers with `FY_NOW` to simulate the year change). Not applied to Turso.

- **FY rules** in `shared/src/fy.ts` (`fyOf`, `currentFy`, `fyShort`, `counterNameFor`, `numberWithFy`; India FY 1 Apr – 31 Mar, Asia/Kolkata). Server clock `server/src/lib/fy-clock.ts` (self-contained so drizzle-kit can load schema.ts): `currentFyNow()`, env `FY_NOW=YYYY-MM-DD` (tests only) and `NUMBERING_START_FY` (default `2026-27`).
- **ONE number generator**: `server/src/lib/numbering.ts` `nextNumbers(tx, key, n, {fy, first})` / `nextNumber` / `peekNextNumber`. Up to and including the start FY the old global counter row (`jobsheet_no`, `taka_no`, `butta_challan_no` …) simply continues — live numbering does not jump or restart before **1 April 2027**. Later FYs use rows `"<key>:<fy>"` starting at `first` (1; taka numbers `TAKA_NO_START` = 11). Orders use `MAX(order_no)+1` within the FY. **Every new automatic number must go through this helper.**
- **`fy` column** on the 12 numbered tables (orders, jobsheets, takas, challans, dispatch_challans, party_returns, damaged_lots, outside_pos, yarn_pos, yarn_boxes, warping_jobs, beams). Schema: `.default('2026-27').$defaultFn(currentFyNow)`. **Gotcha:** Drizzle uses a static `.default()` BEFORE `$defaultFn` on insert, so `db/client.ts` clears the static default of every `fy` column at runtime (`FY_COLUMNS`); the DDL keeps the constant default (SQLite ADD COLUMN needs one). Never add a raw-SQL INSERT into these tables without `fy`. A DC revision copies its parent's `fy`.
- **Uniqueness is per FY**: `(fy, number)` (challans `(kind, fy, challan_no)`, DC `(fy, challan_no, revision)`, takas `(fy, taka_no) WHERE not deleted`, boxes / beam codes `(fy, lower(code))`).
- **Lookups by number** (taka number box, Butta / Mill receive, QC, scan, `/jobsheets/by-no`): current FY first; if nothing matches there, every older match — one → that one, several → `candidates` (each with `fy`) and the "Which one?" picker (`numberWithFy`: "6245 · Order #26 · 2026-27"). QC corrections answer an ambiguous number with a 409 listing the years.
- **QR**: new prints encode `/j/<fy>/<no>` (`jobsheetQrUrl(base, no, fy)`); `parseJobsheetQrFull` reads both forms, old `/j/<no>` keeps working (route `j/:fy/:jobsheetNo` + `j/:jobsheetNo`; API `GET /jobsheets/by-no/:fy/:no`). Lists sort by `fy` then number (or by date). Only TFO / Palti box numbers will SHOW the year (Sprint 24).
- **QC login limits (C10)**: only the role `qc` (`isLoginLimited`); owners "viewing as QC" are not limited. Pure rules in `shared/src/loginLimits.ts` (`allowedUntil(now, hours, grants)`, `checkLocation` = haversine ≤ radius + accuracy capped at 100 m; no active place configured = place not checked; messages bilingual). Server `services/login-limits.ts`: login check (`checkQcLogin`: first try without a location → 403 `location_required`, the client reads the GPS and retries, or sends `locationDenied` → refused with the explanation), `sessions.valid_until` checked on EVERY request (401, `error.field = 'session_ended'`, bilingual "Your login time is over"), `POST /auth/heartbeat {location}` every 5 min + on focus (re-checks time + place; 2 heartbeats in a row outside ends the session), refusals / forced logouts in `login_limit_log` (last 30 days), every settings change in `login_limit_changes` (who, when, before → after). Tables `login_limit_settings` (one row: enabled, 08:30–19:20, days Mon–Sun), `login_locations` (name, lat, lng, radius 200 m, active), `login_time_grants` (QC user, date, until, reason, active | cancelled).
- **API** `/login-limits` (`canManageLoginLimits`: Jenish + Gaurang): `GET /` (settings, places, grants, QC users, change history), `PUT /settings`, `POST|PUT|DELETE /locations[/:id]`, `POST /grants`, `POST /grants/:id/cancel`, `GET /log`. `AuthUser.limitUntil` = the session end for QC.
- **Client**: `features/settings/login-limits-page.tsx` (`/settings/qc-login`, in the Masters hub; places full width on top, hours + extra time side by side on tablets, log + settings history; "Use my current location"), `features/auth/qc-session-bar.tsx` (QC bar "Logged in until 7:20 pm / शाम 7:20 तक", heartbeat, toast 10 min before the end), login page asks for the location (bilingual note) and shows the reason a session ended (`authStore.takeSignedOutMessage`).
- Not done / to check: apply 0022 → 0025 on Turso (backup first; 0024 drops and recreates 13 unique indexes — see the plan); no real-phone GPS check; no 360 / 820 / 1180 / 1440 px screenshot pass of the Settings screen; the login rate limit and the QC checks run per request (no push); `check-sprint16.mjs` still asserts the old receipt numbering.

## Sprint 24 — Yarn: combined lots, withdraw purpose, TFO hold, warping leftover, Palti, box stickers (read this before touching yarn; it supersedes Sprint 17 / 20 / 20b / 20c where they differ)

Spec: `rivoora-sprint24-yarn-changes-prompt.md`. Plan + decisions: `docs/plans/sprint-24-plan.md`. ONE migration `0026_sprint24_yarn.sql` (additive: tables `tfo_program_events`, `palti_runs`, `palti_run_inputs`; columns `yarn_withdrawals.purpose` (DEFAULT 'in_house') / `party_name` / `rate_paise`, `tfo_programs.rolls_made` / `rolls_done` (DEFAULT 0) / `held_at`, `warping_jobs.denier` / `used_g` / `leftover_g`, `yarn_boxes.kind` (DEFAULT 'tfo') / `program_event_id` / `source_job_id` / `palti_run_id`; plus ONE system row: a deleted machine 0 "System (Palti)" and a `tfo_programs` row with status `system`). Tests: `shared/src/sprint24.test.ts`; API flow `node scripts/check-sprint24.mjs` (local file DB only, 57 checks). **Not applied to Turso** (apply 0022 → 0025 first; export a backup).

- **A · CR-16 combined lots**: a challan line whose party + lot no. match an existing lot (lot no. compared without case, otherwise exactly: "245a" = "245A", "245" ≠ "245A" ≠ "245-A") ADDS to that lot when the quality is the same (`matchLots` in `services/yarn-po.ts`; no new `yarn_lots` row, allocations add stock to the same lot); another quality → 400 on `lots.<i>.lotNo` (`lotQualityClashText`). The same lot twice in ONE challan is still refused. `GET /yarn/lots/check` returns `YarnLotCheck {available, lot: {quality, receivedG, challans}}`; Receive shows "New lot" / "Existing lot · 600 kg received earlier (challan 77)" / the quality clash under the field.
- **B1 · CR-17 withdraw**: `WITHDRAW_ZONES` = all three zones; `withdrawWholeBoxes(zone)` = not Direct (TFO + Warping withdraw whole boxes); beams in Direct + Warping. Every withdraw needs `purpose` `sell` (party required, `rate` ₹/kg optional) | `in_house` (party / rate dropped). Movements: `?purpose=` filter (`mpurpose` in the URL) and a purpose tag; `YarnMove.withdrawal = {purpose, partyName, ratePaise, rateEntered}` — `ratePaise` only with `canSeeRate` (the supervisors see "rate entered"). `listMoves(q, {showRate})`, `yarnSummary(showRate)`.
- **B2 · CR-19 program-wise pickers**: `YarnBox.kind` + `fy`; `boxGroupKey` (`p-<programId>`, `palti`), `tfoProgramLabel(id)` = "P-12" (programs have no number). `BoxChecklist` (Transfer / Withdraw / manual remove) groups By program | By quality (localStorage `rivoora.yarn.boxGroup`, try/catch), a tick per group, the selected list + totals on the right from 768px, a sticky "N boxes · X kg" bar on phones. Zone `programs` exclude the Palti system row.
- **C · CR-20/21 TFO hold**: statuses `running | on_hold | box_pending | completed` (`TFO_PROGRAM_STATUS_CONFIG`; `system` is internal). Endpoints (floor roles): `POST /yarn/tfo/programs/:id/hold {rollsMade, rollsLeft, reason?}` (made + left = rolls started, made ≥ rolls already boxed — `checkHoldRolls`; sections freed), `/resume {sections}` (idle sections like Start; `tfo_programs.machine_id/section` move to the first new one — the running unique index sits on it), `/part {rollWeightKg, boxes, …}` ("Complete made part": rolls in boxes ≤ `partRollsLimit` — made − boxed when On hold, started − boxed when Running; completes the program when every started roll is boxed), `/stop` (Running or On hold; may have no new boxes when parts were saved), `/stop-later {note?}` (→ Box details pending, sections freed, nothing into twisted stock yet), `/boxes` (Box details pending → Completed, same body as Stop). Every step writes `tfo_program_events`; boxes carry `program_event_id`; `TfoProgram.rollsMade / rollsDone / heldAt / events`; a running program lists only its running sections. `TfoBoard.onHold / boxPending`, summary `tfo.onHold / boxPending`. Client: TFO tabs Running · On hold · Box details pending · Pending (counts); `StopProgramDialog` has `mode` stop | part | boxes (+ "Stop · enter boxes later"); `HoldProgramDialog`, `ResumeProgramDialog`, `ProgramActionDialogs`; the Machine view opens an action chooser for a running section.
- **D · CR-24 warping leftover**: Start body `{denier}` (required > 0, `warpingStartSchema`); jobs started before give it at Mark done (`denier` in the done body). At Mark done: kg used = Σ beam meters × denier × taar (the job's, else the first beam's) ÷ 9,000,000; remaining = issued − used, split by the pure `warpingLeftover()` — half / half over the LAST TWO TFO programs whose boxes were inputs (latest stop first, the odd unit to it), one program → all, none → back to the inputs by kg (raw → its lot, no-box → its bucket, a Palti box → that box again); used > issued → `overG`, nothing back (amber warning). A program's share is a **`yarn_boxes` row `kind = 'remaining'`** in Warping (rolls 0, gross = net, number from the box counter, `program_id` = the program, `source_job_id` = the job) — it works like any box. Ledger kind `warping_leftover` (Movements → Warping). `WarpingJob.denier / usedG / leftoverG / leftover[]`, `WarpingJobInput.program`. Mark done shows the summary card (`LeftoverSummary`; beams left, card right from 768px).
- **E · CR-25 Palti** (`services/yarn-palti.ts`, `/yarn/palti`, floor roles): `POST /yarn/palti {date, inputs:[{kind: box (qtyKg null = whole) | no_box | raw, zone, …}], output: {warpingQualityId, rolls?, grossKg?, netKg, zone}, note}` — inputs from ANY zone leave stock (`palti_issue`), ONE new box `kind = 'palti'` (box counter + FY, `program_id` = the system program from migration 0026, `palti_run_id`) goes into the chosen zone (`palti_output`); net < inputs = `waste_g`, net > inputs → 400. `GET /yarn/palti` = runs (`PaltiRun`). Movements filter `palti`. Client `features/yarn/palti-page.tsx` (list + New Palti box: inputs left, output right; Inputs → Output steps on phones); "Palti" button on the Yarn inventory screen.
- **F · CR-18 stickers**: `GET /yarn/boxes/print?ids=` (`YarnBoxSticker`), `GET /yarn/boxes/:id`. Print route `/print/yarn-boxes?ids=&size=label|a4` (`box-sticker-print-page.tsx`; `@page 50mm 25mm` one sticker per page, or A4 3 × 8; CSS only while mounted): box no. with the FY in brackets `15 (26-27)` (`boxNoWithFy`), quality, lot, gross / net kg, rolls, date, P-12 / Palti, QR → `/yarn/box/:id` (redirects to the box's zone stock screen). Print from the stop / part / boxes / Palti success toasts ("Print stickers"), the Palti list, each box row and a ticked selection on the stock screen. The FY bracket shows ONLY on boxes (stickers, box lists, pickers).
- Old check scripts updated for the new rules (withdraw purpose, denier at start): `check-sprint17.mjs`, `check-sprint20.mjs`; both pass, as do `check-sprint23.mjs` and `check-sprint24.mjs`.
- **Not done / to check**: apply 0026 on Turso (after 0022 → 0025, backup first); no 360 / 820 / 1180 / 1440 px screenshot pass and no real thermal-printer test of the 50 × 25 mm sticker; the Movements purpose filter lists only withdrawals (by design).
