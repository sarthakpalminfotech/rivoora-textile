/**
 * Rework (Sprint 12): sending takas back to butta cutting or the mill. Pure rules shared by server and client.
 */
import type { TakaStage } from './pipeline';

export type SendBackTarget = 'butta' | 'mill';

/** Stages a taka can be sent back from — the takas WITH US right now. */
export const REWORK_SELECTABLE_STAGES: readonly TakaStage[] = [
  'entered',
  'waiting_mill',
  'butta_qc',
  'mill_qc',
  'final',
  'ready_dispatch',
  'refinish',
  'rework_butta',
];

export interface ReworkSelectable {
  selectable: boolean;
  /** Why it can't be selected (tooltip). */
  reason: string | null;
}

/** at butta cutting / at the mill → greyed ("it is out"), dispatched → only through GR. */
export function reworkSelectable(stage: string): ReworkSelectable {
  if ((REWORK_SELECTABLE_STAGES as readonly string[]).includes(stage)) return { selectable: true, reason: null };
  if (stage === 'at_butta') return { selectable: false, reason: 'At butta cutting right now — receive it first.' };
  if (stage === 'at_mill') return { selectable: false, reason: 'At the mill right now — receive it first.' };
  if (stage === 'dispatched') return { selectable: false, reason: 'Dispatched — it can come back only through GR (goods return).' };
  return { selectable: false, reason: 'Not available for rework.' };
}

/**
 * A taka that has already been to the mill (itself, or any ancestor through `parent_taka_id`) is dyed: after a Butta QC
 * (e.g. a re-butta) it goes back to the godown (`final`) — to its order, or still free stock — and NOT to the mill again.
 * Everything else follows the normal flow: `waiting_mill`.
 */
export function stageAfterButtaQc(taka: {
  hasBeenToMill?: boolean | null;
  ancestorHasBeenToMill?: boolean | null;
  hasMillHistory?: boolean;
  refinishCount?: number | null;
}): TakaStage {
  const dyed = !!taka.hasBeenToMill || !!taka.ancestorHasBeenToMill || !!taka.hasMillHistory || (taka.refinishCount ?? 0) > 0;
  return dyed ? 'final' : 'waiting_mill';
}

/** The stage a taka sent back to `target` moves to. */
export const sendBackStage = (target: SendBackTarget): TakaStage => (target === 'butta' ? 'rework_butta' : 'refinish');

const FROM_TEXT: Record<string, string> = {
  entered: 'waiting for butta cutting',
  waiting_mill: 'waiting for the mill',
  butta_qc: 'in butta QC',
  mill_qc: 'in mill QC',
  final: 'from godown',
  ready_dispatch: 'ready for dispatch',
  refinish: 'in refinish',
  rework_butta: 'already sent back',
};

/** "3 from godown", "1 ready for dispatch" — one short line per current stage, in the order of the stages. */
export function sendBackSummaryLines(takas: readonly { stage: string }[]): string[] {
  const counts = new Map<string, number>();
  for (const t of takas) counts.set(t.stage, (counts.get(t.stage) ?? 0) + 1);
  return REWORK_SELECTABLE_STAGES.filter((s) => counts.has(s)).map((s) => `${counts.get(s)} ${FROM_TEXT[s] ?? s}`);
}

/** "Re-butta" / "Re-butta ×2" tag text for a taka sent back to butta cutting `count` times. */
export const reButtaTag = (count: number) => (count > 1 ? `Re-butta ×${count}` : 'Re-butta');
export const REMILL_TAG = 'Re-mill';
export const SENT_BACK_BY_OWNER = 'Sent back by owner';
