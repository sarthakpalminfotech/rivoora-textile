# Rivoora Textile — State Machines

Every status / stage the system stores, written from the code (commit `b4fd6be`). Operation IDs (e.g. `BUT-03`) point
to `FLOW_INVENTORY.md`. Each machine ends with **states with no way out** and **transitions that look missing** —
candidates for `GAPS_AND_QUESTIONS.md`.

Contents: 1 Order status · 2 Order flags (hold, closed, steps) · 3 Jobsheet status · 4 Taka stage (+ routing, free
stock, ownership) · 5 Damage lifecycle · 6 Butta / mill challan · 7 Delivery challan (DC) · 8 Outside PO · 9 Yarn PO ·
10 TFO program · 11 Warping job · 12 Beam · 13 Masters / users (active, deleted)

---

## 1. Order status (`orders.status`)

Config: `shared/src/statuses.ts` (`ORDER_STATUSES`). Only two statuses are **set by hand**; every other status is
**derived** by one function, `orderStatusForJobsheets(jobsheets, takaStages, hadGoodsReturn, {steps, isClosed})`, run
by `recomputeOrderStatus` (`server/src/services/jobsheets.ts`) at the end of every jobsheet / taka / challan / QC /
godown / dispatch / free-stock / steps / hold / close write. A history row is written only when the value changes
(a lower sequence shows as "Moved back to …").

### 1.1 Statuses

| Seq | Key | Label | Visible to |
|---|---|---|---|
| 10 | `pending_production` | Pending for production | Jenish |
| 20 | `ready_production` | Jobsheet pending | Jenish, Gaurang |
| 22 | `outside_production` | At outside weaver | Jenish, Gaurang, Dhruvil |
| 24 | `awaiting_goods` | Awaiting goods | Jenish, Gaurang, Dhruvil |
| 30 | `jobsheet_created` | Jobsheet created | Jenish, Gaurang, Supervisor |
| 40 | `in_production` | In production | + Godown supervisor |
| 50 | `production_completed` | Production completed | Jenish, Gaurang, Supervisor, Godown sup. |
| 60 | `taka_entry_done` | Taka entry done | Jenish, Gaurang, Supervisor, Godown sup. |
| 70 | `in_butta_cutting` | In butta cutting | Jenish, Gaurang, Godown sup. |
| 80 | `ready_for_mill` | Ready for mill | Jenish, Gaurang, Godown sup. |
| 90 | `in_mill` | In mill | Jenish, Gaurang, Godown sup. |
| 100 | `received_from_mill` | Received from mill | Jenish, Gaurang, Godown sup. |
| 110 | `mill_qc_done` | Mill QC done | Jenish, Gaurang, Godown sup. |
| 115 | `in_godown` | In godown (orders without Mill) | Jenish, Gaurang, Dhruvil, Godown sup. |
| 120 | `ready_for_dispatch` | Ready for dispatch | Jenish, Gaurang, Godown sup. |
| 130 | `partly_dispatched` | Partly dispatched | Jenish, Gaurang, Dhruvil, Godown sup. |
| 140 | `dispatched` | Dispatched | Jenish, Gaurang, Dhruvil, Godown sup. |
| 145 | `returned` | Returned | Jenish, Gaurang, Dhruvil, Godown sup. |
| 150 | `closed` | Closed | Jenish, Gaurang |

"On hold" is **not** a status — it is a flag (§2) shown as a badge.

### 1.2 Hand-set transitions

| From → To | Trigger | Who | Conditions | Evidence |
|---|---|---|---|---|
| (new) → Pending for production | Add order (ORD-02) | Jenish | — | `createOrder` (`services/orders.ts`) |
| Pending for production → Jobsheet pending, then immediately re-derived (outside → At outside weaver; FG → Awaiting goods) | Send for production (ORD-06) | Jenish | Status is Pending for production | `sendToProduction` |
| Jobsheet pending / At outside weaver / Awaiting goods → Pending for production | Undo send for production (ORD-07) | Jenish | No jobsheets, no non-cancelled outside POs; outside / FG: no takas. UI offers it only for Jobsheet pending | `undoSendToProduction`, `order-details-page.tsx` |
| any → Closed | Close order (HLD-04) | Jenish, Gaurang | Not closed; not held | `closeOrder` (`services/close-order.ts`) → recompute returns Closed whenever `is_closed` |

### 1.3 How every other status is derived (precedence, top wins)

Rule runs only for orders that are Jobsheet pending or later (a Pending-for-production order is never moved, unless closed).

| # | Condition | Status |
|---|---|---|
| 1 | Order is closed | **Closed** (overrides everything, also Pending for production) |
| 2 | Kind is **outside production** or **FG** and the order has **no active taka** counting for it | Returned if it ever had a GR; else **At outside weaver** (outside) / **Awaiting goods** (FG) |
| 3 | Kind outside / FG with takas | → the **taka rule** (rows 8–16) |
| 4 | In-house, **no real jobsheets** | **Jobsheet pending** (even if free stock / outside PO already gave it takas) |
| 5 | In-house, every jobsheet Completed but **not every one has a taka** | **Production completed** |
| 6 | In-house, every jobsheet Completed and each has ≥ 1 taka | → the **taka rule** |
| 7 | In-house, any jobsheet Ongoing or Completed (rest Pending / Sent) | **In production** |
| 7b | In-house, all jobsheets Pending / Sent | **Jobsheet created** |
| | **Taka rule** (stages of every active, non-free taka counting for the order): | |
| 8 | Any taka **Dispatched**, not all | **Partly dispatched** |
| 9 | All dispatched | **Returned** if the order had a goods return, else **Dispatched** |
| 10 | Any taka at butta / butta QC / sent back to butta | **In butta cutting** |
| 11 | All takas waiting for mill | **Ready for mill** |
| 12 | (no taka still `entered`) all Ready for dispatch | **Ready for dispatch** |
| 13 | (no `entered`) all final / refinish / ready | **Mill QC done** (order has Mill) or **In godown** (no Mill) |
| 14 | (no `entered`) all Mill QC pending or past the mill | **Received from mill** |
| 15 | (no `entered`) any at mill / mill QC / past the mill | **In mill** |
| 16 | otherwise (e.g. some takas still waiting for butta) | **Taka entry done** |

Evidence: `orderStatusForJobsheets`, `statusForTakaStages` (`shared/src/statuses.ts`); `recomputeOrderStatus`
(`server/src/services/jobsheets.ts`); tests `shared/src/sprint16.test.ts`, `sprint13.test.ts`, `sprint9.test.ts`.

### 1.4 Derived moves you'll see (examples of triggers)

| From → To | Typical trigger |
|---|---|
| Jobsheet pending → Jobsheet created | JS-01 / JS-02 |
| Jobsheet created → Jobsheet pending | last jobsheet deleted (JS-04) |
| Jobsheet created → In production | SUP-03 Start, or TE-04 taka entry on any jobsheet |
| In production → Production completed | last jobsheet completed (SUP-04 / SUP-05 / HLD-01 / HLD-04 / TE-04) without takas on all |
| Production completed → Taka entry done / In butta cutting / Ready for mill / In godown… | TE-04 (first taka on the last jobsheet), by where the takas start |
| Taka entry done → In butta cutting | BUT-03 (first challan) |
| In butta cutting → Ready for mill / Mill QC done / In godown | QC-02 for the last taka in butta |
| Ready for mill → In mill | MIL-03 |
| In mill → Received from mill → Mill QC done | MIL-07 count does **not** change stages; BUT/MIL receive or QC-03 does |
| Mill QC done / In godown → Ready for dispatch | GD-09 for all takas |
| any → Partly dispatched / Dispatched | DSP-01 |
| Dispatched → Partly dispatched → Returned | DSP-05 / DSP-06 (returned goods become free stock, so remaining ones are all dispatched → Returned) |
| any later status → In butta cutting / In mill ("Moved back to …") | RW-01 / RW-02, GD-08, a new jobsheet added (back to In production) |
| At outside weaver / Awaiting goods → taka rule status | OUT-06 / FG-01 / FG-02 / FS-02 first taka |
| any → previous derived status | Move to inventory (FS-01) removes takas from the order |

### 1.5 States with no way out / missing transitions

- **Closed**: no reopen.
- **Dispatched / Returned**: final; a returned order can't take more free stock (`canReceiveFreeStock`).
- No **Cancelled** order status and no order delete; Close is the only way to stop an order.
- **Pending for production** is visible only to Jenish; Gaurang can't see or send it.
- Undo for At outside weaver / Awaiting goods exists on the server but has no button.
- A non-pcs in-house order can never leave **Jobsheet pending** by production (no jobsheets for kg / g / meters); it can
  only move through outside POs or free stock.
- Status never reflects "on hold" (only a flag) — lists can't filter by hold.

---

## 2. Order flags

| Flag | From → To | Trigger | Who | Conditions | Evidence |
|---|---|---|---|---|---|
| `is_on_hold` | off → on | Hold (HLD-01) | Jenish | Not on hold (closed is **not** checked) | `holdOrder` |
| | on → off | Release (HLD-02) | Jenish | On hold | `releaseOrder` |
| `is_closed` | off → on | Close (HLD-04) | Jenish, Gaurang | Not closed, not held | `closeOrder` |
| | on → off | — | — | **No reopen** | — |
| Steps `has_production / has_butta / has_mill` | any → any | Add / Edit order (ORD-02/04/05) | Jenish, Gaurang (edit) | Untick locks (jobsheets / butta history / mill history); outside POs forbid "nothing ticked"; closed blocks | `applyStepsChange`, `stepsChangeError` |

Order **kind** (`ORDER_KINDS`, `shared/src/orderSteps.ts`) follows the steps: Production ticked → `in_house`
(In-house); else Butta or Mill → `outside_production` (Outside production); none → `fg_purchase` (FG purchase).

---

## 3. Jobsheet status (`jobsheets.status` + soft delete)

Config: `JOBSHEET_STATUSES` (`shared/src/statuses.ts`): `pending` (Pending), `sent` (Sent to supervisor), `ongoing`
(Ongoing), `completed` (Completed), plus `is_deleted` (deleted / cancelled). The supervisor sees `sent` as "Pending" and `ongoing` as "On-loom".
The hidden **external jobsheet** of an order (outside / FG takas) is created Completed with 0 frames and never listed.

| From → To | Trigger | Who | Conditions | Evidence |
|---|---|---|---|---|
| (new) → Pending | Create / Add single (JS-01/02) | Jenish, Gaurang | Order Jobsheet pending or later, Production ticked, pcs, not held / closed | `generateJobsheets`, `addSingleJobsheet` |
| (new) → Pending | Auto-adjust creates extra (JS-03) | Jenish, Gaurang | Edited jobsheet Pending | `updateJobsheet` / `planFramesEdit` |
| (new) → Pending | Hold with remaining frames (HLD-01) | Jenish | Ongoing jobsheet completed with fewer frames | `holdOrder` |
| (new) → Sent | Change machine (SUP-05) | Supervisor | Ongoing jobsheet | `changeMachine` |
| Pending → Sent | Send to supervisor (JS-05) | Jenish, Gaurang | — | `sendJobsheets` |
| Sent → Pending | Pull back (JS-06) | Jenish, Gaurang | Not started | `pullBackJobsheet` |
| Sent → Ongoing | Start (SUP-03) | Supervisor | Assigned active loom | `startJobsheet` |
| Ongoing → Completed | Complete (SUP-04) | Supervisor | Frames ≥ 0 (above assigned allowed) | `completeJobsheet` |
| Ongoing → Completed | Change machine (SUP-05) | Supervisor | Frames ≤ assigned | `changeMachine` |
| Ongoing → Completed | Hold / Close with frames (HLD-01/04) | Jenish / Jenish, Gaurang | Frames ≤ assigned | `holdOrder`, `closeOrder` |
| **Pending / Sent / Ongoing → Completed** | Taka entry (TE-04) | Taka entry | Any status; completed frames = assigned | `enterTakas` |
| Pending → deleted | Delete (JS-04) / auto-adjust removal (JS-03) | Jenish, Gaurang | Pending only | `deleteJobsheet`, `updateJobsheet` |
| Pending / Sent → deleted ("cancelled" event) | Close order (HLD-04) | Jenish, Gaurang | — | `closeOrder` |

**No way out:** Completed (no reopen, completed frames can't be corrected); deleted / cancelled (no restore).
**Missing:** Ongoing → Sent ("stop / not really started"); Completed → edit frames; Sent jobsheets can't be edited
without pull back; a jobsheet entered at taka entry while still Pending skips Sent / Ongoing (no loom recorded).

---

## 4. Taka stage (`takas.stage`)

Config: `TAKA_STAGES` (`shared/src/pipeline.ts`). 11 values:

| Stage | Label | Where the taka physically is |
|---|---|---|
| `entered` | Taka entry done · waiting for butta cutting | with us |
| `at_butta` | At butta cutting | butta party |
| `butta_qc` | Received · Butta QC pending | with us |
| `waiting_mill` | Waiting for mill | with us |
| `at_mill` | At mill (dyeing) | mill |
| `mill_qc` | Received · Mill QC pending | with us |
| `final` | Final takas (godown) | Dhruvil's godown |
| `refinish` | Refinish (in inventory) | with us, waiting to go back to the mill |
| `ready_dispatch` | Ready for dispatch | godown |
| `rework_butta` | Sent back to butta cutting · waiting | with us |
| `dispatched` | Dispatched | client |

Plus the row flag `is_deleted` (removed by Edit takas) and the ownership flags in §4.4.

### 4.1 The routing rule (`nextTakaStage`, Sprint 16)

| From | Order has Butta | Order has Mill | Next stage |
|---|---|---|---|
| Taka entry (TE-04) or outside weaver receipt (OUT-06) | yes | any | `entered` (waiting for butta) |
| | no | yes | `waiting_mill` |
| | no | no | `final` |
| FG receipt (FG-01/02), received lot, return lot | — | — | `final` |
| Butta QC done (QC-02) | — | yes, and the taka **and every parent** was never dyed (no mill trip, no refinish) | `waiting_mill` |
| | — | otherwise | `final` |
| Mill QC done (QC-03) | — | — | `final` |

Rework (RW-01/02) and refinish are exceptions done by hand. A **free** taka is routed by its **origin** order's steps.
Evidence: `shared/src/pipeline.ts`, `services/taka-ops.ts` (`initialStageForOrder`, `stepsOfTakaOrder`,
`ancestorHasBeenToMill`), tests `sprint16.test.ts`.

### 4.2 Transitions

| From → To | Trigger | Who | Conditions | Evidence |
|---|---|---|---|---|
| (new) → entered / waiting_mill / final | Taka entry (TE-04) | Taka entry | Routing rule | `enterTakas` |
| (new) → entered / waiting_mill / final | Weaver receipt (OUT-06) | Jenish, Gaurang, Godown sup., Dhruvil | Routing rule | `createOutsideReceipt` |
| (new) → final | FG receipt lump / received lot (FG-01/02) | same | — | `createFgReceipt` |
| (new) → final (free) | Pcs GR return lot (DSP-06) | Dhruvil, Jenish, Gaurang | — | `createGoodsReturn` |
| (new) → final / refinish | Split part (GD-05) | Dhruvil, Jenish, Gaurang | Parent final | `splitTaka` |
| (new) → same stage as parent | Pcs move / pcs add split (FS-01/02) | same | Part needed only partly | `splitOffPart` (`inventory-moves.ts`) |
| (new) → any (manual number) | Edit takas add row (ET-01) | Jenish, Gaurang | Jobsheet Completed | `editTakas` (uses the order's start stage) |
| entered → at_butta | Butta challan (BUT-03) | Jenish, Gaurang, Godown sup. | — | `createChallan` |
| rework_butta → at_butta | Butta challan (re-trip) | same | Old challan row closed | `createChallan` |
| at_butta → entered / rework_butta | Cancel butta challan (BUT-10) | Jenish, Gaurang | Nothing received | `cancelChallan` |
| at_butta → butta_qc | Butta receive (BUT-07/08) | Jenish, Gaurang, Godown sup. | On an active challan, not received | `receiveTakas` |
| butta_qc → at_butta | Undo receive (BUT-09) | same | Still butta_qc | `undoReceive` |
| butta_qc → waiting_mill / final | Butta QC (QC-02) | QC | Routing rule | `submitQc` (`butta-qc.ts`) |
| waiting_mill → at_mill | Mill challan (MIL-03) | Jenish, Gaurang, Godown sup. | Not mixed with refinish | `createChallan` |
| refinish → at_mill | Mill challan (refinish trip) | same | Own challan | `createChallan` |
| at_mill → waiting_mill / refinish | Cancel mill challan (MIL-08) | Jenish, Gaurang | Nothing received / counted | `cancelChallan` |
| at_mill → mill_qc | Mill receive (API only) or Mill QC opening an at-mill taka | QC | Active mill row | `receiveTakas` / `submitMillQc` |
| mill_qc → at_mill | Undo mill receive (API only) | — | — | `undoReceive` |
| mill_qc (or at_mill) → final | Mill QC Done (QC-03) | QC | Every open damage answered | `submitMillQc` |
| mill_qc (or at_mill) → refinish | Mill QC Send to refinish (QC-03) | QC | — | `submitMillQc` |
| entered → waiting_mill / final | Butta step unticked (ORD-05) | Jenish, Gaurang | Butta untick allowed | `applyStepsChange` |
| waiting_mill → final | Mill step unticked (ORD-05) | Jenish, Gaurang | Mill untick allowed | `applyStepsChange` |
| entered / waiting_mill / butta_qc / mill_qc / final / ready_dispatch / refinish → rework_butta | Send back to butta (RW-01) | Jenish, Gaurang | Not already there | `sendBackTakas` |
| entered / waiting_mill / butta_qc / mill_qc / final / ready_dispatch / rework_butta → refinish | Send back to mill (RW-02) | Jenish, Gaurang | Not already there | `sendBackTakas` |
| final → refinish | Godown Send to refinish (GD-08) | Dhruvil, Jenish, Gaurang | — | `sendGodownRefinish` |
| final → ready_dispatch | Ready for dispatch (GD-09) | same | Ticked | `confirmReadyDispatch` |
| ready_dispatch → final | Move to inventory (FS-01), Close order (HLD-04) | Jenish, Gaurang, Dhruvil / Jenish, Gaurang | Becomes free stock | `moveToInventory`, `closeOrder` |
| ready_dispatch → dispatched | Dispatch (DSP-01) | Dhruvil, Jenish, Gaurang | All ready takas of the order | `createDispatch` |
| dispatched → final (free) | Lump GR (DSP-05) | same | Active revision | `createGoodsReturn` |
| dispatched → dispatched (fewer pcs) | Pcs GR (DSP-06) | same | — | `reducePcsAcrossRows` |
| entered / waiting_mill → deleted | Edit takas remove (ET-01) | Jenish, Gaurang | Only these two stages | `editTakas` |

### 4.3 What does *not* change the stage

Mill received count (MIL-07), tick / untick, edit pcs, mark damage / resolve, mark fresh, move to inventory of
in-making takas (stage kept), add from free stock (stage kept), hold.

### 4.4 Ownership (who a taka counts for) — `is_free_stock`, `allocated_order_id`

| From → To | Trigger | Who | Evidence |
|---|---|---|---|
| order's → free (reason "Moved") | Move to inventory (FS-01) | Jenish, Gaurang, Dhruvil | `moveToInventory` |
| order's → free (reason "Order closed") | Close order (HLD-04); receive / Butta QC / Mill QC of a closed order's taka | Jenish, Gaurang; receive / QC roles | `closeOrder`, `freeTakasOfClosedOrders` |
| dispatched → free (reason "Returned") | Goods return (DSP-05/06) | Dhruvil, Jenish, Gaurang | `createGoodsReturn` |
| free → allocated to order B | Add from free stock / Assign (FS-02/03) | Jenish, Gaurang (+ Dhruvil FS-02) | `addFromFreeStock` |
| allocated to B → free | Move to inventory from order B | same | `moveToInventory` |

Reasons (`FREE_STOCK_REASONS`): `moved` (Moved), `order_closed` (Order closed), `goods_return` (Returned).
`takas.order_id` (origin) never changes. **No way out:** free stock has no "sell as seconds" / "write off" / "scrap"
state — it waits until assigned (or forever).

### 4.5 Where each stage shows on the order dashboard

Main stages (`MAIN_STAGE_KEYS`): `production` (Production), `outside` (Outside production — instead of Production when
it is not ticked), `purchase` (Purchase — FG), `butta` (Butta cutting), `mill` (Mill), `ready` (Ready). Sub-stages
(`SUB_STAGES`, `shared/src/pipeline.ts`):

| Sub-stage | Label | Main stage | Counts |
|---|---|---|---|
| `not_sent` | Not assigned to supervisor | production | jobsheets Pending |
| `with_supervisor` | Waiting to start on loom | production | jobsheets Sent |
| `on_loom` | On loom | production | jobsheets Ongoing |
| `taka_pending` | Taka entry pending | production | jobsheets Completed without takas |
| `taka_done` | Taka entry done · waiting for butta cutting | production | takas `entered` |
| `outside_po` | Given outside (POs) | production | open POs of an in-house order |
| `at_weaver` | At outside weaver | outside | open POs |
| `at_butta` | At butta cutting | butta | takas `at_butta` |
| `butta_qc` | Received · QC pending | butta | takas `butta_qc` |
| `rework_butta` | Sent back to butta cutting · waiting | butta | takas `rework_butta` |
| `waiting_mill` | Waiting for mill | mill | takas `waiting_mill` |
| `at_mill` | At mill (dyeing) | mill | takas `at_mill` |
| `mill_qc` | Received · QC pending | mill | takas `mill_qc` |
| `refinish` | Refinish (in inventory) | mill | takas `refinish` |
| `final` | Final takas (godown) | ready | takas `final` |
| `ready_dispatch` | Ready for dispatch | ready | takas `ready_dispatch` |
| `dispatched` | Dispatched | ready | takas `dispatched` |

Taka **source** (`takas.source`, `TAKA_SOURCES`): `production` (taka entry), `outside_po` (weaver receipt),
`fg_purchase` (FG receipt). It decides the damage types offered (Machine vs Weaver).

### 4.6 States with no way out / missing transitions

- `dispatched` for **pcs-to-pcs** orders never leaves (GR creates a separate return lot).
- `at_butta` / `at_mill` if a party never returns goods: no "lost / short received" path; mill received count only
  counts.
- `refinish`: only exit is a mill challan or a send-back to butta — there is **no "refinish not needed → final"** (mark
  fresh doesn't move it).
- `ready_dispatch` → `final` ("un-ready") exists only through Move to inventory / Close; not as its own action.
- `rework_butta`: no cancel of a send-back.
- `butta_qc` → `final` / `waiting_mill` and Mill QC results can't be undone.
- Deleted takas can't be restored; Edit takas can't remove takas at or after butta cutting.
- Free in-making takas keep flowing through butta / mill under their **origin** order (and the origin order's steps),
  which can be confusing on the pending lists.

---

## 5. Damage lifecycle (`taka_damages`)

Columns: `status` open / resolved, `pcs`, `resolved_pcs`, `found_at` = **type**, `recorded_at` = **where**,
`resolved_stage` = where it was resolved. `takas.is_damaged` = has an open damage.

**Types** (`found_at`): `machine` (Machine damage), `butta` (Butta cutting damage), `mill` (Mill damage), `weaver`
(Weaver damage / "Weaver / supplier damage" for FG), `unmarked` (Damage type not marked — GR only), legacy `godown`
(Supervisor marked), legacy `customer_return` (Customer return). The popup offers only the types that apply
(`damageTypeOptions`).

**Recorded at** (`recorded_at`): `taka_entry`, `edit_takas`, `butta_qc`, `mill_qc`, `godown`, `goods_return`, `split`,
`inventory`, `outside_receipt` (Receipt from weaver), `fg_receipt` (FG receipt). Resolved at (`resolved_stage`):
`butta_qc`, `mill_qc`, `godown`, `split`, `inventory`.

| From → To | Trigger | Who | Conditions | Evidence |
|---|---|---|---|---|
| (new) → Open | Taka entry (TE-04), Edit takas (ET-01/02), Butta QC (QC-02), Mill QC (QC-03), godown Mark damage (GD-06), split (GD-05), weaver / FG receipt (OUT-06, FG-01/02), GR (DSP-05/06) | each operation's roles | Type required (except GR); pcs ≤ taka pcs | `insertTakaDamages`, `addNewDamages` (`qc-shared.ts`, `taka-ops.ts`) |
| Open → Open, partly resolved (`resolved_pcs` > 0) | QC answer "resolved N pcs" (N < open pcs) | QC | — | `applyResolve` (`shared/src/butta.ts`), `damage_partly_resolved` |
| Open → Resolved | QC resolves all open pcs | QC | — | `damage_resolved`, `resolved_stage` butta_qc / mill_qc |
| Open → Open ("kept") | QC answers "not resolved" | QC | — | `damage_kept` |
| Open → Resolved | Godown Mark resolved (GD-07) | Dhruvil, Jenish, Gaurang | Final taka | `resolved_stage = godown` |
| Open → Resolved | Mark as fresh (FS-04) — all open damages | Jenish, Gaurang | Final / ready / refinish taka | `resolved_stage = inventory` |
| Open → Resolved ("cleared by split") | Split (GD-05) — **all** open damages of the original | Dhruvil, Jenish, Gaurang | — | `resolved_stage = split` |
| Open (original) → Resolved + new Open on a part | Split damage picker "moved" | same | Each damage to one part, pcs ≤ part | `splitTaka` (`shared/src/splitDamage.ts`) |
| Open → changed / removed | Edit takas (ET-01/02) | Jenish, Gaurang | Resolved damages are read-only; damaged pcs can't go below resolved pcs | `editTakas` |

**No way out:** Resolved (no reopen). **Missing:** a damaged taka can go all the way to dispatch with its damage open
(only a notice); no "accept as seconds" / price-reduction outcome; godown resolve only works on `final` takas (not on
ready / refinish); Taka entry can't add photos.

---

## 6. Butta / mill challan (`challans`, `challan_takas`)

Kinds (`CHALLAN_KIND_CONFIG`, `shared/src/challans.ts`): **butta** (prefix GSM, counter `butta_challan_no`) and
**mill** (prefix MIL, counter `mill_challan_no`). Numbers are never reused.

### 6.1 Challan status

| From → To | Trigger | Who | Conditions | Evidence |
|---|---|---|---|---|
| (new) → Active | Create challan (BUT-03 / MIL-03) | Jenish, Gaurang, Godown sup. | Takas sendable; mill: refinish and normal not mixed | `createChallan` |
| Active → Cancelled | Cancel (BUT-10 / MIL-08) | Jenish, Gaurang | No taka received; mill: received count = 0 | `cancelChallan` |

Derived (not stored): **open** = received < takas; **received** = all received. Received = max(mill received count,
takas marked received). "For refinish" = every taka on a mill challan is a refinish trip.

### 6.2 Challan taka row

| From → To | Trigger | Evidence |
|---|---|---|
| (new) active, sent | Create challan | `challan_takas` insert |
| sent → received (`received_at`) | Receive (BUT-07/08), Mill QC on an at-mill taka | `receiveTakas`, `submitMillQc` |
| received → sent | Undo receive | `undoReceive` |
| received → QC done (`qc_done_at`) | Butta QC / Mill QC | `submitQc`, `submitMillQc` |
| active → inactive | Next trip of the same kind (re-butta / refinish), challan cancel | `createChallan`, `cancelChallan` |
| inactive → active | Cancelling a refinish trip re-activates the previous trip | `cancelChallan` |

Mill **received count** (MIL-07): 0 → N, editable between "takas received at QC" and "takas on the challan".

**Missing:** no edit of party / date / e-way; no removing a taka from an active challan; no "short received / lost"
close-out; the count can never be "closed" against the actual takas; no overdue / aging alert.

---

## 7. Delivery challan (`dispatch_challans`)

Label `DC-n` / `DC-n R1` (`dispatchChallanLabel`), counter `dispatch_challan_no`.

| From → To | Trigger | Who | Conditions | Evidence |
|---|---|---|---|---|
| (new) → Active, revision 0 | Dispatch (DSP-01) | Dhruvil, Jenish, Gaurang | ≥ 1 ready taka | `createDispatch` |
| Active (rev k) → Revised | Goods return (DSP-05/06) | same | It is the active revision; something left to return | `createGoodsReturn` |
| (new) → Active (rev k+1, same number, parent = rev k) | Same GR | same | Contains everything not returned (may be empty of pcs) | `createGoodsReturn` |

**No way out:** Revised (history only). **Missing:** cancel a dispatch; edit transport / LR / e-way / date; a GR can't
be undone; no "delivered / acknowledged" state; no link to an invoice.

---

## 8. Outside PO (`outside_pos`)

Config `PO_STATUSES` (`shared/src/outside.ts`): `open`, `partly_received`, `received`, `closed`, `cancelled`; label
`PO-n`, counter `outside_po_no`. Receipts (`outside_receipts.kind`): `outside_po` or `fg`.

| From → To | Trigger | Who | Conditions | Evidence |
|---|---|---|---|---|
| (new) → Open | Create PO (OUT-01) | Jenish, Gaurang | Order sent for production, not closed, not FG | `createOutsidePo` |
| Open → Partly received / Received | Receipt (OUT-06) | Jenish, Gaurang, Godown sup., Dhruvil | received qty (pcs or meters by unit) vs quantity | `poStatusFor` |
| Partly received → Received | Receipt | same | received ≥ quantity | `poStatusFor` |
| Received / Partly → Partly / Open | Edit receipt takas (ET-02) lowers the received qty | Jenish, Gaurang | Not closed / cancelled | `refreshReceiptTotals` |
| Open → Cancelled | Cancel (OUT-03) | Jenish, Gaurang | Nothing received | `cancelOutsidePo` |
| Open / Partly received → Closed | Close (OUT-04) or Close order (HLD-04) | Jenish, Gaurang | — | `closeOutsidePo`, `closeOpenPosOfOrder` |

**No way out:** Received, Closed, Cancelled. **Missing:** reopen a closed PO; edit a PO after the first receipt (rate,
quantity); over-receipt limit; no aging alert on open POs.

---

## 9. Yarn PO (`yarn_pos`)

Config `YARN_PO_STATUSES` (`shared/src/yarn.ts`): `open`, `partly_received`, `received`, `closed`, `cancelled`.
Receipts go into a zone (`YARN_ZONES`): `direct` (Direct consumption), `tfo` (TFO), `warping` (Warping). Every
quantity change is a ledger row (`yarn_stock_moves.kind`): `receipt`, `transfer_in`, `transfer_out`, `withdraw`,
`tfo_issue`, `tfo_output`, `tfo_return`, `warping_issue`; beam history (`beam_moves.kind`): `beam_created`,
`transfer_in`, `transfer_out`, `consumed`.

| From → To | Trigger | Who | Conditions | Evidence |
|---|---|---|---|---|
| (new) → Open | Create (YPO-02) | Jenish, Gaurang | PO no unique | `createYarnPo` |
| Open → Partly received / Received | Receive (YPO-05) | Jenish, Gaurang, Supervisor, Godown sup. | received g vs ordered g | `yarnPoStatusFor` |
| Partly received → Received | Receive | same | — | same |
| Partly received → Closed | Close (YPO-06) | Jenish, Gaurang | Only partly received | `closeYarnPo` |
| Open → Cancelled | Cancel (YPO-07) | Jenish, Gaurang | Nothing received | `cancelYarnPo` |

PO events (`YARN_PO_EVENT_KINDS`): `created`, `edited`, `received`, `closed`, `cancelled`. **No way out:** Received / Closed / Cancelled. **Missing:** an
Open PO with nothing received can't be "closed" (only cancelled); no reverse of a receipt.

---

## 10. TFO program (`tfo_programs`)

Statuses: `running`, `completed`.

| From → To | Trigger | Who | Conditions | Evidence |
|---|---|---|---|---|
| (new) → Running | Assign program (YRN-07) | Jenish, Gaurang, Supervisor, Godown sup. | Section idle, machine active, raw stock enough | `startProgram` |
| Running → Completed | Stop (YRN-08) | same | Twisted kg / returned raw valid | `stopProgram` |

One running program per machine section (unique index). **Missing:** cancel a program started by mistake (it must be
stopped with output); edit a stopped program.

---

## 11. Warping job (`warping_jobs`)

Statuses (`WARPING_STATUSES`): `in_process` (In process), `done` (Done).

| From → To | Trigger | Who | Conditions | Evidence |
|---|---|---|---|---|
| (new) → In process | Start warping (YRN-10) | 4 yarn roles | Inputs within Warping stock | `startWarpingJob` |
| In process → Done | Mark done (YRN-11) | same | 1–50 beams | `finishWarpingJob` |

**Missing:** cancel an in-process job (inputs are already out of stock); edit beams after done.

---

## 12. Beam (`beams`, history `beam_moves`)

Statuses (`BEAM_STATUSES`): `in_stock` (In stock), `consumed` (Consumed); zone `direct` or `warping`.

| From → To | Trigger | Who | Conditions | Evidence |
|---|---|---|---|---|
| (new) → In stock (Direct or Warping) | Warping done (YRN-11) | 4 yarn roles | — | `finishWarpingJob` (`beam_created`) |
| In stock Direct ↔ In stock Warping | Transfer (YRN-04) | same | Beams only between these two | `createTransfer` (`transfer_out/in`) |
| In stock (Direct) → Consumed | Withdraw (YRN-05) | same | Beam in Direct consumption | `createWithdrawal` (`consumed`) |

**No way out:** Consumed. **Missing:** a beam in Warping can't be consumed without a transfer first; consumption isn't
linked to a loom / jobsheet / order; no "beam returned / partly used".

---

## 13. Masters, users, sessions

| Record | States | Transitions | Notes |
|---|---|---|---|
| Customers, materials, designs, damages, butta / mill parties, weavers, yarn parties, yarn qualities | active → soft-deleted | Delete (blocked while used — see each module) | No restore screen |
| Customer brokers | active → soft-deleted | Removed on customer edit | Stay on old orders |
| Machines, TFO machines | active ↔ inactive, → soft-deleted | Edit / delete (blocked while on an active jobsheet / running program) | |
| Users | active ↔ inactive | USR-03 (not yourself; not the last user manager) | No delete |
| Sessions | created → expired / deleted | Login, logout, 30 days, password reset / deactivate / role change | |

---

## 14. History rows (events) — what writes them

Every state change above also writes a history row. These are what the History tab, the taka drawer, the damage
details screen and the jobsheet Activity show.

### 14.1 Taka events (`taka_events.event`, `TAKA_EVENT_KINDS`)

| Event | Written by (operation) |
|---|---|
| `entered` | Taka entry (TE-04); Edit takas add row (ET-01) |
| `sent_butta` / `sent_mill` | Butta / mill challan (BUT-03, MIL-03) |
| `received_butta` / `received_mill` | Receive (BUT-07/08, MIL-09); `received_mill` also when Mill QC opens an at-mill taka (QC-03) |
| `receive_undone` | Undo receive (BUT-09, MIL-09) |
| `challan_cancelled` | Cancel challan (BUT-10, MIL-08) |
| `butta_qc_done` | Butta QC (QC-02) |
| `mill_qc_done` | Mill QC Done (QC-03) |
| `damage_added` | Any new damage (TE-04, ET-01/02, QC-02/03, GD-05/06, OUT-06, FG-01/02, DSP-05/06) |
| `damage_partly_resolved` / `damage_resolved` / `damage_kept` | QC answers (QC-02/03); `damage_resolved` also godown resolve (GD-07), split (GD-05), mark fresh (FS-04), edit takas |
| `edited` | Edit takas (ET-01/02), steps change re-route (ORD-05), split renumber / moved damage (GD-05) |
| `sent_refinish` | Mill QC refinish (QC-03), godown refinish / split part (GD-05, GD-08) |
| `split` | Split (GD-05); pcs move / add split (FS-01/02) |
| `godown_checked` / `godown_unchecked` | Tick (GD-03) |
| `actual_pcs_changed` | Edit pcs (GD-04) |
| `ready_dispatch` | Ready for dispatch (GD-09) |
| `sent_back` | Send back (RW-01/02) |
| `dispatched` | Dispatch (DSP-01) |
| `goods_returned` | Goods return (DSP-05/06) |
| `moved_to_inventory` | Move to inventory (FS-01), Close order (HLD-04), closed order's taka coming back (BUT-07, QC-02, QC-03) |
| `allocated_from_free_stock` | Add from free stock / Assign (FS-02/03) |
| `received_outside` / `received_fg` | Weaver receipt (OUT-06) / FG receipt (FG-01/02) |
| `moved_order` | **Never written any more** (Move to order removed in Sprint 13; kept for old rows) |

### 14.2 Jobsheet events (`jobsheet_events.event`)

| Event | Written by |
|---|---|
| `created` | JS-01, JS-02, JS-03 (auto-adjust extra), HLD-01 (remaining frames), SUP-05 (continuation) |
| `sent` | JS-05; SUP-05 (the continuation is created Sent) |
| `pulled_back` | JS-06 |
| `started` | SUP-03 |
| `completed` | SUP-04, TE-04 ("completed at taka entry"), HLD-01 ("completed on hold"), HLD-04 ("completed — order closed") |
| `machine_changed` | SUP-05 |
| `takas_entered` / `takas_edited` | TE-04 / ET-01 (hidden from roles without `canViewTakas`) |
| `cancelled` | HLD-04 (Pending / Sent jobsheets of a closed order) |

Deleting a Pending jobsheet (JS-04) or removing one by auto-adjust writes **no** event.

### 14.3 Order-level history

| Table / event | Written by |
|---|---|
| `order_status_history` (from → to status) | ORD-02, ORD-06, ORD-07 and every recompute that changes the status |
| `order_events` `steps_changed` | ORD-04 / ORD-05 ("Steps changed: Butta removed") |
| `order_events` `order_closed` | HLD-04 (summary + note) |
| `order_hold_events` `held` / `released` | HLD-01 / HLD-02 ("Put on hold" / "Released from hold") |
| `yarn_po_events` | YPO-02, YPO-03, YPO-05, YPO-06, YPO-07 |
| `goods_returns` (+ takas) | DSP-05 / DSP-06 |
