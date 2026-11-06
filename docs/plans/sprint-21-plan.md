# Sprint 21 — build plan (written after the build, because the owner asked for it to be built in one go)

Branch `sprint-21`, one commit per phase (A FG type · B hold / close · C supervisor + taka entry · D receipts + shrinkage · E undo + QC corrections · F challans · G dispatch · H alerts).
Migration: `server/drizzle/0022_loud_callisto.sql` (additive). **Not applied to Turso** — export a backup first, then `npm run db:migrate`.
Tests: `shared/src/sprint21.test.ts`, `closeBlockers.test.ts`, `overdue.test.ts`; API flow `scripts/check-sprint21.mjs` (local file DB only).

## Where the prompt clashed with the code (and what was done)
- Challans had no transport / vehicle / notes columns → added (nullable). Delivery challans had no vehicle / notes → added.
- "A removed taka is not printed": the `challan_takas` row is deleted (a cancelled challan keeps its rows for the record).
- "Lost" needed a real stage → `TakaStage 'lost'` + a dashboard sub-stage; lost takas are excluded from the bar, totals, the status recompute and Close.
- "Undo QC exactly" needed new data → `qc_runs` (damage snapshot + ids added). QC submits made before this migration have no run and cannot be undone.
- The supervisor's restricted views are kept: QC corrections and Alerts return no client or rate.
- Close used to complete / cancel Sent + Ongoing jobsheets; now they are blockers (only Pending ones are cancelled).
- Outside / FG receipts: the old "our number" column and `code + weaver number` numbering are gone for new receipts; old takas keep their numbers.
- Not built: hold notification (spec), Undo buttons inside the Butta Send / Mill Refinish pending lists, "W <weaver no>" on challan prints.
