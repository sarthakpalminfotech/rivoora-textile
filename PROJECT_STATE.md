# Rivoora Textile — Project State

Snapshot of what the code actually does as of **2026-09-29** (branch `main`, last commit `4cee33a first time
implementation` **plus a set of uncommitted changes** — see [§8.1](#81-repository-state)). Written so a developer
can continue the project without reading the code first. The original brief is `rivoora-claude-code-prompt.md`;
day-to-day conventions are in `CLAUDE.md`.

`npm run typecheck` passes for all three packages at the time of writing. There are no automated tests.

---

## 1. Tech stack and folder structure

### Stack

| Layer | Technology |
|---|---|
| Monorepo | npm workspaces: `shared`, `server`, `client`; `concurrently` runs dev servers together |
| Shared | TypeScript source only (no build step), zod 3 |
| Server | Node 20+, Express 4, TypeScript (ESM), `tsx` for dev, `tsup` for build |
| DB | Turso (libSQL) via `@libsql/client` + Drizzle ORM 0.45, `drizzle-kit` migrations |
| Uploads | multer (memory storage) + sharp → WebP; stored on local disk |
| Client | Vite 6, React 18, TypeScript, React Router 6 (data router), TanStack Query 5 |
| UI | Tailwind 3 + `tailwindcss-animate`, Radix primitives (dialog, popover, dropdown-menu, tooltip, tabs, checkbox, slot), shadcn-style components written in-repo, `lucide-react`, `sonner` toasts, `react-day-picker` 9, `class-variance-authority` |
| Forms | react-hook-form + zod (`@hookform/resolvers`) |
| Dates | date-fns 4 |

Ports: API `4000` (env `PORT`), Vite dev server `5180` with `host: true` (LAN-reachable). Vite proxies `/api` and
`/uploads` to `API_URL` env or `http://localhost:4000`. In production (`npm start`) Express also serves
`client/dist` with an SPA fallback when that folder exists.

### Folder structure

```
rivoora-textile/
├─ package.json                  workspaces + root scripts (dev, build, start, typecheck, db:*)
├─ CLAUDE.md  README.md  rivoora-claude-code-prompt.md  PROJECT_STATE.md
├─ shared/                       @rivoora/shared — imported by client AND server
│  └─ src/
│     ├─ index.ts                re-exports everything below
│     ├─ roles.ts                ROLES config + permissions, can(), isRoleKey()
│     ├─ statuses.ts             ORDER_STATUSES config + helpers
│     ├─ units.ts                UNITS = meters | kg | pcs | g, DEFAULT_UNIT = meters
│     ├─ codes.ts                normalizeCode(), variationCode() (placeholder hint only)
│     ├─ schemas.ts              zod request schemas (server validates with these)
│     └─ types.ts                API DTO types
├─ server/
│  ├─ .env.example               TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, PORT
│  ├─ drizzle.config.ts  tsup.config.ts
│  ├─ drizzle/                   generated SQL migrations + meta/ (journal, snapshots)
│  ├─ uploads/                   image files (gitignored except demo/ and .gitkeep)
│  │  ├─ demo/                   42 seed images (21 full + 21 thumbs), committed
│  │  └─ designs/ notes/         user uploads (created on demand)
│  └─ src/
│     ├─ index.ts                Express app wiring
│     ├─ env.ts                  loads server/.env, exits if TURSO_* missing
│     ├─ config/roles.ts         re-export of shared roles
│     ├─ db/                     client.ts, schema.ts, migrate.ts, seed.ts, patterns.ts (SVG textile patterns)
│     ├─ lib/                    errors.ts (HttpError helpers), http.ts (ah(), parseId, pagination, LIKE escaping, csv)
│     ├─ middleware/             role.ts (X-Role → req.role, requirePermission), error.ts (error JSON)
│     ├─ routes/                 customers, designs, lookup, materials, orders, uploads (thin routers)
│     ├─ services/               customers, designs, materials, orders (all SQL + business rules)
│     └─ storage/                index.ts (active driver), local.ts (sharp → disk), types.ts (driver contract)
└─ client/
   ├─ index.html                 DM Sans from Google Fonts, theme-color #8B1E3F
   ├─ vite.config.ts  tailwind.config.ts  postcss.config.js
   ├─ public/favicon.svg         also used as the logo
   └─ src/
      ├─ main.tsx  App.tsx  index.css
      ├─ config/                 roles.ts, statuses.ts (re-exports from shared)
      ├─ lib/                    api.ts, form.ts, format.ts, query-client.ts, role-store.ts, utils.ts
      ├─ hooks/                  useDebounce, useInfiniteList, useInfiniteScroll, useMediaQuery, useRole
      ├─ components/
      │  ├─ layout/              app-layout (sidebar/rail, top bar, bottom nav), nav-items, page-title, page-skeleton, profile-menu
      │  ├─ ui/                  design system (see §6)
      │  └─ list-parts.tsx       SearchBar, LoadMore, ErrorState, Fab, FetchingIndicator
      ├─ features/
      │  ├─ orders/              orders-page, add-order-page, order-details-page, saved-designs-drawer,
      │  │                       order-filters, filters (URL state), api (query hooks)
      │  └─ masters/             api, master-list (generic list scaffold), use-delete-flow,
      │     ├─ customers/        customers-page, customer-form
      │     ├─ materials/        materials-page (form inline)
      │     └─ designs/          designs-page, design-detail-page, design-form, variation-form
      └─ pages/                  not-found-page, route-error
```

---

## 2. Database

Turso (libSQL/SQLite). Schema source of truth: `server/src/db/schema.ts`.

Conventions used by every table:
- `id` — `integer PRIMARY KEY AUTOINCREMENT`
- `created_at`, `updated_at` — `text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))` (ISO strings).
  `updated_at` is also set by Drizzle `$onUpdate` on every update issued through Drizzle.
- `is_deleted` — `integer (boolean) NOT NULL DEFAULT false`, only on masters (customers, materials, designs).
- Booleans are stored as 0/1. Dates-only (`order_date`) are `yyyy-MM-dd` text.

### customers

| Column | Type | Notes |
|---|---|---|
| id | integer PK | |
| name | text NOT NULL | |
| phone | text | normalized (spaces/dashes and leading `+91`/`0` stripped), must match `^[6-9]\d{9}$` |
| alternate_phone | text | same rule as phone |
| email | text | lower-cased, email-validated |
| address | text | ≤500 |
| city | text | ≤80 |
| gst_number | text | ≤20, upper-cased, no format validation |
| notes | text | ≤1000 |
| is_deleted, created_at, updated_at | | |

Indexes: `customers_name_idx (name)`.

### materials

| Column | Type | Notes |
|---|---|---|
| id | integer PK | |
| name | text NOT NULL | ≤80, unique (case-insensitive) among non-deleted |
| code | text | ≤30, optional, not unique |
| notes | text | |
| is_deleted, created_at, updated_at | | |

Indexes: `materials_name_idx (name)`; `materials_name_active_unique` UNIQUE on `lower(name)` WHERE `is_deleted = 0`.

### designs

| Column | Type | Notes |
|---|---|---|
| id | integer PK | |
| code | text NOT NULL | normalized (upper-case, spaces removed), `^[A-Z0-9_\-/.]+$`, ≤30 |
| name | text | |
| image_url | text | nullable (a design can exist without an image) |
| thumb_url | text | |
| notes | text | |
| material_id | integer FK → materials.id | **nullable; added in migration 0001.** "This design is only made in this material" |
| is_deleted, created_at, updated_at | | |

Indexes: `designs_code_idx (code)`; `designs_material_idx (material_id)`; `designs_code_active_unique` UNIQUE on
`code` WHERE `is_deleted = 0`.

### design_variations

| Column | Type | Notes |
|---|---|---|
| id | integer PK | |
| design_id | integer NOT NULL FK → designs.id | |
| variation_no | integer NOT NULL | assigned by server as `MAX(variation_no)+1` per design |
| code | text NOT NULL | **typed by the user**, same rules as design codes |
| image_url | text | required by the API schema, nullable in DB |
| thumb_url | text | |
| created_at, updated_at | | no `is_deleted` — variations are hard-deleted |

Indexes: `design_variations_design_idx (design_id)`; `design_variations_code_idx (code)`;
`design_variations_design_no_unique` UNIQUE on `(design_id, variation_no)`.

Code uniqueness: design codes and variation codes share one namespace. This is enforced **in application code
only** (`isDesignCodeTaken` in `services/designs.ts`) — there is no DB constraint on variation `code`.

### orders

| Column | Type | Notes |
|---|---|---|
| id | integer PK | |
| order_no | integer NOT NULL | `(SELECT COALESCE(MAX(order_no),0)+1 FROM orders)` inside the insert transaction |
| customer_id | integer NOT NULL FK → customers.id | |
| material_id | integer NOT NULL FK → materials.id | |
| design_id | integer FK → designs.id | nullable |
| variation_id | integer FK → design_variations.id | nullable; requires design_id |
| quantity | real NOT NULL | > 0, ≤ 100,000,000 |
| unit | text NOT NULL | `meters` \| `kg` \| `pcs` \| `g` |
| rate | real | nullable, ≥ 0 |
| order_date | text NOT NULL | `yyyy-MM-dd` |
| notes | text | ≤4000 |
| status | text NOT NULL | status key from `shared/src/statuses.ts` |
| sent_to_production_at | text | ISO, set on send, cleared on undo |
| created_at, updated_at | | |

Indexes: `orders_order_no_unique` UNIQUE `(order_no)`; `orders_status_idx`; `orders_order_date_idx`;
`orders_customer_idx`; `orders_material_idx`; `orders_design_idx`.

### order_note_images

| Column | Type | Notes |
|---|---|---|
| id | integer PK | |
| order_id | integer NOT NULL FK → orders.id ON DELETE CASCADE | |
| image_url, thumb_url | text NOT NULL | |
| created_at, updated_at | | |

Indexes: `order_note_images_order_idx (order_id)`. Max 10 per order (validated).

### order_status_history

| Column | Type | Notes |
|---|---|---|
| id | integer PK | |
| order_id | integer NOT NULL FK → orders.id ON DELETE CASCADE | |
| from_status | text | NULL for the "created" entry |
| to_status | text NOT NULL | |
| role | text NOT NULL | role key that made the change (`jemish` / `gaurang`) |
| changed_at | text NOT NULL | default now |
| created_at, updated_at | | |

Indexes: `order_status_history_order_idx (order_id)`. Written on create, send-to-production and undo.

### Relations summary

```
customers 1─* orders *─1 materials
designs   1─* orders        design_variations 1─* orders
designs   1─* design_variations
materials 1─* designs (optional default material)
orders    1─* order_note_images, order_status_history (cascade delete — orders are never deleted today)
```

All other FKs are `ON DELETE NO ACTION`; masters are soft-deleted, so FKs are never violated in practice.

### Migrations (`server/drizzle/`)

| # | File | What it does | Git state |
|---|---|---|---|
| 0000 | `0000_tiresome_mandroid.sql` | Creates all 7 tables and indexes above (without `designs.material_id`) | committed |
| 0001 | `0001_curious_mulholland_black.sql` | `ALTER TABLE designs ADD material_id integer REFERENCES materials(id)` + `designs_material_idx` | **untracked** (journal change uncommitted) |

Whether 0001 has been applied to the Turso DB can't be told from the code. `npm run db:migrate` is idempotent,
so run it to be sure.

### Seed (`npm run db:seed`)

Idempotent: customers/materials/designs/variations are matched by name, code or `(design, variation_no)` and
inserted only if missing. Orders are seeded only when the `orders` table is empty. It creates 8 customers
(Surat, Ahmedabad, Jaipur, Vadodara, Mumbai, Rajkot, Chennai), 6 materials (Georgette GEO, Chiffon CHF, Silk SLK,
Cotton COT, Crepe CRP, Rayon RAY), 6 designs D101–D106 with 2–3 variations each (codes `D101N1`…, images
generated from SVG patterns in `patterns.ts`), and 25 orders over the last 44 days (14 Ready, 11 Pending, with
repeat designs for the same client) plus matching history rows. The seed does not set `designs.material_id`.

---

## 3. API endpoints

Everything is under `/api`, JSON in and out. Every route except `GET /api/health` needs the header
`X-Role: jemish | gaurang` (case-insensitive). If it's missing or invalid the API returns **400**.
Errors look like `{ "error": { "message": string, "field"?: string } }`, with codes 400 (validation, zod, multer,
bad JSON), 403 (permission), 404, 409 (conflict / UNIQUE constraint), 500.

Permission column: **All** means any valid role. Permission names are from `shared/src/roles.ts`.
`requirePermission(a, b)` means **either** permission is enough.

### Orders

| Method | Path | Purpose | Permission |
|---|---|---|---|
| GET | `/orders?search=&status=a,b&material=1,2&from=&to=&page=&limit=` | Lean paginated list (default 20, max 100), newest `order_no` first. Joins customer, material, design, variation in one query. Returns `designCode` / `designThumbUrl` (variation if set, else design). **Never returns rate.** Only statuses visible to the role; requested statuses are intersected with visible ones. Search (leading `#` stripped) matches customer name, material name, design code, variation code; if numeric also exact `order_no` and quantity prefix. `from`/`to` filter `order_date` inclusive. | All (role-filtered) |
| GET | `/orders/:id` | Full detail + note images + status history. **404 if the order's status isn't visible to the role.** `rate` key present only when `canSeeRate`. | All (role-filtered) |
| POST | `/orders` | Create. Body `orderCreateSchema`: `customerId, materialId, designId?, variationId?, newDesign? {code,imageUrl,thumbUrl}, quantity, unit, rate?, orderDate, notes?, noteImages[]`. Checks that the referenced records exist and aren't deleted. `newDesign` inserts a design into Design Master in the same transaction (409 on `designCode` if the code is taken). Status `pending_production`, writes history. Returns `{ id, orderNo }` (201). | `canAddOrder` |
| POST | `/orders/send-to-production` | Body `{ orderIds: number[] }` (1–500). In one transaction, moves only those currently `pending_production` → `ready_production`, sets `sent_to_production_at`, writes history. Other ids are silently skipped. 409 if none were updated. Returns `{ updated, orderIds }`. | `canSendToProduction` |
| POST | `/orders/:id/undo-production` | `ready_production` → `pending_production`, clears `sent_to_production_at`, writes history. 409 if the order isn't Ready. Returns the updated order detail. | `canUndoProduction` |

### Customers

| Method | Path | Purpose | Permission |
|---|---|---|---|
| GET | `/customers?search=&page=&limit=` | Paginated, sorted by `lower(name)`. Search: name, phone, city. | All |
| GET | `/customers/:id` | One customer | All |
| GET | `/customers/:id/previous-designs` | Distinct design/variation pairs used in this client's orders, each with its **latest** order (no, date), `timesUsed`, and the design's default material; newest first, max 60, not paginated. Skips deleted designs. Not role-filtered by status. | All |
| POST | `/customers` | Create | `canManageMasters` **or** `canAddOrder` (so the Add Order ➕ works) |
| PUT | `/customers/:id` | Update | `canManageMasters` |
| DELETE | `/customers/:id` | Soft delete. 409 with "used in N orders" when referenced. 204. | `canManageMasters` |

### Materials

| Method | Path | Purpose | Permission |
|---|---|---|---|
| GET | `/materials?search=&page=&limit=` | Paginated, sorted by `lower(name)`. Search: name, code. | All |
| GET | `/materials/:id` | One material | All |
| POST | `/materials` | Create. 409 on `name` if a case-insensitive duplicate exists. | `canManageMasters` |
| PUT | `/materials/:id` | Update (same uniqueness rule) | `canManageMasters` |
| DELETE | `/materials/:id` | Soft delete. 409 if used in orders. Also sets `material_id = NULL` on designs that used it. 204. | `canManageMasters` |

### Designs & variations

| Method | Path | Purpose | Permission |
|---|---|---|---|
| GET | `/designs?search=&page=&limit=` | Paginated, newest id first. Items: `id, code, name, thumbUrl, imageUrl, variationCount, materialName`. Search: design code, name, or any of its variation codes. | All |
| GET | `/designs/check-code?code=&exceptId=` | `{ code (normalized), available }` — checks active design codes **and** variation codes | All |
| GET | `/designs/:id` | Design + `material {id,name} \| null` + variations (by `variation_no`) | All |
| POST | `/designs` | Create (`code, name?, notes?, imageUrl?, thumbUrl?, materialId?`). 409 on `code` if taken; 400 on `materialId` if the material doesn't exist. | `canManageMasters` |
| PUT | `/designs/:id` | Update the same fields. Variation codes are **not** renamed when the design code changes. | `canManageMasters` |
| DELETE | `/designs/:id` | Soft delete. 409 if any order references the design. | `canManageMasters` |
| GET | `/designs/:id/variations` | Variations array | All |
| POST | `/designs/:id/variations` | Body `{ code, imageUrl, thumbUrl }` (all required). 409 on `code` if taken. `variation_no` auto-assigned. | `canManageMasters` |
| DELETE | `/designs/:id/variations/:variationId` | **Hard delete.** 409 if used in orders. | `canManageMasters` |

There is no endpoint to edit a variation.

### Lookups (dropdowns)

| Method | Path | Purpose | Permission |
|---|---|---|---|
| GET | `/lookup/customers?search=` | `{id, name, city}[]`, max 30, `Cache-Control: private, max-age=10` | All |
| GET | `/lookup/materials?search=` | `{id, name, code}[]`, max 50, same cache header | All |

### Uploads & misc

| Method | Path | Purpose | Permission |
|---|---|---|---|
| POST | `/uploads?folder=designs\|notes` | multipart field `file`, one image ≤10 MB (jpg/jpeg/png/webp/heic/heif by MIME or extension). sharp auto-rotates it and saves `<name>.webp` (≤1600px wide, q82) + `<name>-thumb.webp` (320×320 cover, q72). Returns `{ url, thumbUrl }` (201). | `canManageMasters` **or** `canAddOrder` |
| GET | `/api/health` | `{ ok: true }` — no role header needed | — |
| GET | `/uploads/*` (not under /api) | Static files, `immutable`, `max-age 365d`, 404 on missing | public |

---

## 4. Screens and routes

Routing lives in `client/src/App.tsx`. Pages are lazy-loaded (`React.lazy`). Changing the role re-mounts the whole
router (`key={role}`) and clears the React Query cache. Breakpoints (Tailwind): `sm 480`, `md 768`, `lg 1024`,
`xl 1280`, `2xl 1536`.

### App shell (`AppLayout`, all routes except `/orders/new`)

- **Phone (<768):** sticky top bar (logo, page title, role tag, avatar) + fixed **bottom nav** with 4 tabs
  (Orders, Customers, Materials, Designs). Pages leave bottom padding for the nav.
- **Tablet (768–1023):** left **icon rail** (76px), with an Expand/Collapse button at the bottom. The expanded
  state is saved in localStorage `rivoora.sidebar.expanded`. No bottom nav.
- **Desktop (≥1024):** always-expanded 256px sidebar with logo, "Rivoora Textile / Order management" and the 4 links.
- **Top bar:** page title (set with `usePageTitle`, which also sets `document.title`), `RoleTag` (gold pill with
  "Owner"/"Partner"), and `ProfileMenu`.
- **ProfileMenu:** avatar (initial on maroon with gold ring) + name/title (≥480px). The dropdown shows the current
  user and a "Switch role" radio list (Jemish — Owner, Gaurang — Partner). Switching saves to localStorage
  `rivoora.role`, clears the cache, shows a toast and navigates to `/orders`.
- `/` redirects to `/orders`. Unknown paths → `NotFoundPage`. A crash or failed lazy chunk → `RouteError`
  ("A new version is available" + Reload button for chunk errors).

### `/orders` — Orders list (`features/orders/orders-page.tsx`)

- **Toolbar:** `SearchBar` ("Search by client, order no, design, quantity, material…", debounced 300 ms),
  a spinner while refetching, a filter icon button with an active-count badge, and an **Add Order** button
  (md+ only, `canAddOrder` only).
- **Filter chips** below the toolbar (status / material / date range), each removable, plus "Clear all".
  All filters and the search live in the URL (`q`, `status`, `material`, `from`, `to`), so they survive
  going to a detail page and back.
- **Filter dialog** (`OrderFiltersDialog`): **full screen on every breakpoint** (content max-w-2xl). Fields:
  Status multi-select (only shown if the role can see more than one status, so it's hidden for Gaurang),
  Order date with preset pills (Today / Last 7 days / This month) + `DateRangePicker`, and Material multi-select
  with server search. The footer has "Clear all" (clears the draft) and "Apply".
- **List:** a **card grid on every breakpoint**: 1 column on phones, 2 at md, 3 at lg, 4 at xl, 5 at 2xl.
  Each card shows `#N` + `StatusBadge`; a 64px design thumbnail (variation or design, no lightbox) next to the
  client name and "Design <code>" / "No design"; then Quality, Quantity (with unit) and Date. The whole card
  opens `/orders/:id`. Pending cards show a full-width **"Send for production"** button (`canSendToProduction`
  only); the button stops the click from opening the order.
- **Pagination:** infinite scroll with an IntersectionObserver (400px margin) plus a "Load more" fallback button
  and a "Showing X of Y orders" line.
- **Selection mode** (starts from a card's Send button): that order is pre-selected. Pending cards get a checkbox
  and toggle when clicked. Non-pending cards are dimmed (opacity 40%) and can't be clicked. The row buttons and the
  FAB are hidden. An info banner appears. The **action bar** is fixed above the bottom nav on phones and sticky at
  the bottom of the list on md+. It has "N of M pending selected" (≥480px), **Select all pending** (only covers the
  pages loaded so far), **Cancel**, and **Send for production (N)** (disabled at 0). Escape exits selection mode.
  Confirm dialog: "Send N orders for production?" → one API call → toast "N orders sent for production" → exit
  selection mode. The cache is patched to the new status, then refetched.
- **FAB** (phone only, `canAddOrder`, hidden in selection mode) → `/orders/new`.
- **States:** skeleton cards; `ErrorState` with Retry; empty states: "No orders match your search/filters"
  (+ Clear filters), "No orders yet — add your first order" (+ Add Order, Jemish), "No orders ready for
  production yet" (Gaurang).

### `/orders/new` — Add Order (`features/orders/add-order-page.tsx`)

This is a full-screen route **outside** the app layout (no sidebar or nav). If the role lacks `canAddOrder` it
redirects to `/orders`.

- **Header:** close (X) → `/orders`, the title "New order", and a **"Save order"** button on md+ only.
- **Form** (max-w-3xl, centred), in section cards:
  1. **Client & material** (2 columns at md+): *Client name* (required; searchable `Select` with server search and a
     **➕** button beside it that opens `CustomerFormDialog`; after saving, the new customer is selected and the rest
     of the form is kept) and *Material / Quality* (required; searchable). If a design with a default material is
     picked, the material is pre-selected and a hint "Pre-selected from design X" appears. The user can still
     change it.
  2. **Design**: with nothing attached there are two tiles: **Upload design image** (`ImageDropzone`,
     tap = camera/gallery on phones, drag-drop on desktop) and **View saved designs** (opens the drawer). Once
     attached, a card shows the thumbnail (tap → lightbox) and either
     - *saved*: "Design"/"Variation" label + code, **Change** (reopens drawer), **Remove**; or
     - *upload*: a required **Design code** input with a **live availability check** (debounced 400 ms via
       `/designs/check-code`; the hint says "X is available — it will be saved to Design Master" or "This code is
       already used"), **Change image**, **Remove**.
  3. **Quantity & pricing**: *Quantity* (required, decimal, > 0) with a fixed **unit** `Select` beside it
     (meters default, kg, pcs, g); *Rate* (optional, ₹ prefix, "per unit" hint, shown only when `canSeeRate`);
     *Order date* (`DatePicker`, defaults to today).
  4. **Notes**: a textarea with a toolbar holding a **disabled mic** (tooltip "Voice notes coming soon",
     opens on hover or tap) and an **image attach** button (multiple files, max 10). Attached images show as
     removable 80px thumbnails.
- **Sticky bottom bar:** Cancel + **Save** (both breakpoints; on phones they share a 2-column grid).
- **Save:** client-side zod validation with inline errors. Server field errors are mapped inline (including
  `designCode`/`newDesign.code` → design code field). While saving the button is disabled with a spinner.
  On success: toast "Order #N created" → `/orders`.
- **Unsaved changes:** `useBlocker` shows "Discard this order?" (Discard / Keep editing) for in-app navigation, and
  `beforeunload` covers tab close or reload.

### Saved designs drawer (`features/orders/saved-designs-drawer.tsx`)

- **Phone:** full screen (back arrow). **md+ (≥768):** slides in from the **right**, `max-w-[540px]`, with a
  dimmed backdrop.
- Header "Saved designs", search box ("Search design or variation code…", debounced), and tabs:
  - **Previous orders** (the default tab when a client is selected): tiles from `/customers/:id/previous-designs`
    showing thumbnail, code, `#orderNo · date`, and "N×" if the design was used more than once. The search filters
    **client-side**. Empty states: "Select a client to see their previous designs", "No previous designs",
    "No previous designs match your search".
  - **Design library**: server-searched, paginated grid of `DesignCard`s (2 columns, 3 at ≥480px). Tapping one opens
    the variations view: "All designs" back link, code/name/material, and tiles for **Base design** + each
    variation.
- The currently attached design is highlighted with a check mark. Picking a tile closes the drawer and attaches it
  (and its default material, if any).

### `/orders/:id` — Order details (`features/orders/order-details-page.tsx`)

- "← Orders" back link: goes back in history, which keeps the list filters, or to `/orders` on a direct visit.
- Heading "Order #N" + status badge. An **Undo send for production** button appears only when `canUndoProduction`
  and the status is Ready. It opens a confirm dialog ("Move order #N back to Pending for production?" → "Move back"),
  then a toast.
- Layout: a single column on phone/tablet. At lg+ it has two columns (`1fr | 360px`).
  - **Order details** card: client (+ city), phone (a `tel:` link), material (+ code), quantity with unit,
    **rate only if the API returned it**, order date.
  - **Notes** card: text + note image thumbnails (lightbox).
  - **Dates** card: Created (date + time), Sent to production (or "Not yet").
  - **Design** card (right column): a large square image (lightbox loads the full image), the code, and
    "Variation of D101 · name" when a variation is set; otherwise "No design attached".
  - **Status history** card: a timeline, newest first. It says "Order created", "Moved to X" or
    "Moved back to X" (when the sequence goes down), with date/time and "by <role name>".
- 404 → "Order not found — it may not exist or isn't visible for your role."

### `/customers` — Customer Master (`features/masters/customers/`)

- Toolbar: search ("name, phone or city"), **Add Customer** button (md+) / FAB (phone). The add controls only
  appear when `canManageMasters`.
- **md+ (from 768, so tablets too):** a table inside a card with a sticky header. Columns: Name, Phone, City,
  GST number (lg+), Email (xl+), and Edit/Delete icon buttons. **Phone:** cards (name, phone, city) with the same
  icons.
- Clicking a row opens the form: **Add / Edit customer** for Jemish, **Customer details** (read-only fieldset,
  Close button only) for Gaurang.
- `CustomerFormDialog`: full screen on every breakpoint (content max-w-3xl). Fields: Name*, Phone, Alternate
  phone, Email, City, Address, GST number, Notes. It can't be dismissed by an outside click while dirty.
  The same component is reused by the Add Order ➕.
- Delete → confirm dialog → soft delete. If the customer is in use, a toast shows the server's 409 message.

### `/materials` — Material Master (`features/masters/materials/materials-page.tsx`)

- Same list scaffold (`MasterList`). Table columns: Name, Code, Notes. Phone cards show the name + code and a
  one-line notes preview.
- Form (full screen, max-w-2xl content): Name (quality)*, Code, Notes. It's read-only for Gaurang.
- Delete is the same as customers (409 if used in orders).

### `/designs` — Design Master grid (`features/masters/designs/designs-page.tsx`)

- Search ("design or variation code") + **Add Design** (button/FAB, `canManageMasters`).
- A thumbnail grid on **every** breakpoint: 2 columns on phones, 3 at ≥480px, 4 at lg, 5 at xl. `DesignCard` shows a
  square thumbnail, code, "name · material", and a gold badge with the variation count.
- Add Design form → after saving, navigates to the new design's page.

### `/designs/:id` — Design detail (`features/masters/designs/design-detail-page.tsx`)

- "← All designs" link. Top card: a square image (lightbox; 300px column at md+), code, name, **Edit** / **Delete**
  (`canManageMasters`), Material / Quality ("Any material" if none), variation count, "Added on", notes.
- **Variations** card: a grid (2 columns on phones, 3 at ≥480px, 5 at lg) of thumbnails + code, each with an ✕
  remove button (confirm dialog, hard delete, 409 if used), plus an **Add variation** tile.
- `DesignFormDialog` (full screen): image (dropzone or preview with Change/Remove), Design code* (the server checks
  uniqueness; this form has no live check), Name, **Material / Quality** (optional searchable select with a clear
  ✕ button; the hint explains it pre-selects on new orders), Notes.
- `VariationFormDialog` (full screen): Variation image* + **Variation code*** typed by the user, with a live
  availability check. The placeholder suggests `<DESIGN>N<next no>`.
- Delete design → confirm → soft delete → `/designs`. A 409 if it's used in orders.

---

## 5. Status and role configuration (current values)

### `shared/src/statuses.ts`

| key | label | sequence | badge bg / text / dot | visibleTo |
|---|---|---|---|---|
| `pending_production` | Pending for production | 10 | `#FEF3C7` / `#92400E` / `#F59E0B` (amber) | `['jemish']` |
| `ready_production` | Ready for production | 20 | `#DCFCE7` / `#166534` / `#22C55E` (green) | `FROM_READY` = `['jemish','gaurang']` |

Helpers: `getStatus(key)` (unknown keys fall back to a grey badge), `isStatusKey`, `statusesForRole(role)`
(sorted by sequence), `visibleStatusKeys(role)`, `canRoleSeeStatus(role, status)`, and the constant
`STATUS.PENDING_PRODUCTION / READY_PRODUCTION`. The only transitions are Pending → Ready (send) and
Ready → Pending (undo), both via `changeStatus()` in `server/src/services/orders.ts`.

### `shared/src/roles.ts`

| Permission | jemish (Jemish — Owner, "J") | gaurang (Gaurang — Partner, "G") |
|---|---|---|
| `canSeeRate` | ✅ | ✅ |
| `canAddOrder` | ✅ | ❌ |
| `canSendToProduction` | ✅ | ❌ |
| `canUndoProduction` | ✅ | ❌ |
| `canManageMasters` | ✅ | ❌ |

`DEFAULT_ROLE = 'jemish'`, `ROLE_HEADER = 'X-Role'`. Order visibility isn't a permission; it comes from each
status's `visibleTo`. `client/src/config/roles.ts` and `server/src/config/roles.ts` just re-export the shared file.

---

## 6. Design system

### Theme tokens (`client/src/index.css`, HSL channels, mapped in `tailwind.config.ts`)

| Token | Value | Hex / meaning |
|---|---|---|
| `--background` | 210 40% 98% | #F8FAFC page background |
| `--foreground` | 222 47% 11% | slate-900 text |
| `--card` / `--card-foreground` | white / 222 47% 11% | |
| `--primary` | 342 64% 33% | **#8B1E3F maroon** |
| `--primary-hover` / `--primary-active` | 342 64% 29% / 25% | darker shades |
| `--primary-soft` | 342 60% 96% | tinted backgrounds (active nav, chips, selection) |
| `--primary-foreground` | white | |
| `--accent` | 46 68% 47% | **#C9A227 muted gold** |
| `--accent-soft` / `--accent-foreground` | 46 80% 94% / 36 60% 20% | role tag, variation badge |
| `--muted` / `--muted-foreground` | 210 40% 96% / 215 16% 47% | |
| `--border` / `--input` | 214 32% 91% / 214 28% 86% | |
| `--ring` | = primary | focus ring (used at 40% alpha) |
| `--destructive` / `-soft` / `-foreground` | 0 72% 45% / 0 86% 97% / white | |
| `--radius` | 0.75rem (12px) | `rounded-lg`; inputs/buttons/dropdowns use `rounded-[10px]` |

Other theme settings:
- **Font:** DM Sans (Google Fonts, weights 400–700), with a system sans-serif fallback. `font-feature-settings: 'ss01'`.
- **Shadows:** `shadow-soft` (cards) and `shadow-pop` (popovers, modals, FAB).
- **Spacing:** `bottom-nav` = `4rem + safe-area`.
- **Utility classes:** `.page-container` (max 1920px, 16/24/32/40px gutters), `.pb-safe`, `.scrollbar-thin`.
- **Other:** `react-day-picker` is themed to primary with 40px days (36px under 380px). The number-input spinners
  are hidden. Status badge colours come from the status config, not from tokens.

### Formatting helpers (`client/src/lib/format.ts`)

- `formatDate` → `dd-MM-yyyy`
- `formatDateTime` → `dd-MM-yyyy, hh:mm a`
- `formatMoney` → `₹1,25,000.00` (en-IN)
- `formatQuantity` → `250 meters` (up to 3 decimals)
- `formatOrderNo` → `#N`
- `toApiDate` → `yyyy-MM-dd`

### Shared UI components (`client/src/components/ui/`)

| Component | Description |
|---|---|
| `button.tsx` — `Button`, `buttonVariants` | cva button; variants `primary`, `secondary`, `ghost`, `soft`, `destructive`, `link`; sizes `sm`, `md` (44px), `lg`, `icon`, `icon-sm`; `loading` shows a spinner and disables; `asChild` via Radix Slot. |
| `input.tsx` — `Input`, `NumberInput`, `Textarea`, `fieldBase` | Soft-grey rounded fields with a primary focus ring; `Input` supports `prefix`/`suffix`; `NumberInput` uses `inputMode="decimal"` and keeps a string value. |
| `field.tsx` — `Field` | Label (+ required asterisk) + control + inline error or hint. |
| `select.tsx` — `Select`, `MultiSelect` | **The standard dropdown**, used for every select. It's a Radix Popover the width of the trigger, with a chevron that flips and a primary border when open, and a check mark on selected items. Options: `searchable` combobox, `onSearchChange` for server search, `loading`, `emptyText`, `action` slot beside the trigger (➕). Keyboard: arrows, Home/End, Enter, Escape. The panel is capped to the viewport. |
| `modal.tsx` — `Modal`, `ResponsiveModal` | Radix Dialog with variants `center`, `right`, `bottom`, `fullscreen`; `size` sets the dialog width (center) or content width (fullscreen). Full-screen and right sheets get a back arrow on phones; `dismissible=false` blocks outside-click close. `ResponsiveModal` defaults to `fullscreen` on every breakpoint. |
| `confirm-dialog.tsx` — `ConfirmDialog` | Small centred confirmation with Cancel / Confirm (optionally destructive, with loading state). |
| `date-picker.tsx` — `DatePicker`, `DateRangePicker` | Popover + react-day-picker (weeks start Monday); the range picker has a clear ✕ and a Done button. |
| `image-thumb.tsx` — `ImageThumb`, `Lightbox` | Lazy thumbnail with a pulse placeholder and fallback icon; tapping opens a full-screen lightbox that loads the **full** image only then. |
| `image-upload.tsx` — `ImageDropzone`, `ImagePickButton`, `uploadImage`, `validateImage` | Client-side type/size check (10 MB) and upload to `/api/uploads`, with toasts on failure. The dropzone supports drag-drop and tap (camera/gallery); the pick button supports `multiple`. |
| `status-badge.tsx` — `StatusBadge` | Pill with a coloured dot; colours and label come from the status config. |
| `checkbox.tsx` — `Checkbox` | Radix checkbox in primary colours. |
| `dropdown-menu.tsx` — `DropdownMenu*` | Radix dropdown menu wrappers (used by the profile menu). |
| `tabs.tsx` — `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` | Radix tabs in a segmented-control style. |
| `tooltip.tsx` — `Tooltip`, `TooltipProvider` | Radix tooltip that also opens on tap for touch devices. |
| `empty-state.tsx` — `EmptyState` | Centred icon + title + description + optional action. |
| `skeleton.tsx` — `Skeleton` | Pulsing grey block. |

Other shared components:
- **`components/list-parts.tsx`:** `SearchBar` (search input with clear ✕), `LoadMore` (infinite-scroll sentinel,
  "Load more" fallback button and "Showing X of Y"), `ErrorState` ("Couldn't load this" + Retry), `Fab` (phone-only
  floating + above the bottom nav), `FetchingIndicator` (small spinner).
- **Layout (`components/layout/`):** `AppLayout` (sidebar/rail + top bar + bottom nav), `ProfileMenu`, `RoleTag`,
  `Avatar`, `Logo`, `PageSkeleton`, `PageTitleProvider` / `usePageTitle`, `NAV_ITEMS`.
- **Feature-level reusables:** `MasterToolbar` / `MasterList` (table on md+, cards on phone, row actions, all states),
  `useDeleteFlow` (confirm + soft delete), `DesignCard` / `DesignGridSkeleton`, and `useCodeAvailability` /
  `designCodeField`.

---

## 7. Differences from the original spec (`rivoora-claude-code-prompt.md`)

### Data model / naming

| Spec | Current code |
|---|---|
| Variation `code` "auto-generated" as design code + `N` + number, "shown read-only", generated on the server | **Typed in by the user** when adding a variation. `variationCode()` only supplies the placeholder (and seed codes). `variation_no` is still auto-assigned. Variation codes are **not** renamed if the design code changes. |
| Design code unique among designs | Design codes **and** variation codes share one namespace (checked in app code); codes are normalized (upper-case, spaces removed, `A-Z0-9_-/.` only). |
| designs: `code, name, image_url, thumb_url, notes` | **Added `designs.material_id`** (optional default material, migration 0001). Picking such a design on a new order pre-selects the material. Deleting a material unlinks it from designs. |
| Indexes listed in §5 | All present. **Extra:** partial unique indexes for material name / design code, `orders_design_idx`, `design_variations_code_idx`, `design_variations(design_id, variation_no)` unique, `designs_material_idx`. |
| Thumbnail "~300px" | 320×320 (cover crop). |
| Customer phone "10-digit Indian number" | Stricter: must start with 6–9 after `+91`/`0` is stripped. |

### UI flow changes

| Spec | Current code |
|---|---|
| Orders on desktop: **table** (Order No, Client, Date, Quantity, Status, Quality, Action), sticky header; cards only on mobile | **Card grid on every breakpoint** (1–5 columns). No table. |
| Order cards: `#N`+status, client, material · qty, date, action | Adds a **64px design thumbnail + design/variation code**; details in a labelled 2-column grid. |
| Search: client, quantity, order no, material | **Also searches design and variation codes**; a leading `#` is ignored. |
| Filters: modal on desktop, **bottom sheet on mobile** | **Full-screen dialog on every breakpoint.** The Status filter is hidden when the role can see only one status (Gaurang). |
| Master add/edit forms: modal on desktop, full screen on mobile | **Full screen on every breakpoint** (content centred at a readable width). Confirmations stay small centred dialogs. |
| Saved designs drawer: right drawer on desktop, full screen on mobile | As specified, but the right drawer starts at **md (768px)**, so tablets get it too. |
| Master lists: desktop table / mobile cards | Tables start at **md (768px)**, so tablets use the table too. **Designs** use a thumbnail grid on every breakpoint. |
| Add Order: sticky bottom bar with Save + Cancel | As specified, **plus** a duplicate "Save order" button in the header on md+. |
| Add Order ➕ opens the Add Customer flow and returns | Implemented as the same `CustomerFormDialog` opened on top of the Add Order page (no navigation), so the form state is kept. |
| Uploaded design: ask for a design code | Adds a **live availability check** of the code while typing. |
| Previous-orders tab "paginated / infinite scroll" | Not paginated: max 60 items. Search is client-side. Items show a "N×" times-used count. The library tab is paginated. |
| Order details: order no, status, client name/phone, material, design, qty, rate, date, notes, note images, created, sent-to-production, history | All present. **Also shows** client city, material code, "Variation of <design>" line, the role that made each history change, and date **and time** for created/sent. |
| Select all pending | Selects only pending orders **on pages already loaded**, not all pending orders on the server. |
| Tablet sidebar "collapsible" | Icon rail that expands; the state is remembered in localStorage. |
| Masters: open a row | Clicking a customer/material opens its edit form (Jemish) or a read-only details form (Gaurang). Designs have a dedicated detail route `/designs/:id`. |

### Added features (not in spec)
- Design default material (see above) and the material shown on design cards and detail.
- `GET /designs/check-code` and live code checks (Add Order upload, variation form).
- URL-persisted order filters; back navigation keeps the list state.
- Role switch shows a toast and navigates to `/orders`; the router re-mounts per role.
- The `RouteError` page detects a stale-deploy chunk error.
- `Button` has `soft` and `link` variants.
- `GET /api/health`.
- In production, the Express server serves the built client.

### Removed / not implemented from spec
- **Optimistic updates:** the spec asked for them "where safe". Send-to-production only patches the cache **after**
  the server responds; there are no true optimistic updates.
- **Bottom-sheet variant:** exists in `Modal` (`variant="bottom"`) but nothing uses it.
- Everything else in the Sprint 1 checklist is present.

---

## 8. Known issues, TODOs and shortcuts

### 8.1 Repository state
- **Uncommitted work in the tree:** design default material, typed variation codes, the variation form, and
  orders/drawer tweaks (15 modified files, `+292/−96`). Also untracked: `client/src/features/masters/designs/variation-form.tsx`,
  `server/drizzle/0001_curious_mulholland_black.sql` and `server/drizzle/meta/0001_snapshot.json`. Commit these
  together (migration + code) and make sure `npm run db:migrate` has been run against Turso.
- No automated tests, no ESLint/Prettier setup (the code has `eslint-disable` comments, but ESLint isn't installed).
- `CLAUDE.md` says "desktop ≥1024 … master lists still use tables". In the code, master tables start at **768px**.

### 8.2 Not built yet (planned for next sprints)
- Login/auth: the role is just a client-chosen `X-Role` header, so **anyone can impersonate any role** by setting
  it. There is no CORS config or rate limiting.
- Statuses after Ready for production (In production … Completed) and their transition endpoints.
- Further order actions: **no edit or delete of orders** (and no UI or endpoint to change an order's
  design/quantity after creation).
- Voice notes: the mic icon is a placeholder (tooltip "Voice notes coming soon"). This is the only "coming soon"
  marker in the code; there are no `TODO`/`FIXME` comments.
- **Orphaned uploads are never cleaned up:** images uploaded then abandoned (form cancelled, image replaced or
  removed, design soft-deleted, variation hard-deleted) stay on disk.
- No endpoint or UI to **edit a variation** (image or code); you have to delete it and add it again (only if unused).

### 8.3 Shortcuts / risks in the current implementation
- **Order number race:** `MAX(order_no)+1` runs inside the transaction, with a unique index as the backstop. Two
  truly concurrent creates could collide; the loser gets a generic **409 "A record with the same value already
  exists"**. There's no retry.
- **Variation / design code uniqueness across the two tables is app-level only.** Concurrent requests could create
  duplicates, because there's no DB constraint on `design_variations.code`.
- The generic UNIQUE-constraint handler in `middleware/error.ts` hides which field conflicted (no `field` in the
  response).
- **Uploads are stored on local disk** (`server/uploads`). They aren't in git or the DB, so moving or redeploying
  the server loses user images. There's a driver interface ready for R2/S3 (`server/src/storage/index.ts`).
- **HEIC/HEIF** are accepted by the filter, but they only work if the installed sharp/libvips supports HEIF;
  otherwise the user gets "This image could not be read…".
- `previous-designs` isn't filtered by the caller's role or status visibility (Gaurang could see designs from a
  client's pending orders through this endpoint, though not the orders themselves). The UI only calls it from the
  Add Order page (Jemish).
- `design-form.tsx` (design edit/create) has no live code check; the conflict shows only after submit (409 inline).
- The lookup endpoints return at most 30 customers / 50 materials with no paging. Beyond that, users must type to
  search.
- `drizzle.config.ts` loads `.env` from the current directory. That works through `npm run db:generate`
  (cwd = `server/`), but not if drizzle-kit is run from the repo root directly.
- Deleting a variation doesn't check whether its parent design is soft-deleted (harmless: the design page 404s first).
- `order_status_history` has both `changed_at` and `created_at` (redundant).
- Rate is visible to both current roles by config. Any new role must keep `canSeeRate: false` unless allowed; the
  list endpoint never returns rate regardless of role.
