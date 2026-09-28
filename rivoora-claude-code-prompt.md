# Rivoora Textile — Order Management System (Sprint 1)

Build a complete, production-quality, fully responsive web app from scratch for **Rivoora Textile**, a textile company that makes sarees and clothes on its own power looms. Sprint 1 covers **order management and order tracking** plus the **masters** that orders depend on. Everything must be connected to a real **Turso (libSQL)** database.

**How to work:**
- Start in plan mode. Read this whole document, then show me your plan (folder structure, database schema, API endpoints, screens, build phases) before writing code.
- After I approve, build **phase by phase** (see "Build phases" at the end). At the end of each phase, run the app, fix all errors and TypeScript warnings, and give me a short summary.
- Create a root `CLAUDE.md` that documents the architecture, how to run the project, conventions, the status system and the database setup, so future sessions can continue development smoothly. Keep it updated as you build.

---

## 1. Tech stack

**Frontend (`/client`)**
- Vite + React 18 + TypeScript
- Tailwind CSS + shadcn/ui (Radix primitives) for components
- React Router for routing
- TanStack Query (React Query) for all server data: caching, pagination, invalidation
- react-hook-form + zod for forms and validation
- lucide-react icons
- date-fns for dates
- sonner (or shadcn toast) for toasts

**Backend (`/server`)**
- Node.js + Express + TypeScript
- `@libsql/client` + **Drizzle ORM** for Turso, with **drizzle-kit migrations** (schema kept in code, migrations committed)
- multer for file uploads, sharp for image thumbnails
- zod for request validation

**Why a backend:** the Turso token has full read-write access, so it must **never** be in the frontend bundle. Only the server talks to Turso; the React app talks only to our API.

**Monorepo root**
- Root `package.json` with scripts: `dev` (runs client and server together using `concurrently`), `build`, `db:migrate`, `db:seed`.
- In dev, the Vite proxy forwards `/api` and `/uploads` to the server.

---

## 2. Database connection and environment

- `server/.env` (never committed):
  ```
  TURSO_DATABASE_URL=libsql://rivoora-textile-sarthak-palm.aws-ap-south-1.turso.io
  TURSO_AUTH_TOKEN=<I will paste the token here myself>
  PORT=4000
  ```
- Create `server/.env.example` with the same keys and empty values.
- `.gitignore` must include `.env`, `node_modules`, `server/uploads/*` (but keep `server/uploads/demo/` and a `.gitkeep`).
- Do **not** hardcode the URL or token anywhere in code. Read them only from env. Fail with a clear error message if they are missing.
- A single shared DB client module (`server/src/db/client.ts`) used everywhere.
- `npm run db:migrate` applies migrations; `npm run db:seed` inserts demo data (see section 11). Seeding must be safe to run twice (no duplicates).

---

## 3. Roles (no login in this sprint)

- There is **no login/authentication** yet.
- Top-right **profile menu** (avatar + name) contains a **role switch dropdown**:
  - **Jemish — Owner** (default)
  - **Gaurang — Partner**
- Selected role is saved in `localStorage` and sent to the API as a header (`X-Role: jemish | gaurang`). The server uses it to filter data, so visibility is enforced on the server, not only hidden in the UI.
- Put role permissions in **one config file** (`client/src/config/roles.ts`, mirrored on the server) so more roles can be added later.

| Capability | Jemish | Gaurang |
|---|---|---|
| See all orders (every status) | ✅ | ❌ |
| See orders from "Ready for production" onwards | ✅ | ✅ |
| Add order | ✅ | ❌ (no Add Order button / FAB at all) |
| Send for production | ✅ | ❌ |
| Undo send for production | ✅ | ❌ |
| See rate | ✅ | ✅ |
| Masters (Customer, Material, Design) | Full add/edit/delete | View only (assumption; keep it configurable) |

- **Rate** is visible only to these two roles (and never on the order listing). Any future role must not see rate unless explicitly allowed in the roles config. The API must omit `rate` from responses for roles that are not allowed to see it.

---

## 4. Order statuses (extensible)

Define statuses in **one central config** (e.g. `shared/statuses.ts`, used by both client and server) with: key, label, sequence number, badge colour, and which roles can see it.

Sprint 1 statuses:
1. `pending_production` — **Pending for production** (set when Jemish saves a new order)
2. `ready_production` — **Ready for production** (set when Jemish sends it for production)

More statuses will be added later, after "Ready for production", up to "Completed". Build everything (filters, badges, Gaurang's visibility rule, details screen) so a new status only needs to be added in the config, not rewritten across screens.

**Gaurang's visibility rule:** he sees orders whose status sequence is **≥ Ready for production** (from Ready for production up to Completed). He never sees "Pending for production" orders.

Keep a small `order_status_history` table (order_id, from_status, to_status, role, changed_at) and write to it on every status change, including undo.

---

## 5. Database schema (use Drizzle; adjust names if needed but keep the meaning)

All tables have `id`, `created_at`, `updated_at`. Masters use **soft delete** (`is_deleted`).

**customers**
- `name` (required), `phone`, `alternate_phone`, `email`, `address`, `city`, `gst_number`, `notes`

**materials** (material = "quality"; they are the same thing)
- `name` (required, unique among non-deleted), `code` (optional), `notes`

**designs**
- `code` (required, unique), `name` (optional), `image_url`, `thumb_url`, `notes`

**design_variations** (patterns = variations of a design)
- `design_id` (FK), `variation_no` (1, 2, 3…), `code` (auto-generated), `image_url`, `thumb_url`
- Variation code = design code + `N` + number. Example: design `D101` → variations `D101N1`, `D101N2`, `D101N3`. Generate it on the server; keep the format in one function so it can be changed later.

**orders**
- `order_no` — integer, auto-incrementing 1, 2, 3… (unique; generate safely on the server, never on the client)
- `customer_id` (FK, required)
- `material_id` (FK, required)
- `design_id` (FK, nullable), `variation_id` (FK, nullable) — what was picked or uploaded
- `quantity` — number (decimal allowed), required, > 0
- `unit` — enum: `kg`, `pcs`, `g`, `meters` (required)
- `rate` — number, optional (₹)
- `order_date` — date, defaults to today
- `notes` — text
- `status` — status key
- `sent_to_production_at` — nullable datetime

**order_note_images**
- `order_id`, `image_url`, `thumb_url`

**Indexes:** `orders(status)`, `orders(order_date)`, `orders(customer_id)`, `orders(material_id)`, `orders(order_no)`, `customers(name)`, `materials(name)`, `designs(code)`, `design_variations(design_id)`.

One order = one item (one material, one design, one quantity). No multi-line orders in this sprint.

---

## 6. Images and file uploads

- Uploads are saved on our own server in `server/uploads/` (subfolders: `designs/`, `notes/`), served statically at `/uploads/...`. The database stores **only the URL**, never the file.
- On upload, use sharp to:
  - convert to WebP, max width 1600px (full image)
  - create a ~300px WebP **thumbnail**
  - store both URLs
- Limits: images only (jpg, jpeg, png, webp, heic if supported), max 10 MB each; show a clear error otherwise.
- Keep the storage logic behind one module (`server/src/storage/`) so it can later be swapped to cloud storage (R2/S3) without touching the rest of the app.
- Grids, cards and the design drawer show **thumbnails only**; full images load only when the user opens/previews them. All images use `loading="lazy"` and a neutral placeholder while loading.

---

## 7. Performance (very important — the app must feel fast)

- **Server-side pagination** for orders and master lists (20 per page). Use infinite scroll with a "Load more" fallback on mobile, and pagination or infinite scroll on desktop.
- **Server-side search and filtering**; debounce the search input (300 ms).
- The order list API returns only the columns the list needs (joined customer name and material name in **one query**, no N+1 queries). Full details load only on the details screen.
- Dropdown data (customers, materials) comes from lightweight endpoints returning `id` + `name` (+ code), with server-side search for long lists.
- React Query caching with sensible `staleTime`; invalidate only affected queries after mutations; use optimistic updates where it's safe.
- Skeleton loaders instead of blank screens or full-page spinners.
- Route-level code splitting (`React.lazy`) for pages.
- No unnecessary re-renders or refetches on every keystroke.

---

## 8. UI and design system

**Overall look:** clean, modern, professional, calm. Plenty of white space, clear hierarchy, readable on small phones. It is used by business owners, so large tap targets and simple language matter more than decoration.

**Theme (put all colours as CSS variables / Tailwind theme tokens so it can be changed in one place):**
- Primary: deep maroon `#8B1E3F` (saree-inspired), with hover/active shades
- Accent: muted gold `#C9A227` — use sparingly (highlights, small badges)
- Neutrals: slate/gray scale; page background `#F8FAFC`; cards white
- Status badge colours come from the status config
- Font: **DM Sans** (Google Fonts), fallback system sans-serif
- Border radius: 10–12px for inputs, cards and modals
- Soft shadows only

**Standard dropdown component (use this everywhere — every select in the app):**
Build one reusable `Select` / `Combobox` component with this exact structure:
- Closed trigger: full-width input-style box, light gray border, rounded corners (~10px), soft background, gray placeholder text (e.g. "Select type"), chevron icon on the right.
- When open: trigger border changes to the **primary colour**, chevron flips to point up.
- Options panel opens directly below the trigger, same width, white background, rounded corners (~10px), soft shadow, thin light border.
- Options are a simple vertical list: left-aligned, medium-weight dark text, comfortable padding (~12px vertical, 16px horizontal), no dividers between items, light background on hover and on keyboard focus, and a subtle check mark / tinted background for the selected item.
- Searchable variant (combobox) for long lists (customers, materials): a search box at the top of the panel, "No results" state, and support for an **action next to the trigger** (e.g. a ➕ button).
- Fully keyboard accessible (arrow keys, Enter, Escape) and works well on touch devices. On mobile, the panel must fit the screen and never overflow off-screen.

**Other shared components:** Button (primary / secondary / ghost / destructive), Input, Textarea, Number input, Date range picker, Modal (dialog), Drawer / side sheet, Bottom sheet (mobile), Confirmation modal, Status badge, Empty state, Skeletons, Toasts, Image thumbnail with preview (lightbox).

**Layout and navigation:**
- **Desktop (≥ 1024px):** left sidebar with the app name "Rivoora Textile" and links: Orders, Customers, Materials, Designs. Top bar with page title and profile menu (role switch).
- **Tablet (768–1023px):** collapsible sidebar (icon rail).
- **Mobile (< 768px):** top app bar (title + profile avatar) and a **bottom navigation bar** with the same links. No sidebar.
- Show the current role clearly in the profile menu and as a small tag in the top bar.

**Formatting:**
- Dates: `dd-MM-yyyy` (Indian style)
- Money: Indian format with ₹ (e.g. ₹1,25,000.00)
- Quantity shown with unit (e.g. `250 meters`, `40 pcs`, `12.5 kg`)
- Order number shown as `#1`, `#2`…

**Responsiveness rule:** nothing may break, overflow horizontally, or get cut off on a 360px-wide phone. Test every screen at 360px, 768px and 1280px.

---

## 9. Orders module

### 9.1 Order list (Jemish view)

**Top bar (desktop):** page title "Orders", then in one row:
- **Search bar** — searches client name, quantity, order number and material name (server-side, debounced). Placeholder: "Search by client, order no, quantity, material…"
- **Filter icon button** next to it — opens the filter modal. Shows a small count badge when filters are active.
- **Add Order button** (primary) on the right.

**Mobile:**
- Search bar full width, filter icon beside it.
- Add Order becomes a **floating action button (FAB)** at the bottom-right, above the bottom navigation.

**Filters (modal on desktop, bottom sheet on mobile):**
- **Status** (multi-select; only statuses the current role can see)
- **Date range** (order date from–to, with quick picks: Today, Last 7 days, This month)
- **Material** (multi-select, searchable)
- Buttons: "Clear all" and "Apply". Active filters appear as removable chips under the search bar.

**Desktop grid (table) columns:**
| Order No | Client Name | Date | Quantity (with unit) | Status (badge) | Quality (material name) | Action |

- **Rate is never shown on the list.**
- Rows are clickable → open the Order Details screen.
- Default sort: newest first (highest order number first).
- Sticky table header; the table sits inside a card.

**Mobile list:** do not use a wide table. Show each order as a **card**:
- Top line: `#12` and status badge
- Client name (bold)
- Material/quality · Quantity with unit
- Date
- Action button (if any) at the bottom of the card
- Whole card is tappable to open details.

**Empty states:** "No orders yet — add your first order" (with Add Order button for Jemish), and "No orders match your search/filters" (with Clear filters).

### 9.2 Send for production flow (Jemish only)

1. Every order with status **Pending for production** shows a small **"Send for production"** button in its Action column (on mobile: at the bottom of its card). Clicking it must not open the details screen.
2. Clicking it switches the list into **selection mode**:
   - That order is automatically selected (checked).
   - A checkbox appears on every **Pending for production** order; they stay selectable for **multi-select**.
   - All other orders (any other status) are **disabled**: greyed out, not selectable, not clickable.
   - The row buttons are hidden while in selection mode.
3. A **selection action bar** appears (desktop: sticky at the top or bottom of the list; mobile: fixed at the bottom above the nav, replacing the FAB) with:
   - **"Send for production (N)"** — N is the live count of selected orders
   - **"Select all pending"** (optional helper) and **"Cancel"** (exits selection mode, clears selection)
4. Clicking "Send for production (N)" shows a confirmation modal: "Send N orders for production?" with Confirm / Cancel.
5. On confirm:
   - One API call updates all selected orders to **Ready for production**, sets `sent_to_production_at`, and writes status history (in one DB transaction).
   - Toast: "N orders sent for production".
   - Exit selection mode and refresh the list.
   - These orders now appear in Gaurang's Orders module.
6. If N becomes 0, disable the send button.

### 9.3 Order list (Gaurang view)

- Same screen, same design, same search and filters, same columns, same mobile cards.
- Shows **only** orders with status from **Ready for production** onwards (server-enforced).
- **No Add Order button and no FAB.**
- **No "Send for production" button** and no selection mode.
- Clicking an order opens the same details screen with all details (including rate), but without Jemish-only actions.

### 9.4 Add Order screen (Jemish only)

Opens as a **full-screen view** (its own route, e.g. `/orders/new`) with a back/close button and a sticky bottom bar containing **Save** (primary) and **Cancel**. On desktop, the form is centred with a comfortable max width, and fields can sit in two columns where it makes sense; on mobile it's a single column.

**Fields:**

1. **Client name** (required) — searchable dropdown from Customer Master, with a **➕ button beside it**.
   - ➕ opens the **Add Customer flow from Customer Master** (same form).
   - After saving the new customer, return to the Add Order screen with **all previously filled values preserved** and the **new customer selected** automatically.
2. **Material / Quality** (required) — searchable dropdown from Material Master.
3. **Design** — a "Design" section with two options:
   - **Upload design image** — pick/drag an image (on mobile, allow the camera or gallery). When uploading, also ask for a **design code** (required, unique) in a small field. On save, this uploaded design is **automatically saved into Design Master** as a new design and linked to the order.
   - **"View saved designs"** button — opens the **Saved Designs drawer** (see 9.5).
   - Once a design or variation is attached, show a card with the thumbnail, the code (e.g. `D101N2`), and "Change" / "Remove" actions. Tapping the thumbnail opens a full-size preview.
4. **Quantity** (required) — numeric input (decimal allowed, > 0), with a **fixed unit dropdown right beside it**: `kg`, `pcs`, `g`, `meters` (required; default `meters`). Uses the standard dropdown component.
5. **Rate** (optional) — numeric input with ₹ prefix. Visible only to Jemish and Gaurang.
6. **Order date** — defaults to today, editable.
7. **Notes** — multiline textarea with two icons in its toolbar:
   - **Microphone icon** — shown **for reference only**. It is visually present but disabled/greyed; on hover (desktop) or tap (mobile) show a tooltip: "Voice notes coming soon". It records nothing and stores nothing.
   - **Image attach icon** — attach one or more images to the note (uploaded via the upload API, shown as removable thumbnails below the textarea).

**Save:**
- Validate with zod; show inline error messages under fields.
- Disable Save while saving and show a spinner on the button; prevent double submission.
- On success: the order is created with the next order number and status **Pending for production**; toast "Order #N created"; go back to the order list, where it appears at the top.
- If the user tries to leave with unsaved changes, ask for confirmation.

### 9.5 Saved Designs drawer

- **Desktop:** slides in from the **right** (about 480–560px wide) over the Add Order screen, with a dimmed backdrop.
- **Mobile:** opens **full screen**, with a back/close button.
- Header: "Saved designs", a search box (search by design code or variation code), and a close button.
- Two tabs/sections:
  1. **Previous orders (this client)** — designs used in earlier orders of the **currently selected client** (most recent first), each showing thumbnail, code, and the order number/date it was used in. If no client is selected yet, show "Select a client to see their previous designs". If the client has no previous orders, show a friendly empty state.
  2. **Design library** — all designs from Design Master as a thumbnail grid (2 columns on mobile, 2–3 on desktop). Tapping a design shows its **variations** (N1, N2, N3…) with their thumbnails and codes. The user can choose either the **base design** or a **specific variation**.
- Selecting an item closes the drawer and attaches the image and code to the order form.
- Paginated / infinite-scroll with lazy-loaded thumbnails.

### 9.6 Order Details screen

- Opens when any order row/card is clicked (route `/orders/:id`), for both roles.
- Shows all order details: order number, status badge, client (name, phone), material/quality, design image (tap to enlarge) and code, quantity with unit, rate (only for allowed roles), order date, notes, note images, created date, sent-to-production date, and a simple **status history timeline**.
- **Undo send for production (Jemish only):** when the order status is **Ready for production**, show an "Undo send for production" button. Clicking it shows a **confirmation modal** ("Move order #N back to Pending for production?"). On confirm, the status goes back to **Pending for production**, `sent_to_production_at` is cleared, and history is recorded. Toast on success. The order then disappears from Gaurang's list.
- Keep this screen's layout simple and structured in sections (cards) so more actions and details can be added later. Other actions on this screen will be defined in the next sprint — do not invent extra actions.

---

## 10. Masters

Each master has: a list page (search, pagination, desktop table / mobile cards), Add and Edit forms (modal on desktop, full screen on mobile), and Delete (soft delete, with confirmation modal). **Block deleting** a record that is used by any order, and show a clear message explaining why. For Gaurang, masters are read-only (hide add/edit/delete).

### 10.1 Customer Master
- Fields: **Name (required)**, Phone, Alternate phone, Email, Address, City, GST number, Notes.
- Validate phone (10-digit Indian number) and email format only when filled.
- The Add Customer form must be reusable, so the ➕ button on the Add Order screen uses the same form and returns to the order with the new customer selected.

### 10.2 Material Master
- Fields: **Name (required, unique)**, Code (optional), Notes.
- List columns: Name, Code, Notes (truncated).

### 10.3 Design Master
- Fields: **Design image**, **Design code (required, unique)**, Name (optional), Notes.
- **Variations:** inside a design, the user can add multiple variations, each with its own image. Variation codes are auto-generated as design code + `N1`, `N2`, `N3`… (e.g. `D101N1`), shown read-only. Variations can be removed (if not used in any order).
- List page shows a **thumbnail grid** of designs with code and variation count. Opening a design shows its image and variations.
- Designs uploaded from the Add Order screen appear here automatically.

---

## 11. Seed / demo data (`npm run db:seed`)

- **Demo design images:** generate about 6 simple, attractive pattern images programmatically (e.g. with sharp from SVG: stripes, checks, paisley-like dots, borders in saree colours) and save them to `server/uploads/demo/`. No downloading from the internet.
- Create 6 designs (`D101`–`D106`) using those images, each with 2–3 variations (colour-shifted versions of the same pattern) with codes like `D101N1`, `D101N2`.
- About 8 customers with Indian names and cities (Surat, Ahmedabad etc.), about 6 materials (e.g. Georgette, Chiffon, Silk, Cotton, Crepe, Rayon).
- About 25 orders across customers, materials, units and both statuses, with some repeat orders of the same design for the same customer (to test the "Previous orders" section).

---

## 12. API (REST, JSON, all under `/api`)

Suggested endpoints (you may refine them):
- `GET /api/orders?search=&status=&from=&to=&material=&page=&limit=` — list (role-filtered, lean fields, no rate)
- `GET /api/orders/:id` — full details (rate only for allowed roles; role-checked visibility)
- `POST /api/orders` — create (Jemish only)
- `POST /api/orders/send-to-production` — body `{ orderIds: [] }` (Jemish only; only affects orders currently Pending for production; transactional)
- `POST /api/orders/:id/undo-production` — (Jemish only; only if Ready for production)
- `GET /api/customers/:id/previous-designs`
- CRUD: `/api/customers`, `/api/materials`, `/api/designs`, `/api/designs/:id/variations`
- Lightweight lookups: `/api/lookup/customers?search=`, `/api/lookup/materials?search=`
- `POST /api/uploads` — image upload (returns `url` and `thumbUrl`)

Rules: validate every input with zod, enforce role permissions on the server, return consistent error JSON `{ error: { message, field? } }`, use proper HTTP status codes, and use transactions for multi-row updates.

---

## 13. Quality checklist

- TypeScript strict mode, no `any` unless unavoidable.
- Clean folder structure: `client/src/{pages,components,components/ui,features/orders,features/masters,hooks,lib,config}`, `server/src/{routes,services,db,storage,middleware}`, `shared/`.
- Loading, empty and error states on every screen; friendly error toasts for failed API calls.
- Accessible: labels on inputs, focus states, keyboard navigation in dropdowns, modals and drawers; Escape closes modals/drawers.
- No layout break or horizontal scroll at 360px width.
- No secrets in the client bundle or in Git.
- `CLAUDE.md` and a `README.md` with setup steps: install, add `.env`, migrate, seed, run.

---

## 14. Build phases

1. **Setup:** monorepo, client + server scaffolding, Tailwind + shadcn, theme tokens, DM Sans, Turso connection via env, Drizzle schema + migrations, `CLAUDE.md`.
2. **Design system and layout:** standard dropdown component and other shared components, responsive layout (sidebar / bottom nav), profile menu with role switch.
3. **Masters:** Customer, Material and Design (with variations and uploads), plus seed data.
4. **Orders list:** grid + mobile cards, search, filters, pagination, role-based visibility.
5. **Add Order:** full form, add-customer flow with return, uploads, Saved Designs drawer with previous orders and library.
6. **Send for production + Order Details + Undo:** selection mode, bulk action, confirmation modals, status history.
7. **Polish and verification:** test all flows as both roles at 360px, 768px and 1280px; fix bugs; check performance (network tab: no over-fetching, thumbnails only in lists); update `CLAUDE.md` and `README.md`.
