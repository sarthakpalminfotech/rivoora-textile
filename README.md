# Rivoora Textile — Order Management

Web app for managing and tracking orders at Rivoora Textile: orders, send-for-production workflow, and the
Customer / Material / Design masters. It works on phones, tablets and desktops.

- **Client:** React 18 + Vite + TypeScript + Tailwind + Radix, TanStack Query, react-hook-form + zod
- **Server:** Node + Express + TypeScript, Drizzle ORM on Turso (libSQL), multer + sharp for images

## Setup

Requires Node 20+.

1. **Install**
   ```bash
   npm install
   ```
2. **Configure the database.** Copy the example env file and fill in your Turso URL and token:
   ```bash
   cp server/.env.example server/.env
   ```
   ```
   TURSO_DATABASE_URL=libsql://<your-db>.turso.io
   TURSO_AUTH_TOKEN=<token>
   PORT=4000
   ```
   `server/.env` is gitignored. The token is only used by the server and never reaches the browser.
   **Client (optional but needed before printing jobsheets for the floor):** the QR code on every printed jobsheet
   points to `${VITE_PUBLIC_APP_URL}/j/<jobsheet number>`. Set it to the live HTTPS address the phones open:
   ```bash
   cp client/.env.example client/.env
   ```
   ```
   VITE_PUBLIC_APP_URL=https://app.rivoora.in
   ```
   It is read at build time (`npm run build`). When empty, the print preview uses the current address and shows a
   warning. Phone browsers only allow the camera (Scan jobsheet) on HTTPS or localhost.
3. **Create the tables**
   ```bash
   npm run db:migrate
   ```
4. **Load demo data** (optional; safe to run again)
   ```bash
   npm run db:seed
   ```
   This adds 8 customers, 6 materials, 6 designs (D101–D106) with generated pattern images and variations, and
   25 orders. Orders are only seeded when the orders table is empty.
5. **Run**
   ```bash
   npm run dev
   ```
   Open http://localhost:5180. The API runs on http://localhost:4000, and Vite proxies `/api` and `/uploads` to it.
   To test on a phone, open the "Network" URL that Vite prints; the phone must be on the same Wi-Fi.

## Roles

There is no login yet. Use the profile menu (top right) to switch between **Jenish — Owner** (everything),
**Gaurang — Partner** (orders from Jobsheet pending on, jobsheets, read-only masters), **Supervisor** (Jobsheets
module + Machine view) and **Taka entry** (Scan jobsheet + a Jobsheets list to enter takas; English + Hindi screens).
The server enforces what each role can see and do.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | API + web app with hot reload |
| `npm run build` | Production build (server → `server/dist`, client → `client/dist`) |
| `npm start` | Run the built server; it also serves `client/dist` |
| `npm run typecheck` | TypeScript checks for shared, server and client |
| `npm test` | Unit tests for the shared logic (jobsheet maths, takas, QR parsing) |
| `npm run db:generate` | Create a migration after editing `server/src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | Insert demo data |

## Uploads

Images are converted to WebP (max 1600px wide) plus a 320px thumbnail and stored in `server/uploads/`. The
database stores only their URLs. To move to cloud storage later, add a driver in `server/src/storage/` and switch
it in `storage/index.ts`.

See `CLAUDE.md` for architecture and conventions.

## Login (Sprint 12)

Everyone logs in with a 10-digit mobile number and a password (httpOnly cookie session, 30 days). `npm run db:migrate` creates the default users if their phone does not exist yet:

| Name | Phone | Role | Default password |
|---|---|---|---|
| Jenish | 9999999999 | owner | `Rivoora@999` |
| Gaurang | 8888888888 | partner | `Rivoora@888` |
| Supervisor | 7777777777 | supervisor | `Rivoora@777` |
| Taka entry | 6666666666 | taka_entry | `Rivoora@666` |
| QC | 5555555555 | qc | `Rivoora@555` |
| Godown supervisor | 4444444444 | godown_supervisor | `Rivoora@444` |
| Dhruvil | 3333333333 | dispatch | `Rivoora@333` |

The default password is `Rivoora@` + the first 3 digits of the phone. Change them in **Users** (Jenish / Gaurang) before real use.

**Autofill button:** the login screen has a small *Autofill* button that fills the default password. It is controlled by `VITE_LOGIN_AUTOFILL` (build-time, default **on**). Set `VITE_LOGIN_AUTOFILL=false` in `client/.env` (and in the Vercel env) before real use.

`node scripts/check-auth.mjs http://localhost:4000` runs the auth checks (every route rejects a request without a session, logout, role switching rules, rate limit) against a running API.
