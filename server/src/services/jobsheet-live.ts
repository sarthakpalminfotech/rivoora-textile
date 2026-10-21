import { sql } from 'drizzle-orm';
import { SECTIONS_PER_BEAM } from '@rivoora/shared';

/**
 * Live jobsheet figures of an order (Sprint 15). `orders.jobsheet_pieces` / `target_frames` are deprecated and no
 * longer read: the numbers come from the active jobsheets, with the same rule as the shared `coverageFrames`
 * (actual frames once Completed, otherwise the assigned frames). Outer column written explicitly (Drizzle gotcha).
 */
export const liveJobsheetFrames = sql<number>`COALESCE((SELECT SUM(CASE WHEN j.status = 'completed' AND j.completed_frames IS NOT NULL THEN j.completed_frames ELSE j.frames END) FROM jobsheets j WHERE j.order_id = "orders"."id" AND j.is_deleted = 0), 0)`;

/** Jobsheet quantity in pcs = frames in jobsheets × SECTIONS_PER_BEAM. */
export const liveJobsheetPieces = sql<number>`${liveJobsheetFrames} * ${SECTIONS_PER_BEAM}`;
