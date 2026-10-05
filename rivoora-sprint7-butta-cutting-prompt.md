# Rivoora Textile — Sprint 7: Butta cutting (send, receive, challans), Butta QC, damage list per taka

This continues the existing project. Read `CLAUDE.md` and `PROJECT_STATE.md` first, including the Sprint 6 changes: order-number-first display, the damage master, taka pcs, and taka numbers with `-` / `/`.

The client likes the current UI very much. **Reuse the existing patterns and components and keep the look**: card grids, selection mode + action bar, full-screen forms, `ConfirmDialog`, standard `Select`, `StatusBadge`, `<Bi>` bilingual helper, helper keys `–` `/` on taka number fields, the damage popup, tabs, `LoadMore`, theme tokens. **Do not redesign the order details page**; only extend it where this document says so.

**How to work**
0. Run `git status`. If there are uncommitted changes, stop and tell me so I can commit them first.
1. Start in plan mode and show me the plan: migrations (and the duplicate-taka check), status and pipeline changes, roles, endpoints, screens, and the challan print layout.
2. Build in the phases at the end. After each phase, run `npm run typecheck` and `npm test`, run the app, fix all errors, and give me a short summary.
3. At the end, update `CLAUDE.md` and `PROJECT_STATE.md`.

---

## 1. Background (the factory process)

- After taka entry, takas of some designs go to **butta cutting**. It's outsourced: the takas are sent to a **butta party** with a **delivery challan**, and later come back to our godown.
- When they come back, each taka is **received**, then checked by **Butta QC**:
  - meters and pcs are confirmed
  - older (machine) damages are resolved or kept
  - new damage found here is recorded as **butta cutting damage**
- After Butta QC, the taka **waits for the mill** (the mill flow comes in a later sprint).
- Takas of designs that **don't** go for butta cutting skip all of this and go straight to **waiting for mill** after taka entry.

---

## 2. Taka numbers are now unique across the whole system

From now on, a taka number **must never repeat**, across jobsheets, orders and years.

- **Migration:** replace the per-jobsheet unique index with a **global** unique partial index on `taka_no WHERE is_deleted = 0`.
  - **Before creating it, check for existing duplicates.** If any exist, the migration must stop with a clear list (taka no → orders/jobsheets) so I can fix them. Don't silently change data.
- **Validation** (`shared/src/takas.ts` + the server):
  - a duplicate inside the submitted list → the existing message
  - a number already used anywhere → bilingual "Taka 6245 is already used (Order #26 (319)) / टाका 6245 पहले से है"
  - the server returns the field error as `takas.<index>.takaNo`
- **Live check:** `GET /takas/check?no=` → `{ available, usedBy?: { orderNo, jobsheetNo } }`. Call it debounced on the Taka entry and Edit takas fields so the error shows before submit.
- **Lookup by number:** `GET /takas/by-no/:no` returns the one active taka (used by Receive and Butta QC).
- Update `CLAUDE.md`, which currently says numbers repeat across jobsheets.

---

## 3. Design master: "Goes for butta cutting"

- New column `designs.butta_cutting` (boolean, NOT NULL). Backfill **all existing designs = true**.
- **Design form:** a **required** Yes / No choice "Goes for butta cutting?", as two attached tappable options like the Order type control. New designs have nothing pre-selected, so the user must choose.
  - Hint: "Changing this affects takas entered from now on."
  - Show a small "Butta" tag on design cards and on the design detail page when Yes.
  - Designs created from Add Order's upload also need this choice: add the same control in the upload block.
- **Rule at taka entry** (in the same transaction that inserts takas): the new taka's `stage` is
  - `entered` (waiting for butta cutting) if the order's design (the variation's parent design) has `butta_cutting = true`, **or the order has no design**
  - `waiting_mill` if `butta_cutting = false`

  Put this in one shared helper, `initialTakaStage(design)`, with tests.

---

## 4. Damages become a list per taka

A taka can now have several damages (machine + butta, later mill), and damages can be **resolved**.

**New table `taka_damages`:**
- `id`, `taka_id` (FK, indexed)
- `damage_id` (FK → `damages`: the damage **name**)
- `found_at` (`machine` | `butta` | `mill`: **where** it was found, the existing damage type)
- `pcs` (integer, damaged pcs; required for new rows: 1 to the taka's pcs; nullable only for migrated rows)
- `status` (`open` | `resolved`)
- `resolved_at`, `resolved_by` (role), `resolved_stage` (e.g. `butta_qc`)
- `created_by` (role), `created_at`, `updated_at`, `is_deleted`

**Migration:** for every existing damaged taka, create one `open` row: `found_at = takas.damage_type` (machine), `damage_id = takas.damage_id` (may be null → shown as just "Machine damage"), `pcs = null`.

**Source of truth:** `taka_damages` from now on.
- Keep `takas.is_damaged` as a **denormalized flag = "has at least one open damage"**. Recompute it in the same transaction on every damage write, through one helper.
- Stop reading `takas.damage_type` / `takas.damage_id` (leave the columns in the DB, marked deprecated in the schema comments).
- A taka with **no open damages** is **"Fresh"**.

**Damage popup** (the existing one from Sprint 6, used on Taka entry, Edit takas and Butta QC):
- Add a **required "Damaged pcs / खराब पीस"** number field (1 to the taka's pcs; the taka's pcs must be filled first).
- The popup takes a `foundAt` prop: Taka entry and Edit takas → `machine`; Butta QC → `butta`.

**Taka entry:** a row can carry **one or more** damages. Tapping Damage adds one; the row shows "Damage · Hole · 2 pcs". Tapping the damaged button offers Change / Remove / **Add another damage**.

**Edit takas (Jemish/Gaurang):** each taka row shows its damage list (name, where found, pcs, open/resolved). They can edit or remove open damages and add a machine damage. Resolved damages are shown read-only.

**Display everywhere** (chips, Takas card, Damages tab, dashboard drawer):
- an open damage: "Machine damage · Hole · 2 pcs" (red)
- a resolved one: grey, struck-through style, "Resolved at butta QC"
- a taka with only resolved damages shows a green "Fresh" tag

**Order dashboard and Damages tab:**
- damage counts are **open damages by `found_at`**
- the **Butta cutting damage** tile is now connected
- the Damages tab gets a "Show resolved" toggle (off by default) and shows damaged pcs
- keep the current layout

---

## 5. Taka stages and the order pipeline

In `shared/src/pipeline.ts`:

| Taka stage | Meaning | Main stage → sub-stage (dashboard) | Connected |
|---|---|---|---|
| `entered` | Taka entry done, waiting for butta cutting | Production → "Taka entry done · waiting for butta cutting" | yes |
| `at_butta` | Sent on a challan, at the butta party | Butta cutting → "At butta cutting" | **yes (new)** |
| `butta_qc` | Received back, Butta QC pending | Butta cutting → "Received · QC pending" | **yes (new)** |
| `waiting_mill` | Butta QC done, or design skips butta | Mill → **"Waiting for mill"** (new sub-stage) | **yes (new)** |
| `at_mill`, `mill_qc` | later sprint | Mill | no |
| `ready` | later sprint | Ready | no |

- Remove the old `butta_done` sub-stage; `waiting_mill` replaces it. Migrate any data that uses it.
- Set `connected: true` where marked.
- The dashboard page and `buildOrderDashboard` should need no layout changes (Sprint 5 promise). Update the tests.
- **Taka history:** a new table `taka_events`:
  - `taka_id`, `event` (`entered` | `sent_butta` | `received_butta` | `receive_undone` | `butta_qc_done` | `damage_added` | `damage_resolved` | `damage_kept` | `edited` | `challan_cancelled`)
  - `challan_id`, `note` (e.g. "meters 61.00 → 60.50"), `role`, `created_at`

  Write one for every taka action from now on.

---

## 6. New order statuses (derived, like the existing ones)

Extend the shared pure status function (`orderStatusForJobsheets` or a successor that also takes taka stages) and `recomputeOrderStatus`:

| key | label | sequence | Rule |
|---|---|---|---|
| `in_butta_cutting` | In butta cutting | 70 | the taka entry done conditions hold (all jobsheets Completed, each with takas) **and** at least one taka is `at_butta` or `butta_qc` |
| `ready_for_mill` | Ready for mill | 80 | the taka entry done conditions hold **and** every active taka is `waiting_mill` |

- Otherwise the existing rules apply. While production is still running, the order stays "In production", and the dashboard shows the partial butta progress.
- Give each status a distinct badge colour, visible to Jemish and Gaurang.
- Call `recomputeOrderStatus` at the end of every send / receive / QC / cancel transaction, for every order touched.
- Tests: all combinations, including a no-butta design going straight to Ready for mill.

---

## 7. Roles

| Permission | jemish | gaurang | supervisor | taka_entry | **godown_supervisor** | **butta_qc** |
|---|---|---|---|---|---|---|
| `canUseButtaModule` (Butta cutting module: Send + Receive) | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| `canCancelChallan` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `canManageButtaParties` (master) | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `canButtaQc` | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

**Godown supervisor** (`godown_supervisor`, "Godown supervisor", initial "G" or "GS" if "G" is taken):
- English only. Uses a **phone and tablet**: tablet-first layouts, 48px tap targets, nothing overflowing at 360px.
- Landing `/butta`. Nav: **Butta cutting** only.
- Sees **order numbers, design (image + code) and quality**. **Never the client name**, rate or other order details (restricted view on the server).
- Needs `GET /lookup/butta-parties`.

**Butta QC** (`butta_qc`, "Butta QC", Hindi "बुट्टा QC"):
- `bilingual: true`, phone-first, like Taka entry.
- Landing `/butta-qc`. Nav: **Butta QC** only.
- Sees order number + design + quality only. Needs `GET /lookup/damages`.

Both new roles appear in the **Switch role** list. Every other route redirects them to their landing, and every other API returns 403.

---

## 8. Butta party master

A new master **Butta parties**, next to the others (Jemish/Gaurang manage, `canManageButtaParties`).
- **Fields:** Name* (printed as "M/s. …"), Address (multi-line), Mobile, GSTIN, Notes.
- Name is unique (case-insensitive) among non-deleted.
- Uses `MasterList` + a full-screen form. Soft delete, blocked (409) if used on any challan.

---

## 9. Butta cutting module (`/butta`): Jemish, Gaurang, Godown supervisor

Two top tabs, kept in the URL: **Send** and **Receive**.

### 9.1 Send → sub-tabs **Pending** | **In butta cutting**

**Pending:** orders that have takas in stage `entered`, which are only takas of butta designs.
- A **card grid of orders**, styled like the supervisor's Order view cards. Each card shows:
  - the design image (lightbox) + code
  - **Order #26**
  - the quality
  - **pending takas count** and **total meters**
  - a checkbox to select the whole order
- Search by order no, design code or taka no.
- **Tapping an order card** opens its takas: a right drawer on tablet/desktop, full screen on phones.
  - A row per taka: checkbox, **taka no**, meters, pcs, and a damage tag if it has an open damage.
  - **Select all** at the top; **all are selected by default**. The user can untick any.
  - Done/Back keeps the selection.
- Several orders can be selected. Selecting an order's checkbox = all its pending takas; partially selected orders show a partial state (e.g. "12 of 15").
- A **selection action bar** (the existing pattern: fixed above the bottom nav on phones, sticky on md+): "N takas · M m selected" + **Send to butta cutting** + Clear.
- Takas sent are only the ones selected. **Takas entered later stay Pending** for the next challan.

**Send confirmation popup:**
- Shows: **total takas**, **total meters**, the number of orders.
- **Party** (required, standard `Select` from Butta parties).
- **Challan date** (default today).
- **Eway no** (optional text).
- Cancel / **Create challan**.

**On confirm (one transaction):**
- Allocate the next challan number from `counters` (`butta_challan_no`), displayed as **`GSM-<n>`** (prefix in one constant). Starts at **GSM-1**, never reused.
- Create the challan + its taka rows, storing **meters and pcs at the time of sending**.
- Each taka must still be `entered` (conditional update). If any changed meanwhile → 409 with the list, and nothing is saved.
- Takas → `at_butta`, with `sent_butta` events.
- Recompute the status of every touched order.
- Then **open the challan preview** (§11) with **Print** and **Close**.

**In butta cutting:** a challan list (cards), newest first.
- Each card shows:
  - **GSM-173**
  - the party name
  - the date
  - **total takas**
  - **total meters**
  - **received count**, e.g. **8 / 20 received**, with a thin progress bar. When complete: green **"All 20 / 20 received"**.
- Filter pills: **Open** (default: has takas not yet received) / **Fully received** / All.
- Search by challan no, party, order no or taka no.
- Clicking a challan opens its details (§10).

### 9.2 Receive → sub-tabs **Taka number** | **Challans**

**Taka number** (the main receive screen, kept very simple):
- One big input "Taka number" (the same keypad + `–` `/` helper keys as Taka entry) and a big **Received** button beside it. **Enter** also receives.
- The person keeps typing numbers and receiving.
- **Rules:**
  - a number that doesn't exist → red alert "Taka 6245 not found"
  - a taka not at butta cutting (any other stage) → alert "Taka 6245 was not sent for butta cutting" (or "is at <stage>"); it is **not received**
  - already received → "Taka 6245 was already received on …"
- **On success:**
  - Taka → `butta_qc`
  - set `received_at` / `received_by` on its challan row
  - write a `received_butta` event
  - recompute the order status
  - a green confirmation row appears at the **top of a "Received now" list** under the input: taka no, Order #, challan no, meters, time
  - the input clears and keeps focus
- Each row in "Received now" has **Undo** (allowed while that taka's Butta QC hasn't started): it moves the taka back to `at_butta`, clears the received fields and writes a `receive_undone` event.

**Challans:** the same challan cards as Send → In butta cutting, showing **only challans that still have takas to receive**.
- Live updates: refetch every **10 s** and on focus, and invalidate immediately after any receive.
- Clicking opens the challan details, where takas can also be received by ticking rows (§10).

---

## 10. Challan details (`/butta/challans/:id`)

- **Header:** **GSM-173**, the party (name, address, mobile, GSTIN), date, Eway no, created by.
  - **Print** button at the top → the print view (§11).
  - **Cancel challan** (`canCancelChallan`, only while **nothing** has been received): a confirm dialog, then all its takas go back to `entered`, the challan is marked cancelled (shown with a "Cancelled" badge; the number is never reused), `challan_cancelled` events are written and statuses recomputed.
- **Summary tiles:** total takas, total meters, received X / Y, pending.
- **Orders in this challan:** a chip per order (Order #26, with its takas count/meters). Clicking a chip scrolls to that order's section.
- **Order-wise taka lists:** a section per order (Order #26 + design code + quality), then rows of taka no, meters, pcs and status:
  - **In butta cutting** (amber) listed **first**
  - **Received** (green, with the date/time; plus "QC done" if QC has been completed) listed **below**
- Users with `canUseButtaModule` can tick In-butta-cutting rows and press **Mark received (N)**, which follows the same rules as the Taka number screen.
- A back link to the list it came from.

---

## 11. Challan print: match their current challan exactly

Build a print route `/print/challan/:id` (outside the app layout, like the jobsheet print), with a screen preview + sticky Back / Print toolbar (hidden when printing).
- **Paper:** A4 **landscape**. Put page size and orientation in one constant so they can be changed.
- Black on white, thin borders, the same bold sans style as the photo.
- **Company details** come from a new config `shared/src/company.ts` (values exactly as on their challan):
  - name **RIVOORA ETHNIC FASHION**
  - GSTIN **24AAZFR7705C2ZX**
  - mobiles **9879885024**, **9913311903**
  - address **PLOT NO : 08-09-10, SHIV ECO PARK-2, NEAR OM INDUSTRIES, UMBHEL ROAD, VILLAGE-PARAB, SURAT GUJARAT 394325**
  - jurisdiction **SURAT**

**Layout, top to bottom (one outer border around everything):**
1. **Top row:** left `GSTIN :24AAZFR7705C2ZX`; centre **RIVOORA ETHNIC FASHION** (large, bold); right `Mo: 9879885024` with `9913311903` under it.
2. The address line, centred, bold, small caps size.
3. `!! DELIVERY CHALLAN !!`, centred, bold, in its own bordered row.
4. **Party / challan row**, two boxes:
   - **Left** (wide): `M/s. <PARTY NAME>` (bold, uppercase), then the party address lines, `Mo : <mobile>`, `GSTIN : <gstin>`.
   - **Right** (narrow): `Ch. No` + **`GSM-173`** in a light-grey shaded cell (bold, larger); `Date` + `21/07/2026` (format `dd/MM/yyyy`); `Eway No :` + the value or blank.
5. `Quality Name : <QUALITY>` row: the material/quality name of the takas. If the challan has several qualities, join them with ", ".
6. **Taka table:** **4 column groups side by side**, each with the headers **`NO | Taka No | MTRS.`**.
   - Rows are numbered continuously (1, 2, 3…) and filled **column by column**: group 1 holds rows 1–12, group 2 rows 13–24, group 3 rows 25–36, group 4 rows 37–48. That's **12 rows per group, 48 takas per page**, matching the photo.
   - MTRS uses 2 decimals and is right-aligned. Unused rows stay blank but keep the grid height.
   - Under each group, a **subtotal of meters** for that group (e.g. 717.00, 493.00), blank if the group is empty.
   - Takas are listed by order, then taka number. **No order number and no client name anywhere on the print.**
7. **Totals row:** `Total Taka : 19` · `Total Mtrs : 1210` (meters shown as in the photo, no decimals when whole, otherwise 2 decimals) · right-aligned `For, RIVOORA ETHNIC FASHION`.
8. **Bottom row:** left `Receiver's Signature`, centre `Subject to SURAT Jurisdiction Only. E& O.E.`, right `Authorised Signatory`.

**More than 48 takas:** continue on further pages with the **same header and party/challan block**, numbering continuing (49…), and "Page 2 of 3" small at the top right. Totals and signatures appear on the **last page only**.

The print uses the **meters at the time of sending**, so it never changes after QC edits. The same route is used by the preview after creating a challan and by the details Print button.

---

## 12. Butta QC role (`/butta-qc`), bilingual, phone-first like Taka entry

**Home:**
- A big "Taka number / टाका नंबर" input (keypad + `–` `/` helper keys) + **Open / खोलें**.
- Below it, a list **"QC pending / जांच बाकी"**: takas in stage `butta_qc`, newest received first, as tappable chips/rows (taka no, Order #, meters).
- Search the list by taka no.

**Opening a taka:**
- A taka **not received yet** → bilingual alert "This taka has not been received from butta cutting / यह टाका अभी बुट्टा से वापस नहीं आया". Blocked.
- A taka **already QC done** → a read-only summary with "Already checked / पहले से जांचा गया".
- Not found → "Taka not found / टाका नहीं मिला".

**QC screen** (the QC action first; details secondary, like the Taka entry screen):
1. **Identity card:** **Taka 6245** in very large type, Order #26 (319), design thumbnail (lightbox) + code, quality, challan GSM-173.
2. **Meters and Pcs:** **prefilled** with the taka's current values, editable, with the same validation as Taka entry.
3. **Damage alert** (only if the taka has open damages): a clear red/amber card, "Damaged taka / खराब टाका". One block per open damage:
   - the damage name, where found (e.g. Machine damage), and **damaged pcs**
   - two big choice buttons: **"Resolved — all N pcs / सब ठीक"** and **"Not resolved / ठीक नहीं"**
   - every open damage must get an answer before submit
   - for a migrated damage with no pcs count, first ask **"How many pcs damaged? / कितने पीस खराब?"** (required), then the choice
4. **Add new damage / नई खराबी जोड़ें:** opens the damage popup with `foundAt = butta` (name from the master or Other + **damaged pcs**, both required). New butta damages are listed with Remove until submit.
5. A sticky **"QC done / जांच पूरी"** button → a bilingual confirm dialog summarising: meters/pcs changes, damages resolved, kept and added.

**On submit (one transaction):**
- Update meters/pcs if changed, with an `edited` event noting old → new.
- Resolved damages → `resolved` (`resolved_at`, `resolved_by`, `resolved_stage = butta_qc`), with `damage_resolved` events. Kept ones get `damage_kept` events.
- Insert new damages (`found_at = butta`, status `open`) with `damage_added` events.
- Recompute `is_damaged`: no open damages = **Fresh**.
- Taka → `waiting_mill`, with a `butta_qc_done` event.
- Recompute the order status.

**Success screen:** a green check, "Saved / सेव हो गया", the result ("Fresh / ठीक" or "Damaged / खराब"), and **Next taka / अगला टाका** (back to home, input focused).

Jemish and Gaurang can see the QC result on the order (Takas tab / taka history) and fix data through Edit takas.

---

## 13. Order details: keep the UI, add only what's needed

- **Dashboard:** the Butta cutting stage, its sub-stages, the Mill "Waiting for mill" sub-stage and the Butta cutting damage tile now show real numbers (through the pipeline config; no layout change). Item drawers for taka sub-stages also show the challan number for `at_butta` / `butta_qc` takas.
- **Takas tab:**
  - each taka chip gets a small **stage indicator** (a colour dot from the pipeline config + tooltip with the stage label) and its damage state (open = red, Fresh = green tag)
  - a **stage filter** pill row (All / each stage that has takas) next to the existing All / Damaged only filter
  - clicking a chip opens a small **taka details drawer**: number, meters, pcs, stage, challan (link to the challan details for users with `canUseButtaModule`), the damage list (open / resolved), and the **taka history** from `taka_events`
- **Damages tab:** open damages by where found; the "Show resolved" toggle; damaged pcs (§4).
- **Jemish/Gaurang nav:** add **Butta cutting**. On phones it goes in the main bar or the More sheet, whichever keeps the bar clean (follow the existing rule).

---

## 14. API summary

| Method | Path | Notes | Permission |
|---|---|---|---|
| GET | `/takas/check?no=` | live uniqueness check | taka entry, Jemish, Gaurang |
| GET | `/takas/by-no/:no` | the taka + jobsheet/order number + stage + damages (restricted view for the new roles) | roles that use it |
| GET | `/takas/:id` | taka details + damages + events (taka drawer) | Jemish, Gaurang |
| CRUD | `/butta-parties`, `GET /lookup/butta-parties` | master | manage: `canManageButtaParties`; lookup: + godown supervisor |
| GET | `/butta/pending-orders?search=&page=` | orders with `entered` takas of butta designs: order no, design, quality, count, meters (one aggregate query) | `canUseButtaModule` |
| GET | `/butta/pending-orders/:orderId/takas` | that order's pending takas | `canUseButtaModule` |
| POST | `/butta/challans` | `{ takaIds[], partyId, challanDate, ewayNo? }` → creates the challan (one transaction) | `canUseButtaModule` |
| GET | `/butta/challans?filter=open\|received\|all&search=&page=` | cards with totals + received count | `canUseButtaModule` |
| GET | `/butta/challans/:id` | details grouped by order | `canUseButtaModule` |
| GET | `/butta/challans/:id/print` | print data (no order no / client) | `canUseButtaModule` |
| POST | `/butta/challans/:id/cancel` | only while nothing received | `canCancelChallan` |
| POST | `/butta/receive` | `{ takaNo }` or `{ takaIds[] }` → receives with the rules in §9.2; returns the result per taka | `canUseButtaModule` |
| POST | `/butta/receive/:takaId/undo` | only before QC | `canUseButtaModule` |
| GET | `/butta-qc/pending?search=&page=` | takas in `butta_qc` | `canButtaQc` |
| POST | `/butta-qc/:takaId` | `{ meters, pcs, damageDecisions: [{ takaDamageId, resolved, pcs? }], newDamages: [{ damageId \| otherName, pcs }] }` | `canButtaQc` |

- Every multi-row write is **one transaction** with conditional updates on the current stage, ending with `recomputeOrderStatus` for the touched orders.
- Validate every body with zod in `shared/src/schemas.ts`.
- Invalidate the butta lists, challans, order dashboards, takas and orders queries after each write.
- Restricted views (godown supervisor, butta QC) **never** return the client name, rate or other order fields: test with their `X-Role` headers.

---

## 15. Quality checklist

- **Shared tests:**
  - `initialTakaStage`
  - global taka uniqueness messages
  - the new order statuses
  - pipeline counts with the new stages
  - challan numbering format
  - the challan print paging helper (48 per page, column-by-column fill, per-group subtotals, totals)
  - QC decision validation (every open damage answered; pcs required)
- The challan print matches the photo layout on paper (A4 landscape), including more than 48 takas.
- The Receive screen works fast for continuous entry: Enter receives, focus stays in the input, alerts are clear.
- The godown supervisor (tablet and phone) and Butta QC (phone, bilingual) screens have no overflow at 360px, and tap targets are at least 48px.
- The order details page looks the same as before apart from the additions in §13.
- The migrations are safe to run on the live Turso DB (the duplicate check stops before changing anything).

## 16. Build phases

1. **Migrations + shared:**
   - the global taka uniqueness (with the duplicate check)
   - `designs.butta_cutting`, `taka_damages` (+ migration of existing damages), `taka_events`
   - `butta_parties`, `butta_challans` + `butta_challan_takas` (meters/pcs at send, `received_at`/`received_by`, cancelled flag; one active challan per taka via a unique partial index)
   - the counter, pipeline/stages, new statuses, roles, `company.ts`
   - tests
2. **Design "Goes for butta cutting"** + `initialTakaStage` at taka entry.
3. **Damage list:** the popup with damaged pcs, Taka entry multi-damage, Edit takas, display, dashboard/Damages tab counts.
4. **Butta party master.**
5. **Butta cutting → Send:** Pending (order cards, takas drawer, selection), confirm, challan creation, the In butta cutting list.
6. **Challan print + challan details** (incl. cancel and tick-to-receive).
7. **Receive:** the Taka number screen + Challans list (live), undo.
8. **Butta QC role.**
9. **Order details additions:** stage dots, stage filter, taka drawer + history, dashboard connections.
10. **Polish:** test every role at 360px, 768px and 1280px, print a challan on paper, and update `CLAUDE.md` and `PROJECT_STATE.md`.
