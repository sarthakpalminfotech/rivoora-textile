# Sprint 19 — Meter (all-over) orders + manual stock adjustment (APPROVED PLAN)

> This is the approved plan. Follow it exactly. Where anything in a later draft differs, this file wins.


Spec: rivoora-sprint19-meter-orders-prompt.md. This plan is written per that spec's own "Start in plan mode" instruction.

## Working agreement (overrides the spec's own pacing where they differ)

- One phase at a time. After each numbered build-phase item: run the checks for that item, commit it, then stop and give a short report. Do not start the next phase until you say so.
- Turso is never touched without your explicit OK, given fresh each time, not just once at plan approval — this applies especially to Phase 2 (the migration), which additionally waits for you to confirm you've exported a backup.
- Nothing destructive (git history, Turso data) is touched without you confirming in the moment.

Context

The app (live on Vercel + Turso, real data) currently only produces pcs orders in-house: every jobsheet/taka/godown/dispatch/inventory code path assumes frames × sections = pcs. Orders can already be created with unit meters/kg/g, but they dead-end — no jobsheets, no taka production (confirmed gap A1.8 in docs/flows/GAPS_AND_QUESTIONS.md). Sprint 19 extends the same machinery to meter ("all-over") orders, and adds an owner-only manual stock add/remove tool for finished goods not tied to any real order.

Checked against the live DB first (§1.4): SELECT * FROM orders WHERE unit != 'pcs' → 0 rows. No existing meter/kg/gorders, no backfill needed. No is_stock_holder-type column exists yet. 18/18 migrations already applied on Turso, matching server/drizzle/*.sql exactly.

Git — corrected approach

This folder currently has no .git, but the project does have real history (last commits b4fd6be "last stage changes" and 9ce4c9f "Flow inventory for client flowcharts") that you're going to copy the .git folder in for. So:

- I will not run git init.
- Once you've copied .git in, I run git status and git log --oneline -5 and show you the result before touching anything — no commits, no staging, until you've seen it.
- If it turns out there's genuinely no .git after all, before any first commit I will: verify .gitignore coversserver/.env, .env.local, .env*, *.db, node_modules, uploads (and fix it if not, showing you the diff first); run git status and show you the full file list; and never add an origin that already has history, and never push.
- First action of Phase 1 is simply: check for .git, report what's there, and wait.

---
1. The core abstraction: shared/src/orderUnit.ts (new file)

export const isMeterOrder = (order: {unit: string}) => order.unit === 'meters';
export const qtyLabel = (unit: string) => unit === 'meters' ? 'm' : 'pcs';
export function takaQty(t: {meters: number|null; actualMeters?: number|null; pcs: number|null; actualPcs?: number|null}, unit: string): number | null;
export function formatQty(n: number, unit: string): string; // "1,250.5 m" / "1,250 pcs"
export const MANUAL_STOCK_LABEL = 'Manual stock';
export const isManualStockOrderNo = (orderNo: number) => orderNo < 0;
export function orderRefText(orderNo: number): string; // isManualStockOrderNo → MANUAL_STOCK_LABEL, else `#${orderNo}`
UNITS in shared/src/units.ts is unchanged (kg/g stay valid — old rows keep them); only the Add/Edit order dropdown stops offering kg/g.

New shared helper takaActualMeters(t) (shared/src/takas.ts, next to takaActualPcs): t.actualMeters ?? t.meters ?? null. Every place that currently reads t.meters for a "final/current" quantity after the godown stage must prefer this instead (see §8).

2. Generalizing the jobsheet maths (shared/src/jobsheets.ts)

Thread an optional unit: 'pcs' | 'meters' = 'pcs' parameter through the frames↔pieces family so every existing call site and jobsheets.test.ts stays byte-identical:
- allocUnits(quantity, sections, unit) (replaces framesForPieces): pcs → Math.ceil(quantity/sections); meters → Math.ceil((quantity/sections)*100)/100.
- quantityForUnits(units, sections, unit) (replaces piecesForFrames): pcs → units*sections; meters → Math.round(units*sections*100)/100.
- splitQuantity(total, perJobsheet, unit) (replaces splitFrames) — same remainder-to-last-jobsheet logic, 2dp rounding for meters.
- New constant METERS_ON_TARGET_SLACK = 0.05 (shared/src/production.ts) — the meters analog of "< 1 frame" in onTarget()/coverageWarnings/jobsheetQuantityWarning.
- coverageWarnings/jobsheetQuantityWarning render messages through formatQty/qtyLabel instead of hardcoded "pcs"/"frames".
- effectiveFrames/coverageFrames/jobsheetPcs/coveragePieces/latestSections get parallel effectiveMeters/coverageMeters/jobsheetMeters functions reading jobsheets.meters/completed_meters.
- orderJobsheetPlan gets a sibling orderJobsheetMetersPlan(orderedMeters, outsideMeters, list).

New tests in shared/src/sprint19.test.ts. Existing jobsheets.test.ts untouched.

3. Migration 0018_sprint19_meter_orders.sql (additive only)

New nullable columns:
- jobsheets.meters REAL, jobsheets.completed_meters REAL — a meter jobsheet stores frames = 0 (sentinel) and keeps using sections (cloth meters = meters × sections). No relaxation of frames NOT NULL (would need a table rebuild — forbidden).
- orders.meters_per_jobsheet REAL
- takas.actual_meters REAL, takas.removed_reason TEXT, takas.removed_by_user_id INTEGER, takas.removed_at TEXT (§10.2)
- taka_damages.meters REAL, taka_damages.resolved_meters REAL NOT NULL DEFAULT 0
- orders.is_stock_holder INTEGER (boolean) NOT NULL DEFAULT 0

New table stock_adjustments:
id PK, kind TEXT ('add'|'remove'), design_id FK designs.id NULL, material_id FK materials.id NOT NULL,
unit TEXT, qty REAL NOT NULL, condition TEXT ('fresh'|'damaged') NULL, taka_id FK takas.id NULL,
remark TEXT NOT NULL, role TEXT NOT NULL, user_id INTEGER NULL, created_at TEXT NOT NULL DEFAULT now

Holder-order key now includes blouse (point 3): partial unique expression index
CREATE UNIQUE INDEX stock_holder_orders_key_unique ON orders
  (COALESCE(design_id, -1), material_id, unit, COALESCE(blouse_option, ''))
  WHERE is_stock_holder = 1;
New counter row stock_holder_order_no (starts 0) and one reserved system customer row "Stock (system)" (idempotent byname) — holder orders need a non-null customer_id and there's no real customer; this avoids relaxing that NOT NULL FK. I'll also exclude this customer row from /customers and /lookup/customers so it never appears to a real user (flaggingthis as my own addition, not explicitly requested — veto it if you'd rather it just show up normally).

Data step (guarded, aborts on mismatch): same conditional order_type='lump' backfill for existing meters orders without dispatch/GR history — today 0 rows match, kept defensively per the spec's safety rule.

I will report the exact before/after row counts from a local file-DB dry run, and wait for your confirmation that you've exported a Turso backup, before this ever runs for real.

4. Order form, unit lock, Order details label

- Unit dropdown → only Pcs/Meters (kg/g stay valid in the zod enum, not offered). Meters → Order type auto-set to Lump, disabled, hint "Meter orders are always lump".
- services/orders.ts updateOrder()'s unit-lock guard extends to jobsheets OR takas OR outside POs exist.
- "All-over order (meters)" label only in the Order details tab.

5. Production in meters

Pattern: every file reading frames/completedFrames/sections on a jobsheet gets an isMeterOrder branch reading/writingmeters/completedMeters via the §2 maths. Key files: server/src/services/jobsheets.ts (assertJobsheetsAllowed, insertJobsheets, generateJobsheets/addSingleJobsheet, updateJobsheet auto-adjust, printJobsheets), jobsheet-live.ts (new liveJobsheetMeters/liveJobsheetClothMeters SQL siblings), external.ts (new outsideCommittedMeters() mirroring outsideCommittedPcs, no integer rounding). Client: features/jobsheets/jobsheet-forms.tsx, edit-jobsheet-form.tsx,jobsheet-details-page.tsx, order-jobsheets-section.tsx (isPcs gate → isPcs || isMeters), print-page.tsx, supervisor-jobsheets-page.tsx, machine-view-page.tsx; features/jobsheets/parts.tsx's FramesValue gets a MetersValuesibling.

§5.X — frames = 0 sentinel audit (new, point 7). Since both the pre-existing hidden external jobsheet AND the new meter-jobsheet frames column use frames = 0/sentinel values, I will grep the whole codebase (server, client, shared) for every place that tests frames === 0, !frames, !js.frames, frames > 0, or sums frames as a stand-in for "is this the external/empty jobsheet" instead of checking the actual is_external boolean. Each hit gets fixed to check is_externalexplicitly. Findings and fixes are listed in the Phase 4 (jobsheets) report, before moving on.

6. Supervisor dialogs (meters)

run-dialogs.tsx (CompleteDialog/ChangeMachineDialog) get a meters variant (decimal, 2dp) of "frames completed"/"frames to make next" — services/jobsheets.ts completeJobsheet()/changeMachine() write completedMeters for meter jobsheets.hold-order.ts/close-order.ts (planHold) and their client dialogs get the same decimal treatment.

7. Taka entry, edit takas, outside/FG receipts (meters)

- shared/src/takas.ts: new parseDamageMeters(value, takaMeters) (parallels parseDamagePcs); TAKA_METERS_MISMATCH_PCT = 0.02.
- taka-entry-page.tsx: meter-order row = number → Meters* only; meters mismatch note at >2% gap vs (completedMeters ?? meters) * sections.
- services/takas.ts enterTakas()'s auto-complete branch gets a completedMeters: js.meters path; editTakas()'s "pcs required" validation branches to "meters required" for meter orders.
- edit-takas-dialog.tsx, edit-receipt-takas-dialog.tsx, outside/FG receipt screens: meters-only rows for meter orders, pcs hidden.

8. After the loom (meters) — corrected per point 6, nothing here is "unchanged"

- QC damage sizing (services/qc-shared.ts): bound by taka.meters/write taka_damages.meters/resolved_meters for meterorders, using the new parseDamageMeters.
- Partial resolve in meters: wherever applyResolve/the butta-QC and mill-QC "validate decisions" logic sizes a partialresolve against pcs/resolvedPcs (services/butta-qc.ts, services/qc-shared.ts, and the shared shared/src/takas.ts damage helpers damageOpenPcs/damageLabelOf/damageResolveSummary), generalize to a damageOpenQty(d, unit)/meters-aware variantsso a meter-order's partial resolve works on resolved_meters the same way pcs does on resolved_pcs.
- splitDamage.ts: movedDamagePcsCheck gets a movedDamageMetersCheck twin — moved-damage quantity on a meter-order splitis bound by the part's meters, not pcs.
- Butta/Mill totals: services/challans.ts getKindCounts()'s pcs-only pendingPcs/inKindPcs get pendingMeters/inKindMeters siblings (the totalMeters SUM pattern already exists elsewhere in this file — reuse it). expectedMoreByOrder() ("18/~20 expected", mill approximation) gets a meters branch: SUM(COALESCE(completed_meters, meters) * sections) for meterorders, instead of the frames version.
- Godown (Dhruvil): patchGodownTaka() gets a meters branch writing actual_meters; EditPcsDialog gets a meters sibling;shared/src/godown.ts godownKpis/checkedPcsBar/actualVsExpectedLine thread unit and read takaActualMeters for meter orders. Mark as fresh (shared/src/dispatch.ts markFreshResult) gets a meters-aware variant (currently computesopenPcsBefore from pcs only). Damaged inventory figures: DAMAGED_STOCK_STAGES aggregation in inventory.ts/shared/src/inventory.ts gets a damagedMeters figure alongside damaged (pcs), reading opentaka_damages.meters - resolved_meters.
- Split: for a meter order, meters is the primary split input (not apportioned from pcs). New shared/src/takas.tsfunction validateMeterSplit(parts, actualMeters, used) mirroring validateSplit's shape but keyed on meters (parts must sum to the taka's actual meters); pcs stays null throughout. split-page.tsx swaps the primary field based onisMeterOrder.
- Dispatch snapshot must use the actual quantity: services/dispatch.ts createDispatch() currently snapshots meters:t.meters directly — once actual_meters exists this must become meters: takaActualMeters(t) (parallel to how pcs: takaActualPcs(t) ?? 0 already works), so a godown meters edit is reflected on the delivery challan.
- Goods return: shared/src/dispatch.ts lumpGrDamagePcsOk gets a lumpGrDamageMetersOk twin bounding GR damage by meters for meter-order lump GR (meter orders are always lump, so only this path is needed — no pcs-to-pcs GR branch formeters).
- Dashboard sub-stage/damage tiles in meters: shared/src/orderDashboard.ts buildOrderDashboard's sub-stage takaPcs andthe damage-type tiles get meters-aware siblings (threaded via order.unit), not just the bar-share math mentioned in §9 — this was undersold in the first draft.

9. Free stock & inventory in meters

- services/inventory-moves.ts gate !== 'pcs' → !== 'pcs' && !== 'meters'; meter moves always use the lump tick-takaspath (meter orders are always lump).
- services/inventory.ts: every eq(orders.unit, 'pcs') filter → inArray(orders.unit, ['pcs','meters']), branching whichcolumn to sum. shared/src/inventory.ts orderInventoryPcs gets a sibling orderInventoryMeters.
- Inventory item cards show two separate figure blocks (pcs tiles + meters tiles) when a design has both.
- Free-stock unit rule: a meter free taka may only be assigned to a meter order of the same design (server-enforced in addFromFreeStock, next to the existing design-match check) — never mixes with pcs stock.

10. Manual add/remove finished-goods stock (canAdjustStock, Jenish+Gaurang only)

Holder order — one hidden orders row per (design_id, material_id, unit, blouse_option):
- is_stock_holder = 1, status = 'closed', is_closed = 1 (point 2 — this makes every existing "closed orders are excluded" rule work for free: Receive goods/awaiting-goods lists already exclude closed orders per the Sprint 16 docs,so that's covered with zero new code). order_no negative, from the new stock_holder_order_no counter (mirrors the existing externalJobsheetNo = -orderId convention) — never collides with the real MAX(order_no)+1 sequence. customer_id= the reserved "Stock (system)" row. quantity = 0, order_date = today.
- Found-or-created inside the write transaction via the §3 unique index (insert, catch violation, re-select).
- Gets its own hidden external jobsheet via the existing ensureExternalJobsheet() (no new jobsheet mechanism).

Explicit exclusions required everywhere (point 4) — in addition to whatever is_closed=1 already buys for free:
- middleware/hold-guard.ts: any /orders/:id/* request (read or write) where the order isStockHolder → 404, checkedbefore the closed-order 409 logic (so the response never leaks the negative number via a "Order #-3 is closed" message). This one change also covers order milestones (GET /orders/:id/milestones) and any other /orders/:id/* reader for free.
- services/jobsheets.ts listSupervisorJobsheets/listSupervisorOrders — explicit is_stock_holder = false filter (defense in depth; likely already excluded via is_external, verify).
- Customer "previous designs" query, send-to-production/undo-production (reject/filter holder ids), services/outside.ts Receive-goods listing (explicit filter, not solely relying on is_closed), services/challans.ts pending/refinish-orderqueries, godown-scope.ts, the free-stock "assign-targets" query (a holder order is never a valid assign target), services/dispatch.ts listDispatchedOrders, services/orders.ts listOrders.
- Design/material delete checks (services/designs.ts/services/materials.ts): currently block delete with "used by an order" when any order references it. Split into two checks: real orders (is_stock_holder=0) keep that message; adesign/material referenced only by a holder order with remaining active free-stock takas gets a new message "Has manual stock — remove it first". Once a holder order's stock is fully removed (no active takas reference it), it no longerblocks deletion.

Negative order numbers must never be shown anywhere (point 5). Using the new orderRefText/isManualStockOrderNo helper from §1:
- jobsheetRef/jobsheetRefShort (shared/src/jobsheets.ts) check isManualStockOrderNo first and return "Manual stock" regardless of jobsheet number.
- takaUsedText's ref parameter (the "already used in Order #26 (319)" check), damageShareMessage, taka events' generated text, GR/dispatch notes that embed an order number — all route through orderRefText instead of building #${orderNo}directly.
- Client: taka drawer's order reference, takas-card.tsx's "from Order #A" cross-order group label, free-stock rows —same rule.
- scripts/check-sprint19.mjs gets explicit asserts: after the manual-add/remove flow, scan every relevant API responsefor a negative-number order reference pattern and fail the script if one is found outside of the raw orderNo field itself (which legitimately stays negative in the DB/API — only display text must never show it).

10.1 Add stock — POST /api/inventory/stock/add:
1. Resolve/create the holder order for (designId, materialId, unit, blouseOption).
2. Allocate a taka number from the normal counter, insert a takas row on the holder's external jobsheet: stage='final',free_stock_reason='manual_add' (extends FREE_STOCK_REASONS), is_free_stock=true immediately, pcs/meters by unit, blouse (pcs only).
3. Condition = Damaged → write a taka_damages row in the same transaction. Damage type options: offer all of Machine/Butta/Mill/Weaver (point 8 — origin is unknown, so don't guess from the design's steps).
4. Insert stock_adjustments row (kind='add'); event stock_added (new event kind, additive).

10.2 Remove stock — POST /api/inventory/stock/remove:
- Lump (tick-based, pcs or meters): soft-delete selected free takas (is_deleted=1,removed_reason/removed_by_user_id/removed_at) + stock_removed event + stock_adjustments row.
- Pcs numeric mode: reuse planPcsMove's picking logic against only free-stock takas, splitting one via the existingsplit machinery if needed.
- Only is_free_stock=true takas are selectable, enforced server-side. Remark required. 403 for anyone withoutcanAdjustStock.

10.3 Stock adjustments history — GET /api/inventory/stock-adjustments → new page, linked from Inventory.

---
11. Tablet layouts (§6 of the spec)

Every screen touched above gets an explicit 768–1023 / 1024–1279 pass: jobsheet forms (2–3 columns + side-panelpreview), taka entry meter rows (one line, big touch targets), supervisor dialogs (numbers side by side), godown edit-meters/split (table-like grid), Inventory pcs+meters tiles (3–4 col grid, two-column item page on landscape),Add/Remove stock dialogs (2 columns, Remark full width). Screenshots at 360/768/1024/1280px for a pcs order and a meter order — Phase 10 deliverable.

12. Tests & checks

- shared/src/sprint19.test.ts: meters planning/edit/coverage/decimals/0.05m rule, outside-meters-PO subtraction,completed meters, taka-meters mismatch tolerance, dashboard bar+sub-stage+damage tiles in meters, inventory pcs-vs-meters (never mixed), free-stock unit rule, orderRefText/manual-stock-label behaviour, meter split validation,meters-bound partial resolve.
- scripts/check-sprint19.mjs (local file DB only): full meter-order walk (add → jobsheets → start/complete/changemachine → taka entry → butta → QC partial resolve in meters → mill → count → Mill QC → godown edit-meters/split-in-meters → ready → dispatch (snapshot uses actual meters) → GR (meters-bound damage) → free stock →assign to another meter order (ok) / pcs order (refused) → hold/close with meters) plus the identical steps as a pcs regression, plus manual add (fresh + damaged, all 4 damage types offered) and remove (remark required, 403 for Dhruvil), plus the negative-order-number-never-shown asserts, plus a frames=0-sentinel regression (create a meter jobsheet and confirm it's never mistaken for the hidden external jobsheet anywhere).
- After every phase: npm run typecheck, npm test, every existing scripts/check-*.mjs against a fresh local file DB, and a manual click-through of scenario 1 (pcs, END_TO_END_SCENARIOS.md) against the dev server.

13. Docs (Phase 10)

- CLAUDE.md: add "Sprint 19" (condensed from this plan) and the missing "Sprint 16" section (order steps tri-tick,outside production/weavers/PO lifecycle, direct FG purchase, Close order) from the research already gathered.
- PROJECT_STATE.md: append both, consistent with its "later section wins" convention.

---
Build-phase order — one item per turn, commit, stop, report (point 9)

1. Git check. Look for .git (none expected yet since you haven't copied it in). Report what's there — do NOT proceed to any other phase, including phase-1's own shared-code work, until you confirm .git is in place and I've shown you gitstatus/git log.
2. Shared unit helper + generic planning maths + tests (§1–2). Commit.
3. Migration — dry-run on a local file-DB copy, report exact before/after counts, wait for your explicit OK + confirmed Turso backup, then (only then) npm run db:migrate on Turso (§3). Commit.
4. Order form (unit/lump lock), Order details label (§4). Commit.
5. Jobsheets: create/add/edit/coverage/print/cards/machine view + the frames=0 sentinel audit (§5). Commit.
6. Supervisor complete/change machine; hold/close dialogs (§6). Commit.
7. Taka entry + edit takas + outside/FG receipts (§7). Commit.
8. Butta/mill/QC/godown/split/dispatch/GR, fully in meters per §8's corrections. Commit.
9. Free stock + inventory two-figure display (§9). Commit.
10. Manual add/remove stock + holder-order exclusions + negative-order-number guard + stock adjustments list (§10). Commit.
11. Tablet layout pass + screenshots, full role regression (pcs and meters), docs (§11–13). Commit.

Each numbered item = one phase = one stop-and-report. Nothing beyond the current item happens without your go-ahead.

---
Appendix A — full pcs/frames/sections/meters touchpoint inventory

Shared: production.ts (+METERS_ON_TARGET_SLACK); jobsheets.ts (§2, +orderRefText/manual-stock guard injobsheetRef/jobsheetRefShort); takas.ts (parseDamageMeters, validateMeterSplit, takaActualMeters, takaUsedText/damageShareMessage via orderRefText, meters-aware damageOpenQty/damageLabelOf/damageResolveSummary);orderDashboard.ts (bar share and sub-stage/damage tiles in meters); inventory.ts (+orderInventoryMeters, damagedMeters); godown.ts (godownKpis/checkedPcsBar/actualVsExpectedLine thread unit); freeStock.ts (+manual_add reason;pcsMoveOrder/planPcsMove stay pcs-only); dispatch.ts (+lumpGrDamageMetersOk, meters-aware markFreshResult); splitDamage.ts (+movedDamageMetersCheck); outside.ts (already dual-unit, template to copy).

Server (services/): jobsheets.ts, jobsheet-live.ts, external.ts (§5); takas.ts (§7); dashboard.ts (meters SUM aggregates alongside pcs); godown.ts (§8, incl. patchGodownTaka meters branch, splitTaka meters-primary branch, resolveGodownDamage meters branch); inventory.ts + inventory-moves.ts (§9); challans.ts (getKindCounts meters KPIs,expectedMoreByOrder meters branch); dispatch.ts (createDispatch meters snapshot via takaActualMeters, GR meters-bound damage); qc-shared.ts, butta-qc.ts, mill-qc.ts (§8 meters-bound damage/partial resolve); rework.ts (meters totalalongside pcs); hold-order.ts/close-order.ts (§6); orders.ts (getOrder's jobsheetMeters sibling); middleware/hold-guard.ts (holder-order 404, point 4); services/designs.ts/services/materials.ts (delete-check messagesplit). New: services/stock-adjustments.ts, routes/inventory.ts additions.

Client: jobsheets/parts.tsx (+MetersValue), jobsheet-forms.tsx, edit-jobsheet-form.tsx, jobsheet-details-page.tsx, order-jobsheets-section.tsx, supervisor-jobsheets-page.tsx, run-dialogs.tsx, print-page.tsx, activity.tsx;machine-view-page.tsx; takas/taka-entry-page.tsx, edit-takas-dialog.tsx, edit-receipt-takas-dialog.tsx, taka-chip.tsx, taka-drawer.tsx (+ manual-stock label), takas-card.tsx (+ manual-stock label on cross-order groups), damage-dialog.tsx,damage-details-page.tsx; orders/dashboard/dashboard-tab.tsx, order-header.tsx, damages-tab.tsx, docs-tab.tsx, design-stock-panel.tsx; godown/godown-order-page.tsx (+meters EditPcsDialog sibling), split-page.tsx (meters-primary for meter orders), split-damage-picker.tsx; inventory/inventory-page.tsx, item-details-page.tsx, damaged-details-page.tsx, new add-stock-dialog.tsx/remove-stock-dialog.tsx/stock-adjustments-page.tsx; challans/*, dispatch/* (GR/dispatch notesvia orderRefText); outside/po-form-dialog.tsx (read order's unit instead of hardcoded pcs), receipt-entry-page.tsx, fg-pcs-receipt-page.tsx; free-stock/add-from-free-stock-dialog.tsx, move-to-inventory-dialog.tsx.

---
Verification plan

1. npm run typecheck + npm test after every phase.
2. scripts/check-sprint19.mjs against a fresh local file DB — full meter walk + pcs regression + manual-stock +negative-order-number asserts + frames=0-sentinel regression, per §12.
3. Manual click-through of scenario 1 (pcs, END_TO_END_SCENARIOS.md) after each phase touchingproduction/takas/godown/dispatch.
4. Dev-server click-through of the new meter-order flow end to end, plus manual add/remove stock (fresh + damaged, then403-check as a non-owner role).
5. Screenshot pass at 360/768/1024/1280px, pcs and meters (Phase 11).
6. Turso migration: dry-run locally, report exact row-count deltas, wait for your explicit OK and confirmed backup, only then run for real, with you present.
