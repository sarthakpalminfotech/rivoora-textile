# Rivoora Textile — Sprint 18: Design master by quality (no variations) + multi-upload, sections per beam, outside order, Dhruvil design library, GR check

This continues the existing project. Read `CLAUDE.md` and `PROJECT_STATE.md` first (all sprints so far, incl. Sprint 16 order steps and Sprint 17 yarn, if they're in the code). The app is **live with real data**.

**Safety rules (they come first)**
- Migrations are **additive** (new tables/columns). The **one data change** in this sprint (§1.3, variations → designs) must be:
  - written as a careful, **transactional** migration with **before/after count checks** that aborts and changes nothing if anything doesn't match
  - kept traceable with a mapping table
  - tested on a **local copy of real-shaped data** first

  Tell me **exactly** what it will change on Turso before I run `npm run db:migrate`, and remind me to **export a Turso backup first**.
- Never run wipe / seed scripts against Turso.
- One commit per item. After each one, run `npm run typecheck`, `npm test`, the existing check scripts, and a role-by-role regression of the flows that use designs: Add order, saved designs drawer, jobsheet print, supervisor / taka entry / QC cards, challans, dispatch challan, inventory, dashboards.
- Keep the current look (Sprint 8 §11 rules) and **design the tablet layouts properly** (Sprint 17 §9: 2–3 column forms, table rows on tablets, screenshots at 360 / 768 / 1024 / 1280px).

**How to work**
0. Run `git status`. If there are uncommitted changes, stop and tell me so I can commit them first.
1. Start in **plan mode**: the design data change (§1), every screen / query that reads `variation_id` or `designs.material_id`, and the sections-per-beam change (§3). Wait for my OK.
2. At the end, update `CLAUDE.md` and `PROJECT_STATE.md`.

---

## 1. Design master: no variations, designs grouped by quality

### 1.1 New model
- **Every design is standalone**, with its **own unique code** and image. **Variations go away** (no "Add variation", no variation codes, no "Variation of …").
- A design can belong to **one or more qualities** (materials). New table `design_qualities` (`design_id`, `material_id`, a unique pair).
- **New designs need at least one quality** (inline validation). Existing designs without one appear in a **"No quality"** group until edited.
- `designs.material_id` (the old single default material) is **replaced** by `design_qualities`. The backfill copies it (§1.3). Leave the column in the DB, unused, marked deprecated.
- Keep the other design fields as they are (name, notes, image, "Goes for butta cutting" (used to pre-fill the order's Butta step), soft delete, code uniqueness incl. the live check).

### 1.2 Design master screens (`/designs`)
- **First level: qualities.** A card grid with one card per quality, showing:
  - the quality name
  - the **number of designs**
  - a small strip of 3–4 design thumbnails

  Plus a **"No quality"** card when it's > 0. Search by quality name or **design code** (searching a code jumps straight to matching designs).
- **Second level** (`/designs?quality=<id>` or `/designs/quality/:id`): all designs of that quality as the existing thumbnail grid (code, name, a small "+2 qualities" hint when a design is in several). A design that has several qualities **appears under each of them**.
- **Design detail / form:**
  - image
  - **Code*** (unique)
  - name
  - **Qualities*** (a `MultiSelect` from the Material master, with quick-add if it exists)
  - "Goes for butta cutting"
  - notes

  Remove everything about variations.
- **Permissions:**
  - Jenish / Gaurang manage, as today
  - **Dhruvil can view the design library read-only** (§4)

### 1.3 Data change: existing variations become designs (one careful migration)
For **each existing variation**:
1. Create a **new design**:
   - code = the variation's code (already unique in the shared namespace)
   - image / thumb = the variation's
   - name = the parent design's name (or empty)
   - notes copied from the parent
   - "goes for butta cutting" = the parent's
   - **qualities = the parent design's quality** (its `material_id` → `design_qualities`)
2. Record it in a mapping table `design_variation_map` (`variation_id`, `new_design_id`).
3. **Update orders** that point to this variation: `design_id = new_design_id`, `variation_id = NULL`. Every other table that stores `variation_id` (check and list them in the plan) is updated the same way, or keeps working through the map.

For **every existing design** with `material_id`: insert it into `design_qualities`.

**Checks inside the migration:**
- the number of new designs = the number of variations
- orders pointing to a variation before = orders pointing to the mapped designs after
- no duplicate design codes

Abort on any mismatch. Codes printed on old challans / jobsheets don't change (same codes). Afterwards the `design_variations` table stays in the DB, **unused** (don't drop it), and no code reads it.

Then remove variation handling from the whole codebase (DTOs, `designCode` / `designThumbUrl` "variation else design" logic, the saved designs drawer, prints, inventory keys `v-<id>` → designs only, search). Inventory item keys for old `v-` links can redirect via the map.

### 1.4 Multi-upload
On `/designs`, add a **Upload many** button (Jenish / Gaurang):
1. **Pick multiple images** (file picker, `multiple`; drag-drop on desktop). They upload in the background with progress, using the existing client shrink + upload API.
2. A **review page**: a grid (tablet 3–4 per row, desktop 5–6, phone 1–2) of small thumbnails. Each has:
   - **Design code*** (live uniqueness check, also against the other rows on the page)
   - **Qualities*** (`MultiSelect`)
   - optional name
   - a remove ✕

   An **"Apply quality to all"** helper at the top fills the qualities for every row (each row can still be changed).
3. **Add all** is enabled when every row is valid. It saves all of them in **one request / one transaction** (all or nothing, field errors mapped back to rows). Then it goes to the quality view.
4. Failed uploads show a retry on that tile.

---

## 2. Add order: saved designs by quality

In the **Saved designs drawer** (Add / Edit order):
- **Design library:** shown **grouped by quality**. If the order's **quality is already selected**, that quality's group comes **first**, then all other qualities (and "No quality" last). Search by code or name across all.
- **Picking a design first:**
  - design has **exactly one** quality → the order's quality is auto-filled (still changeable)
  - design has **several** → ask the user to choose one (a small chooser listing only that design's qualities)
- **Previous orders** tab: unchanged (shows designs, no variations).
- Remove the "base design / variations" step from the drawer.

---

## 3. Sections per beam: editable (instead of always 3)

Today every calculation uses `SECTIONS_PER_BEAM = 3`. Make it **editable per jobsheet run**:
- **Create jobsheets** and **Add single jobsheet:** a **Sections per beam*** field (integer 1–12, **default 3**). The live preview uses it ("304 pcs ÷ 4 sections = 76 frames …"), and so do the jobsheet count / frames split, the pieces and the warnings.
- New column `jobsheets.sections` (integer, NOT NULL, **default 3**; existing rows = 3).
  - Every jobsheet stores the value it was made with.
  - **Split / change machine / hold remaining** jobsheets copy their parent's value.
  - **Edit jobsheet** shows it, editable while Pending.
- **Replace every use** of `SECTIONS_PER_BEAM` in the maths with the jobsheet's own `sections`. Keep the constant only as the default. In particular:
  - `orderJobsheetPlan` / live jobsheet numbers: jobsheet pcs = Σ effective frames × **that jobsheet's** sections. **Frames needed** uses the sections of the latest run (or the default 3 when there are no jobsheets), and is labelled so it's clear.
  - `planJobsheets`, `planFramesEdit`, coverage, previews and warnings
  - the **Taka entry pcs warning** (frames × that jobsheet's sections)
  - the dashboard bar / inventory "pcs not yet takas"
  - the jobsheet print (show "Sections: 4" small, if useful)
- **Tests:** mixed jobsheets with 3 and 4 sections in one order; edit with auto-adjust; taka entry warning; dashboard bar.

---

## 4. Dhruvil: view-only Design library

Give Dhruvil read access to the **Design library** (the quality groups → designs → design detail, incl. images / lightbox).
- **No** add / edit / delete / upload buttons, and the server rejects writes (403).
- Add a **Design library** nav item for him (follow the bottom-bar / More rules).

---

## 5. Add / Edit order: **Outside order** checkbox

A simple checkbox **"Outside order (making for another party)"**.
- When ticked, a required **Party name** text field appears (typed; no master).
- Store `orders.is_outside_order` (boolean, default false) and `orders.outside_party_name` (text).
- Show a small tag **"Outside order · <party>"** on the order card, header and Order details (for roles that can see the client).
- Add it to the orders list filters (Outside order: yes / no) and search (party name).
- Label it clearly so it isn't confused with Sprint 16's **"Outside production"** (POs to outside weavers): different words and a different tag colour.

---

## 6. GR (goods return): verify it works end to end (no feature change)

Don't change the GR feature. **Test it thoroughly and fix anything broken:**
- **Lump:** dispatch → GR ticking 3 returned takas, 1 marked damaged with a type and name → challan becomes `DC-n R1` without those takas → the 3 takas are in **free stock** (2 fresh "Ready for order", 1 in Inventory → Damaged) → **Add from free stock** to another order of the same design works → the order shows **Returned**.
- **Pcs to pcs:** returned pcs + damaged pcs → the **return lot** is in free stock with the right fresh / damaged pcs → usable in another order.
- Prints, the Docs tab, Dispatched module, inventory KPIs and history all reflect it.
- **After the §1 design migration,** returned takas still map to the right design in inventory.

Write the results (pass/fail + fixes) in the final summary.

---

## Data summary (additive + one checked data change)
- `design_qualities` (new)
- `design_variation_map` (new)
- the variations → designs migration (§1.3)
- `jobsheets.sections` (default 3)
- `orders.is_outside_order`, `orders.outside_party_name`
- no columns dropped (`designs.material_id` and `design_variations` stay, unused)

## Build phases
1. Shared + migration (design_qualities, the variation map + data change with checks, `jobsheets.sections`, the outside-order columns). Test on a local copy; summarise the Turso changes for me.
2. Design master by quality (screens, form, permissions) + remove variation handling everywhere.
3. Multi-upload.
4. Saved designs drawer by quality + quality auto-fill / chooser.
5. Sections per beam everywhere (+ tests).
6. Outside order checkbox + tags + filter.
7. Dhruvil design library (view only).
8. GR end-to-end verification (+ fixes).
9. Polish: screenshots at 360 / 768 / 1024 / 1280px, a full role regression, update `CLAUDE.md` + `PROJECT_STATE.md`.
