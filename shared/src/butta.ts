/**
 * Challan print paging (butta and mill share one print) and the Butta QC decision rules.
 * Pure helpers shared by the server (validation) and the client (print layout, QC form).
 */

import { formatMeters } from './takas';

/* ------------------------------------------------------------------ */
/* Challan print (A4 landscape)                                         */
/* ------------------------------------------------------------------ */

/** Paper size + orientation in one place so they can be changed. */
export const CHALLAN_PAPER = { size: 'A4', orientation: 'landscape' } as const;
export const CHALLAN_ROWS_PER_GROUP = 12;
export const CHALLAN_GROUPS = 4;
export const CHALLAN_TAKAS_PER_PAGE = CHALLAN_ROWS_PER_GROUP * CHALLAN_GROUPS;

export interface ChallanPrintTaka {
  takaNo: string;
  /** Meters at the time of sending. */
  meters: number | null;
}

export interface ChallanPrintRow {
  /** Continuous row number (1, 2, 3 …). */
  no: number;
  takaNo: string;
  meters: number | null;
}

export interface ChallanPrintGroup {
  /** Always `CHALLAN_ROWS_PER_GROUP` entries; unused rows are null (blank, but the grid keeps its height). */
  rows: (ChallanPrintRow | null)[];
  /** Subtotal of the group's meters; null when the group is empty. */
  subtotal: number | null;
}

export interface ChallanPrintPage {
  page: number;
  pages: number;
  groups: ChallanPrintGroup[];
  isLast: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Splits the takas into pages of 4 groups × 12 rows. Rows are numbered continuously and filled column by column:
 * group 1 holds rows 1–12, group 2 rows 13–24, … (49–96 on page 2). Always returns at least one page.
 */
export function paginateChallanTakas(takas: readonly ChallanPrintTaka[]): ChallanPrintPage[] {
  const pages = Math.max(1, Math.ceil(takas.length / CHALLAN_TAKAS_PER_PAGE));
  return Array.from({ length: pages }, (_, p) => {
    const groups: ChallanPrintGroup[] = Array.from({ length: CHALLAN_GROUPS }, (_, g) => {
      const rows: (ChallanPrintRow | null)[] = Array.from({ length: CHALLAN_ROWS_PER_GROUP }, (_, r) => {
        const index = p * CHALLAN_TAKAS_PER_PAGE + g * CHALLAN_ROWS_PER_GROUP + r;
        const t = takas[index];
        return t ? { no: index + 1, takaNo: t.takaNo, meters: t.meters } : null;
      });
      const filled = rows.filter((r): r is ChallanPrintRow => r !== null);
      return {
        rows,
        subtotal: filled.length ? round2(filled.reduce((sum, r) => sum + (r.meters ?? 0), 0)) : null,
      };
    });
    return { page: p + 1, pages, groups, isLast: p === pages - 1 };
  });
}

export function challanTotals(takas: readonly ChallanPrintTaka[]): { count: number; meters: number } {
  return { count: takas.length, meters: round2(takas.reduce((sum, t) => sum + (t.meters ?? 0), 0)) };
}

/** A row's meters in the table: 2 decimals ("493.00"), blank when none. */
export const formatChallanRowMeters = (meters: number | null | undefined) => (meters == null ? '' : meters.toFixed(2));

/** The "Total Mtrs" figure: no decimals when whole ("1210"), otherwise 2 decimals ("1210.50"). */
export function formatChallanTotalMeters(meters: number): string {
  const r = round2(meters);
  return Number.isInteger(r) ? String(r) : r.toFixed(2);
}

/** "12-12-2026" style dates are used in the app; the challan prints `dd/MM/yyyy`. */
export function formatChallanDate(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : isoDate;
}

/* ------------------------------------------------------------------ */
/* Butta QC decisions                                                   */
/* ------------------------------------------------------------------ */

export interface QcOpenDamage {
  id: number;
  /** Null on an older (migrated) damage that never had a pcs count. */
  pcs: number | null;
  /** Pcs resolved before this QC (a damage stays open while part of it is resolved). */
  resolvedPcs?: number | null;
}

/**
 * The decision for one open damage: how many pcs were resolved NOW (0 = not resolved). `pcs` is needed only for an
 * older damage that has no pcs yet (the damaged pcs).
 */
export interface QcDecision {
  takaDamageId: number;
  resolvedPcs: number;
  pcs?: number | null;
}

export interface QcDecisionIssues {
  /** Open damages that have no answer yet. */
  unanswered: number[];
  /** Answered damages that have no pcs (neither stored nor given) — ask "How many pcs damaged?". */
  pcsMissing: number[];
  /** Pcs larger than the taka's pcs. */
  pcsTooBig: number[];
  /** Resolved pcs larger than the pcs still open on the damage. */
  resolvedTooBig: number[];
  /** Decisions that don't belong to an open damage of this taka. */
  unknown: number[];
}

/** The state of a damage after `resolveNow` more pcs were resolved. Fully resolved only when no pcs are left open. */
export function applyResolve(damage: { pcs: number; resolvedPcs?: number | null }, resolveNow: number) {
  const resolvedPcs = Math.min(damage.pcs, (damage.resolvedPcs ?? 0) + Math.max(0, resolveNow));
  const openPcs = damage.pcs - resolvedPcs;
  return { resolvedPcs, openPcs, status: openPcs === 0 ? ('resolved' as const) : ('open' as const) };
}

/**
 * Every open damage must get an answer (0 = not resolved, or 1…open pcs); a damage without pcs needs a pcs count, no
 * damaged pcs may exceed the taka's pcs and no more pcs can be resolved than are open. `takaPcs` = the pcs after the
 * QC edit.
 */
export function validateQcDecisions(
  open: readonly QcOpenDamage[],
  decisions: readonly QcDecision[],
  takaPcs: number,
): QcDecisionIssues & { ok: boolean } {
  const byId = new Map(decisions.map((d) => [d.takaDamageId, d]));
  const issues: QcDecisionIssues = {
    unanswered: [],
    pcsMissing: [],
    pcsTooBig: [],
    resolvedTooBig: [],
    unknown: decisions.filter((d) => !open.some((o) => o.id === d.takaDamageId)).map((d) => d.takaDamageId),
  };
  for (const o of open) {
    const d = byId.get(o.id);
    if (!d) {
      issues.unanswered.push(o.id);
      continue;
    }
    const pcs = o.pcs ?? d.pcs ?? null;
    if (pcs === null) issues.pcsMissing.push(o.id);
    else if (pcs > takaPcs) issues.pcsTooBig.push(o.id);
    else if (d.resolvedPcs > pcs - (o.resolvedPcs ?? 0)) issues.resolvedTooBig.push(o.id);
  }
  return { ...issues, ok: Object.values(issues).every((l) => l.length === 0) };
}

/** "meters 61 m → 60.5 m · pcs 12 → 11" — the note of an `edited` taka event (empty string when nothing changed). */
export function takaEditNote(
  before: { meters: number | null; pcs: number | null },
  after: { meters: number | null; pcs: number | null },
): string {
  const parts: string[] = [];
  if (before.meters !== after.meters) {
    parts.push(
      `meters ${before.meters == null ? '–' : formatMeters(before.meters)} → ${after.meters == null ? '–' : formatMeters(after.meters)}`,
    );
  }
  if (before.pcs !== after.pcs) parts.push(`pcs ${before.pcs ?? '–'} → ${after.pcs ?? '–'}`);
  return parts.join(' · ');
}
