import { sql } from 'drizzle-orm';

/**
 * Live jobsheet figures of an order (Sprint 15). `orders.jobsheet_pieces` / `target_frames` are deprecated and no
 * longer read: the numbers come from the active jobsheets, with the same rule as the shared `coverageFrames`
 * (actual frames once Completed, otherwise the assigned frames). Outer column written explicitly (Drizzle gotcha).
 */
export const liveJobsheetFrames = sql<number>`COALESCE((SELECT SUM(CASE WHEN j.status = 'completed' AND j.completed_frames IS NOT NULL THEN j.completed_frames ELSE j.frames END) FROM jobsheets j WHERE j.order_id = "orders"."id" AND j.is_deleted = 0 AND j.is_external = 0), 0)`;

/**
 * Jobsheet quantity in pcs = Σ effective frames × each jobsheet's own sections per beam (Sprint 18) — the SQL twin of
 * the shared `coveragePieces`.
 */
export const liveJobsheetPieces = sql<number>`COALESCE((SELECT SUM((CASE WHEN j.status = 'completed' AND j.completed_frames IS NOT NULL THEN j.completed_frames ELSE j.frames END) * j.sections) FROM jobsheets j WHERE j.order_id = "orders"."id" AND j.is_deleted = 0 AND j.is_external = 0), 0)`;

/** Sprint 19: the meter twin of `liveJobsheetFrames` — Σ effective loom metres. */
export const liveJobsheetMeters = sql<number>`COALESCE((SELECT SUM(CASE WHEN j.status = 'completed' AND j.completed_meters IS NOT NULL THEN j.completed_meters ELSE j.meters END) FROM jobsheets j WHERE j.order_id = "orders"."id" AND j.is_deleted = 0 AND j.is_external = 0), 0)`;

/** Sprint 19: the meter twin of `liveJobsheetPieces` — Σ effective loom metres × each jobsheet's own sections (cloth metres). */
export const liveJobsheetClothMeters = sql<number>`COALESCE((SELECT SUM((CASE WHEN j.status = 'completed' AND j.completed_meters IS NOT NULL THEN j.completed_meters ELSE j.meters END) * j.sections) FROM jobsheets j WHERE j.order_id = "orders"."id" AND j.is_deleted = 0 AND j.is_external = 0), 0)`;
