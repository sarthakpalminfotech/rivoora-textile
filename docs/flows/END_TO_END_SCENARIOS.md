# Rivoora Textile — End-to-end Scenarios

Step-by-step stories across roles, as the code behaves at commit `b4fd6be`. Each step: **who · screen · action → what
happens → what the next person sees**. Operation IDs point to `FLOW_INVENTORY.md`, stages / statuses to
`STATE_MACHINES.md`. Numbers (order #26, jobsheet 319, taka 6245…) are examples.

---

## 1. Normal in-house **lump** order (Production + Butta + Mill)

| # | Who | Screen | Action | Result | Next person sees |
|---|---|---|---|---|---|
| 1 | Jenish | Orders → Add order | Client, broker, quality, design (Saved designs drawer), 300 pcs, **Lump**, blouse, steps P·B·M (Butta pre-filled from the design), rate, date | Order **#26**, status *Pending for production* (ORD-02) | Only Jenish sees it |
| 2 | Jenish | Orders list → select → Send for production | — | *Jobsheet pending* (ORD-06) | Gaurang now sees #26 (opens on its Jobsheets tab) |
| 3 | Jenish / Gaurang | #26 → Jobsheets → Create jobsheets | 300 pcs, 3 sections per beam → 100 frames, 25 frames per jobsheet, looms 7 + 9 | Jobsheets **319–322** *Pending*; order *Jobsheet created* (JS-01). Coverage OK (no warning) | — |
| 4 | Jenish / Gaurang | Jobsheets → Print all | — | 4 A4 pages with QR "Scan · 26 (319)" (JS-07) | Paper goes to the loom floor |
| 5 | Jenish / Gaurang | Jobsheets → ⬆ Send (all Pending pre-selected) | Send | 319–322 *Sent* (JS-05) | Supervisor: 4 cards in **Pending** |
| 6 | Supervisor | Jobsheets → card 319 → Start | Pick loom 7 → **Start & print** | 319 *Ongoing* on loom 7; print preview opens (SUP-03); order *In production* | Machine view: loom 7 running; Dashboard "On loom 1" |
| 7 | Supervisor | Card 319 → Complete | Frames completed 25 | 319 *Completed* (SUP-04) | Taka entry: 319 in **Taka pending**; Dashboard "Taka entry pending" |
| 8 | Taka entry | Scan jobsheet | Scans the QR (or types 319) | Opens the entry screen (TE-01) | — |
| 9 | Taka entry | Entry screen | 3 rows: pcs 25 / 25 / 25, meters; row 2 Damage → *Machine damage · Hole · 2 pcs*; Submit → confirm | Takas **6245–6247** (system numbers), stage *waiting for butta*; amber note if pcs ≠ 25 × 3 (TE-04) | Butta cutting → Pending: #26 "3 / 3 ready" |
| 10 | (repeat 6–9 for 320–322) | | | When every jobsheet has takas → order *Taka entry done* | |
| 11 | Godown supervisor | Butta cutting → Send → Pending → #26 | Drawer (ready takas pre-selected) → Send → party, date, e-way | Challan **GSM-173**; takas *At butta cutting*; order *In butta cutting* (BUT-03) | Print GSM-173 (PRN-02); "In butta cutting" list |
| 12 | Godown supervisor | Butta cutting → Receive → Taka number | Types 6245, 6246… (or ticks them on the challan) | Takas *Butta QC pending* (BUT-07/08) | QC can open them |
| 13 | QC | QC → number 6246 | Butta QC: answers the old Hole damage "Resolved 2 pcs"; adds *Butta cutting damage · Cut · 1 pcs* + photo; Save | Hole resolved; new open damage; taka *waiting for mill* (QC-02); when all are done order *Ready for mill* | Mill → Pending: #26 |
| 14 | Godown supervisor | Mill → Send → Pending → #26 | Send → mill party | **MIL-12**; takas *At mill*; order *In mill* (MIL-03) | Print MIL-12 |
| 15 | Godown supervisor | Mill → Receive → Challans → MIL-12 | Enters received count 12 (MIL-07) | Count stored; stages unchanged | QC can check those takas |
| 16 | QC | QC → 6246 | Mill QC (it's still *At mill* → marked received now with a note); resolves the Cut; **Done** | 6246 *final* (QC-03); when all done order *Mill QC done* | Dhruvil: #26 in his Orders |
| 17 | Dhruvil | Orders → #26 → Final takas | Ticks each counted taka; ⋯ Edit pcs on 6247 (24 instead of 25) | Ticked; actual pcs 24 (GD-03/04) | Checked-pcs bar |
| 18 | Dhruvil | #26 | Select ticked takas → Ready for dispatch | *Ready for dispatch* (GD-09); order *Ready for dispatch* when all are | Dispatch button |
| 19 | Dhruvil | #26 → Dispatch | Date, transport, LR, e-way (amber notice if any ready taka still has a damage) | **DC-12** with every ready taka; takas *Dispatched*; order *Dispatched* (DSP-01) | Print DC-12 (lump: taka grid); Dispatched module; Docs tab |

---

## 2. The same for a **pcs-to-pcs** order (differences only)

- Step 1: order type **Pcs to pcs**.
- Taka entry, butta, QC, mill are identical (takas still have numbers inside the system).
- Step 19: the delivery challan prints **lines** (Sr · Quality · Design · Pcs) and **no taka numbers** (DSP-02).
- Move to inventory / Add from free stock ask for a **number of pcs**, not ticked takas (scenario 9).
- Goods return asks for **returned pcs** and creates one return lot (scenario 8).
- FG receipts (scenario 11) ask only for received pcs and create one "Received lot".

---

## 3. Orders with other step combinations

| Steps | What changes vs scenario 1 | Evidence |
|---|---|---|
| **P + M** (design doesn't go for butta, or Butta unticked) | Taka entry puts takas straight into *waiting for mill*; they never appear in Butta cutting; status goes Production completed → *Ready for mill*; History overview leaves out the butta steps | `nextTakaStage`, `orderMilestones` |
| **P + B** | After Butta QC takas go to **final** (Dhruvil); no Mill step; when all are with Dhruvil the order is *In godown* (not "Mill QC done") | `statusForTakaStages` (`hasMill = false`) |
| **P only** | Taka entry → **final** directly; order *Taka entry done* → *In godown* → Ready / Dispatched | |
| **B + M without P** (outside production) | No Jobsheets tab; after Send for production the order is *At outside weaver*; Jenish creates **PO-3** to a weaver (OUT-01); weaver challan received (OUT-06) → takas *waiting for butta*; then as scenario 1 from step 11 | scenario 11 |
| **M only / B only without P** | Received takas go to *waiting for mill* / *waiting for butta*; after the last ticked step → final | |
| **Nothing ticked** (FG purchase) | *Awaiting goods* → receive FG challan (FG-01/02) → takas **final** → Dhruvil | scenario 11 |
| **Changing steps later** | Jenish / Gaurang untick Butta: takas still *waiting for butta* move to *waiting for mill* (or final) and History says "Steps changed: Butta removed". Unticking is refused once a taka has been to butta cutting (Production: once a jobsheet exists) | ORD-05 |

---

## 4. Change machine; edit with auto-adjust; delete jobsheets

**4a. Change machine mid-jobsheet**
1. Supervisor: 320 is *Ongoing* on loom 9 (25 frames). Card → **Change machine** → frames completed 10 → "Frames to
   make next" pre-fills 15 → Save (SUP-05).
2. 320 → *Completed* with 10 frames (activity "machine changed · continued as 323"); new jobsheet **323** *Sent*, 15
   frames, same sections, all active looms ("Continued from #26 (320)").
3. Supervisor sees 323 in Pending → Start on loom 4. Taka entry: 320 now in Taka pending (10 frames × 3 = 30 pcs
   expected).

**4b. Edit a jobsheet with auto-adjust**
1. Gaurang: 322 (*Pending*) → Edit → frames 25 → 30, add loom 11 (JS-03).
2. The **last Pending jobsheet** absorbs the change (e.g. 321 drops from 25 to 20); if the last one would go to 0 it is
   removed; if frames are added beyond, new Pending jobsheets are created with the last one's looms + sections.
3. Result screen lists updated / created / removed + coverage warnings (ALR-02). A *Sent* jobsheet must be **pulled
   back** first (JS-06); a started one can't be edited ("already in production").

**4c. Delete jobsheets**
1. Gaurang deletes Pending 321 (JS-04) → soft delete; number 321 never reused; coverage now "frames short".
2. Deleting the last jobsheet → order back to *Jobsheet pending*; then Jenish could Undo send for production (ORD-07).

---

## 5. Damage at every stage

| Stage | Who / screen | How | Type offered | Resolve |
|---|---|---|---|---|
| Taka entry | Taka entry → row Damage | Popup: type (radio, nothing pre-selected unless one applies), name (master or Other), pcs | Machine (+ Butta / Mill if the order has them) | later QC / godown / mark fresh |
| Edit takas | Jenish / Gaurang → Edit takas | Change / remove / add open damages; resolved are read-only | same | — |
| Butta QC | QC | Every open damage must be answered: **resolve all**, **resolve some pcs** (stays open, "(2 resolved)"), **not resolved**; new butta damages + photos | Machine / Butta / Mill as applicable | partial → open; all → resolved at butta QC |
| Mill QC | QC | Same; Send to refinish needs no answers | | resolved at mill QC |
| Godown | Dhruvil → ⋯ Mark damage / Mark resolved; Damage tab | One damage at a time; resolve one or all (final takas only) | | resolved at the godown |
| Weaver / FG receipt | Receipt form rows | Damage with **Weaver damage** ("Weaver / supplier damage" for FG) | Weaver (+ Butta / Mill if applicable) | |
| Goods return | Dhruvil → GR | Type optional → "Damage type not marked" | | |
| Inventory | Jenish → Inventory → Damaged → Mark as fresh | Resolves **every** open damage | — | resolved in inventory |

**Photos + share:** QC (and GR / receipt / godown roles) upload photos (≤ 10 per damage). Jenish opens the taka drawer
→ damage details → photo → **Share**: phone share sheet with the image, else WhatsApp text + download (TKD-03).

**Damage moved by split:** see scenario 7.

**Dispatch with an open damage:** allowed; the Dispatch dialog only shows an amber "N takas (X pcs) still have damage".

---

## 6. Rework and refinish

**6a. Owner sends back to butta cutting**
1. Jenish: #26 → Takas → **Select** → ticks 6250 (final) and 6251 (ready for dispatch) → **Send back to butta cutting**
   + note (RW-01).
2. Both → *Sent back to butta cutting*, Re-butta count 1, godown tick cleared. Order "Moved back to In butta cutting".
3. Godown supervisor: Butta → Pending → #26 shows them tagged **Re-butta** → new challan GSM-180 (old challan rows
   closed) → receive → QC.
4. QC Butta QC: the taka **has been dyed** → goes back to **final** (not to the mill again).

**6b. Owner sends back to the mill**
1. Jenish: Select → **Send back to mill** (RW-02) → stage *Refinish*, refinish count 1, "Sent back by owner".
2. Godown supervisor: Mill → Send → **Refinish** sub-tab → its own challan (refinish and normal takas can't be mixed;
   print says FOR REFINISH) → mill → count → Mill QC → final.

**6c. Refinish from Mill QC** — QC chooses **Send to refinish** with a note → *Refinish* → same as 6b step 2.

**6d. Refinish from the godown** — Dhruvil: final taka ⋯ → **Send to refinish** (GD-08) → same as 6b step 2. A split
part can also be sent to refinish while splitting.

Rework is allowed even when the order doesn't have that step (e.g. an order without Butta). There is no undo of a
send-back.

---

## 7. Split with the damage picker

1. Dhruvil: #26 → Final takas → taka **1101** (actual pcs 25, open damage *Hole 3 pcs*) → ⋯ **Split** (GD-05). Amber
   note: "This taka is marked damaged — only the damages you give to a part stay open".
2. Parts: Part 1 keeps **1101** with 15 pcs; Part 2 gets **1101A** with 10 pcs (next free letter; numbers are never
   typed). Parts must add up to 25.
3. Part 2 → "Which damage is this?" picker → picks *Hole* (moved, 3 pcs ≤ 10) — the damage moves with its type, name,
   date, place and photos; each earlier damage can be moved to one part only. Part 1 gets nothing (it becomes fresh).
4. Optionally tick "refinish" on a part → it goes to *Refinish* instead of final.
5. Save: original's open damages are closed as "cleared by split"; 1101A is a new final taka (parent 1101, meters by
   pcs); outside takas keep the weaver number + letter (weaver 1101 → 1101A).

---

## 8. Ready for dispatch in batches; dispatch in lots; goods return

1. Dhruvil ticks 20 of 40 final takas → **Ready for dispatch** (batch 1).
2. **Dispatch** → **DC-12** takes *all* ready takas (the 20). Order *Partly dispatched*.
3. Later: tick + Ready the other 20 → Dispatch → **DC-13**. Order *Dispatched*.
4. **GR lump**: client returns 3 takas of DC-12, one with damage. Dhruvil: Dispatched → #26 → DC-12 → **GR** → tick 3,
   add damage (type optional) → Save (DSP-05).
   - The 3 takas → *final*, **free stock** (reason Returned), damaged one has an open damage.
   - **DC-12 R1** is created with the remaining 17; DC-12 becomes **Revised** (REVISED watermark when printed).
   - Order → *Returned* (everything left is dispatched and there was a GR).
5. **GR pcs to pcs** (other order #30, DC-20, 60 pcs): returned 15, damaged 4 + damage name → one **return lot** taka
   (our next number, 15 pcs, free stock, final); dispatched takas shrink by 15 pcs; **DC-20 R1** = 45 pcs (DSP-06).
6. **Returned stock used in another order**: Jenish → Inventory → design → Free stock → tick the 2 fresh returned takas →
   **Assign to order** #31 (same design; FS-03), or Dhruvil on #31 → Add from free stock (FS-02). The damaged one waits
   in Inventory → Damaged until Mark as fresh (FS-04).

Notes: there's no way to pick only some ready takas for a challan, to cancel a dispatch, or to undo a GR.

---

## 9. Move to inventory, add from free stock, mark as fresh

1. **Lump**: Jenish (or Dhruvil on the godown screen) → #26 → Takas → Select → ticks 4 final takas → **Move to inventory**
   + note (FS-01). They become free stock (stage kept; ready ones back to final). #26's figures drop; Inventory shows
   "Free 4". In-making takas (e.g. waiting for mill) can be moved too and keep flowing through the mill as free stock.
2. **Pcs to pcs**: Move **50 pcs** → system takes final first, then ready, largest first; if one taka is needed only
   partly it is split (e.g. 7001 → keeps 20, 7001A 15 pcs goes to free stock).
3. **Add from free stock**: on order #40 (same design, not pending / dispatched / returned / closed) → Add from free
   stock → lump: tick free takas; pcs: enter pcs (+ blouse filter; amber note if blouse differs) → allocated to #40,
   shown in #40's Takas tab as "from Order #26" (FS-02).
4. **Mark as fresh**: Inventory → Damaged → design → taka with open damage → **Mark as fresh** → every open damage
   resolved ("Marked fresh in inventory") (FS-04).

---

## 10. Hold an order with jobsheets on the loom; release; close mid-way

**10a. Hold**
1. Jenish: #26 header → **Hold** → dialog lists 321 (on loom, 25 frames) → frames completed 12 → note → Confirm (HLD-01).
2. 321 → *Completed* (12 frames, "completed on hold"); new **Pending** jobsheet 330 for the 13 remaining (same looms,
   sections); order flagged **On hold** (status unchanged).
3. Supervisor, Taka entry, QC, Godown supervisor, Dhruvil: #26 disappears from their lists; opening a 26-jobsheet or
   taka shows "Order #26 is on hold" (EN + HI for Taka entry / QC). Every write on #26 is refused — even for Jenish —
   except receiving (butta / mill receive, mill count, undo receive, outside / FG receipts).
4. Gaurang still sees #26 with an On hold badge.

**10b. Release** — Jenish → **Release** (HLD-02) → visible again, status recomputed; 330 can be sent to the supervisor.

**10c. Close mid-way**
1. Jenish or Gaurang → **Close order** → preview: 1 jobsheet on the loom, 2 Pending/Sent to cancel, 1 open PO, 18 takas
   (430 pcs) to free stock, 5 takas out at the mill, 10 dispatched (HLD-03).
2. Enter frames for the loom jobsheet + note → Confirm (HLD-04): loom jobsheet completed (no remaining jobsheet),
   Pending/Sent cancelled, PO closed, the 18 takas → free stock ("Order closed"), order **Closed**.
3. The 5 takas at the mill can still be counted and QC'd; at Mill QC they become free stock instead of returning to #26.
4. #26 vanishes from every work list except Jenish / Gaurang's Orders (Closed badge) and Dispatched (its 10 dispatched
   takas stay visible). No reopen.
5. Caution: completed jobsheets that had **no takas entered yet** can no longer get takas (taka entry is blocked on a
   closed order).

---

## 11. Outside production / FG purchase

**11a. Outside production (no Production step)**
1. Jenish: Add order #50 with steps **B + M** (Production off) → helper text "You'll create POs to outside weavers" →
   Send for production → *At outside weaver*.
2. #50 → **Outside production** tab → **Create a PO**: weaver *Shree Textiles* (code S), quality, 300 pcs, Lump, rate,
   date → **PO-3** *Open* (OUT-01) → Print PO (PRN-05) for the weaver.
3. Godown supervisor / Dhruvil: **Receive goods** → PO-3 → **Receive challan** (OUT-06): weaver challan 445, date; rows
   weaver taka 1101 / 1102 … with pcs, meters, damage (*Weaver damage*). Optionally **Add our taka numbers** (pre-filled
   from our counter). Without our number the system number is **S1101**.
4. PO-3 → *Partly received* (120 of 300 pcs); takas → *waiting for butta* (Butta ticked); order status by takas
   (*Taka entry done* → *In butta cutting*…). Takas tab groups them "Challan 445 · PO-3".
5. Butta / mill / QC / Dhruvil as scenario 1. Challans print **1101** (the weaver's number), screens show S1101 + "W 1101".
   Typing 1101 at Butta receive matches the weaver number; if several takas match a "Which taka?" picker appears.
6. When the weaver can't send the rest: Jenish → PO-3 ⋯ → **Close** (OUT-04).

**11b. Part of an in-house order given outside** — on in-house #26, Outside production tab → PO-5, 60 pcs → Jobsheets
tab shows "60 pcs given outside (PO-5)" and frames needed drop by 20 (JS-09); Dashboard shows a "Given outside" sub-stage.

**11c. Direct FG purchase**
1. Jenish: order #60 with **no steps** → Send → *Awaiting goods*. Dhruvil / Godown supervisor see it under Receive
   goods → "Awaiting goods".
2. **Lump**: Receive FG → supplier name *Shree Traders*, supplier challan 88, rows (supplier taka no → **FG1101** unless
   our number typed) → takas **final** (FG-01).
   **Pcs to pcs**: received 200 pcs, damaged 5 + damage → one **Received lot** taka (FG-02).
3. Dhruvil: #60 in his Orders → tick → ready → dispatch (scenario 1 steps 17–19). Or skip buying: **Add from free stock**
   (FG-03).

---

## 12. Yarn: PO → partial receipts into zones → TFO → warping → beams → consumption

1. Jenish: Yarn PO → **New**: PO no 1045 (typed, unique), party, lines 75D raw 500 kg @ ₹210, 120D raw 300 kg (YPO-02).
2. Godown supervisor: PO 1045 → **Receive** → challan 77, zone **TFO**, 75D 200 kg → ledger +200 kg raw 75D in TFO; PO
   *Partly received*. Second receipt: zone **Warping**, 120D 300 kg (YPO-05; amber "More than pending" if over, still allowed).
3. Supervisor: Yarn inventory → TFO board → machine 2 section A → **Assign program**: 75D raw 150 kg, output quality
   75D twisted, TPM → *Running*; TFO raw 75D drops to 50 kg (YRN-07).
4. Later **Stop**: twisted 145 kg (+ 3 kg raw returned) → TFO twisted 75D +145 kg (YRN-08).
5. Transfer 145 kg twisted 75D TFO → Warping (YRN-04).
6. Warping → **Start warping**: inputs 120D raw 250 kg + 75D twisted 140 kg → **WJ-7** *In process* (YRN-10).
7. **Mark done** → 4 beams **BM-21…24** (quality, taar, panna, meters) kept in **Direct consumption** (YRN-11).
8. Loom floor uses a beam: Direct consumption → **Withdraw** → beams BM-21, BM-22 → *Consumed* (YRN-05).
9. Jenish: PO 1045 has 200 kg of 75D still pending and the party won't send it → **Close** (YPO-06).

Not linked: none of these steps refer to an order, jobsheet or loom (by design in Sprint 17).
