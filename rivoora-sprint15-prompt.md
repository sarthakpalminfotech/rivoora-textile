# Rivoora Textile — Sprint 15: Live jobsheet numbers, Hold order, godown supervisor Orders, mill/butta in takas, refinish challan label, share damage photos, split damage picker, and small fixes

This continues the existing project. Read `CLAUDE.md` and `PROJECT_STATE.md` first (up to the Sprint 14 follow-ups and the navigation update). The app is live with real data, so:
- **every migration is additive**, tested on a local file DB copy first
- tell me exactly what `npm run db:migrate` will change on Turso before I run it
- never run wipe/seed scripts against Turso

**Keep the current look.** Follow the visual rules from Sprint 8 §11 and do a screenshot pass at 360 / 768 / 1280px for every changed screen.

**How to work**
0. Run `git status`. If there are uncommitted changes, stop and tell me so I can commit them first.
1. Start in plan mode: migrations, the hold rules (which queries and permissions change), and the screens.
2. Do the items in the order of the phases at the end, with one commit per item. After each one, run `npm run typecheck` and `npm test`, run the app, and re-check the related flows for every affected role.
3. At the end, update `CLAUDE.md` and `PROJECT_STATE.md`, and give me a short summary per item.

---

## 1. Jobsheet numbers must be live (bug)

**Problem:** the Jobsheets section on order details (Jobsheet quantity, Frames needed, Frames in jobsheets, warnings) uses `orders.jobsheet_pieces` / `target_frames`. These are **added to on create** but **never reduced on delete or edit**. Example: after deleting a jobsheet (now 7 frames short), "Jobsheet quantity" still shows 200 pcs. Adding a single jobsheet also wrongly warns about extra pcs.

**Fix:** compute everything **live from the active jobsheets** (one shared pure function, e.g. `orderJobsheetPlan(order, jobsheets)` in `shared/src/jobsheets.ts`):
- **Frames needed** = `ceil(order quantity / SECTIONS_PER_BEAM)` (pcs orders).
- **Frames in jobsheets** = the sum of each active jobsheet's effective frames (`completed_frames` if Completed, otherwise `frames`). This is the existing `coverageFrames` rule.
- **Jobsheet quantity (pcs)** = frames in jobsheets × `SECTIONS_PER_BEAM`.
- **Warnings / coverage** compare these with the order quantity, and are recalculated after every create, single add, edit (incl. auto-adjust), delete, complete and change machine.
- The **Create jobsheets** and **Add single jobsheet** previews use the same function with the new jobsheet(s) added. The "extra / short pcs" message must be correct.
  - The single jobsheet's **Pieces** field becomes **read-only** (= frames × 3), so the stored numbers can never disagree.
- Stop reading `orders.jobsheet_pieces` / `target_frames` anywhere (dashboard, order header, jobsheet print "jobsheet quantity", inventory). Leave the columns in the DB (no data change) and mark them deprecated in the schema comments.
- `frames_per_jobsheet` is still used by the auto-adjust split. Keep it.
- **Check that delete and edit really work end to end:** delete a jobsheet; edit frames with auto-adjust; delete the last one (back to Jobsheet pending). The section, dashboard and order status must update immediately (invalidate the right queries).
- **Tests:** create → delete → numbers drop; edit +/−; single add preview; completed with fewer frames.

## 2. Save / Confirm stays above the on-screen keyboard

On phones and tablets, the sticky **Save / Confirm / Submit** bars get hidden behind the keyboard. Fix it **once, for every sticky action bar and every dialog footer that has inputs**:
- Use the `visualViewport` API (a small shared hook, e.g. `useKeyboardInset()`) to lift sticky bars and modal footers above the keyboard while it's open. Fall back gracefully where `visualViewport` isn't supported.
- Also scroll the focused input into view above the bar.
- Check at least: Taka entry, Edit takas, QC screens, damage popup, Add / Edit order, jobsheet forms, Send / Receive popups, Split screen, Edit pcs, GR form, login, masters forms.

## 3. Remove "Picks" from jobsheets

- Remove the **Picks** input from Create jobsheets, Add single jobsheet and Edit jobsheet, and from every screen that displays picks (cards, details, supervisor screens).
- **Print:** keep the **PICKS** box on the jobsheet print, **always blank** (to be written by hand).
- Keep the `picks` column in the DB (no data change); stop reading and writing it.

## 4. Supervisor → Jobsheets → Order view: quality and machines on the card

On each **order card** in the Order view:
- show the **quality** (material name; an order normally has one)
- show **all machine numbers** assigned (suggested) across the order's visible jobsheets, **merged, unique and sorted**: jobsheet 1 has 2, 3 and jobsheet 2 has 3, 4 → **"Machines: 2, 3, 4"**

Add the data to the same `GET /jobsheets/orders` aggregate query (no per-card queries).

## 5. **Hold order** (Jenish only)

New permission `canHoldOrder`: **Jenish only** (role key `jemish`).

**Data (additive):** on `orders`:
- `is_on_hold` (boolean, default false, indexed)
- `held_at`, `held_by_user_id`, `hold_note`
- `released_at`

Write `order_status_history`-style entries **"Put on hold"** / **"Released from hold"** (or a dedicated event), visible on the History tab.

### 5.1 Putting an order on hold
- On the order details header, Jenish gets **Hold order** (and **Release hold** when held).
- **Hold dialog:**
  - a short explanation: "Work on this order will stop and it will be hidden from production, QC, godown and dispatch until you release it"
  - an optional note
  - **if the order has jobsheets on the loom (Ongoing):** an amber alert listing each one (`Order #26 (319)` · Machine 7 · 10 frames assigned · running 4 h), with a required **"Frames completed"** input per jobsheet (0 to assigned, same control as the supervisor's Complete)

**On confirm (one transaction):**
- each ongoing jobsheet is **completed** with the frames entered (`completed` event, note "completed on hold")
- if frames remain, a new **Pending** jobsheet with the remaining frames is created (new number, same machines, `parent_jobsheet_id`), so it can be sent again after release
- then the order is set on hold and the status is recomputed

### 5.2 What hold does
- **Jenish and Gaurang** still see the order everywhere, with a clear **"On hold"** badge (on the order card, header, Dispatched module, inventory order rows). Gaurang can't release it. All write actions on a held order are blocked for Gaurang too (buttons disabled with "Order is on hold").
- **Hidden from every other role** while held:
  - **Supervisor:** jobsheet lists (All + Order view), order cards, Orders module, Machine view running rows
  - **Taka entry:** jobsheet lists. Scanning or typing a held order's jobsheet shows a clear bilingual "This order is on hold / यह ऑर्डर होल्ड पर है" and blocks entry.
  - **QC:** opening a taka of a held order shows the same message and blocks QC
  - **Godown supervisor:** Butta / Mill **Pending** and **Refinish** lists (nothing new can be sent), his Orders module
  - **Dhruvil:** godown Orders and dispatch (no ready / dispatch / GR actions)
- **Exception, receiving:** takas **already at butta cutting or the mill** can still be **received** (Butta receive by taka number, Mill received count, and challan details stay usable). Receiving only records that they're back; they then wait, hidden, until release.
- **Server-side:** every write endpoint on jobsheets, takas, QC, send, dispatch, GR, move-to-inventory, rework and split checks the hold and returns **409 "Order #26 is on hold"**. The only exceptions are the receive endpoints and Jenish's release.
- Put the hold filter in one shared SQL helper (e.g. `orderNotOnHold`) used by every list query for those roles. **Grep every list query** that those roles use.

### 5.3 Release
**Release hold** (Jenish): a confirm → everything becomes visible again and the status is recomputed. Pending jobsheets created at hold time can be sent to the supervisor as usual.

## 6. Godown supervisor: **Orders** module (read-only, butta onwards)

Give the godown supervisor the **Orders** list and **order details**, limited to his part of the work:
- **Which orders:** orders that have **at least one taka at the butta stage or later**, i.e. any taka in `entered` (waiting for butta), `rework_butta`, `at_butta`, `butta_qc`, `waiting_mill`, `at_mill`, `mill_qc`, `refinish`, `final`, `ready_dispatch`, `dispatched`. Never orders still only in production. Held orders are hidden (§5).
- **No client name, broker, phone or rate** (`canSeeClient` / `canSeeRate` stay false). Read-only: no write actions.
- **Order details tabs:**
  - **Dashboard**, showing only the **Butta cutting, Mill and Ready** main stages (no Production card, no jobsheet KPIs)
  - **Takas**
  - **Damages**
  - **Docs**
  - **History**
  - **No Jobsheets tab.** The header hides the production fields.
- Implement it with a permission (e.g. `canViewGodownOrders`) and a role option for the visible stages, the same way the supervisor's limited Orders view was done in Sprint 11. Add **Orders** to his nav.

## 7. Butta cutting and Mill: count in **takas**, not pcs

Wherever a sent challan is compared with what came back (Receive → Challans cards, In butta cutting / In mill cards, challan details, Docs rows), show **takas only**:
- **"Sent 20 takas · Received 12"**, with progress = received / sent takas
- Remove the "expected pcs" vs received comparison. Pcs/meters may stay as secondary info where they're already shown, but **progress and counts are in takas**.
- Mill keeps its received **count** input (in takas).

## 8. Mill → Send → Pending: takas drawer from the right

Tapping a **pending order card** on Mill → Send → Pending opens the **right-side takas drawer** (full screen on phones), exactly like Butta cutting:
- all **ready** takas of that order, **all selected by default**; the user can untick any
- not-ready takas are greyed with their stage
- **Done** keeps the selection; the selection bar and the Send to mill flow use it

If the drawer already exists but doesn't open from the card, fix the wiring. Do the same check for the **Refinish** sub-tab.

## 9. Mill challan print: **"FOR REFINISH"**

Refinish challans are always separate from normal ones (they're never mixed). On the mill challan print for a **refinish challan**, print **FOR REFINISH** in bold at the **right end of the "Quality Name" row**.
- Add a flag on the challan (or derive it: all of its takas are refinish trips).
- Show a small **"Refinish"** tag on that challan's cards and details too.
- Block mixing on the server: one challan = all refinish or all normal.

## 10. Share damage photos (WhatsApp)

Wherever a damage photo is shown (the damage popup thumbnails, the taka details drawer, the damage details screen, the image lightbox), add a **Share** button:
- **Message** (prefilled):
  > "Damage: Mill damage · Hole · 2 pcs | Taka 1101 | Order #26"

  (damage type · damage name · open pcs | taka number | order number; add the jobsheet "(319)" if useful)
- **Phones / tablets:** use the Web Share API **with the image file** + the text (`navigator.share({ files, text })`, after `navigator.canShare`), so the phone's share sheet opens with WhatsApp included.
- **Fallback** (desktop, or no file sharing): open `https://wa.me/?text=<encoded message>` and **download the image** so it can be attached by hand. Show a small toast explaining this.
- Fetch the image as a blob from its Cloudinary/local URL. Handle failures with a friendly message.
- Bilingual labels on QC / Taka entry screens.

## 11. Split screen (Dhruvil): pick which earlier damage a part has

On the Split screen, when a part is marked **Damage**, first show **"Which damage is this?"**: a picker (standard `Select` or tappable list) of the **open damages of this order**:
- the **split taka's own open damages first**, then other open damages of takas in the same order
- each option shows: damage type · damage name · open pcs · marked date · source taka (e.g. "Mill damage · Hole · 2 pcs · 14-10-2026 · Taka 1101")
- a last option: **Other (new damage)**

**Choosing an existing damage:**
- Its details are shown **read-only**: type, name, marked date, where recorded, photos.
- **Damaged pcs** is prefilled with the damage's open pcs and **editable**. If it differs from the original, or exceeds the part's pcs, show an **amber mismatch alert** ("Original damage was 3 pcs — you entered 2"). Pcs can't exceed the part's pcs.
- On save, the damage is **moved** to that part:
  - the part gets the damage (same type, name, marked date, `recorded_at`, photos linked) with the entered pcs
  - the original open damage is closed (`resolved_stage = 'split'`, note "moved to 1101A")
  - an event is written on both takas
- **Each existing damage can be picked only once** in a split: it disappears from the picker for the other parts.

**Choosing Other:** the normal damage popup (type radio, name, pcs, photos), as for a first-time damage.

**Interaction with the existing rule** "split clears all open damages of the original taka": damages **moved** to parts stay open on those parts. The rest are cleared as today. Show the amber note listing which damages will be cleared.

Put the logic in shared helpers with tests: picker ordering, single use, pcs mismatch.

## 12. QC: meters and pcs are read-only

In the **QC role** (Butta QC and Mill QC screens), **meters and pcs are display-only**. Remove the editable inputs and make the server **ignore or reject** meters/pcs changes from QC endpoints (409 or schema change). Damage pcs inputs in the damage popup stay as they are.

---

## API / data summary (additive)

- `orders`: `is_on_hold`, `held_at`, `held_by_user_id`, `hold_note`, `released_at` + an index on `is_on_hold`.
- Challans: a refinish flag (or derived).
- `POST /orders/:id/hold` `{ note?, ongoing: [{ jobsheetId, completedFrames }] }` · `POST /orders/:id/release` (`canHoldOrder`).
- `GET /jobsheets/orders`: + `quality`, `machineNos[]`.
- Godown supervisor: read access to the orders routers with the limited view (§6).
- QC endpoints: no meters/pcs changes.
- Split: `parts[].damages[]` accept `{ fromTakaDamageId, pcs }` or a new damage.

**Jobsheet numbers (§1) need no schema change** (computed live). Picks: no schema change.

## Quality checklist

- **Tests:**
  - `orderJobsheetPlan` (create / delete / edit / single preview / completed short)
  - the hold rules (lists hidden, writes 409, receive allowed, hold with ongoing jobsheets → completed + remaining pending)
  - the godown supervisor order visibility
  - the split damage picker (order, single use, pcs mismatch, move)
  - the refinish flag (no mixing)
  - the share message text
- **Role regression after the hold and godown changes:** Jenish, Gaurang, Supervisor, Taka entry, QC, Godown supervisor and Dhruvil each still see and do what they did before (for non-held orders).
- **Real phone/tablet check:** the keyboard + Save button (§2) and share with an image (§10).

## Build phases
1. Live jobsheet numbers (§1) + picks removal (§3) + supervisor order card (§4).
2. Keyboard-safe action bars (§2).
3. QC read-only meters/pcs (§12) + takas-only counts (§7) + mill drawer (§8) + refinish label (§9).
4. Hold order (§5): migration, server checks, list filters, hold dialog, badges.
5. Godown supervisor Orders (§6).
6. Share damage photos (§10).
7. Split damage picker (§11).
8. Polish: screenshots at all breakpoints, a full role regression, update `CLAUDE.md` + `PROJECT_STATE.md`.
