# Sprint 24 plan — Yarn: combined lots, withdraw purpose, TFO hold, warping leftover, Palti, box stickers

Spec: `rivoora-sprint24-yarn-changes-prompt.md`. Branch `sprint-24` (from `main` = Sprint 23). The owner asked for the whole
sprint "in one go", so the phases are built back to back (one commit per phase) instead of stopping after each one.
**No migration is run against Turso** — `server/.env` is not present in this checkout; everything is tested on a local
file DB. Export a Turso backup and say "go" before `npm run db:migrate` is run on the live DB.

## Migration — ONE file, `0026_sprint24_yarn.sql` (additive only)

```sql
-- B1 withdraw purpose
ALTER TABLE yarn_withdrawals ADD purpose text DEFAULT 'in_house' NOT NULL;
ALTER TABLE yarn_withdrawals ADD party_name text;
ALTER TABLE yarn_withdrawals ADD rate_paise integer;
-- C TFO hold / box details pending
ALTER TABLE tfo_programs ADD rolls_made integer;
ALTER TABLE tfo_programs ADD rolls_done integer DEFAULT 0 NOT NULL;
ALTER TABLE tfo_programs ADD held_at text;
CREATE TABLE tfo_program_events (id, program_id → tfo_programs, kind, rolls_made, rolls_left, rolls, twisted_g,
  sections, note, role, user_id, created_at);                      -- hold | resume | part_done | stop_later | stopped | boxes_saved
-- D warping
ALTER TABLE warping_jobs ADD denier real;
ALTER TABLE warping_jobs ADD used_g integer;
ALTER TABLE warping_jobs ADD leftover_g integer;
-- E Palti + D remaining rows + F stickers
ALTER TABLE yarn_boxes ADD kind text DEFAULT 'tfo' NOT NULL;      -- tfo | palti | remaining
ALTER TABLE yarn_boxes ADD program_event_id integer;              -- the stop / part completion that made a TFO box
ALTER TABLE yarn_boxes ADD source_job_id integer;                 -- the warping job a "remaining" row came from
ALTER TABLE yarn_boxes ADD palti_run_id integer;
CREATE TABLE palti_runs (id, run_date, box_id, input_g, waste_g, note, role, user_id, created_at);
CREATE TABLE palti_run_inputs (id, run_id, zone, item, quality_id, qty_g, lot_id, box_id, warping_quality_id);
-- one system row so Palti boxes satisfy yarn_boxes.program_id NOT NULL (see "Clashes" 1)
INSERT INTO tfo_machines (machine_no, name, is_active, is_deleted) SELECT 0, 'System (Palti)', 0, 1 WHERE NOT EXISTS (…);
INSERT INTO tfo_programs (…, status) SELECT … 'system' WHERE NOT EXISTS (…);
```
Old rows: withdrawals = Use in-house, boxes = `tfo`, `rolls_done` 0. No existing row is rewritten.

## Phases, files, endpoints

| Phase | Server | Shared | Client |
|---|---|---|---|
| A CR-16 | `yarn-po.ts` receive: party + lower(lot no) → reuse the lot (same quality) or 400 `lots.i.lotNo`; `checkLotNo` returns `{available, lot: {quality, receivedG, challans}}` | — | receive-page `LotNoCheck` → "Existing lot · 600 kg received earlier (challan 77)" / "New lot" / quality clash |
| B1 CR-17 | `createWithdrawal` purpose / party / rate; every zone; `listMoves` `purpose` filter + withdrawal info (rate only with `canSeeRate`) | `WITHDRAW_ZONES` = all, beams Direct + Warping, `withdrawWholeBoxes` = not Direct, `WITHDRAW_PURPOSES` | WithdrawDialog Purpose `Segmented`, Warping Withdraw button, movements Purpose filter + column |
| B2 CR-19 | `YarnBox.kind / fy / programLabel`, zone `programs` incl. remaining rows | `boxGroupKey`, `tfoProgramLabel` (`P-12`) | `BoxChecklist` grouped By program / By quality (localStorage), tick a program, 2-column picker with totals, phone sticky bar |
| C CR-20/21 | `hold`, `resume`, `part`, `stop` (running / on hold), `stop-later`, `boxes` endpoints; board `onHold` + `boxPending` | `TFO_PROGRAM_STATUS_CONFIG`, `checkHoldRolls`, `partRollsLimit` | TFO tabs Running · On hold · Box details pending · Pending (counts), Hold / Resume / Complete made part / Stop dialogs (one box form for stop / part / boxes) |
| D CR-24 | `startPendingJob {denier}`, `finishWarpingJob` (denier for old jobs) → leftover rows | `warpingLeftover()` + tests | Start asks denier; Mark done summary card (beams left, card right on tablet) |
| E CR-25 | `yarn-palti.ts`: `GET /yarn/palti`, `POST /yarn/palti` | `paltiTotals`, kinds `palti_issue` / `palti_output` / `warping_leftover` | `/yarn/palti` list + New Palti box (inputs left, output right; phone stepper) |
| F CR-18 | `GET /yarn/boxes/print?ids=`, `GET /yarn/boxes/:id` | `boxNoWithFy` → `15 (26-27)` | `/print/yarn-boxes?ids=&size=label|a4`, `/yarn/box/:id`, Print sticker from box rows, stop / part / Palti toasts, stock screen selection |

Permissions: all new floor endpoints sit behind the yarn router's `canUseYarnInventory`; no new permission. Rates in the
movements list only with `canSeeRate` (Yarn inventory supervisor / Supervisor get "rate entered").

## Decisions / clashes with the code

1. **Palti boxes have no TFO program** but `yarn_boxes.program_id` is NOT NULL (+ FK). Making it nullable needs a table
   rebuild (not additive). As with the Sprint 20 system yarn quality, the migration adds ONE system TFO program (status
   `system`, on a deleted machine 0) that Palti boxes point to; every program query filters by real statuses, so it never
   shows. Boxes are told apart by `kind`.
2. **Warping remaining kg** are stored as `yarn_boxes` rows (`kind = 'remaining'`, rolls 0, gross = net, number from
   the box counter, `program_id` = the program, `source_job_id` = the job) — they then work everywhere a box works
   (transfer, withdraw, warping input, Palti, stickers, program-wise views) without a second stock model.
3. **Rolls**: box rolls and program rolls are the same unit for the hold maths. "Complete made part" accepts box rolls up
   to rolls made − rolls already boxed (On hold) or started − boxed (Running). The program completes by itself when every
   started roll is boxed. The final Stop keeps today's rules (no roll check) and may have no boxes when parts were saved.
4. **Program number**: programs have no number; `P-<id>` (`tfoProgramLabel`) is shown.
5. **Resume** moves `tfo_programs.machine_id / section` to the first new section (the running unique index is on it).
6. **Old in-process warping jobs** have no denier: Mark done asks for it then.
7. **Leftover without a program** goes back to each input (raw → its lot, no-box → its bucket, a Palti box → that box).
8. A lot entered twice in ONE challan is still refused (combine across challans only).

## UI per breakpoint
Phone < 768: one column, full-screen dialogs, cards, sticky totals bars. Tablet 768–1023: 2-column forms / pickers
(groups left, selection right), box rows as grid lines, Segmented tabs, 48 px floor buttons. Desktop ≥ 1024: side sheet
dialogs, tables where the module has them.

## Tests
`shared/src/sprint24.test.ts` (leftover split: two programs, one, raw only, negative; hold rolls; withdraw schema;
box no with FY; Palti totals). API smoke `scripts/check-sprint24.mjs` (local file DB only).
