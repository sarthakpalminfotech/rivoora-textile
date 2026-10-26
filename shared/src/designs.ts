/**
 * Sprint 18 — the design library by quality. Variations are gone: every design is standalone with its own code, and
 * belongs to one or more qualities (materials, `design_qualities`). Pure rules shared by the server, the Design master,
 * "Upload many" and the Saved designs drawer (tests: designs.test.ts).
 */
import { DESIGN_CODE_MAX_LENGTH, DESIGN_CODE_REGEX, normalizeCode } from './codes';
import type { DesignQuality } from './types';

/** The group of designs that have no quality yet (older designs, until they are edited). */
export const NO_QUALITY_LABEL = 'No quality';
/** `?quality=none` in the URL / the API. */
export const NO_QUALITY_PARAM = 'none';

/** How many design thumbnails a quality card shows. */
export const QUALITY_CARD_THUMBS = 4;

/** Parses `?quality=` — a material id, `none` (No quality), or null (nothing / invalid). */
export function parseQualityParam(v: unknown): number | 'none' | null {
  if (v === NO_QUALITY_PARAM) return 'none';
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * The drawer's group order: the order's quality first (when one is picked), then the others by name, "No quality" last.
 * Groups are `{ materialId, name }` (materialId null = No quality).
 */
export function orderQualityGroups<G extends { materialId: number | null; name: string }>(groups: readonly G[], firstMaterialId?: number | null): G[] {
  return [...groups].sort((a, b) => {
    if ((a.materialId === null) !== (b.materialId === null)) return a.materialId === null ? 1 : -1;
    if (firstMaterialId != null && (a.materialId === firstMaterialId) !== (b.materialId === firstMaterialId)) {
      return a.materialId === firstMaterialId ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
  });
}

/**
 * What picking a design does to the order's quality:
 * - the order's quality is already one of the design's → keep it;
 * - the design has exactly one quality → set it (still changeable);
 * - several → ask the user to choose one of them;
 * - none → leave the quality alone.
 */
export type QualityOnPick =
  | { kind: 'keep' }
  | { kind: 'set'; quality: DesignQuality }
  | { kind: 'choose'; options: DesignQuality[] }
  | { kind: 'none' };

export function qualityOnPick(designQualities: readonly DesignQuality[], currentMaterialId: number | null): QualityOnPick {
  if (designQualities.length === 0) return { kind: 'none' };
  if (currentMaterialId != null && designQualities.some((q) => q.id === currentMaterialId)) return { kind: 'keep' };
  if (designQualities.length === 1) return { kind: 'set', quality: designQualities[0] };
  return { kind: 'choose', options: [...designQualities] };
}

/** "+2 qualities" — the other qualities of a design shown under one quality group (null when there are none). */
export function otherQualitiesHint(qualities: readonly DesignQuality[], groupMaterialId: number | null): string | null {
  const others = qualities.filter((q) => q.id !== groupMaterialId).length;
  if (groupMaterialId === null || others === 0) return null;
  return `+${others} ${others === 1 ? 'quality' : 'qualities'}`;
}

/* ------------------------------------------------------------------ */
/* Upload many — the review page rows                                   */
/* ------------------------------------------------------------------ */

export interface BulkDesignRow {
  key: string;
  code: string;
  materialIds: readonly number[];
  buttaCutting: boolean | null;
  /** The image is uploaded (rows still uploading / failed can't be saved). */
  uploaded: boolean;
}

export interface BulkRowProblems {
  code?: string;
  materialIds?: string;
  buttaCutting?: string;
  image?: string;
}

/**
 * Per-row problems of the review page (by row key). `takenCodes` = normalized codes the live check found already used
 * in the Design master. Codes repeated on the page are flagged on every row that has them.
 */
export function bulkRowProblems(rows: readonly BulkDesignRow[], takenCodes: ReadonlySet<string> = new Set()): Map<string, BulkRowProblems> {
  const seen = new Map<string, number>();
  for (const r of rows) {
    const c = normalizeCode(r.code);
    if (c) seen.set(c, (seen.get(c) ?? 0) + 1);
  }
  const out = new Map<string, BulkRowProblems>();
  for (const r of rows) {
    const p: BulkRowProblems = {};
    const c = normalizeCode(r.code);
    if (!c) p.code = 'Design code is required';
    else if (c.length > DESIGN_CODE_MAX_LENGTH) p.code = `At most ${DESIGN_CODE_MAX_LENGTH} characters`;
    else if (!DESIGN_CODE_REGEX.test(c)) p.code = 'Use only letters, numbers and - / _ .';
    else if ((seen.get(c) ?? 0) > 1) p.code = 'Used twice on this page';
    else if (takenCodes.has(c)) p.code = 'Already used by another design';
    if (r.materialIds.length === 0) p.materialIds = 'Pick at least one quality';
    if (r.buttaCutting === null) p.buttaCutting = 'Choose Yes or No';
    if (!r.uploaded) p.image = 'The image is not uploaded yet';
    if (Object.keys(p).length) out.set(r.key, p);
  }
  return out;
}
