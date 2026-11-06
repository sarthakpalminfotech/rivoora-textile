# Sprint 22 — build plan (written after the build, because the owner asked for it to be built in one go)

Branch `sprint-22` (from `sprint-21`, which is not merged yet). Migration `server/drizzle/0023_fuzzy_weapon_omega.sql` — additive; **not applied to Turso**.
Tests: `shared/src/sprint22.test.ts`; API flow `scripts/check-sprint22.mjs` (local file DB only).

## Where the prompt clashed with the code (and what was done)
- The prompt says the Sprint 19 stock-holder / adjustment pieces were "never built": the tables and columns exist (migration 0018) but no code used them — this sprint builds the holder-order service, with exclusions in the orders list, the inventory scope and the hold guard (404), and a display rule so a negative order number is never shown.
- The spec asks for damage types Machine / Butta / Mill / Supervisor on manual stock: the existing choosable list has Weaver instead of Supervisor, so manual stock uses its own list (`machine`, `butta`, `mill`, `godown` = "Supervisor marked").
- The old inventory is pcs-only (`orderInventoryPcs`). Rather than rewrite it, the new Quality → Design → Details screens use a new dual read model (`stock-qualities.ts`); the old screen is still reachable (`?view=designs`, `?section=damaged`).
- New goods returns are not linked to a challan, so they create no DC revision and never set the Returned status; the old GR endpoint stays for old data.
- A removed taka is kept as a soft-deleted row (`is_deleted` + `removed_*`), so figures, lists and history stay consistent.
- Not built: the lot print (optional in the spec).
