# Rivoora Textile — Sprint 2: Machine Master + Jobsheets

This continues the existing project. Read `CLAUDE.md` and `PROJECT_STATE.md` first. The app already has orders, masters, roles (`jemish` / `gaurang` via `X-Role`), the status config, the design system and the layout described there. **Reuse all existing patterns and components** (`Select`/`MultiSelect`, `ResponsiveModal`, `ConfirmDialog`, `Field`, `Button`, `StatusBadge`, `ImageThumb`/`Lightbox`, `MasterList`/`MasterToolbar`, `useDeleteFlow`, `EmptyState`, `Skeleton`, `SearchBar`, `LoadMore`, format helpers, theme tokens). New screens must look and behave like the existing ones: same spacing, cards, radius, colours, full-screen forms, and phone/tablet/desktop behaviour. Do not restyle or refactor existing screens beyond what this document asks.

**How to work**
0. Run `git status` first. If there are uncommitted changes, **stop and tell me** before doing anything, so I can commit them. Make sure `npm run db:migrate` has been applied, including migration 0001.
1. Start in plan mode. Show me the plan (schema + migration, shared logic, endpoints, screens, print approach) before writing code.
2. Build in the phases at the end. After each phase run `npm run typecheck`, run the app, fix errors, and give me a short summary.
3. At the end, update `CLAUDE.md` and `PROJECT_STATE.md` to reflect the new state.

---

## 1. Background (how the factory works)

- Each power loom beam has **3 sections**, so one **frame** of weaving produces **3 pieces** (one per section). One frame is roughly 100 m of cloth. The 100 m is for your understanding only and is not used in any calculation.
- A **jobsheet** is a printed paper given to loom workers. It says which design, which machine(s), the picks, and how many frames to weave.
- Gaurang (production partner) creates jobsheets from an order once Jemish has sent it for production. Jemish (owner) has full access to everything too.

Put `SECTIONS_PER_BEAM = 3` in one shared config constant (`shared/src/production.ts`), never hardcode 3 anywhere else.

---

## 2. Scope of jobsheets in this sprint

- Jobsheets work **only for orders with unit `pcs`**. For orders in `meters`, `kg` or `g`, the Jobsheets section on the order details page shows an `EmptyState` saying "Jobsheets for kg / g / meter orders — coming soon" with no actions.
- Jobsheets can be created only when the order status is **Ready for production** or later (never for Pending for production). The server enforces this.

---

## 3. Roles and permissions

Add to `shared/src/roles.ts`:

| Permission | jemish | gaurang |
|---|---|---|
| `canManageJobsheets` (create, edit, delete, print) | ✅ | ✅ |
| `canManageMachines` (add/edit/delete machines) | ✅ | ✅ |

Both roles can view everything jobsheet-related. Enforce on the server with `requirePermission`, and check that the role can see the parent order (same rule as `GET /orders/:id`).

---

## 4. New status: Jobsheet created

Add to `shared/src/statuses.ts`:

| key | label | sequence | visibleTo | badge |
|---|---|---|---|---|
| `jobsheet_created` | Jobsheet created | 30 | jemish, gaurang | a blue or indigo badge, distinct from amber and green |

Transitions (always written to `order_status_history` with the role):
- When the **first** jobsheet of an order is created (by generate or single add) and the order is `ready_production` → `jobsheet_created`.
- If **all** active jobsheets of an order are deleted → back to `ready_production`.
- It appears automatically in the order list badges and the Status filter (config-driven).

**Undo send for production:** allowed only when the status is `ready_production` **and** the order has no active jobsheets. Hide the button otherwise; the server returns 409 with a clear message.

---

## 5. Machine Master

**Table `machines`:** `id`, `machine_no` (integer, required, ≥1, unique among non-deleted), `name` (optional, ≤80), `notes` (optional), `is_active` (boolean, default true), `is_deleted`, `created_at`, `updated_at`. Unique partial index on `machine_no WHERE is_deleted = 0`.

**UI:** a new nav item **Machines** (lucide icon such as `Factory` or `Cog`) after Designs, in the sidebar, rail and bottom nav. Check that 5 bottom-nav tabs still fit at 360px with labels, and shorten labels if needed.
- The list uses `MasterList`: search by number or name. Table columns (md+): Machine No, Name, Status (Active/Inactive pill), Notes. Phone cards: "Machine 7", name, status pill. Sort by `machine_no` ascending.
- The form is full screen, like the other masters: Machine number*, Name, Active toggle, Notes. It's read-only without `canManageMachines`.
- Delete: soft delete with confirm. **Block (409)** if the machine is used on any active jobsheet, with a message suggesting to mark it inactive instead.
- Inactive machines don't appear in the jobsheet machine dropdowns, but still show on existing jobsheets.

**Endpoints:** `GET /machines?search=&page=&limit=`, `GET /machines/:id`, `POST`, `PUT /machines/:id`, `DELETE /machines/:id`, `GET /lookup/machines?search=` (active only, `{id, machineNo, name}`, sorted by number).

**Seed:** add machines 1–12 (idempotent).

---

## 6. Data model

### 6.1 `jobsheets`
| Column | Notes |
|---|---|
| `id` | PK |
| `jobsheet_no` | integer, **globally unique, running from 1, never reused**, even after deletion. UNIQUE index. |
| `order_id` | FK → orders, NOT NULL, indexed |
| `frames` | integer ≥ 1 |
| `picks` | text, optional, ≤ 20 (display only, e.g. "72") |
| `created_by` | role key |
| `is_deleted` | soft delete (deleted jobsheets keep their number, and the number is never given out again) |
| `created_at`, `updated_at` | |

### 6.2 `jobsheet_machines`
`jobsheet_id` (FK, cascade), `machine_id` (FK). Composite primary key. Index on `machine_id`.

### 6.3 `counters`
`name` (text PK), `value` (integer). One row: `jobsheet_no`, starting at 0.
- Allocate numbers **inside the same transaction** with `UPDATE counters SET value = value + :n WHERE name = 'jobsheet_no' RETURNING value`, then assign `value-n+1 … value`.
- **Do not** use `MAX(jobsheet_no)+1`: deletions must never let a number be reused.

### 6.4 New columns on `orders` (the "jobsheet plan" for the whole order)
| Column | Meaning |
|---|---|
| `jobsheet_pieces` | integer, default 0 — the **jobsheet quantity**: total pieces planned across all runs. It's printed on every jobsheet and shown on order details. |
| `target_frames` | integer, default 0 — total frames the jobsheets should cover. Used for the auto-adjust and the warnings. |
| `frames_per_jobsheet` | integer, nullable — the value from the latest multi-jobsheet run. Used when splitting. |

These are reset to 0 / 0 / null when all jobsheets of the order are deleted.

---

## 7. Calculation rules (single source of truth)

Write all of this as **pure functions** in `shared/src/jobsheets.ts`, used by the server (the real write) and the client (live previews). Add **vitest** to the `shared` package with unit tests for every example below.

### 7.1 Multi-jobsheet generation
Inputs: `pieces` (integer ≥ 1), `framesPerJobsheet` (integer ≥ 1).
1. `totalFrames = ceil(pieces / SECTIONS_PER_BEAM)`. **Always round up** (e.g. 101.2 → 102).
2. `jobsheetCount = ceil(totalFrames / framesPerJobsheet)`.
3. All jobsheets get `framesPerJobsheet` frames, except the **last**, which gets the remainder: `totalFrames − framesPerJobsheet × (jobsheetCount − 1)`.

Examples (must be unit tests):
- 300 pcs, 10 per jobsheet → 100 frames → 10 jobsheets × 10.
- 300 pcs, 11 per jobsheet → 100 frames → 10 jobsheets: 9 × 11 + 1 × 1.
- 304 pcs, 10 per jobsheet → 102 frames (101.33 rounded up) → 11 jobsheets: 10 × 10 + 1 × 2.
- 2 pcs, 5 per jobsheet → 1 frame → 1 jobsheet × 1.

When the run is saved, on the order: `jobsheet_pieces += pieces`, `target_frames += totalFrames`, `frames_per_jobsheet = framesPerJobsheet`.

### 7.2 Single jobsheet
Inputs: `frames` (integer ≥ 1), `pieces` (integer ≥ 1, defaults to `frames × SECTIONS_PER_BEAM`, editable), picks and machines.
Creates exactly 1 jobsheet. On the order: `jobsheet_pieces += pieces`, `target_frames += frames`.

### 7.3 The whole order is one batch
All active jobsheets of an order form **one batch**, no matter how many runs or single adds created them. Order them by `jobsheet_no`. The **last jobsheet** = the active jobsheet with the highest `jobsheet_no`.

### 7.4 Auto-adjust when a jobsheet's frames are edited
Let `F = order.frames_per_jobsheet` (may be null) and `delta = newFrames − oldFrames` for the edited jobsheet.

**A. The edited jobsheet is NOT the last one** → apply `−delta` to the last jobsheet:
- **Last jobsheet grows past F** (only if F is not null): the last becomes F, and the leftover goes into **new jobsheet(s)** of up to F frames each (new numbers from the counter). New jobsheets copy the **picks and machines of the last jobsheet**. If F is null, the last just grows.
- **Last jobsheet drops to 0 or below:** **delete (soft) only that last jobsheet**. Do not take frames from any other jobsheet. The total frames now exceed `target_frames` → show the warning (7.5). Never block the edit.
- Otherwise: the last jobsheet simply gets the new value.

Example: F = 10, 10 jobsheets of 10 (target 100). Jobsheet #3 is changed to 12 → the last becomes 8. Then jobsheet #5 is changed to 5 → the last becomes 8 + 5 = 13 > 10, so the last becomes 10 and a new jobsheet with 3 frames is created.

**B. The edited jobsheet IS the last one** → no other jobsheet changes. After saving, compare the total with `target_frames`: if it's less, show the warning (7.5). If it's more or equal, that's fine (no warning needed for "more" here, but still show the coverage summary).

Picks or machines edits never trigger any adjustment.

The server does the whole edit + adjust in **one transaction** and returns a summary of what changed (e.g. `{ updated: [...], created: [...], removed: [...] }`), so the UI can show a toast like "Jobsheet #325 changed to 8 frames" / "New jobsheet #331 created (3 frames)" / "Jobsheet #330 removed".

Write unit tests for: normal adjust, last-grows-past-F with a split into one and into several new jobsheets, last reaching exactly 0, last going below 0, F = null, and editing the last jobsheet.

### 7.5 Coverage summary and warnings
Computed from the order and its active jobsheets:
- `orderedPieces` = order quantity
- `jobsheetPieces` = `order.jobsheet_pieces`
- `targetFrames` = `order.target_frames`
- `totalFrames` = sum of the active jobsheets' frames

Warnings (amber, non-blocking; shown both in forms before saving and on the order details page):
- `jobsheetPieces < orderedPieces` → "Jobsheet quantity (X pcs) is less than the order (Y pcs)."
- `jobsheetPieces > orderedPieces` → "Jobsheet quantity (X pcs) is more than the order (Y pcs)."
- `totalFrames < targetFrames` → "Jobsheets cover X frames, but Y frames are needed (Z short)."
- `totalFrames > targetFrames` → "Jobsheets cover X frames, which is Z more than the Y needed."

### 7.6 Deleting a jobsheet
- Soft delete with a confirm dialog. **No auto-adjust.** Its number is never reused.
- The coverage warnings then show any shortfall.
- If it was the last active jobsheet of the order, reset the jobsheet plan (6.4) and move the order back to `ready_production`.

---

## 8. Order details page — Jobsheets section

Add a full-width **Jobsheets** card to `/orders/:id`, below the existing cards (spanning both columns at lg+). It's visible to both roles once the order is Ready for production or later. For Pending orders it's not shown at all.

**Header row:** the title "Jobsheets" + a count, then these actions (only with `canManageJobsheets`, and only for `pcs` orders):
- **Create jobsheets** (primary) → the multi-jobsheet form
- **Add single jobsheet** (secondary)
- **Print all** (icon button with a printer icon + tooltip; disabled when there are no jobsheets)

On phones the actions wrap neatly, or go into a compact row, and must not overflow.

**Summary strip** (small stat tiles like the existing detail fields):
- Order quantity (e.g. 300 pcs)
- Jobsheet quantity (e.g. 304 pcs)
- Frames needed (target)
- Frames in jobsheets (total)
- Jobsheets (count)

Show the amber warnings from 7.5 directly under the strip.

**Listing (clean grid):**
- **md+:** a table in the card, with the same style as the master tables and a sticky header. Columns: **Jobsheet No** (plain number, e.g. `319`), **Frames**, **Picks**, **Machines** (e.g. `7, 9`), **Created** (date), and actions: a **Print** icon (tooltip "Print jobsheet") and an **Edit** icon.
- **Phone:** cards: `Jobsheet 319` large, frames · picks, machines, and print/edit icons.
- Sort by jobsheet number ascending. Clicking a row or card opens the jobsheet details page. The icon buttons stop propagation.
- Empty state: "No jobsheets yet" plus the Create jobsheets button (if permitted).
- For non-pcs orders, show the "coming soon" `EmptyState` from section 2 instead.

**Undo send for production** is hidden once jobsheets exist (section 4).

---

## 9. Create jobsheets (multi) form

A full-screen `ResponsiveModal`, like the other forms (content max-w-2xl, sticky bottom bar with Cancel + primary button). Title: "Create jobsheets — Order #N".

Fields:
1. **Number of pieces** (integer, required). Prefill with the order quantity on the first run. On later runs, prefill with the remaining pieces (`orderedPieces − jobsheetPieces`) if that's positive, otherwise leave it empty. Show a live amber warning if **jobsheet quantity after this run** (`jobsheetPieces + pieces`) is lower or higher than the order quantity, e.g. "This makes the jobsheet quantity 290 pcs — 10 less than the order (300 pcs)."
2. **Picks** (text input, optional, e.g. 72). The hint says "Printed on every jobsheet".
3. **Number of frames per jobsheet** (integer ≥ 1, required).
4. **Machines**: a `MultiSelect` from `/lookup/machines` (searchable, shows "Machine 7 · name"), with at least one required. The hint says "Applied to all jobsheets; you can change machines per jobsheet later."

**Live preview panel** (updates as the user types, using the shared function):
- "304 pcs ÷ 3 sections = 101.33 → **102 frames**"
- "**11 jobsheets**: 10 × 10 frames + 1 × 2 frames"
- If jobsheets already exist: "Total after this run: 21 jobsheets, 204 frames"

The primary button reads **Create N jobsheets** and is disabled until the form is valid.

On save:
- One API call, with the whole run in one transaction.
- Toast: "11 jobsheets created (#320–#330)".
- Close the form and refresh the order details (status badge + jobsheets section).

---

## 10. Add single jobsheet form

Same modal style. Title "Add jobsheet — Order #N".

Fields:
- **Frames** (integer ≥ 1, required)
- **Pieces** (integer, defaults to frames × 3 and follows frames until the user edits it)
- **Picks** (optional)
- **Machines** (multi-select, required)

Show the same jobsheet-quantity warning as in section 9. The button reads **Add jobsheet**. Toast: "Jobsheet #331 created".

---

## 11. Jobsheet details page

Route: `/jobsheets/:id`, inside the app layout. Build it like the order details page.
- A "← Order #N" back link (history back, or `/orders/:orderId`).
- Heading **Jobsheet 319**, plus actions: **Print** (printer icon button), **Edit**, **Delete** (with `canManageJobsheets`).
- **Details card:** order number (link) + client name, material/quality, design/variation code, frames, picks, machines, jobsheet quantity (the order's `jobsheet_pieces`), created date/time + by role, updated date/time.
- **Design card:** the design/variation image (lightbox) and code, the same as on order details.
- A 404 state if the jobsheet is not found or isn't visible for the role (or has been deleted).

**Edit form** (full screen): Frames, Picks, Machines (multi-select; can include machines that are now inactive if they're already assigned).
- When frames changed, show a live **"What will change"** preview (from the shared function) before saving, e.g.:
  - "Jobsheet 330 (last): 10 → 8 frames"
  - "New jobsheet will be created with 3 frames"
  - "Jobsheet 330 will be removed"

  Plus any coverage warnings.
- Save → the server does the adjust (7.4) → toast(s) summarizing the changes → invalidate the order and jobsheets queries.

---

## 12. Printing

### 12.1 Mechanics
- A print route `/print/jobsheets?ids=1,2,3` **outside** the app layout (like `/orders/new`), lazy-loaded.
  - **Print all** passes all active jobsheets of the order in number order.
  - The row and detail print icons pass one id.
  - Endpoint: `GET /api/jobsheets/print?ids=` returns everything needed (jobsheet no, frames, picks, machine numbers, jobsheet quantity, design/variation code, **full** image URL) in one query. Role-checked.
- **On screen**, the route shows a light-grey preview of the A4 pages (scaled to fit the width on phones) with a small sticky toolbar: **Back** and **Print**. The toolbar is hidden when printing.
  - The Print button calls `window.print()` only after **all images have loaded**. Show "Preparing…" until then.
- `@page { size: A4 portrait; margin: 10mm; }`, black on white, no app chrome, no shadows, and `print-color-adjust: exact` for borders.
- **Each jobsheet = 2 pages** (the printer prints double-sided): page 1 is the jobsheet front, page 2 is the design back. Use `break-after: page` so the pairs never shift. If an order has no design, still output the back page (with "No design attached" in small grey text) so the front/back pairs stay aligned.

### 12.2 Front page layout (match their current paper jobsheet)
Use thin black borders (1–1.5px), bold uppercase labels, and fill the A4 page top to bottom the way the paper version does. Printed values use a clear, large font. Everything else is left **empty** for the workers to write in with a pen.

1. **Top centre:** `॥ श्री गणेशाय नमः ॥`. Load **Noto Sans Devanagari** from Google Fonts (print route only) so it renders correctly.
2. **Below it:** a wide rectangular box (left/centre) with the **jobsheet number** in large bold digits, e.g. `319`.
3. **Upper main box** (one large bordered box):
   - **Left side:** a stacked list of labels, each followed by a long blank line to write on: `WARP:`, `REED:`, `TOTAL ENDS:`, `WIDTH:`, `WEFT:`, then **3 more blank rows** (a line with no label) for anything extra.
   - **Right side:** an inner bordered box with:
     - `LOOM NO:` + a value box showing the machine numbers, comma-separated (e.g. `7, 9`)
     - `DESIGN NO:` + a value box showing the **variation code if the order has a variation, otherwise the design code** (e.g. `D101N2`)
   - **Below, left:** a table with the columns **PRE-WINDER | YARN | (blank) | (blank)** and **12 rows** numbered `1)` to `12)` in the first column. All other cells are empty. Size the columns similar to the photo: pre-winder narrow, yarn wide, the two blank columns narrow.
   - **Below, right of the table:**
     - a bordered box with `PICKS:` + a value box (the picks, empty if none), and `FRAME:` + a value box (the frames of this jobsheet), with the **jobsheet quantity** under it, e.g. `300 pcs`
     - under that, a separate bordered box with `HEAD OPERATOR:` and `OPERATOR NAME:`, each with an empty writing line
4. **Bottom box** (one large bordered box):
   - **Left:** `TAKA:` followed by 4 numbered empty writing lines `1)` to `4)`.
   - **Right:** an inner bordered box titled **DAMAGE** (centred, bold) with the labels `MACHINE DAMAGE:`, `BUTTACUTTING DAMAGE:` and `MILL DAMAGE:`, each with empty space to write.

Keep the positions of all these blocks the same as described; this is the format the workers already know.

### 12.3 Back page
- The design (or variation) **full image**, as large as possible within the margins (`object-fit: contain`, centred).
- The **code** (e.g. `D101N2`) in large bold text above or below the image.
- A small `Jobsheet 319` in a corner, so a loose back page can be matched.

---

## 13. API summary

| Method | Path | Purpose | Permission |
|---|---|---|---|
| GET | `/orders/:id/jobsheets` | Active jobsheets (with machine numbers) + coverage summary + warnings | All (order must be visible) |
| POST | `/orders/:id/jobsheets/generate` | `{ pieces, picks?, framesPerJobsheet, machineIds[] }` → run 7.1 in one transaction; status change if first | `canManageJobsheets` |
| POST | `/orders/:id/jobsheets` | Single: `{ frames, pieces, picks?, machineIds[] }` | `canManageJobsheets` |
| GET | `/jobsheets/:id` | Details (+ order, design, machines) | All (order visible) |
| PUT | `/jobsheets/:id` | `{ frames, picks?, machineIds[] }` → 7.4 in one transaction; returns the change summary + new coverage | `canManageJobsheets` |
| DELETE | `/jobsheets/:id` | Soft delete (7.6) | `canManageJobsheets` |
| GET | `/jobsheets/print?ids=` | Print data | All (orders visible) |
| — | Machines endpoints | See section 5 | `canManageMachines` for writes |

Validation rules:
- Use zod schemas in `shared/src/schemas.ts`.
- Return 409 for: order not `pcs`, order not Ready or later, inactive or deleted machine chosen, undo with jobsheets present.
- Return 404 for jobsheets on deleted or invisible orders.
- Use one query per list (no N+1).
- React Query: invalidate `order`, `orders` list, and `jobsheets` keys after each mutation.

---

## 14. Quality checklist
- The calculation lives only in `shared/src/jobsheets.ts`, and its vitest tests pass.
- Every write that touches several rows (generate, edit + adjust, delete + status reset) is **one transaction**.
- Jobsheet numbers are never reused (test: create 3, delete the last, create 1 → it gets number 4).
- No layout break or horizontal scroll at 360px on the new screens, including the jobsheet table/cards and the print preview.
- The print looks right when printed from Chrome desktop and Chrome Android: A4, 2 pages per jobsheet, pairs aligned.
- Loading, empty and error states everywhere, consistent with the existing screens.

## 15. Build phases
1. **Schema + migration:** `machines`, `jobsheets`, `jobsheet_machines`, `counters`, the new `orders` columns, the new status + permissions, and seeding machines 1–12.
2. **Shared calculation module + vitest tests.**
3. **Machine Master:** API + UI + nav item.
4. **Jobsheet API:** generate, single, list/coverage, details, edit with auto-adjust, delete, print data, and the status transitions + undo rule.
5. **Order details Jobsheets section + Create (multi) form + Add single form.**
6. **Jobsheet details page + Edit form with the "What will change" preview + Delete.**
7. **Print route:** the front/back layout and the preview toolbar.
8. **Polish:** test every flow as both roles at 360 / 768 / 1280px, and update `CLAUDE.md` and `PROJECT_STATE.md`.
