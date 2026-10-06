# Rivoora Textile — Sprint 8: Butta QC fixes, damage images, Mill (send / receive / challans), Docs tab, dashboard polish

This continues the existing project. Read `CLAUDE.md` and `PROJECT_STATE.md` first, especially the Sprint 7 work: Butta cutting module, challans, `taka_damages`, `taka_events`, Butta QC, Godown supervisor.

**Reuse what exists.** The Mill flow is the Butta cutting flow again, so **generalise the butta code into shared building blocks** instead of copying it (see §6).

**How to work**
0. Run `git status`. If there are uncommitted changes, stop and tell me so I can commit them first.
1. Start in plan mode and show me the plan: migrations (incl. the challan generalisation), shared changes, endpoints, the screens touched, and how you'll check the visual quality (§11).
2. Build in the phases at the end. After each phase, run `npm run typecheck` and `npm test`, run the app, fix all errors, and give me a short summary.
3. At the end, update `CLAUDE.md` and `PROJECT_STATE.md`.

---

## 1. Butta QC: resolving damage with a pcs count

Today each open damage has "Resolved — all N pcs" / "Not resolved". Change this to:
- Two buttons per open damage: **Resolve / ठीक करें** and **Not resolved / ठीक नहीं**.
- **Resolve** opens a small popup: **"How many pcs resolved? / कितने पीस ठीक हुए?"**, a number field **prefilled with all the damaged pcs** of that damage (editable, 1 to the open pcs), then Cancel / **Save**.
- The damage block then shows the result, e.g. "Resolved 3 of 3 pcs" (green) or "Resolved 2 of 3 · 1 pcs still damaged" (amber), with **Change**.

**Data:**
- Add `taka_damages.resolved_pcs` (integer, default 0).
- Open pcs = `pcs − resolved_pcs`.
- The damage becomes `resolved` only when `resolved_pcs = pcs`. A partial resolve keeps it `open`, with fewer open pcs.
- The taka is **Fresh** only when no damage has open pcs.
- Write `damage_resolved` events with the pcs, e.g. "resolved 2 of 3 pcs".
- Update the QC decision schema, the shared validation and the tests.

Everywhere damage pcs are shown (chips, Takas tab, Damages tab, drawers), show the **open** pcs, with "(2 resolved)" when partial.

---

## 2. Remove the `–` / `/` helper keys

Remove the helper key buttons from every taka number field: Taka entry, Edit takas, Receive (butta + mill), and Butta QC. Use `inputMode="tel"` on these fields (most phone keypads then offer `-`). Taka number validation itself doesn't change.

---

## 3. Damage images (Butta QC only)

When **Butta QC adds a new damage**, the damage popup gets an **Images** section:
- Two buttons side by side:
  - **Camera / कैमरा**: `<input type="file" accept="image/*" capture="environment">`, opens the back camera directly
  - **Attach image / फोटो जोड़ें**: `accept="image/*" multiple`, picks from the device
- **Multiple images per damage** (max 10). Images are **optional**.
- Selected images show as thumbnails with a remove ✕ and an upload progress state. Use the existing client-side shrink (> 3 MB) and the existing upload API with a new folder `damages`. On the live site this goes to **Cloudinary** (already wired in `storage/cloudinary.ts`).
- The popup's Save is disabled while uploads are running.
- **Permissions:** allow the Butta QC role to upload to the `damages` folder only.
- The Taka entry and Edit takas damage popups do **not** get images.

**Data:** a new table `taka_damage_images`:
- `id`, `taka_damage_id` (FK, indexed)
- `image_url`, `thumb_url`
- `created_by`, `created_at`

**Where images show:**
- **Not** on list views or chips.
- **Only** in the **taka details drawer** (Takas tab → chip): thumbnails under each damage, tap → lightbox.
- In the **damage details screen** (§9).

---

## 4. Butta cutting module: counts on the Send sub-tabs

The Send sub-tabs show their **taka counts** in brackets: **Pending (124)** · **In butta cutting (380)**. Use the existing count-pill style if that reads cleaner than brackets. The counts update with the lists.

---

## 5. Mill: the new stages and statuses

**Taka stages** (`shared/src/pipeline.ts`):
- `waiting_mill`: exists (Butta QC done, or the design skips butta)
- `at_mill`: sent on a mill challan. Dashboard: Mill → "At mill (dyeing)". **Connected now.**
- `mill_qc`: received back from the mill, Mill QC pending (Mill QC comes in a later sprint). Dashboard: Mill → "Received · QC pending". **Connected now.**
- Leave `ready` and the Ready main stage `connected: false`.

**Order statuses** (extend the shared pure status function, the tests and `recomputeOrderStatus`). They only apply once the taka entry done conditions hold (all jobsheets Completed, each with takas). The earliest unfinished stage wins:

| key | label | sequence | Rule |
|---|---|---|---|
| `in_butta_cutting` | In butta cutting | 70 | exists: any taka `at_butta` / `butta_qc` |
| `ready_for_mill` | Ready for mill | 80 | exists: all active takas `waiting_mill` |
| `in_mill` | **In mill** (new) | 90 | no taka before `waiting_mill`, and at least one taka is `at_mill` (some may still be `waiting_mill`) |
| `received_from_mill` | **Received from mill** (new) | 100 | every active taka is `mill_qc` |

Give each new status a distinct badge colour, visible to Jemish and Gaurang. Tests: every combination, including a mix of `waiting_mill` + `at_mill`, and butta + mill at the same time.

---

## 6. Generalise challans (butta + mill share one engine)

Mill works exactly like Butta cutting. Do it **once**:

**Data:**
- Turn the butta challan tables into generic ones: `challans` with a **`kind`** (`butta` | `mill`), and `challan_takas`.
- **Migrate the existing butta challans and their taka rows**, keeping their ids, numbers, received data and cancelled flags. Check counts before and after in the migration and stop with a clear error if anything doesn't match.
- Numbers come from separate counters per kind:
  - butta: **`GSM-<n>`** (continues the current series)
  - mill: **`MIL-<n>`**, starting at **MIL-1**

  Put the prefixes in one config.
- Keep "one active challan per taka **per kind**" (unique partial index).
- **Parties:** keep `butta_parties` as the Butta party master and add a **Mill party master** (`mill_parties`, same fields: Name*, Address, Mobile, GSTIN, Notes; same rules). Build both screens from **one shared master component** with a `kind` prop.

**Code:**
- Extract the butta services and screens into shared, kind-aware building blocks:
  - order cards
  - the takas drawer with selection
  - the selection bar
  - the send confirm popup
  - the challan list cards
  - challan details
  - the Receive screen
  - the challan print
- Butta and Mill then pass their kind-specific rules:
  - which stage is "ready to send"
  - which stage the takas move to on send / receive
  - labels and colours
  - the party master
  - the number prefix
- The existing butta endpoints may stay as they are (or become `/challans?kind=`); the client and behaviour must not change for butta.

---

## 7. Mill module (`/mill`)

**Access:** Jemish, Gaurang and the **Godown supervisor**, the same as Butta cutting.
- New permissions: `canUseMillModule` (all three) and `canManageMillParties` (Jemish, Gaurang). `canCancelChallan` is reused.
- Add **Mill** to their nav, next to Butta cutting (the phone More sheet if the bar is full).
- The godown supervisor still never sees client names.

Two tabs: **Send** | **Receive**. Same layout, components and behaviour as Butta cutting.

### 7.1 Send → **Pending (N)** | **In mill (N)**

**Pending:** orders that have takas not yet sent to the mill, with **at least one taka ready**.
- **Order cards** show the design image + code, **Order #26**, the quality, and the readiness:
  - **"18 / 20 ready to send"**: ready = takas in `waiting_mill`; total = the order's active takas not yet sent to the mill
  - a thin progress bar
  - total meters of the ready takas
  - A fully ready order shows a calm green "All 20 ready".
- **Tapping an order** opens the takas drawer: **every** taka of the order with its stage/status label. Ready takas are selectable (**all ready ones pre-selected**, Select all / untick). Not-ready takas are shown greyed with their status (e.g. "At butta cutting", "Butta QC pending") and can't be selected.
- Order checkboxes, multi-order selection and the selection bar work the same as Butta cutting ("N takas · M m selected" + **Send to mill**).
- **Not-ready warning:** when **Send to mill** is pressed and any selected order still has takas that aren't ready, first show an alert listing those takas grouped by order (taka no + current status), e.g. "Order #26: 2 takas not ready — 6251 (At butta cutting), 6252 (Butta QC pending)".
  - Buttons: **Cancel** / **Send ready takas only (N)**.
  - The not-ready takas stay behind and go on a later challan.
- **Confirmation popup:** total takas, total meters, orders, **Mill party** (required, from the Mill party master), challan date (today), Eway no (optional) → **Create challan**.
- **On confirm (one transaction):**
  - next `MIL-<n>`
  - challan + taka rows with meters/pcs at send
  - each taka must still be `waiting_mill` (conditional update, 409 with a list otherwise)
  - takas → `at_mill`, with `sent_mill` events
  - recompute order statuses
  - then the challan preview (Print / Close)

**In mill:** mill challan cards, the same as butta: **MIL-12**, party, date, total takas, meters, **received X / Y** with a progress bar, filters Open / Fully received / All, search. Clicking a card opens the challan details.

### 7.2 Receive → **Taka number** | **Challans**

The same as butta:
- **Taka number:** a big input + **Received** (Enter works).
- **Rules:**
  - not found → alert
  - not at the mill → "Taka 6245 was not sent to the mill" (or "is at <stage>"), not received
  - already received → alert
- **On success:** taka → `mill_qc`, `received_mill` event, recompute the status, the "Received now" list with **Undo** (allowed until Mill QC starts, which is a later sprint, so always allowed for now; `receive_undone` event).
- **Challans:** mill challans with takas still to receive, live (refetch every 10 s + on focus + after each receive).

### 7.3 Challan details + print

- **Details:** the same as butta (header, summary tiles, orders chips, order-wise lists with in-mill first and received below, tick-to-receive, Print, Cancel challan while nothing is received).
- **Print:** **exactly the same format** as the butta challan (company header, `!! DELIVERY CHALLAN !!`, party box, `Ch. No MIL-12`, Date, Eway No, Quality Name, 4×12 taka table with group subtotals, totals, signatures, multi-page). Only the challan number and party change.

---

## 8. Order details: a new **Docs** tab

Add a tab **Docs** after History.
- Inside it, a sub-section pill row; for now one pill: **Challans** (built so more document types can be added later).
- **Challans:** every challan (**butta and mill**, including cancelled ones) that contains **at least one taka of this order**. Newest first.
- Each row/card shows:
  - the **challan no** (GSM-173 / MIL-12) and a kind badge (Butta cutting / Mill)
  - the party
  - the date
  - **this order's takas in it** ("8 of 20 takas") and their meters
  - the challan's received X / Y
  - a "Cancelled" badge when cancelled
  - a print icon button
- Clicking opens the challan details.
- Empty state: "No challans for this order yet".
- Endpoint: `GET /orders/:id/challans`.

---

## 9. Damage details screen

- In the order's **Damages** tab, **clicking a damaged taka card** opens a **damage details screen**: route `/orders/:orderId/takas/:takaId/damages`, inside the app layout, with a back link to the Damages tab (keeping its filter).
- **Header:** **Taka 6245**, Order #26 (319), design thumbnail (lightbox) + code, quality, meters, pcs, current stage, challan(s), and Fresh / Damaged state.
- **One section per damage** of this taka (open first, then resolved):
  - the damage name
  - where found (Machine / Butta cutting / Mill damage)
  - **pcs:** damaged, resolved, still open
  - status
  - who added it and when
  - an **image gallery** (thumbnails → lightbox with next/previous). No images → nothing shown.
  - a **timeline** for that damage from `taka_events`: added (role, date) → kept at Butta QC → partly resolved (2 of 3 pcs) → resolved…
- Jemish/Gaurang can open **Edit takas** from here (the existing flow).
- Endpoint: `GET /takas/:id/damages` (damages + images + their events).

---

## 10. Order dashboard polish

**10.1 Completed main stages.** When a main stage is **fully completed** for the order, show its card in a **calm completed state**:
- neutral grey background
- muted text and a grey dot instead of the stage colour
- the count still visible
- a small grey **"✓ Completed"** tag in the top-right corner

It **stays fully functional**: clickable, selectable, opens the sub-stages and details as before. This is a visual state only.

**"Completed" rules** (computed in `buildOrderDashboard`, with tests):
- **Production:** all active jobsheets Completed, each with ≥ 1 taka, and no taka still in a Production stage (`entered`).
- **Butta cutting:** Production completed and no taka in `entered`, `at_butta` or `butta_qc`. If no taka of the order ever went to butta cutting (no-butta design), show **"Skipped"** in the same grey style instead of "Completed".
- **Mill:** Butta cutting completed/skipped and every taka is past `mill_qc`. That can't happen yet, so Mill shows as completed only once later stages are connected.
- Not-connected stages are never "Completed".

**10.2 Bar in pcs.** The top bar and the numbers under it use **pcs instead of frames**:
- a jobsheet without takas counts as its frames (actual frames if completed) × `SECTIONS_PER_BEAM`
- takas count their own **pcs** (if a taka has no pcs, fall back to its share of the jobsheet's frames × `SECTIONS_PER_BEAM`)

The legend and summary read like "1,140 pcs · Production 62% · Butta cutting 30% · Mill 8%". Update the tests.

---

## 11. Visual quality: elegant, not just functional

The last screens felt plain. For every screen in this sprint (Mill, Docs tab, damage details, the Butta QC popups and image picker, completed dashboard states), do a **design pass** before calling a phase done:
- **Hierarchy:** one clear focal point per card (the order number or challan number large and confident); secondary info in muted, smaller text; numbers in `tabular-nums`.
- **Calm colour:**
  - neutral surfaces
  - the stage/status colour only in small accents (dots, thin progress bars, badges)
  - no large saturated fills
  - maroon for primary actions and the selected state only
  - gold only as a tiny highlight, if at all
- **Spacing and rhythm:** a consistent spacing scale (4/8/12/16/24/32), generous padding in cards, aligned baselines; nothing cramped at 360px.
- **Softness:** the existing radius tokens, subtle borders (`border-border`), `shadow-soft` only; no heavy outlines or double borders.
- **Detail:**
  - thin progress bars with rounded ends
  - small icon + label pairs
  - skeletons that match the final layout
  - friendly empty states with an icon and one line of guidance
  - smooth hover/press states and 150–200 ms transitions
- **Consistency:** Mill must look like a sibling of Butta cutting (same components), with its own accent colour from the pipeline config.

**Self-check:** at the end of each UI phase, take screenshots at **360px, 768px and 1280px** (Playwright if available) and compare them with the existing order list, supervisor screens and Butta cutting screens. Fix anything that looks heavier, busier or less aligned than those. Mention in your phase summary what you refined.

---

## 12. API summary (new or changed)

| Method | Path | Notes | Permission |
|---|---|---|---|
| POST | `/butta-qc/:takaId` | `damageDecisions: [{ takaDamageId, resolvedPcs }]` (0 = not resolved); `newDamages: [{ damageId \| otherName, pcs, images: [{url, thumbUrl}] }]` | `canButtaQc` |
| POST | `/uploads?folder=damages` | images for damages | + `canButtaQc` |
| CRUD | `/mill-parties`, `GET /lookup/mill-parties` | the Mill party master | manage: `canManageMillParties`; lookup: + godown supervisor |
| GET | `/mill/pending-orders?search=&page=` | orders with ready (`waiting_mill`) takas: ready / total, meters (one aggregate query) + tab counts | `canUseMillModule` |
| GET | `/mill/pending-orders/:orderId/takas` | all of the order's not-yet-sent-to-mill takas with stage + `ready` flag | `canUseMillModule` |
| POST | `/mill/challans` | `{ takaIds[], partyId, challanDate, ewayNo? }` (only `waiting_mill` takas) | `canUseMillModule` |
| GET | `/mill/challans…`, `/mill/challans/:id`, `/mill/challans/:id/print`, `POST /mill/challans/:id/cancel`, `POST /mill/receive`, `POST /mill/receive/:takaId/undo` | the same contracts as the butta ones (shared, kind-aware services) | `canUseMillModule` / `canCancelChallan` |
| GET | `/orders/:id/challans` | Docs → Challans | Jemish, Gaurang |
| GET | `/takas/:id/damages` | the damage details screen | Jemish, Gaurang |

- Every multi-row write is one transaction with conditional stage updates, ending with `recomputeOrderStatus` for the touched orders.
- Validate with zod in `shared/src/schemas.ts`.
- Invalidate the mill/butta lists, challans, dashboards, takas, damages and orders queries after each write.
- Restricted roles never get client names (test with `X-Role`).

---

## 13. Quality checklist

- **Shared tests:**
  - partial resolve (`resolved_pcs`, Fresh rule)
  - the new statuses
  - mill readiness counts
  - the "send ready only" split
  - `MIL-` numbering
  - dashboard completed/skipped rules
  - pcs-based bar shares
- The challan migration keeps every existing butta challan intact (counts checked), and the Butta cutting screens behave exactly as before.
- The mill challan print matches the butta print on paper.
- The camera button opens the camera on Android and iPhone over HTTPS; uploads land in Cloudinary on the live site.
- No overflow at 360px; tap targets are at least 48px on the godown supervisor and Butta QC screens.
- The design pass (§11) is done with screenshots for every new screen.

## 14. Build phases

1. **Butta QC fixes:** partial resolve (`resolved_pcs`), remove the helper keys, the Send tab counts.
2. **Damage images:** the upload folder/permission, the picker in the Butta QC damage popup, `taka_damage_images`, display in the taka drawer.
3. **Challan generalisation:** the generic `challans` tables + migration with checks, the kind-aware shared services and components, butta re-verified unchanged.
4. **Mill:** stages, statuses, Mill party master, Send (readiness, not-ready warning, confirm, challan), In mill, Receive, details, print.
5. **Docs tab** (challans for the order).
6. **Damage details screen.**
7. **Dashboard polish:** completed/skipped states, the pcs-based bar.
8. **Design pass and polish:** screenshots at all breakpoints for every new screen; update `CLAUDE.md` and `PROJECT_STATE.md`.
