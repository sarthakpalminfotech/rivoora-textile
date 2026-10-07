# Rivoora Textile — Sprint 9: Mill QC, refinish, godown final takas, split, ready for dispatch

This continues the existing project. Read `CLAUDE.md` and `PROJECT_STATE.md` first, especially Sprints 7–8: generic challans (butta/mill), `taka_damages` (+ `resolved_pcs`, images), `taka_events`, Butta QC, the Mill module, Godown supervisor.

**Reuse what exists and keep the UI clean**: the Butta QC screens and damage popup (with camera/attach images), the Resolve-with-pcs popup, the kind-aware challan building blocks, card grids, full-screen forms, `ConfirmDialog`, `<Bi>`, theme tokens. Follow the **visual quality rules from Sprint 8 §11** for every new screen: calm surfaces, one focal point per card, colour only as small accents, generous spacing, `tabular-nums`, and screenshots at 360 / 768 / 1280px with refinement before finishing a phase.

**How to work**
0. Run `git status`. If there are uncommitted changes, stop and tell me so I can commit them first.
1. Start in plan mode and show me the plan: migrations, stages/statuses, roles, endpoints, screens, and the split rules.
2. Build in the phases at the end. After each phase, run `npm run typecheck` and `npm test`, run the app, fix all errors, and give me a short summary (including what you refined visually).
3. At the end, update `CLAUDE.md` and `PROJECT_STATE.md`.

---

## 1. Background

- When takas come back from the mill, **Mill QC** checks each one. This is the last check.
  - The taka is **Fresh**, or it has damage (new damage here = **Mill damage**).
  - Older damages can be **resolved**.
  - Some takas go **back to the mill for refinishing**.
- Physically, fresh, damaged and refinish takas are kept apart.
- Fresh and damaged takas (everything except refinish) become the order's **final takas** in the godown.
- The **Godown supervisor** then checks the final takas order by order:
  - corrects the actual pcs
  - splits takas when needed
  - ticks what he has checked
  - confirms **Ready to dispatch**
- Dispatch itself comes in a later sprint. Takas not ready to dispatch stay in the godown (inventory).

**All quantities on these screens are in pcs.**

---

## 2. Stages, statuses and damage types

**New taka stages** (`shared/src/pipeline.ts`, with tests):

| Stage | Meaning | Dashboard (main → sub) |
|---|---|---|
| `final` | Mill QC done (fresh or damaged); with the godown supervisor | Ready → **"Final takas (godown)"** |
| `refinish` | Marked for refinishing; waiting in inventory to go back to the mill | Mill → **"Refinish (in inventory)"** |
| `ready_dispatch` | Confirmed ready to dispatch by the godown supervisor | Ready → **"Ready for dispatch"** |

- The Ready main stage becomes **connected**.
- A refinish taka sent back to the mill goes `refinish` → `at_mill` → `mill_qc` → Mill QC again.
- Add `takas.refinish_count` (integer, default 0), incremented each time it's sent to refinish.

**New `found_at` damage type:** `godown`, label **"Supervisor marked"**. It's connected on the dashboard damage strip and the Damages tab, next to Machine / Butta cutting / Mill damage. **Mill damage** (`mill`) is now connected too.

**New order statuses** (extend the shared pure status function, the tests and `recomputeOrderStatus`; same principle as before: they apply only once all jobsheets are Completed with takas, and the earliest unfinished stage wins):

| key | label | sequence | Rule |
|---|---|---|---|
| `mill_qc_done` | Mill QC done | 110 | no taka before `final`; every active taka is `final`, `refinish` or `ready_dispatch`, and at least one is `final` or `refinish` |
| `ready_for_dispatch` | Ready for dispatch | 120 | every active taka is `ready_dispatch` |

The existing `in_mill` / `received_from_mill` rules must treat `final` / `refinish` / `ready_dispatch` as "past the mill". Write tests for the mixes, e.g. some `mill_qc` + some `final` → Received from mill.

---

## 3. Mill QC role (`mill_qc`)

- Name "Mill QC" / "मिल QC". `bilingual: true`, phone-first (like Butta QC), landing `/mill-qc`, nav **Mill QC** only.
- Restricted view: order number + design + quality only, never the client.
- Permissions: `canMillQc`; may upload to the `damages` folder; may use `/lookup/damages`.
- Appears in **Switch role**.

### 3.1 Home
- A big taka number input (`inputMode="tel"`) + **Open / खोलें**.
- Below it, a **"QC pending / जांच बाकी"** list: takas in `mill_qc`, newest received first, searchable.

**Opening a taka:**
- Stage `mill_qc` → the QC screen.
- Stage `at_mill` (sent but **not marked received**) → **opens**, with an amber bilingual alert: "Not marked received from the mill yet — it will be marked received when you save / मिल से वापसी दर्ज नहीं है — सेव करने पर दर्ज हो जाएगी".
- **Never sent to the mill** (any stage before `at_mill`, or `refinish`) → blocked: "This taka was not sent to the mill / यह टाका मिल नहीं गया".
- Already `final` / `ready_dispatch` → read-only summary, "Already checked / पहले से जांचा गया".
- Not found → alert.

### 3.2 QC screen (action first, details secondary, like Butta QC)
1. **Identity card:** **Taka 6245**, Order #26 (319), design thumbnail + code, quality, challan MIL-12.
2. **Meters and pcs:** prefilled and editable (same validation as Butta QC).
3. **If the taka has no open damage:** two large buttons side by side:
   - **Fresh / ठीक है** (green)
   - **Damage / खराबी** (red outline)
4. **If the taka has open damage(s):** the same red/amber "Damaged taka" alert card as Butta QC, listing each open damage (name, where found, open pcs). Per damage: **Resolve / ठीक करें**, which opens the pcs popup prefilled with all open pcs (the existing component). Below the card, two buttons:
   - **Add new damage / नई खराबी**
   - **Send to refinish / रीफिनिश भेजें**

   Resolving everything turns the taka Fresh automatically.

**Damage popup** (the existing component, `foundAt = mill`):
- damage name (master / Other) + **damaged pcs** + optional **images** (Camera / Attach, multiple)
- plus, at the bottom, a secondary button **Send to refinish / रीफिनिश भेजें**

**Send to refinish** (from the popup or the damaged-taka screen): a confirm dialog with an optional note → the taka is marked **Refinish**. It's not a damage: it's a tag/stage.

**Saving:**
- **Fresh** → confirm → save.
- After adding damages / resolving → a sticky **Done / पूरा** button → confirm summary (changes, damages added/resolved) → save.
- **Send to refinish** → confirm → save.

**On save (one transaction):**
- If the taka is `at_mill`: mark it received on its challan (`received_mill` event) first.
- Meters/pcs edits → `edited` event.
- Resolves (`damage_resolved`), new damages with images (`found_at = mill`, `damage_added`).
- Recompute `is_damaged`.
- **Stage:**
  - Fresh or Done → **`final`** (`mill_qc_done` event)
  - Send to refinish → **`refinish`**, `refinish_count + 1`, `sent_refinish` event with the note
- Recompute the order status.

**Success screen:** "Saved / सेव हो गया", the result (Fresh / Damaged / Refinish), and **Next taka / अगला टाका**.

---

## 4. Refinish takas go back to the mill

- In the **Mill module → Send**, add a third sub-tab: **Pending (N)** · **In mill (N)** · **Refinish (N)**.
- **Refinish** lists the refinish takas grouped by order (the same order card + takas drawer + selection bar), each with a small **"Refinish"** tag (and "×2" if sent more than once).
- Sending creates a normal **MIL-** challan through the existing flow (party, date, Eway, print): takas → `at_mill`, then Receive → `mill_qc` → Mill QC again.
- Refinish takas never appear in the godown's final takas until they pass Mill QC again.
- (A full Inventory module comes later. For now, refinish takas live here and on the order details.)

---

## 5. Godown supervisor → **Orders** module

A new nav item **Orders** for the godown supervisor (route `/godown/orders`, so it doesn't clash with Jemish/Gaurang's `/orders`).
- Phone + tablet layouts, 48px tap targets.
- **No client name, no rate**, anywhere.
- New permission: `canUseGodownOrders` (godown supervisor; also give it to Jemish and Gaurang so they can open these screens if needed).

### 5.1 Orders list
- **Visible orders:** orders where **at least one taka has passed Mill QC** (any taka in `final`, `refinish` or `ready_dispatch`).
- **Search** at the top: **order number or taka number** (a taka number finds its order).
- A simple card grid (1 column on phones, 2 at md, 3 at lg). Each card:
  - the design image, **medium** size (about 72–88px, rounded, tap → lightbox)
  - **Order #26** (focal point)
  - the design code
  - **total pcs ordered**
- Sort: orders with unchecked final takas first, then by order number descending.

### 5.2 Order screen (`/godown/orders/:orderId`)
- **A simple header:** design image (lightbox), Order #26, design code, quality, **ordered pcs**.
- **Tabs:** **Final takas** | **Damage**.

### 5.3 Final takas tab

**KPI row** (small calm tiles):
- **Cleared by Mill QC:** `18 / 20 takas`. The total is all active takas of the order; the cleared count is takas in `final` + `ready_dispatch` (damaged ones included).
- **Checked:** `12 takas · 236 pcs`.
- **Refinish:** `1 taka` (shown only if > 0).

**Pcs bar:** a slim horizontal bar that fills with the **actual pcs of the checked takas** against the **ordered pcs**: "236 / 300 pcs checked". Use a calm fill, and a different shade beyond 100% if it goes over.

Under the bar, one quiet line comparing the totals: **"Actual 296 pcs vs expected 300 (−4)"**, using the actual pcs of all final takas against their expected pcs. Amber when they differ, otherwise muted.

**Taka list.** Columns, which become stacked compact rows on phones with no horizontal scroll:

| ☐ | Taka no | Expected pcs | Actual pcs | |
|---|---|---|---|---|

- **Checkbox:** "I have checked this taka and it's okay". It **saves immediately** (who + when), with an optimistic tick.
- **Taka no:** a small red **"D"** badge beside the number when the taka has open damage. Split parts show their parent subtly ("from 1101").
- **Expected pcs:** read-only. The pcs recorded for the taka (from taka entry, as corrected by QC).
- **Actual pcs:** a number input **prefilled with the expected pcs**. Editing saves on blur (a small saved tick).
  - When actual ≠ expected, the row shows a subtle amber difference ("−2") and a **Split** button appears beside it.
  - The actual value stays on the taka even if he doesn't split.
- A small **⋯ menu** per row: **Mark damage** (the damage popup, `foundAt = godown`) and **Send to refinish** (confirm → `refinish`, the same as §3, so it leaves the final list).
- Takas already **Ready for dispatch** are listed in a separate muted group at the bottom, locked, with a "Ready for dispatch" tag.

**Ready to dispatch:**
- A sticky bottom button **Ready to dispatch (N)**, where N = checked final takas. Disabled at 0.
- It opens a confirmation modal: **total takas** and **total pcs** of the checked takas, plus one muted line "8 unchecked takas stay in the godown".
- Confirm → the checked takas → `ready_dispatch` (`ready_dispatch` event), recompute the order status, toast.
- Unchecked takas stay `final` (in the godown) and can be confirmed later.

### 5.4 Split screen (full screen, opened from **Split**)

Clean and simple, top to bottom:
1. **The source taka:** **1101**, its **actual pcs** (as entered in the row) and meters.
2. A down/right **arrow** to show it's splitting.
3. **The parts.** Each part row has:
   - the **taka number** (editable)
   - a **pcs** input
   - a **Damage** button (the damage popup with `foundAt = godown` and the Send to refinish option)

   **Default rows:**
   - row 1 = the **original number 1101** (it stays, with part of the pcs; the pcs input starts empty)
   - row 2 = **1101A** (empty pcs)
   - **+ Add part** adds 1101B, 1101C… (the next free letter)
   - parts after the first two can be removed
4. **Total at the bottom:** "Total 10 / 10 pcs". Green when the parts add up to the actual pcs, amber with the difference when they don't.

**Save** is enabled only when:
- every part has pcs ≥ 1
- the total = the actual pcs
- all numbers are valid and unique system-wide (live check through the existing `/takas/check`)

**On save (one transaction):**
- 1101 keeps its row with its new pcs.
- New takas are created for each other part, with:
  - same order, jobsheet and stage (`final`)
  - `parent_taka_id = 1101`
  - **meters divided by pcs automatically**: each part = parent meters × part pcs / total pcs, rounded to 2 decimals, with the last part taking the remainder so the sum matches
- Damages chosen per part are added (`found_at = godown`). Send to refinish per part → that part goes to `refinish`.
- **Existing open damages of the parent stay on 1101.**
- Write `split` events (on the parent: "split into 1101A, 1101B"; on each part: "split from 1101").
- The new parts appear unchecked in the list.
- Add `takas.parent_taka_id` (FK, nullable, indexed). Put the split helpers (meters division, letter suffixes, validation) in `shared/src/takas.ts`, with tests.

### 5.5 Damage tab
- All takas of the order with **open** damage: taka no, damage name(s), where found (Machine / Butta cutting / Mill / Supervisor marked), open pcs, image thumbnails (lightbox).
- Read-only for now. Tapping a card opens the existing **damage details screen** (Sprint 8 §9), with the client details hidden for this role.

---

## 6. Order details for Jemish / Gaurang (keep the UI, extend only)

- **Dashboard** (through the pipeline config; no layout change):
  - Mill gets **"Refinish (in inventory)"**
  - **Ready** is connected with **"Final takas (godown)"** and **"Ready for dispatch"**
  - the damage strip adds **Mill damage** and **Supervisor marked**
  - completed / skipped rules include the new stages
  - the bar stays in pcs and uses **actual pcs** when set
- **Takas tab:**
  - stage dots for the new stages
  - a **Refinish** tag (with ×N)
  - split parts shown as "1101A · from 1101"
  - checked / ready-to-dispatch indicators
  - the taka drawer history shows Mill QC, refinish, split, checked and ready-to-dispatch events
- **Damages tab and damage details:** the new found-at types; images from Mill QC and godown damages.
- **Docs → Challans:** refinish trips appear as normal MIL challans.

---

## 7. Data summary (migrations)

- `takas`:
  - `refinish_count` (integer, default 0)
  - `parent_taka_id` (FK, nullable, indexed)
  - `actual_pcs` (integer, nullable; null = same as `pcs`)
  - `godown_checked_at`, `godown_checked_by` (nullable)
- Taka stages: `final`, `refinish`, `ready_dispatch`.
- `found_at`: `godown`.
- New events:
  - `mill_qc_done`, `sent_refinish`, `split`, `godown_checked`, `godown_unchecked`, `actual_pcs_changed`, `ready_dispatch`
  - plus `received_mill` when Mill QC auto-receives
- Order statuses: `mill_qc_done`, `ready_for_dispatch`.
- **"Expected pcs" vs "actual pcs":** expected = `pcs`; actual = `actual_pcs ?? pcs`. Every pcs total from the godown stage onwards (godown bar, dashboard bar, takas tab) uses actual.

---

## 8. API summary (new)

| Method | Path | Notes | Permission |
|---|---|---|---|
| GET | `/mill-qc/pending?search=&page=` | takas in `mill_qc` | `canMillQc` |
| GET | `/mill-qc/taka/:no` | open a taka (stage rules from §3.1) | `canMillQc` |
| POST | `/mill-qc/:takaId` | `{ meters, pcs, damageDecisions[], newDamages[] (with images), result: 'final' \| 'refinish', refinishNote? }` | `canMillQc` |
| GET | `/mill/refinish-orders`, `/mill/refinish-orders/:orderId/takas` | the Refinish sub-tab; sending uses the existing `POST /mill/challans` (also accepts `refinish` takas) | `canUseMillModule` |
| GET | `/godown/orders?search=&page=` | the §5.1 list (one aggregate query) | `canUseGodownOrders` |
| GET | `/godown/orders/:orderId` | header + KPIs + final takas (+ ready-for-dispatch group) | `canUseGodownOrders` |
| PATCH | `/godown/takas/:id` | `{ checked?, actualPcs? }` | `canUseGodownOrders` |
| POST | `/godown/takas/:id/split` | `{ parts: [{ takaNo, pcs, damages?[], refinish? }] }` (the first part is the original number) | `canUseGodownOrders` |
| POST | `/godown/takas/:id/damage`, `/godown/takas/:id/refinish` | the row ⋯ actions | `canUseGodownOrders` |
| POST | `/godown/orders/:orderId/ready-dispatch` | `{ takaIds[] }` (must be checked and `final`) | `canUseGodownOrders` |
| GET | `/godown/orders/:orderId/damages` | the Damage tab | `canUseGodownOrders` |

- One transaction per write, with conditional stage updates, ending with `recomputeOrderStatus`.
- Validate with zod in `shared/src/schemas.ts`.
- Invalidate the godown, mill, dashboard, takas, damages and orders queries after each write.
- Restricted roles never get client names (test with `X-Role`).

---

## 9. Quality checklist

- **Shared tests:**
  - the new statuses and stage mixes
  - Mill QC open rules (at_mill alert, never-sent block)
  - split validation and meters division (sums exact)
  - letter suffix generation
  - actual vs expected totals
  - the checked-pcs bar
  - the ready-to-dispatch rules
- Mill QC (phone, bilingual) and the godown screens (phone + tablet) have no overflow at 360px, 48px tap targets and fast keyboard flow.
- The design pass with screenshots is done for: Mill QC home + QC screen + popups, the Mill Refinish sub-tab, Godown orders list, the order screen (KPIs, bar, list), the split screen, the Damage tab, and the dashboard additions.
- The Jemish/Gaurang order details look unchanged apart from §6.

## 10. Build phases

1. **Migrations + shared:** stages, `found_at = godown`, statuses, takas columns, events, roles/permissions, split helpers, tests.
2. **Mill QC role:** home, open rules, QC screen (Fresh / Damage / Resolve / Add / Refinish), save, success.
3. **Refinish sub-tab** in Mill Send (back to the mill on a MIL challan).
4. **Godown Orders list + order screen:** KPIs, pcs bar, taka list with checkbox / actual pcs / ⋯ actions, Ready to dispatch.
5. **Split screen.**
6. **Godown Damage tab.**
7. **Order details additions** (dashboard, Takas tab, Damages).
8. **Design pass and polish:** screenshots at all breakpoints for every new screen; update `CLAUDE.md` and `PROJECT_STATE.md`.
