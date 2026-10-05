# Rivoora Textile — Sprint 6: Client demo feedback

This continues the existing project. Read `CLAUDE.md` and `PROJECT_STATE.md` first. The client saw the system and liked the UI, so **keep the current look and patterns exactly**: the cards, the standard `Select`, full-screen forms, `ConfirmDialog`, `StatusBadge`, the bilingual `<Bi>` helper on Taka entry screens, the tabs, theme tokens and spacing. Only change what this document asks for.

**How to work**
0. Run `git status`. If there are uncommitted changes, stop and tell me so I can commit them first.
1. Start in plan mode and show me the plan: migrations, shared changes, endpoints, and a list of every screen touched.
2. Build in the phases at the end. After each phase, run `npm run typecheck` and `npm test`, run the app, fix all errors, and give me a short summary.
3. At the end, update `CLAUDE.md` and `PROJECT_STATE.md` (and the README if setup changed).

---

## 1. Order number first, jobsheet number second (display change only)

The factory talks about **orders**, not jobsheets. From now on, **the order number is the main number everywhere a jobsheet appears**, with the jobsheet number in brackets beside it.

**What does NOT change:**
- `jobsheet_no` stays exactly as it is: global, running, unique and never reused.
- The QR codes (`/j/<jobsheetNo>`), `GET /jobsheets/by-no/:no`, the scan screen, the typed jobsheet number on the scan screen, taka uniqueness, and all the jobsheet maths.

**What changes:**
- Add one shared formatter in `shared/src/jobsheets.ts`:
  - `jobsheetRef(orderNo, jobsheetNo)` → `"Order #26 (319)"`
  - a compact variant → `"#26 (319)"` for tight spots such as chips, tiles and toasts
- Use it in **every** place that shows a jobsheet today. The order number is the large/bold part and the bracket part is smaller and muted. That includes:
  - the order Jobsheets tab cards
  - the jobsheet details heading and back link
  - the supervisor cards, dialogs (Start / Complete / Change machine) and toasts
  - the Activity timeline (e.g. "continued as #26 (331)")
  - the Taka entry list, the taka entry identity card, the success screen and the scan result
  - the Takas card and Edit takas groups
  - the order dashboard detail drawer and the Damages tab
  - the Machine view (§8)
  - the print (§6)
- Make sure every endpoint that returns jobsheets (including the restricted views for the supervisor and Taka entry) also returns `orderNo`. The supervisor and Taka entry still get **only the order number**, never the client name or other order details.
- **Search:** every jobsheet search (the supervisor list, the Taka entry list and the dashboard drawer, if it has search) matches **the order number or the jobsheet number** (plus the design code where it already does). The placeholder becomes "Search order no, jobsheet no or design…". A leading `#` is ignored.

Grep the client for `Jobsheet {` / `jobsheetNo` and replace every user-facing occurrence. The list of files is in `PROJECT_STATE.md`.

---

## 2. Customers: brokers

A customer can have **several brokers**. A broker is **just a name** attached to a customer.

**Data:** a new table `customer_brokers`:
- `id`
- `customer_id` (FK, indexed)
- `name` (text, required, ≤ 80, trimmed)
- `is_deleted`, `created_at`, `updated_at`

Add a unique partial index on `(customer_id, lower(name)) WHERE is_deleted = 0`.

**Customer form (add and edit, including the ➕ quick-add from Add Order):**
- A **Brokers** section with a simple repeatable list: an input + **Add broker** button. Each added name shows as a removable row or chip. Empty rows are ignored, and duplicates within the customer are blocked inline.
- Saving the customer saves its brokers in the same transaction:
  - new names are inserted
  - removed names are soft-deleted (they stay on old orders)
  - renamed ones are updated
- **Customer list:** show the brokers (comma-separated, truncated) as an extra column on md+ and as a line on the phone cards. Customer search also matches broker names.

**Orders:**
- New column `orders.broker_id` (FK → customer_brokers, nullable). The broker is **optional**.
- In **Add / Edit order**, add a **Broker** field (the standard `Select`) right after Client name:
  - It's disabled until a client is selected, then lists **only that client's brokers**.
  - If the client has none, it shows "No brokers for this client" with a hint to add them in the customer.
  - Changing the client clears the broker.
- The server checks that the broker belongs to the chosen customer (400 on `brokerId` otherwise).
- Show the broker in the order header detail grid and in the Order details tab. Order search also matches the broker name.
- Endpoint: `GET /lookup/customers/:id/brokers` (Jemish/Gaurang).

---

## 3. Orders: order type (required) and default unit

**Order type** — new column `orders.order_type` (`lump` | `pcs_to_pcs`). It's required for new orders. Backfill existing orders as `pcs_to_pcs` (they can be changed by editing the order).
- In Add / Edit order, add a required **Order type** control: **two side-by-side attached tappable options**, a segmented control styled with the theme, labelled **Lump** and **Pcs to pcs**. Nothing is pre-selected on a new order, and an inline error appears if it's left empty.
- The order type is **not linked to the unit**.
- Jobsheets keep working exactly as now: for **any order whose unit is pcs**, whatever its type.
- Show it as a small tag on the **order cards**, in the **order header**, and in the Order details tab.
- Add an **Order type** filter (Lump / Pcs to pcs) to the orders filter dialog, with URL state and removable chips, like the existing filters.
- It's editable later through Edit order.

**Default unit:** new orders default to **pcs** (instead of meters). Update `DEFAULT_UNIT` in shared.

---

## 4. Taka entry: pcs field, and dashes/slashes in taka numbers

### 4.1 Pcs per taka (required)
- New column `takas.pcs` (integer, nullable in the DB so old takas stay valid, but **required for every new or edited taka**: 1–9999).
- **Taka entry screen:** each taka row becomes: taka number → meters (unchanged) → **pcs** → Damage.
  - On phones, put the number on the first line, then **meters + pcs side by side**, then the Damage button. Keep the big fields and tap targets.
  - The pcs field uses the number keypad, with bilingual labels "Pcs / पीस".
- **Edit takas** (Jemish/Gaurang): add the same pcs field per row.
- **Display:**
  - taka chips show `6245 · 105.5 m · 12 pcs`
  - the Takas card adds a **Total pcs** tile
  - the event summaries include pcs
  - the order dashboard's taka facts and the Production summary line show total pcs
  - old takas without pcs show "—"
- Put the validation and formatting helpers in `shared/src/takas.ts`, next to the meters helpers, with tests.

### 4.2 Taka number format
- Allow **digits, `-` and `/` only** (no letters). The value must start and end with a digit, with no two separators in a row: `^\d+([-/]\d+)*$`, max 15 characters. Examples: `6245`, `6245-1`, `62/45`.
- Update `TAKA_NO_REGEX`, the cleaning helper, the error messages (bilingual: "Use digits, - or / only") and the tests. Duplicates within one jobsheet are still blocked (exact match).
- **Keyboard:** iPhone number keypads have no dash or slash. Keep a numeric-style keypad (`inputMode="tel"` or `numeric`, whichever gives the best keypad; test on Android and iPhone). Under the **focused** taka field, show two small helper keys **–** and **/** that insert at the cursor. They must not appear on other fields.
- The QR / scan parsing (`/j/<digits>`) does **not** change.

---

## 5. Damage master + damage name on takas

Two separate things:
- **Where** the damage was found = the existing `damage_type` (`machine` / `butta` / `mill`). It **stays exactly as it is**: damage marked at taka entry is always `machine`. The dashboard damage strip and Damages tab tiles keep working on it.
- **What** the damage is = a new **damage name** from a new **Damage master**.

**Data:**
- New table `damages` (the master):
  - `id`
  - `name` (required, ≤ 80, unique case-insensitive among non-deleted)
  - `notes` (optional)
  - `is_deleted`, `created_at`, `updated_at`
- New column `takas.damage_id` (FK → damages, nullable), indexed.
- Existing damaged takas keep `damage_type = machine` with no damage name, displayed as just "Machine damage".

**Damage master screen:**
- A new master next to the others: nav label **Damage master**, in the masters group / phone "More" sheet. Use `MasterList` + a full-screen form with Name* and Notes.
- **Jemish and Gaurang** can add, edit and delete. Gaurang may have no master write rights today, so add a permission `canManageDamages` (true for both).
- Delete is a soft delete, blocked (409) if any active taka uses it.
- No seed data; the client will add their own names.

**Lookup:** `GET /lookup/damages?search=` (active only, `{id, name}`), allowed for Jemish, Gaurang and Taka entry.

**Damage popup** (Taka entry screen **and** Edit takas, the same component):
- Tapping **Damage / खराबी** on a filled row opens a popup: a centred modal on md+, a bottom sheet on phones. It's bilingual on the Taka entry screen. It has:
  - **Damage name**: the standard searchable `Select` with the master names, plus a last option **Other / अन्य**.
  - Choosing **Other** shows a required text input "Write damage name / खराबी का नाम लिखें".
  - Buttons: Cancel / **Mark damaged**.
- After confirming, the row shows the red Damage state **with the damage name** (e.g. "Damage · Hole").
- Tapping a damaged row's button again offers **Change damage** or **Remove damage**.
- A damage can't be saved without a name.

**Saving:**
- The taka payloads carry `damage: { damageId } | { otherName } | null`.
- For `otherName`, the server **finds an existing damage by case-insensitive name or creates it in the master**, inside the same transaction. This also works for the Taka entry role, which has no master rights: the server does it as part of the taka write.
- `damage_type` stays `machine` for damage marked at taka entry or in Edit takas.
- Validate with zod in `shared/src/schemas.ts`.

**Display:** wherever a damaged taka shows today, show both, e.g. **"Machine damage · Hole"**:
- chips
- the Takas card
- the Damages tab cards
- the dashboard detail drawer
- the confirm dialog on the Taka entry screen

The Damages tab cards show the damage name prominently.

---

## 6. Jobsheet print changes

In `features/jobsheets/print-page.tsx`:
1. **Top number box:** show the **order number** large (e.g. `26`), with the **jobsheet number in brackets beside it**, smaller: `26 (319)`. Use a "ORDER" micro-label if it helps readability.
   - The QR stays where it is and still encodes `/j/<jobsheetNo>`. Its caption becomes `Scan · 26 (319)`.
2. **LOOM NO:** print the assigned machine numbers **as small text just above the LOOM NO box** (e.g. "Assigned: 7, 9"), and leave the **box itself empty**, so the supervisor can write the loom he actually used.
3. **Remove the design back page completely.** Each jobsheet is now **one page**.
   - Remove the back-page component, its CSS and the image-loading wait. Print now waits only for the fonts and the QR.
   - Update the comments that mention front/back pairs.
   - The design code stays in the DESIGN NO box.

Nothing else on the layout moves.

---

## 7. Supervisor changes

### 7.1 Label: Ongoing → On-loom
- For the **supervisor role only**, the jobsheet status `ongoing` is labelled **"On-loom"**: add it to that status's `roleLabels`.
- The supervisor's tab "Ongoing" becomes **"On-loom"**, and its empty state becomes "Nothing on-loom right now".
- Other roles keep their current labels.

### 7.2 View toggle: Order view (default) / All
At the top of the supervisor's `/jobsheets`, add a segmented toggle **Order | All**. It's kept in the URL (`?view=order|all`) and defaults to **Order**.

**All view:** exactly today's screen (tabs, search, card grid, actions). Only the order-first labels from §1 change.

**Order view:** jobsheets grouped by order, in two levels. Keep the same clean card style the client liked.

1. **Orders list** (`/jobsheets?view=order`):
   - Search: "Search order no or design…".
   - A card grid (1 / 2 / 3 / 4 columns, like the jobsheet cards). Each **order card** shows:
     - the design image (big, like the jobsheet cards; tap → lightbox)
     - **Order #26** in large text
     - the design code
     - **count pills**: Pending N · On-loom N · Completed N (supervisor labels and colours)
     - a thin progress bar of completed vs total jobsheets
     - a full-width button **View jobsheets (N)**
   - **No client name** and no other order details: only the order number.
   - Only jobsheets the supervisor can see count (Sent / Ongoing / Completed).
   - **Sorting:** orders that have Pending or On-loom jobsheets first (by order number ascending), then fully completed orders last (most recently completed first).
   - Tapping the card or the button opens the order's jobsheets.
2. **Order's jobsheets** (`/jobsheets/order/:orderId`, inside the app layout):
   - A small header: back link "← Orders", **Order #26**, the design thumbnail (lightbox) and the code.
   - Below it, the **same tabs** (All / Pending / On-loom / Completed with counts), the **same search** (jobsheet no) and the **same jobsheet cards and actions** (Start / Complete / Change machine), all filtered to this order.
   - Reuse the existing list component with an `orderId` filter; don't duplicate it.

**API:**
- `GET /jobsheets/orders?search=&page=&limit=` (`canViewJobsheetsModule`). It returns `{orderId, orderNo, designCode, designThumbUrl, designImageUrl, counts: {pending, ongoing, completed, total}, lastCompletedAt}` per order, paginated, with the sorting above.
  - One aggregate query (GROUP BY order), no per-order queries.
  - **Never** return the client or any order details beyond these fields.
- `GET /jobsheets?…&orderId=` filters the existing supervisor list (409/404 if the order has no visible jobsheets).
- Invalidate these queries along with the existing jobsheet invalidations.

---

## 8. Machine view: order number first

On each running jobsheet row in a machine tile, show **Order #26** as the main bold label with **(319)** small beside it (via `jobsheetRef`), then the design code, frames and running time as now. The `/machine-view` response must include `orderNo` for each ongoing jobsheet. Nothing else changes.

---

## 9. Order dashboard label changes

In `shared/src/pipeline.ts`, Production sub-stages:
- `not_sent`: "Jobsheet pending (not sent)" → **"Not assigned to supervisor"**
- `with_supervisor`: "Waiting to start" → **"Waiting to start on loom"**

Check that any alert or empty-state text built from these labels still reads correctly.

---

## 10. API and data summary

New migration(s):
- `customer_brokers`
- `orders.broker_id`
- `orders.order_type` (backfill `pcs_to_pcs`)
- `takas.pcs`
- the `damages` table
- `takas.damage_id`

| Method | Path | Notes |
|---|---|---|
| POST/PUT | `/customers`, `/customers/:id` | body gains `brokers: [{ id?, name }]`; saved in one transaction |
| GET | `/lookup/customers/:id/brokers` | `{id, name}[]` |
| POST/PUT | `/orders`, `/orders/:id` | body gains `orderType` (required), `brokerId?` |
| GET | `/orders` | new filter `type=lump,pcs_to_pcs`; search also matches broker names; list items include `orderType` |
| CRUD | `/damages` | the Damage master (`canManageDamages`) |
| GET | `/lookup/damages?search=` | Jemish, Gaurang, Taka entry |
| POST/PUT | `/jobsheets/:id/takas` | rows gain `pcs` (required) and `damage` (`{damageId}` / `{otherName}` / null); the number format is updated |
| GET | `/jobsheets/orders` | the supervisor's Order view |
| GET | `/jobsheets?orderId=` | the supervisor list filtered to an order |
| — | every jobsheet response | includes `orderNo` |

Keep the role checks exactly as they are, and add the new permission `canManageDamages` (Jemish, Gaurang).

---

## 11. Quality checklist

- **Shared tests:**
  - the new taka number regex (valid: `6245`, `6245-1`, `62/45`; invalid: `-6245`, `6245-`, `62--45`, `A12`)
  - pcs validation
  - `jobsheetRef`
  - the damage payload schema
- No user-facing "Jobsheet 319" left without its order number (grep before finishing).
- The supervisor and Taka entry APIs still never return the client name (test with their `X-Role` headers).
- The print is **one page per jobsheet**: check the print preview, and the QR still scans to the right jobsheet.
- Taka entry with pcs, the dash/slash helper keys and the damage popup work on a **real phone** (Android + iPhone if possible). Nothing overflows at 360px.
- Every new form field has inline validation and bilingual text on the Taka entry screens.

## 12. Build phases

1. **Migrations + shared:** `DEFAULT_UNIT = pcs`, `jobsheetRef`, the order type, the taka number regex, pcs helpers, damage schemas, `canManageDamages`, the supervisor "On-loom" label, the dashboard labels, plus tests.
2. **Brokers:** the customer form/list, the order form broker field, the order header/details, search.
3. **Order type:** the order form control, cards, header, details, filter.
4. **Damage master + damage popup:** master CRUD + lookup, the popup on Taka entry and Edit takas, the "Other" find-or-create, display everywhere.
5. **Taka pcs + number format:** the entry and edit forms, helper keys, chips, totals, dashboard facts.
6. **Order-number-first display** everywhere + search by order number + Machine view.
7. **Supervisor Order view + order jobsheets page.**
8. **Print changes.**
9. **Polish:** test every role at 360px, 768px and 1280px, test a printout and a real phone, and update `CLAUDE.md` and `PROJECT_STATE.md`.
