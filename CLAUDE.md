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
Sprint 8 = Butta QC partial resolve, damage images, Mill (generic challans), Docs tab, damage details, dashboard polish (see "Sprint 8" below).
Specs: `rivoora-sprint8-mill-prompt.md`, `rivoora-sprint7-butta-cutting-prompt.md`, `rivoora-claude-code-prompt.md` (sprint 1), `rivoora-sprint2-jobsheets-prompt.md` (sprint 2),
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
- Not done / to check: real-phone checks (keyboard bars, share sheet); 360 / 768 / 1280 px screenshot pass; Mill Send → Pending drawer was only verified by reading the code (it is generic and was API-tested); apply migration 0014 on Turso (`npm run db:migrate`, after 0010–0013).
