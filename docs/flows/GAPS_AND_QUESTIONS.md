# Rivoora Textile — Gaps and Questions

Things a client could reasonably expect that the system doesn't do, or does only partly — found while building the flow
inventory from the code (commit `b4fd6be`). Each item says **what the code does today** and the **question to ask**.
IDs (e.g. `HLD-04`) point to `FLOW_INVENTORY.md`.

Severity: **H** = likely to hurt in daily use / data can be lost or wrong · **M** = expected feature missing ·
**L** = polish / consistency.

---

## A. Functional gaps

### A1. Orders and order lifecycle

| # | Sev | Gap | What the code does | Question for the client |
|---|---|---|---|---|
| A1.1 | H | **No cancel / delete of an order** | Only Close (HLD-04). An order made by mistake stays in the list forever (as Pending for production, or Closed) | Do you need "Cancel order" (before any work) and/or delete of a wrong order? |
| A1.2 | H | **Closed order can't be reopened** | `is_closed` is one-way | What if an order is closed by mistake? Who may reopen? |
| A1.3 | H | **Woven but not-yet-entered takas are lost on Close** | Close completes / cancels jobsheets, but taka entry on a closed order is refused (GRD-03). Completed jobsheets with no takas can never get them | Should Close wait for taka entry, warn about "taka entry pending", or allow taka entry on closed orders (straight to free stock)? |
| A1.4 | M | Undo send for production for outside / FG orders | Server allows it (no POs / takas yet), the button shows only for "Jobsheet pending" | Show Undo for "At outside weaver" / "Awaiting goods" too? |
| A1.5 | M | Gaurang's rights are uneven | Gaurang can **Close** and edit orders but can't **Hold**, can't add orders, send for production, or even see "Pending for production" orders | Confirm the intended split between Jenish and Gaurang |
| A1.6 | M | Hold on a closed order; Edit on a closed order | Hold has no closed check; the Edit button still shows on a closed order (save is refused) | Hide these on closed orders |
| A1.7 | M | Changing order quantity after production | Allowed; only coverage warnings change; nothing adjusts jobsheets / POs | Is that enough, or should quantity be locked after jobsheets / dispatch? |
| A1.8 | M | **kg / g / meter orders have no production path** | Jobsheets only for pcs ("coming soon"); move-to-inventory / free stock only for pcs | Are non-pcs orders still needed? If yes, how are they made? |
| A1.9 | L | Orders search can't find an order by **our own taka number** (digits only) | Search matches weaver taka no and letter-prefixed numbers (S1101) but not `6245` | Add our taka number to the Orders search? |
| A1.10 | L | Order number clash on two simultaneous saves | Generic 409, no retry | Low risk with one order creator |
| A1.11 | L | FG order shows "Create a PO" on its Outside production tab | Server refuses POs for FG (409) | Hide the button for FG orders |

### A2. Production (jobsheets, supervisor, taka entry)

| # | Sev | Gap | What the code does | Question |
|---|---|---|---|---|
| A2.1 | H | **Completed frames can't be corrected** | No edit after Complete / Change machine / Hold; Complete even accepts more frames than assigned | Who may correct a wrong "frames completed", and how? |
| A2.2 | M | Taka entry on a jobsheet that was never sent / started | Allowed; the jobsheet becomes Completed without any loom recorded (Machine view never showed it) | Should taka entry be allowed only after Start / Complete? |
| A2.3 | M | **Taka entry can't fix mistakes** | Only Jenish / Gaurang can edit or remove takas (ET-01) | Should the Taka entry person get an "edit last entry" window (e.g. 15 minutes)? |
| A2.4 | M | No "stop / unstart" | Ongoing can't go back to Sent (wrong loom picked → must Change machine) | Needed? |
| A2.5 | M | Close / hold don't tell the supervisor | Jobsheets just disappear from his list; printed jobsheets stay on the floor | Need a visible notice for the supervisor (or a "cancelled" list)? |
| A2.6 | L | Jobsheet delete / auto-adjust removals write no activity row | Soft delete only | Keep a record of deleted jobsheets? |
| A2.7 | L | Taka entry photos | The Taka entry role can't upload damage photos | Should machine damages have photos? |
| A2.8 | L | Voice notes | Mic button is a "coming soon" placeholder (order form, taka entry) | Still wanted? |
| A2.9 | L | Machine view has no history | No loom efficiency, idle time history, frames per day | Do you need loom reports? |

### A3. Butta cutting, mill, QC

| # | Sev | Gap | What the code does | Question |
|---|---|---|---|---|
| A3.1 | H | **Challans can't be corrected** | No edit of party / date / e-way, no removing one taka; only cancel the whole challan, and only while nothing was received / counted | Need "edit challan" or "remove taka from challan"? |
| A3.2 | H | **Lost / short goods at a party** | A taka at butta / mill stays there forever if it never comes back; the mill count only counts | How to record a taka lost or short-received at a party? |
| A3.3 | M | No overdue alerts | Nothing flags a challan open for N days, a PO overdue, a QC backlog | Which delays should be flagged, and to whom? |
| A3.4 | M | **QC "Which one?" picker missing** | If a weaver number matches several takas, QC gets "N takas have number … pick the right one" with no picker; the picker exists only on Butta → Receive; `GET /takas/lookup` is unused | Add the picker to QC (and split / GR search) |
| A3.5 | M | QC has no work list | The pending list was removed in Sprint 14 (endpoints still exist); QC only types numbers | Confirm QC never needs to see what's pending |
| A3.6 | M | No undo of Butta QC / Mill QC | A wrong "Done" or "Refinish" can't be reverted (only owner send-back) | Who fixes a wrong QC result? |
| A3.7 | M | Refinish can't be cancelled | A refinish taka can only go to the mill (or be sent back to butta); "not needed after all → final" is missing | Needed? |
| A3.8 | M | Mill received count vs actual takas | Count is independent of which takas came back; the challan never "closes" against the real takas | Is the count enough, or should the mill receipt list taka numbers again? |
| A3.9 | L | Mill per-taka receive endpoints exist but no screen | `/mill/receive`, `/mill/receive/:id/undo` (API only) | Remove or keep for later |
| A3.10 | L | Free in-making takas in pending lists | Free takas still waiting for butta / mill are listed under their **origin** order (also a closed one); the drawer of a closed order 404s for the Godown supervisor | Should free in-making takas be listed separately ("Free stock")? |

### A4. Godown, dispatch, goods return

| # | Sev | Gap | What the code does | Question |
|---|---|---|---|---|
| A4.1 | H | **Dispatch can't be cancelled or edited** | No cancel; transport / LR / e-way / date can't change; only a GR makes a revision | What if a challan is made by mistake or a vehicle changes? |
| A4.2 | H | **No "un-ready"** | A Ready-for-dispatch taka can't go back to final from the godown screen (only via Move to inventory / send back) | Add "Undo ready for dispatch"? |
| A4.3 | M | Dispatch takes **all** ready takas | No choice of takas on the dispatch dialog; batches are controlled only by Ready for dispatch | OK, or should Dhruvil pick takas on the challan? |
| A4.4 | M | Over-dispatch not blocked | No check of dispatched pcs vs ordered pcs (godown bar only shows "more than ordered") | Should it block or ask for confirmation? |
| A4.5 | M | Damaged takas can be dispatched | Only an amber notice | Should dispatch block open damages, or record "sold as damaged / seconds"? |
| A4.6 | M | GR can't be undone; no GR document print | GR record + revised DC only | Need a printable goods-return note / credit note? |
| A4.7 | M | Godown actions only on final takas | Resolve / damage / edit pcs / split not possible on ready-for-dispatch or refinish takas | OK? |
| A4.8 | L | No delivery confirmation | DC has no "delivered / acknowledged" state | Needed for follow-up? |

### A5. Free stock and inventory

| # | Sev | Gap | What the code does | Question |
|---|---|---|---|---|
| A5.1 | H | **No stock write-off / sale of seconds / stock count** | Free and damaged stock waits forever; "Last stock clearance" is always empty (Sprint 10 flow not built); demo card | How do you clear damaged / old stock? Physical stock count? |
| A5.2 | M | Free stock can't be dispatched directly | Must be assigned to an order of the same design first | Do you sell from stock without an order? |
| A5.3 | M | Dhruvil and the Godown supervisor have no Inventory view | Only owners; Dhruvil sees one design's free stock inside the Add dialog | Should Dhruvil see free / damaged stock? |
| A5.4 | M | Mark as fresh only for owners | Dhruvil can resolve godown damages but not mark free / damaged stock fresh | OK? |
| A5.5 | L | Add from free stock needs the same design | No substitution (e.g. similar design) | OK? |

### A6. Outside production / FG

| # | Sev | Gap | What the code does | Question |
|---|---|---|---|---|
| A6.1 | M | **No cancel / delete of a receipt** | Wrong weaver / FG receipt can only be fixed taka by taka in Edit takas (rows can't be added there) | Need "cancel receipt"? |
| A6.2 | M | PO can't be edited after the first receipt | Only Close; rate / quantity locked | OK? |
| A6.3 | M | No over-receipt limit / warning on outside POs found | Receipts until the PO is fully received | Should over-receipt warn like yarn? |
| A6.4 | M | No receipt print (GRN) | Receipts appear in Docs, not printable | Needed for the weaver / accounts? |
| A6.5 | L | No "Purchase" tab for FG orders | Receipts show in Takas + Docs (spec offered a Purchase tab) | OK? |
| A6.6 | L | Hold dialog doesn't list open POs | Sprint 16 spec asked for it (informational) | Still wanted? |
| A6.7 | L | Payments to weavers / FG suppliers | Rate stored only | Accounts out of scope? |

### A7. Yarn

| # | Sev | Gap | What the code does | Question |
|---|---|---|---|---|
| A7.1 | H | **No undo / correction of any yarn movement** | Receipts, transfers, withdrawals, program stops, warping done are final | How are wrong entries corrected? Adjustment entry? |
| A7.2 | M | No physical stock adjustment | Balance = sum of ledger rows only | Need a periodic stock count with adjustment? |
| A7.3 | M | **Yarn not linked to production** | Beams aren't linked to looms / jobsheets / orders; no yarn consumption per order | Do you need yarn cost per order / beam-to-loom tracking? |
| A7.4 | M | A beam in Warping can't be consumed | Withdraw only from Direct consumption (transfer first) | OK? |
| A7.5 | L | TFO program / warping job can't be cancelled | Must be stopped / done with output | Needed? |
| A7.6 | L | No prints for yarn receipts, warping job cards, beam labels | — | Needed on the floor? |

### A8. Reports, notifications, admin, data correction

| # | Sev | Gap | What the code does | Question |
|---|---|---|---|---|
| A8.1 | H | **No reports and no export** | No Excel / CSV / PDF report anywhere: production per loom / day, pending by party, damage by type / party, dispatch register, stock valuation, yarn consumption | Which reports does the client need first? |
| A8.2 | H | **No notifications** | No push / SMS / WhatsApp / email; alerts only inside an order's dashboard (24 h not started + coverage) | Who should be told about what (hold, close, overdue, damage)? |
| A8.3 | M | No global "needs attention" list | Alerts exist per order only | Need a cross-order alerts screen? |
| A8.4 | M | No invoice / billing / GST, no e-way bill generation | E-way number is a typed field | In scope later? |
| A8.5 | M | Login: no "forgot password"; rate limit per server instance; **Autofill login button on by default** | `VITE_LOGIN_AUTOFILL` must be set to `false` before real use | Confirm before go-live |
| A8.6 | M | Uploaded images are public URLs; abandoned uploads never cleaned | — | OK for privacy? |
| A8.7 | M | No audit screen | History exists per order / jobsheet / taka; no "who did what today" view | Needed? |
| A8.8 | L | Users can't be deleted | Deactivate only | OK |
| A8.9 | L | Data that can't be corrected at all | Order number; jobsheet completed frames; challan header; dispatch header; GR; split (no merge); weaver short code once used; unit once jobsheets exist | Confirm each is acceptable |

---

## B. Docs vs code differences

| # | Where | Docs say | Code does |
|---|---|---|---|
| B1 | `CLAUDE.md`, `PROJECT_STATE.md` | **No Sprint 16 section** (CLAUDE.md mentions it once in passing; PROJECT_STATE.md not at all): order steps, outside production, weavers, FG purchase, Close order, Receive goods, routing rule, statuses At outside weaver / Awaiting goods / In godown / Closed | All of it is built: migration `0015_sprint16_order_steps.sql`, `shared/src/orderSteps.ts`, `outside.ts`, `services/outside.ts`, `close-order.ts`, `order-steps.ts`, `scripts/check-sprint16.mjs` |
| B2 | `PROJECT_STATE.md` header | "latest work is the Sprint 17 section" | Sprint 18 is the latest |
| B3 | `CLAUDE.md` "Not built yet" + "Order dashboard (Sprint 5)" | Butta / mill / ready flows "not connected", `connected: false` | Every stage is connected (`pipeline.ts`); comments in `pipeline.ts` are also stale |
| B4 | `CLAUDE.md` taka numbers | `^\d+([-/]\d+)*$` (digits) | `^[A-Z]{0,4}\d+([-/]\d+)*[A-Z]?$` (weaver prefix + split letter) |
| B5 | `CLAUDE.md` Sprint 7 | `initialTakaStage(design)` decides the first stage | `nextTakaStage(order steps)`; the design only pre-fills Butta. Doc comment of `enterTakas` (`services/takas.ts`) is also stale |
| B6 | `services/godown.ts` `splitTaka` comment | "Existing open damages stay on the original taka" | Split clears every open damage (CLAUDE.md follow-up note is right) |
| B7 | `CLAUDE.md` lookups | `/lookup/damages` = masters, enter / edit takas only | + QC, godown orders, receive outside |
| B8 | `CLAUDE.md` `/takas/next-numbers` | `canEnterTakas` | + `canReceiveOutside` |
| B9 | `CLAUDE.md` Sprint 9 + `App.tsx` comment | Godown Orders for the godown supervisor | Dhruvil (+ Jenish / Gaurang) since Sprint 12 |
| B10 | `CLAUDE.md` undo rule | Undo only while Jobsheet pending with 0 jobsheets | Server also allows At outside weaver / Awaiting goods (no POs, no takas); UI still only Jobsheet pending |
| B11 | `PROJECT_STATE.md` §8.2 | "No edit or delete of orders" | Edit exists (Sprint 6+); delete still doesn't |
| B12 | `PROJECT_STATE.md` §8.2 / CLAUDE "Roles (no login yet)" | X-Role header, no login | Real login + sessions (Sprint 12); X-Act-As only for switchers |
| B13 | Sprint 16 spec §5.3 | "Which one?" picker wherever a taka is looked up | Only Butta → Receive; `GET /takas/lookup` has no client caller |
| B14 | Sprint 16 spec §10 | Client uses `PUT /orders/:id/steps` | Client sends steps inside `PUT /orders/:id`; `/steps` is API only |
| B15 | Sprint 16 spec §6 / §9 | FG "Purchase" tab; hold dialog lists open POs | Not built |
| B16 | `shared/src/types.ts` | Taka event `moved_order` | Never written any more (Move to order was removed in Sprint 13) |
| B17 | `CLAUDE.md` Supervisor | "orders routers return 403 for him" | Since Sprint 11 he reads Orders through `canViewProductionOrders` |
| B18 | `CLAUDE.md` Sprint 11 | Mill QC pending list / QC pending list merged | List removed from the client in Sprint 14; endpoints remain |

## C. Sprint features not built / incomplete (by the sprint docs)

| Sprint | Not built / open |
|---|---|
| 2 | Jobsheets for kg / g / meter orders ("coming soon") |
| 4 / 6 | Voice notes (placeholder mic); real-phone check of the taka keypad |
| 10 | Stock clearance flow (`lastClearedAt` always null, demo card) |
| 12 | 360 / 768 / 1280 px screenshot pass of login, Users, send-back, dispatch, GR…; login rate limit not shared across serverless instances |
| 13 | Partial pcs move leaves open damages on the kept taka; dialogs API-tested but not clicked through |
| 15 | Real-phone check (keyboard bars, share sheet) |
| 16 | No project documentation; QC / split / GR "Which one?" picker; Purchase tab; hold dialog PO list; Undo button for outside / FG |
| 17 | Real tablet / phone check; one-field-per-row tablet layouts listed in `PROJECT_STATE.md` not fixed |
| 18 | Screenshot pass and real-device check of Upload many, drawer groups, Sections fields |
| All | Docs say migrations 0010–0017 still have to be applied on Turso (not verifiable from the code) |

---

## D. Top 10 for the client meeting

1. **No reports / exports** (A8.1) — which ones first?
2. **No notifications** and no cross-order alert list (A8.2, A8.3).
3. **Dispatch can't be cancelled / edited; no un-ready** (A4.1, A4.2).
4. **Close order loses takas not yet entered; no reopen; no cancel order** (A1.3, A1.2, A1.1).
5. **Challans can't be corrected; lost / short goods at a party can't be recorded** (A3.1, A3.2).
6. **Stock write-off / seconds / physical count missing** (A5.1, A7.2).
7. **Corrections**: completed frames, QC results, yarn movements, receipts can't be undone (A2.1, A3.6, A7.1, A6.1).
8. **Damaged goods can be dispatched with only a notice; over-dispatch not checked** (A4.5, A4.4).
9. **Roles**: Gaurang can close but not hold; Taka entry can't fix mistakes; Dhruvil has no inventory view (A1.5, A2.3, A5.3).
10. **Yarn not linked to orders / looms** (A7.3) and non-pcs orders have no path (A1.8).
