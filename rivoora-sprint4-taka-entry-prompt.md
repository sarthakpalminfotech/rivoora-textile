# Rivoora Textile — Sprint 4: Taka entry role, QR scan, takas on orders

This continues the existing project. Read `CLAUDE.md` and `PROJECT_STATE.md` first. **Reuse the existing patterns and components.** For the Taka entry person's jobsheet list, use the **same card design as the supervisor's Jobsheets module**: the big design image on top, "Jobsheet N" with the status badge, "Design X · Order #N", Frames / Machine fields, and the full-width primary action button at the bottom. Don't restyle or refactor other screens beyond what this document asks.

**How to work**
0. Run `git status`. If there are uncommitted changes, stop and tell me so I can commit them first.
1. Start in plan mode and show me the plan: schema + migration, role/permissions, QR format, scanner library, endpoints, and screens.
2. Build in the phases at the end. After each phase, run `npm run typecheck` and `npm test`, run the app, fix all errors, and give me a short summary.
3. At the end, update `CLAUDE.md` and `PROJECT_STATE.md`.

---

## 0. Small change first: auto-select on "Send to supervisor"

In the order details Jobsheets card, clicking the **Send to supervisor** icon button now enters selection mode with **all Pending jobsheets of that order already selected**. The user can untick the ones he doesn't want. Nothing else changes.

---

## 1. Background (how it works on the factory floor)

- When a jobsheet's cloth comes off the loom, it goes to the upper floor.
- There, the **Taka entry** person takes each cloth, writes a **taka number** on the cloth and on paper, and checks it for damage.
- One jobsheet's cloth usually becomes about **3 takas** (one per section), but it can be more or fewer. A taka can contain several frames.
- Damage found at this point is always **machine damage**.
- From now on, takas are how cloth is tracked (the next sprints build on this).

---

## 2. New role: Taka entry

Add the role **`taka_entry`**, named "Taka entry" (Hindi: "टाका एंट्री"), initial "T". It must be a valid `X-Role` value and appear in the profile menu's **Switch role** list.

| Permission | jemish | gaurang | supervisor | taka_entry |
|---|---|---|---|---|
| `canUseTakaModules` (Scan jobsheet + the Taka jobsheets list) | ❌ | ❌ | ❌ | ✅ |
| `canEnterTakas` (add new takas) | ❌ | ❌ | ❌ | ✅ |
| `canEditTakas` (edit or remove submitted takas, edit the note) | ✅ | ✅ | ❌ | ❌ |
| `canViewTakas` (see takas on order and jobsheet details) | ✅ | ✅ | ❌ | ✅ (on his screens only) |

**Taka entry visibility:**
- Nav: **Scan jobsheet** and **Jobsheets** only, with bilingual labels (section 3). He lands on `/scan`. Every other route redirects him to `/scan`.
- On the server: every order, master and machine-view endpoint returns 403 for him, except what his screens need.
- He can see **all jobsheets in every status** (Pending, Sent, Ongoing, Completed). He sees the order number only as plain text, and never the client name, rate or order details.
- **No Machine view** for him.

---

## 3. Bilingual labels (English + Hindi) for the Taka entry screens

The Taka entry person isn't very comfortable with technical English. On **every screen he uses** (nav, scan, list, taka entry, dialogs, toasts, empty and error states), show the **English and Hindi** text together.
- Build a small helper, e.g. `bi('Submit', 'जमा करें')`, or a `<BiLabel en hi />` component.
- For buttons and headings, show the English on the first line and the Hindi below it or after a "/". Pick whichever stays cleaner and doesn't wrap badly at 360px.
- Load **Noto Sans Devanagari** globally (it's currently loaded only on the print route), so Hindi renders the same on every device.
- Other roles' screens stay English-only.

Suggested wording (you can improve the Hindi if needed; keep it simple, everyday Hindi):

| English | Hindi |
|---|---|
| Scan jobsheet | जॉबशीट स्कैन करें |
| Jobsheets | जॉबशीट |
| Taka | टाका |
| Taka 1, Taka 2… | टाका 1, टाका 2… |
| Damage | खराबी |
| Note | नोट |
| Add more | और जोड़ें |
| Submit | जमा करें |
| Saved | सेव हो गया |
| Scan next | अगला स्कैन करें |
| Type jobsheet number | जॉबशीट नंबर लिखें |
| Open | खोलें |
| Taka pending | टाका बाकी |
| Done | हो गया |
| Already entered | पहले से डाले गए |
| Coming soon | जल्द आ रहा है |

---

## 4. QR code on the printed jobsheet

**Content:** a URL of the form `${PUBLIC_APP_URL}/j/${jobsheetNo}`, e.g. `https://app.rivoora.in/j/319`. Jobsheet numbers are globally unique and never reused, so the number is a safe identifier.
- `PUBLIC_APP_URL` comes from the client env `VITE_PUBLIC_APP_URL`. Add it to `.env.example` and the README.
- If it's not set, fall back to `window.location.origin`. In that case, show a clear amber warning bar on the print preview (not printed): "QR codes will point to <origin>. Set VITE_PUBLIC_APP_URL to the live website address before printing jobsheets for the floor."

**Rendering:**
- Use the `qrcode` npm package to render an **SVG**, with error correction level **M**.
- Place it in the **empty space to the right of the jobsheet number box** at the top of the front page. Don't move or resize anything else in the layout.
- Size about **28–32 mm** square, with a quiet zone.
- Print a tiny caption under it: `Scan · 319`.

**Route `/j/:jobsheetNo`** (the target of the QR link):
- It resolves the number through `GET /api/jobsheets/by-no/:no`, which returns the id, or 404.
- Then it redirects by role:
  - **taka_entry** → the taka entry screen for that jobsheet (`/jobsheets/:id`, taka entry on top)
  - **jemish/gaurang** → their jobsheet details page
  - **supervisor** → his details page (or a "not available" message if it's Pending)
- If the number isn't found: a clear error screen (bilingual for taka_entry) with a button back to Scan.

**Reprinting:** existing jobsheets have no QR. They get it automatically the next time they're printed (Print / Print all). No data change is needed.

---

## 5. Scan jobsheet screen (`/scan`, Taka entry)

Build it mobile-first; he uses a phone.
- **Camera scanner** using the `qr-scanner` package (or `@zxing/browser` if that suits better; say which in the plan):
  - use the back camera by default
  - a large viewfinder with a square guide
  - a torch toggle if the device supports it
  - a short vibration (`navigator.vibrate`) and a sound-free success tick on a valid scan
- **Accept only our QR codes:** a URL whose path matches `/j/<digits>` (any host, so it survives a domain change). Anything else shows "This is not a Rivoora jobsheet QR" (bilingual) and keeps scanning.
- **On a valid scan:** stop the camera and navigate to that jobsheet's taka entry screen.
- **Manual fallback, always visible under the camera:** a large numeric field "Type jobsheet number / जॉबशीट नंबर लिखें" plus an **Open / खोलें** button.
- **When the camera can't be used** (permission denied, no camera, or an insecure http context, since phone browsers only allow the camera over HTTPS):
  - show a friendly bilingual message explaining why
  - keep the manual entry working
  - for the http case, add a small technical note for admins
- Stop the camera stream when leaving the screen.

---

## 6. Taka entry screen (Taka entry role, `/jobsheets/:id`)

**Taka entry is the primary content**, at the top, so he never has to scroll to reach it. The jobsheet details come after it, as secondary information.

### 6.1 Top: identity card (sticky or first on the page)
- **Jobsheet 319** in very large bold text, with the design thumbnail (tap → lightbox) and the design code, so he can match it with the paper before typing.
- A small line with the frames, the status badge, the machine and `Order #26` (plain text).
- **If the jobsheet is not Completed yet:** a gentle info note, "This jobsheet will be marked Completed when you submit / जमा करने पर यह जॉबशीट पूरी मानी जाएगी".

### 6.2 Already entered (only if takas exist)
A compact read-only list, "Already entered / पहले से डाले गए": taka numbers as chips, damaged ones in red with "Damage / खराबी". He **cannot edit or remove these**; only Jemish and Gaurang can.

### 6.3 New taka fields
- **6 empty fields by default**, stacked vertically, labelled "Taka 1 / टाका 1" … "Taka 6 / टाका 6" (numbering continues after any already-entered takas).
- **Large fields:** at least 56px high, 22–24px text, full width. Use `inputMode="numeric"` and `pattern="[0-9]*"` so the phone opens the **number keypad**. Digits only, up to 10 digits. Store as text so leading zeros are kept.
- Pressing Enter/Next on the keypad moves to the next field.
- **Beside each field:** a big **Damage / खराबी** toggle button (at least 48px).
  - Tapping it turns the button **red** with a warning icon, and gives that row a light red tint.
  - Tap again to undo.
  - It's disabled while the field is empty.
- **Add more / और जोड़ें:** a large secondary button that adds one more field each tap.
- Empty fields are ignored on submit.

### 6.4 Note
- **One common note** for this jobsheet's taka entry (not per taka): a textarea "Note / नोट".
- Beside it, a **microphone icon** that is **display only**: disabled, with the tooltip "Coming soon / जल्द आ रहा है", like the existing mic on Add Order.
- If a note already exists, it's shown read-only to him.

### 6.5 Submit
- A full-width sticky bottom button: **Submit / जमा करें**. It's disabled until at least one field is filled.
- **Validation:**
  - digits only
  - no duplicates **within the same jobsheet**, including against the already-entered takas; show a red message on the field
  - Taka numbers are **not** unique across jobsheets or orders (they can repeat every year). Don't check across jobsheets.
- **Confirm dialog** (bilingual, big text) listing what will be saved, e.g.:
  - `6245`
  - `6246` — **Damage** (in red)
  - `6247`

  Plus the note. Buttons: Cancel / Submit.
- **On submit (one transaction):**
  - insert the takas
  - save or append the note
  - write a `takas_entered` jobsheet event
  - **if the jobsheet is not Completed**, mark it **Completed**: `completed_at` = now, `completed_frames` = its assigned frames, the running machine is freed, and a `completed` event is written with the note "completed at taka entry"
  - call `recomputeOrderStatus`
- **Success screen:**
  - a large green check, "Saved / सेव हो गया", and the taka numbers saved
  - two big buttons: **Scan next / अगला स्कैन करें** (primary, back to `/scan`) and **Back to list**

  Coming back to the jobsheet later shows the new takas under "Already entered" and fresh empty fields, so he can **add more** takas.

### 6.6 Secondary details (below the entry)
Frames, picks, machine(s), started/completed times, and the design image, in a simple card.

---

## 7. Taka entry Jobsheets list (`/jobsheets` for the taka_entry role)

- The same card grid and style as the supervisor list (1 column on phones, 2 at md, 3 at lg, 4 at xl), with bilingual labels.
- **Search** by jobsheet number or design code, across **all jobsheets in every status**.
- **Tabs with counts:**
  - **Taka pending / टाका बाकी** (default): jobsheets with no takas yet. Sort Completed ones first (most recently completed first), then Ongoing, Sent and Pending.
  - **Done / हो गया:** jobsheets with at least one taka, sorted by most recent taka entry first.
- Each card shows the design image, Jobsheet N + status badge, design code, `Order #N`, frames, and the **taka count** (e.g. "3 takas · 1 damage") when takas exist.
- The card's primary button is **Enter taka / टाका डालें**, or **Add more takas / और टाका डालें** on the Done tab. The button and the card both open the taka entry screen.
- There are no Start / Complete / Change machine actions for this role.
- Use the existing server-side pagination with infinite scroll + Load more.

---

## 8. Data model

**New table `takas`:**
- `id`
- `jobsheet_id` (FK, indexed)
- `order_id` (FK, indexed; denormalized for order queries)
- `taka_no` (text, digits, indexed; **not unique**)
- `is_damaged` (boolean, default false)
- `damage_type` (text, nullable; `machine` when damaged, since more damage types come later)
- `entered_by` (role), `created_at`, `updated_at`, `is_deleted` (soft delete for edits)
- A unique partial index on `(jobsheet_id, taka_no) WHERE is_deleted = 0`, so duplicates are blocked within a jobsheet only.

**On `jobsheets`:** add `taka_note` (text, nullable).

**`jobsheet_events`:** add the events `takas_entered` and `takas_edited`. The `note` field holds a short summary, e.g. "3 takas (1 damage)".

---

## 9. Order status: Taka entry done

Add the order status **`taka_entry_done`**, labelled "Taka entry done", sequence 60, visible to Jemish and Gaurang, with a distinct badge colour.

Update `recomputeOrderStatus`, the shared pure function, and its tests: if **all active jobsheets are Completed and every one has at least one active taka** → `taka_entry_done`. Otherwise the existing rules apply. Examples:
- A new jobsheet is added later → the order goes back to In production or Jobsheet created, as the rules say.
- Jemish removes all takas of a jobsheet → Production completed.

---

## 10. Jemish / Gaurang: takas on order details and jobsheet details

**Order details → new "Takas" card**, shown when the order has any jobsheet:
- **Summary:** "Total takas N" and "Damaged M" (red, labelled Machine damage).
- A filter toggle: **All / Damaged only**.
- Takas are **grouped by jobsheet**:
  - a group header "Jobsheet 319 · 10 frames · Machine 7", plus the taka note if any
  - the taka numbers as chips; damaged ones are red, with a small "Machine damage" label
  - a group with no takas shows "No takas yet"
- Each group has an **Edit takas** button (`canEditTakas`). It opens a full-screen form where every taka row is editable:
  - the number
  - the damage toggle
  - a remove (✕) button
  - **Add row**
  - the note

  On save, validate (digits, no duplicates within the jobsheet), apply the changes in one transaction, write a `takas_edited` event, and call `recomputeOrderStatus`.
- Build this card so the next sprint can add more damage types and tracking.

**Jobsheet details (Jemish/Gaurang):** add the same Takas block for that single jobsheet, with the same Edit button. The Activity timeline shows "Takas entered — 3 takas (1 damage) · Taka entry" and "Takas edited · Gaurang".

**Supervisor:** takas are not shown to him. If a jobsheet he has open gets completed by taka entry, his actions correctly return 409 and his list refreshes.

---

## 11. API summary

| Method | Path | Purpose | Permission |
|---|---|---|---|
| GET | `/jobsheets/by-no/:no` | `{ id }` (404 if missing or deleted); for the supervisor, 404 if Pending | any role that can open jobsheets |
| GET | `/taka/jobsheets?tab=pending\|done&search=&page=&limit=` | The Taka entry list + tab counts | `canUseTakaModules` |
| GET | `/jobsheets/:id` | Role-aware; for taka_entry includes the takas and note, and hides client and order details | role-aware |
| POST | `/jobsheets/:id/takas` | `{ takas: [{ takaNo, isDamaged }], note? }`: adds only; auto-completes the jobsheet if needed; recompute | `canEnterTakas` |
| PUT | `/jobsheets/:id/takas` | `{ takas: [{ id?, takaNo, isDamaged }], note? }`: full replace-set edit (soft-delete removed ones); recompute | `canEditTakas` |
| GET | `/orders/:id/takas` | Takas grouped by jobsheet + summary counts | `canViewTakas` (Jemish/Gaurang) |

Validate every body with zod in `shared/src/schemas.ts`. After each mutation, invalidate the jobsheet, order, orders-list, taka-list, supervisor-list and machine-view queries.

---

## 12. Quality checklist

- **Shared tests:**
  - the taka validation (digits, duplicates within a jobsheet, including already-entered ones)
  - the `recomputeOrderStatus` rule for `taka_entry_done`
  - the QR URL parser (accepts `/j/<digits>` on any host, rejects everything else)
- **Test the full floor flow on a real phone over HTTPS** (or Chrome's device emulation with a camera): scan → enter → submit → scan next. Check that the numeric keypad opens and the fields and buttons are easy to tap.
- **Print the jobsheets:** check that the QR sits in the empty space right of the number box, scans from paper, and that the rest of the layout didn't shift.
- The taka_entry role can never reach order, master or machine-view data, via the UI or the API.
- No horizontal overflow at 360px; the Hindi text doesn't break layouts.
- Loading, empty and error states everywhere, consistent with the existing screens (bilingual for the Taka entry role).

## 13. Build phases

1. **Auto-select change** (section 0).
2. **Migration and configs:** the `takas` table, `jobsheets.taka_note`, the new events, the `taka_entry_done` status, the taka_entry role, permissions, nav and landing route, and the bilingual helper + Devanagari font.
3. **Shared logic and tests.**
4. **QR on print + the `/j/:no` route + `by-no` endpoint.**
5. **Scan screen** (camera + manual fallback).
6. **Taka entry screen + Taka Jobsheets list + endpoints**, including auto-complete on submit.
7. **Takas on order details and jobsheet details** for Jemish/Gaurang, with the edit form.
8. **Polish:** test every flow as all four roles at 360px, 768px and 1280px, test a real printout and phone scan, and update `CLAUDE.md` and `PROJECT_STATE.md`.
