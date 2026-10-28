# Rivoora Textile — Sprint 19: Meter (all-over) orders end to end + manual add / remove of finished-goods stock

This continues the existing project. Read `CLAUDE.md`, `PROJECT_STATE.md` and `docs/flows/*` first (the flow inventory describes every flow as built at `b4fd6be`). The app is **live with real data**.

This sprint touches **only** orders / production / takas / godown / dispatch / free stock / inventory. It does **not** touch the yarn module (that is a separate prompt — don't change anything under yarn).

**Safety rules (they come first)**
- Migrations are **additive** (new tables / new nullable columns, no table rebuilds, no dropped columns). Any data change must be inside the migration transaction with **before / after count checks** that abort and change nothing on a mismatch.
- Test every migration on a **local file-DB copy** first. Before I run `npm run db:migrate` on Turso, tell me **exactly** what it changes and remind me to **export a Turso backup first**.
- Never run wipe / seed scripts against Turso.
- **Pcs orders must behave exactly as today.** Every change is gated on the order's unit. After each item, run `npm run typecheck`, `npm test`, all existing `scripts/check-*.mjs` (local file DB only) and a pcs-order regression (scenario 1 of `docs/flows/END_TO_END_SCENARIOS.md`).
- One commit per item. New write endpoints go into `WRITE_RULES` of `middleware/hold-guard.ts` when they act on an order.
- Keep the current look (Sprint 8 §11 rules) and **design tablet layouts properly** (§6).

**How to work**
0. Run `git status`. If there are uncommitted changes, stop and tell me.
1. Start in **plan mode**. The plan must list:
   - **every place that reads pcs, frames or `SECTIONS_PER_BEAM`** (shared functions, server services / SQL, client screens, prints, tests), with what each does for a meter order
   - the new columns and the migration (with the existing meter orders found in the data, see §1.4)
   - the approach for §5 (manual stock) and every query that must ignore the stock-holder orders

   Wait for my OK before writing code.
2. At the end, update `CLAUDE.md` and `PROJECT_STATE.md`. **Also add the missing Sprint 16 section** (order steps, outside production, weavers, FG purchase, close order, receive goods), which the flow inventory found is not documented.

---

## 1. The idea: unit decides pcs world or meter world

### 1.1 Units
- The order **Unit** dropdown shows only **Pcs** and **Meters**. kg / g are no longer offered (old rows keep their value; nothing else changes for them).
- **Meters = an "all-over" order.** Show the words **"All-over order (meters)"** only in the order's **Order details** tab. Nowhere else needs a label; quantities simply show with "m".
- A meter order is **always lump**: when Unit = Meters, the Order type field is set to **Lump** and locked (hint "Meter orders are always lump"). Pcs-to-pcs does not exist for meters.
- **Unit stays locked once jobsheets, takas or outside POs exist** (today: jobsheets only; extend it).

### 1.2 The rule everywhere
For a meter order **every quantity is meters**: no pcs, no frames, from order to dispatch and goods return. Pcs orders keep pcs + frames exactly as today. Put the unit logic in **one shared helper** (e.g. `shared/src/orderUnit.ts`: `isMeterOrder(order)`, `qtyLabel(unit)`, `takaQty(taka, unit)` = actual meters or meters / actual pcs or pcs, formatters `formatQty(n, unit)` → "1,250.5 m" / "1,250 pcs"). Never scatter `unit === 'meters'` checks in screens; use the helper.

### 1.3 New / changed data (additive)
- `jobsheets.meters` (REAL, null for pcs jobsheets) — **loom meters** to weave (takes the place of frames); `jobsheets.completed_meters` (REAL).
- `orders.meters_per_jobsheet` (REAL) — the meter twin of `frames_per_jobsheet`.
- `takas.actual_meters` (REAL, null = same as `meters`) — the godown's corrected meters (twin of `actual_pcs`).
- `taka_damages.meters` / `taka_damages.resolved_meters` (REAL) — damage quantity for meter orders (pcs stays null).
- `goods_return_takas` / dispatch snapshots already hold meters — use them.
- Every DTO carries the order's `unit` wherever quantities are shown, so the client can label correctly.

### 1.4 Existing meter orders in the live data
In the plan, **list every existing order with unit meters / kg / g** (number, status, has POs / takas). Meter orders currently can only have outside POs / FG takas (no jobsheets). Migration: set `order_type = 'lump'` for meter orders **only if** they have no dispatch and no goods return; list any others for me to decide. Don't touch kg / g orders.

---

## 2. Production in meters

### 2.1 Planning jobsheets (Jenish, Gaurang)
The maths is the same as pcs, with meters instead of pcs and loom meters instead of frames:
- **Loom meters needed = (order meters − meters given outside on meter POs) ÷ sections per beam** (default 3, editable 1–12 as today).
  Example: order 300 m, sections 3 → 100 loom meters. Gaurang splits those 100 m into jobsheets (e.g. 50 m + 50 m).
- **Create jobsheets**: fields Order meters (read-only), Sections per beam, **Meters per jobsheet**, looms. Live preview: "300 m ÷ 3 sections = 100 m to weave → 2 jobsheets of 50 m". The last jobsheet takes the remainder.
- **Add single jobsheet**: **Meters** (+ sections, looms). Cloth meters = meters × sections, read-only.
- **Edit with auto-adjust**: same rule as frames (the last Pending jobsheet absorbs the difference), in meters.
- **Coverage / warnings**: same texts with meters ("Jobsheets cover 280 m of 300 m", "loom meters short by 6.7"). Decimals: meters to **2 decimals**; don't produce 0.01-m jobsheets from rounding (silent when within 0.05 m, like the 1-frame rule for pcs).
- Every jobsheet stores its own `sections` (as today) and `meters`.

Refactor `planJobsheets`, `planFramesEdit`, `orderJobsheetPlan`, `coverageWarnings`, `jobsheetQuantityWarning` to work on a **generic quantity** (frames or meters, integer vs 2-decimal) instead of duplicating them. Keep every existing pcs test passing unchanged and add meter tests.

### 2.2 Jobsheet print and cards
- Print: the "Pcs" box shows **"Meters: 50 · Sections: 3 · Cloth ≈ 150 m"** for meter orders. No frames text anywhere. Keep QR, blank Picks / Loom boxes.
- Office cards, supervisor cards, Machine view, jobsheet details, Taka entry list: **meters** instead of frames (e.g. "50 m").

### 2.3 Supervisor (loom floor)
- **Complete**: "Meters completed" (decimal, more than assigned accepted, note if different), stored in `completed_meters`.
- **Change machine**: "Meters completed" + "Meters to make next" (pre-filled with the remainder).
- **Hold** and **Close order** dialogs: meters completed per loom jobsheet; Hold creates the remaining-meters Pending jobsheet.
- Taka entry auto-complete: completed meters = assigned meters.

### 2.4 Taka entry (bilingual)
For a meter order the row is **taka number → Meters\* → Damage** (pcs field not shown; meters required, > 0, ≤ 9999.99, 2 decimals). Damage popup asks **meters** (≤ taka meters).
**Mismatch note** (amber, not a blocker): "Meters entered: X. Expected about Y m (50 m × 3 sections)". Show it when the difference is more than **2 %** (meters vary naturally); make the tolerance one constant.
Edit takas (owners): same fields. Outside weaver receipts and FG receipts for meter orders: rows with **meters required**, no pcs.

### 2.5 Order status, dashboard, history
- `orderStatusForJobsheets` / taka rule need no change except "jobsheet has takas" logic — check it works with meters.
- Dashboard progress card: **meters now / meters ordered**; bar shares in meters (a jobsheet without takas counts loom meters × sections). Sub-stage cards show meters.
- Godown supervisor / supervisor read-only Orders: same, in meters.

---

## 3. After the loom, in meters

- **Butta / Mill / Refinish** send drawers and totals: show **meters** for meter orders (totals already show takas · pcs · meters; for a challan mixing both kinds show both).
- **QC** (Butta + Mill): meters read-only; damages and partial resolve in **meters** (`resolved_meters`).
- **Godown (Dhruvil)**: Final takas show **meters**; ⋯ **Edit meters** (`actual_meters`, same rules as Edit pcs); checked bar "checked m / ordered m"; KPI tiles in meters; Damage tab in meters.
- **Split** (meter orders): parts are entered in **meters** (must add up to the actual meters); numbers by the system as today; damage picker moves damages in meters (≤ part meters).
- **Ready for dispatch / Dispatch**: unchanged flow. Delivery challan print for a meter order = lump taka grid with **meters per taka** and **total meters** (no pcs column).
- **Dispatched module**, Docs tab: meters.
- **Goods return**: lump flow (tick takas) — returned takas to free stock as today; damage in meters (type optional as today).
- **Rework / send back**, hold, close: unchanged except quantities shown in meters.
- **Outside POs** for meter orders: unit meters (already possible); "given outside" subtracts meter POs from the order's meters (see §2.1). Pcs POs on pcs orders unchanged.

## 4. Free stock and inventory in meters

- **Move to inventory** and **Add from free stock / Assign to order**: allowed for meter orders, **lump only** (tick takas). A meter taka can go **only to a meter order of the same design**; pcs and meter stock **never mix** (enforce on the server: `canReceiveFreeStock` checks unit).
- **Inventory**: every design shows **two separate figures** when it has both: pcs and meters (ordered, in making, ready for order, ready for dispatch, refinish, damaged, free stock). KPI row: pcs tiles + meter tiles (only show the meter row when any meter stock / orders exist). Filters / blouse toggle unchanged.
  - In making (meters) = takas before final (meters) + jobsheet loom meters × sections not yet in takas + pending outside meter POs.
- Damaged inventory: meters for meter takas; **Mark as fresh** unchanged.
- The Add / Edit order **stock panel**: shows stock of the order's unit only.

---

## 5. Manual add / remove of finished-goods stock (Jenish, Gaurang only)

New permission `canAdjustStock` (Jenish, Gaurang). Server rejects everyone else (403).

### 5.1 Add stock
From **Inventory → design → Free stock → "Add stock"** (and an "Add stock" button on the Inventory page that first asks for the design):
- **Design\*** (search), **Quality\*** (only that design's qualities), **Unit\*** Pcs / Meters, **Quantity\*** (pcs integer / meters 2 decimals), **Condition** Fresh (default) / Damaged (+ damage type, name and qty like the damage popup), **Blouse** (optional, pcs only), **Remark** (optional).
- Result: **one new free-stock taka** with a system taka number (same counter as taka entry), stage `final`, `free_stock_reason = 'manual_add'` (label "Added manually"), event `stock_added` with the remark and user. It appears in Free stock / Damaged and can be assigned to orders like any free taka.

**Data approach (recommendation — confirm or improve in the plan):** a taka needs an origin order and a jobsheet. Create **one hidden "stock holder" order per design + quality + unit** (`orders.is_stock_holder = 1`, a hidden external jobsheet, status never computed) and hang manual stock takas on it. **Every** order list, count, status recompute, dashboard, search, Dispatched list, godown list, filters, inventory "ordered" figure, order number sequence (holder orders must **not** take a visible order number — use a separate negative / null scheme or a flag the UI never shows) must ignore holder orders. List every such query in the plan. If you find a cleaner approach that keeps every existing query safe, propose it.

### 5.2 Remove stock
From **Inventory → design → Free stock** (and **Damaged**): select free takas → **Remove from stock**; for pcs stock you may also enter a number of pcs (the system picks takas like the pcs move and splits one if needed). **Remark is required.**
- Removed takas are soft-deleted with `removed_reason`, `removed_by_user_id`, `removed_at` and event `stock_removed`. They disappear from every list and figure.
- Only **free stock** can be removed (never takas of an order).
- History: a small **"Stock adjustments"** list under Inventory (date, design, quality, +/- qty, unit, user, remark) so the owners can see what was added / removed.

---

## 6. Tablet layouts (important — not just "responsive")

On tablets, forms must **not** become one field per full-width row. For **every screen changed or added** in this sprint, design the tablet layout explicitly (768–1023 px portrait **and** 1024–1279 px landscape):
- **Create / Add single / Edit jobsheet** (meters): 2–3 columns (Meters per jobsheet · Sections · Looms), the live preview as a side panel on landscape, below on portrait.
- **Taka entry** (meter rows): row = number · meters · damage on one line; big touch targets; keyboard-safe Submit bar (`kb-bar`).
- **Supervisor Complete / Change machine / Hold / Close** dialogs: centred dialog with the numbers side by side.
- **Godown Edit meters / Split in meters**: parts in a table-like grid on tablets.
- **Inventory** with pcs + meters figures: tiles in a 3–4 column grid; the item page as two columns on landscape (figures + orders | free stock).
- **Add stock / Remove stock** dialogs: 2 columns on tablets; Remark full width.

Screenshots at **360 / 768 / 1024 / 1280 px** of every changed screen, for a pcs order **and** a meter order, in the final summary. Nothing may overflow at 360 px.

---

## 7. Tests and checks
- **Shared tests** (`sprint19.test.ts`):
  - jobsheet planning, edit + auto-adjust and coverage in meters (incl. decimals and the 0.05-m rule)
  - outside meter POs subtracted
  - completed meters
  - taka meters mismatch tolerance
  - dashboard bar in meters
  - inventory figures pcs vs meters (never mixed)
  - free stock unit rule
  - every existing test still passes unchanged
- **Check script** `scripts/check-sprint19.mjs` (local file DB only) — a full **meter order**:
  - add (300 m, P · B · M) → jobsheets 2 × 50 m (3 sections)
  - start → complete 48 m → change machine
  - taka entry in meters (mismatch note)
  - butta → QC partial resolve in meters → mill → count → Mill QC
  - godown Edit meters + split in meters → ready → dispatch (DC shows meters) → GR → free stock
  - assign to another meter order (allowed) and to a pcs order (refused)
  - hold / close with meters
  - manual add (fresh + damaged) and remove (remark required, 403 for Dhruvil)

  Plus a **pcs regression** of the same steps.
- Print checks: jobsheet print and delivery challan for a meter order.

## 8. Build phases
1. Shared unit helper + generic planning maths + tests.
2. Migration (columns, holder-order flag, existing meter orders → lump with checks). Summarise the Turso changes for me.
3. Order form (units, lump lock, unit lock), Order details label.
4. Jobsheets: create / add / edit / coverage / print / cards / machine view.
5. Supervisor complete / change machine; hold / close dialogs.
6. Taka entry + edit takas + outside / FG receipts in meters.
7. Butta / mill / QC / godown / split / dispatch / GR in meters.
8. Free stock + inventory (two figures).
9. Manual add / remove stock + stock adjustments list.
10. Tablet layouts pass + screenshots, full role regression (pcs and meters), docs (incl. the missing Sprint 16 section).

Final summary: what changed per item, the migration summary for Turso, test / check results, screenshots, and anything you were unsure about.
