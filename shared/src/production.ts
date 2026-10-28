/**
 * Production constants. Never hardcode these numbers anywhere else.
 * A power-loom beam has sections: one frame of weaving makes one piece per section. Sprint 18: the sections are set per
 * jobsheet run (`jobsheets.sections`, 1–12); `SECTIONS_PER_BEAM` is only the DEFAULT (and the value of older jobsheets).
 */
export const SECTIONS_PER_BEAM = 3;
export const MIN_SECTIONS_PER_BEAM = 1;
export const MAX_SECTIONS_PER_BEAM = 12;

/**
 * Sprint 19: the meters analog of "< 1 frame" in the pcs coverage/warning maths — a meter (all-over) order's
 * jobsheets are "on target" when they are short/over by less than this many metres (rounding dust only, never a
 * real production buffer, since loom metres are continuous unlike whole frames).
 */
export const METERS_ON_TARGET_SLACK = 0.05;
