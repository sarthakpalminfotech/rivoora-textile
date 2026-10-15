/**
 * The order pipeline shown on the order dashboard: main stages → sub-stages, taka stages, damage types and alert
 * rules. Config-driven so later sprints only CONNECT data instead of redesigning the page.
 *
 * ┌──────────────────────────────────────────────────────────────────────────────────────────────────────────┐
 * │ CONNECTED (Sprint 9): taka entry → butta cutting (send / receive / QC) → waiting for mill → at mill →     │
 * │ received back (Mill QC) → final takas in the godown → ready for dispatch; refinish takas go back to the   │
 * │ mill. Dispatch itself comes in a later sprint.                                                            │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Production sub-stages are measured in jobsheets (by jobsheet status); every later sub-stage is measured in takas
 * (by `takas.stage`). A completed jobsheet leaves the jobsheet sub-stages once it has at least one active taka —
 * from then on its takas are counted instead.
 */

/* ------------------------------------------------------------------ */
/* Main stages                                                          */
/* ------------------------------------------------------------------ */

export const MAIN_STAGE_KEYS = ['production', 'butta', 'mill', 'ready'] as const;
export type MainStageKey = (typeof MAIN_STAGE_KEYS)[number];

export type StageUnit = 'jobsheets' | 'takas';

export interface MainStageConfig {
  key: MainStageKey;
  label: string;
  /** Unit of the big count on the main stage card. */
  unit: StageUnit;
  colour: string;
  connected: boolean;
}

export const MAIN_STAGES: readonly MainStageConfig[] = [
  { key: 'production', label: 'Production', unit: 'jobsheets', colour: '#0EA5E9', connected: true },
  // Not connected yet — see the note at the top of this file.
  { key: 'butta', label: 'Butta cutting', unit: 'takas', colour: '#F59E0B', connected: true },
  // The whole order goes to the mill together for dyeing. Only "Waiting for mill" is connected so far.
  { key: 'mill', label: 'Mill', unit: 'takas', colour: '#8B5CF6', connected: true },
  // Connected in Sprint 9: final takas in the godown → ready for dispatch.
  { key: 'ready', label: 'Ready', unit: 'takas', colour: '#10B981', connected: true },
];

/* ------------------------------------------------------------------ */
/* Taka stages (`takas.stage`)                                          */
/* ------------------------------------------------------------------ */

/**
 * Where a taka is. `entered` = taka entry done, waiting for butta cutting · `at_butta` = sent on a challan ·
 * `butta_qc` = received back, Butta QC pending · `waiting_mill` = Butta QC done (or the design skips butta
 * cutting) · the rest comes with the mill / ready sprints. Stored in `takas.stage` (NOT NULL, default `entered`).
 */
export const TAKA_STAGES = [
  'entered',
  'at_butta',
  'butta_qc',
  'waiting_mill',
  'at_mill',
  'mill_qc',
  'final',
  'refinish',
  'ready_dispatch',
  // Sprint 12: sent back to butta cutting by the owner · handed to the client on a dispatch challan.
  'rework_butta',
  'dispatched',
] as const;
export type TakaStage = (typeof TAKA_STAGES)[number];
export const DEFAULT_TAKA_STAGE: TakaStage = 'entered';

export function isTakaStage(value: unknown): value is TakaStage {
  return typeof value === 'string' && (TAKA_STAGES as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------ */
/* Sub-stages                                                           */
/* ------------------------------------------------------------------ */

export const JOBSHEET_SUB_STAGE_KEYS = ['not_sent', 'with_supervisor', 'on_loom', 'taka_pending'] as const;
export type JobsheetSubStageKey = (typeof JOBSHEET_SUB_STAGE_KEYS)[number];

export const SUB_STAGE_KEYS = [
  ...JOBSHEET_SUB_STAGE_KEYS,
  'taka_done',
  'at_butta',
  'butta_qc',
  'waiting_mill',
  'at_mill',
  'mill_qc',
  'refinish',
  'final',
  'ready_dispatch',
  'rework_butta',
  'dispatched',
] as const;
export type SubStageKey = (typeof SUB_STAGE_KEYS)[number];

export interface SubStageConfig {
  key: SubStageKey;
  label: string;
  /** Short label for the KPI cards. */
  shortLabel: string;
  mainStage: MainStageKey;
  unit: StageUnit;
  colour: string;
  /** False until the flow behind it is built (the dashboard shows 0 with "Coming soon"). */
  connected: boolean;
  /** Taka sub-stages: the taka stage(s) counted here. */
  takaStages?: readonly TakaStage[];
}

export const SUB_STAGES: readonly SubStageConfig[] = [
  // Production — rules by jobsheet status (see `jobsheetSubStage`), then the takas waiting for butta cutting.
  { key: 'not_sent', label: 'Not assigned to supervisor', shortLabel: 'Not assigned', mainStage: 'production', unit: 'jobsheets', colour: '#94A3B8', connected: true },
  { key: 'with_supervisor', label: 'Waiting to start on loom', shortLabel: 'Waiting to start', mainStage: 'production', unit: 'jobsheets', colour: '#F59E0B', connected: true },
  { key: 'on_loom', label: 'On loom', shortLabel: 'On loom', mainStage: 'production', unit: 'jobsheets', colour: '#3B82F6', connected: true },
  { key: 'taka_pending', label: 'Taka entry pending', shortLabel: 'Taka entry pending', mainStage: 'production', unit: 'jobsheets', colour: '#14B8A6', connected: true },
  { key: 'taka_done', label: 'Taka entry done · waiting for butta cutting', shortLabel: 'Taka entry done', mainStage: 'production', unit: 'takas', colour: '#A855F7', connected: true, takaStages: ['entered'] },
  // Butta cutting — connected in Sprint 7.
  { key: 'at_butta', label: 'At butta cutting', shortLabel: 'At butta cutting', mainStage: 'butta', unit: 'takas', colour: '#F59E0B', connected: true, takaStages: ['at_butta'] },
  { key: 'butta_qc', label: 'Received · QC pending', shortLabel: 'QC pending', mainStage: 'butta', unit: 'takas', colour: '#EAB308', connected: true, takaStages: ['butta_qc'] },
  // Sprint 12: sent back to butta cutting by Jenish / Gaurang, waiting for the next butta challan.
  { key: 'rework_butta', label: 'Sent back to butta cutting · waiting', shortLabel: 'Sent back · waiting', mainStage: 'butta', unit: 'takas', colour: '#FB923C', connected: true, takaStages: ['rework_butta'] },
  // Mill — connected in Sprint 8 (send / receive on mill challans). The Mill QC comes in a later sprint.
  { key: 'waiting_mill', label: 'Waiting for mill', shortLabel: 'Waiting for mill', mainStage: 'mill', unit: 'takas', colour: '#D97706', connected: true, takaStages: ['waiting_mill'] },
  { key: 'at_mill', label: 'At mill (dyeing)', shortLabel: 'At mill', mainStage: 'mill', unit: 'takas', colour: '#8B5CF6', connected: true, takaStages: ['at_mill'] },
  { key: 'mill_qc', label: 'Received · QC pending', shortLabel: 'QC pending', mainStage: 'mill', unit: 'takas', colour: '#A78BFA', connected: true, takaStages: ['mill_qc'] },
  // Refinish — Mill QC marked it; waits in inventory to go back to the mill (Sprint 9).
  { key: 'refinish', label: 'Refinish (in inventory)', shortLabel: 'Refinish', mainStage: 'mill', unit: 'takas', colour: '#EC4899', connected: true, takaStages: ['refinish'] },
  // Ready — Sprint 9: Mill QC done (final takas with the godown supervisor), then confirmed ready to dispatch.
  { key: 'final', label: 'Final takas (godown)', shortLabel: 'Final takas', mainStage: 'ready', unit: 'takas', colour: '#10B981', connected: true, takaStages: ['final'] },
  { key: 'ready_dispatch', label: 'Ready for dispatch', shortLabel: 'Ready for dispatch', mainStage: 'ready', unit: 'takas', colour: '#059669', connected: true, takaStages: ['ready_dispatch'] },
  // Sprint 12: dispatched to the client on a dispatch challan (DC-n).
  { key: 'dispatched', label: 'Dispatched', shortLabel: 'Dispatched', mainStage: 'ready', unit: 'takas', colour: '#0F766E', connected: true, takaStages: ['dispatched'] },
];

const subByKey = new Map<string, SubStageConfig>(SUB_STAGES.map((s) => [s.key, s]));
const mainByKey = new Map<string, MainStageConfig>(MAIN_STAGES.map((s) => [s.key, s]));

export function isSubStageKey(value: unknown): value is SubStageKey {
  return typeof value === 'string' && subByKey.has(value);
}

export function isMainStageKey(value: unknown): value is MainStageKey {
  return typeof value === 'string' && mainByKey.has(value);
}

export function getSubStage(key: SubStageKey): SubStageConfig {
  return subByKey.get(key)!;
}

export function getMainStage(key: MainStageKey): MainStageConfig {
  return mainByKey.get(key)!;
}

export function subStagesOf(main: MainStageKey): SubStageConfig[] {
  return SUB_STAGES.filter((s) => s.mainStage === main);
}

/** The sub-stage a taka stage belongs to. */
export const TAKA_STAGE_SUB: Record<TakaStage, SubStageKey> = Object.fromEntries(
  SUB_STAGES.flatMap((s) => (s.takaStages ?? []).map((t) => [t, s.key])),
) as Record<TakaStage, SubStageKey>;

export function takaStageMain(stage: string): MainStageKey {
  const sub = isTakaStage(stage) ? TAKA_STAGE_SUB[stage] : 'taka_done';
  return getSubStage(sub).mainStage;
}

/** Label of a taka's current stage (Damages tab). */
export function takaStageLabel(stage: string): string {
  return isTakaStage(stage) ? getSubStage(TAKA_STAGE_SUB[stage]).label : stage;
}

/** Short label of a taka's current stage (chips, the Takas tab filter). */
export function takaStageShortLabel(stage: string): string {
  return isTakaStage(stage) ? getSubStage(TAKA_STAGE_SUB[stage]).shortLabel : stage;
}

/** Colour of a taka's stage (the dot on a taka chip) — from the pipeline config. */
export function takaStageColour(stage: string): string {
  return isTakaStage(stage) ? getSubStage(TAKA_STAGE_SUB[stage]).colour : '#94A3B8';
}

/**
 * The jobsheet sub-stage of an active jobsheet: pending → Not assigned to supervisor · sent → Waiting to start on
 * loom · ongoing → On loom ·
 * completed without takas → Taka entry pending. A completed jobsheet WITH takas is in none (its takas are counted).
 */
export function jobsheetSubStage(status: string, takaCount: number): JobsheetSubStageKey | null {
  switch (status) {
    case 'pending':
      return 'not_sent';
    case 'sent':
      return 'with_supervisor';
    case 'ongoing':
      return 'on_loom';
    case 'completed':
      return takaCount > 0 ? null : 'taka_pending';
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* Damage types                                                         */
/* ------------------------------------------------------------------ */

export const DAMAGE_TYPES = ['machine', 'butta', 'mill', 'unmarked', 'godown', 'customer_return'] as const;
export type DamageType = (typeof DAMAGE_TYPES)[number];

export interface DamageTypeConfig {
  key: DamageType;
  label: string;
  /** When it is recorded. */
  recordedWhen: string;
  connected: boolean;
}

export const DAMAGE_TYPE_CONFIG: readonly DamageTypeConfig[] = [
  { key: 'machine', label: 'Machine damage', recordedWhen: 'At taka entry', connected: true },
  // To connect later: a NEW damage found at the QC after butta cutting / after the mill.
  { key: 'butta', label: 'Butta cutting damage', recordedWhen: 'At the QC after butta cutting', connected: true },
  { key: 'mill', label: 'Mill damage', recordedWhen: 'At the QC after the mill', connected: true },
  // Sprint 13: nothing chosen at a goods return → "Damage type not marked".
  { key: 'unmarked', label: 'Damage type not marked', recordedWhen: 'At goods return (GR), no type chosen', connected: true },
  // Legacy labels: older damages keep them (new damages always carry machine / butta / mill / not marked).
  { key: 'godown', label: 'Supervisor marked', recordedWhen: 'By the godown supervisor (older damages)', connected: true },
  { key: 'customer_return', label: 'Customer return', recordedWhen: 'At goods return (older damages)', connected: true },
];

export const DAMAGE_TYPE_LABEL = Object.fromEntries(DAMAGE_TYPE_CONFIG.map((d) => [d.key, d.label])) as Record<DamageType, string>;

export function isDamageType(value: unknown): value is DamageType {
  return typeof value === 'string' && (DAMAGE_TYPES as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------ */
/* Alerts ("Needs attention")                                           */
/* ------------------------------------------------------------------ */

/** A jobsheet sent to the supervisor more than this many hours ago and not started yet raises an alert. */
export const ALERT_NOT_STARTED_HOURS = 24;

export type AlertKind = 'not_started' | 'coverage';

/** The alert rules the dashboard evaluates (add more here; `buildOrderDashboard` implements each kind). */
export const ALERT_RULES: readonly { kind: AlertKind; label: string; limitHours?: number }[] = [
  { kind: 'not_started', label: `Sent to the supervisor more than ${ALERT_NOT_STARTED_HOURS}h ago, not started`, limitHours: ALERT_NOT_STARTED_HOURS },
  { kind: 'coverage', label: 'Frames short / over, jobsheet quantity less / more than the order' },
];

/** "30h", or "3d 4h" from two days on. */
export function formatHours(hours: number): string {
  const h = Math.max(0, Math.floor(hours));
  if (h < 48) return `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

/**
 * Plain-words status of a taka at its current stage — what to say about a taka that is NOT ready to send
 * ("6251 (At butta cutting)", "6252 (Butta QC pending)").
 */
export const TAKA_STAGE_STATUS_TEXT: Record<TakaStage, string> = {
  entered: 'Taka entry done',
  at_butta: 'At butta cutting',
  butta_qc: 'Butta QC pending',
  waiting_mill: 'Waiting for mill',
  at_mill: 'At mill',
  mill_qc: 'Mill QC pending',
  final: 'Final takas (godown)',
  refinish: 'Refinish',
  ready_dispatch: 'Ready for dispatch',
  rework_butta: 'Sent back to butta cutting',
  dispatched: 'Dispatched',
};

export function takaStageStatusText(stage: string): string {
  return isTakaStage(stage) ? TAKA_STAGE_STATUS_TEXT[stage] : stage;
}
