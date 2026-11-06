/**
 * Sprint 21 (CR-04) — Close order is allowed only when nothing of the order is in process. Pure: the server feeds it the
 * counts and the dialog shows the list. One row per blocker kind, in the order the work flows.
 */
import type { TakaStage } from './pipeline';

export const CLOSE_BLOCKER_KINDS = [
  'jobsheet_on_loom',
  'completed_without_takas',
  'at_butta',
  'butta_qc',
  'at_mill',
  'mill_qc',
  'refinish',
  'rework_butta',
  'outside_po_open',
] as const;
export type CloseBlockerKind = (typeof CLOSE_BLOCKER_KINDS)[number];

export interface CloseBlocker {
  kind: CloseBlockerKind;
  label: string;
  count: number;
  /** In-app route that clears it (the "Open" link). */
  link: string;
}

export interface CloseBlockerInput {
  orderId: number;
  /** Active jobsheets that are Sent or Ongoing. */
  jobsheetsOnLoom: number;
  /** Completed jobsheets with 0 active takas. */
  completedWithoutTakas: number;
  /** Active (non-deleted, non-free) takas of the order by stage. */
  takasByStage: Partial<Record<TakaStage, number>>;
  /** Outside POs that are Open or Partly received. */
  openOutsidePos: number;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function closeBlockers(input: CloseBlockerInput): CloseBlocker[] {
  const id = input.orderId;
  const s = input.takasByStage;
  const out: CloseBlocker[] = [];
  const add = (kind: CloseBlockerKind, count: number, label: string, link: string) => {
    if (count > 0) out.push({ kind, label, count, link });
  };
  add('jobsheet_on_loom', input.jobsheetsOnLoom, plural(input.jobsheetsOnLoom, 'Jobsheet on the loom', 'Jobsheets on the loom'), `/orders/${id}?tab=jobsheets`);
  add('completed_without_takas', input.completedWithoutTakas, plural(input.completedWithoutTakas, 'Completed jobsheet without takas', 'Completed jobsheets without takas'), `/orders/${id}?tab=jobsheets`);
  add('at_butta', s.at_butta ?? 0, 'Takas at butta cutting', '/butta?tab=challans');
  add('butta_qc', s.butta_qc ?? 0, 'Takas waiting for Butta QC', '/qc');
  add('at_mill', s.at_mill ?? 0, 'Takas at the mill', '/mill?tab=challans');
  add('mill_qc', s.mill_qc ?? 0, 'Takas waiting for Mill QC', '/qc');
  add('refinish', s.refinish ?? 0, 'Takas in refinish', '/mill?tab=send&sub=refinish');
  add('rework_butta', s.rework_butta ?? 0, 'Takas sent back to butta cutting', '/butta?tab=send');
  add('outside_po_open', input.openOutsidePos, plural(input.openOutsidePos, 'Outside PO with goods expected', 'Outside POs with goods expected'), `/orders/${id}?tab=outside`);
  return out;
}

/** "This order can't be closed yet: 2 Jobsheets on the loom, 3 Takas at the mill" (the 409 text). */
export function closeBlockedMessage(blockers: readonly CloseBlocker[]): string {
  return `This order can't be closed yet — clear these first: ${blockers.map((b) => `${b.count} ${b.label.toLowerCase()}`).join(', ')}`;
}
