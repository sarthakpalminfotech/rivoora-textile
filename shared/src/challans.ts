/**
 * Challans: butta cutting and the mill run on ONE engine. Everything that differs between the two lives in
 * `CHALLAN_KIND_CONFIG` (number prefix, counter, the stage a taka must be in to be sent, the stages it moves to, the
 * labels and the route). Server and client read this; adding a third kind only means adding an entry.
 */
import type { TakaStage } from './pipeline';

export const CHALLAN_KINDS = ['butta', 'mill'] as const;
export type ChallanKind = (typeof CHALLAN_KINDS)[number];

export function isChallanKind(value: unknown): value is ChallanKind {
  return typeof value === 'string' && (CHALLAN_KINDS as readonly string[]).includes(value);
}

export interface ChallanKindConfig {
  kind: ChallanKind;
  /** "Butta cutting" / "Mill" — the module name and the kind badge. */
  label: string;
  /** Prefix of the challan number: GSM-173 / MIL-12. Numbers start at 1 and are never reused. */
  prefix: string;
  /** The `counters` row the numbers come from. */
  counter: string;
  /** "Butta party" / "Mill party". */
  partyLabel: string;
  /** Where a taka is sent ("butta cutting" / "the mill"), used in sentences. */
  place: string;
  /** "for butta cutting" / "to the mill": "Taka 6245 was not sent <sentToText>". */
  sentToText: string;
  /** Client route of the module. */
  route: string;
  /** Taka stage that can be sent on a challan of this kind. */
  readyStage: TakaStage;
  /** Stages a taka that is NOT yet sent of this kind can be in (the "total" of "18 / 20 ready"). */
  notSentStages: readonly TakaStage[];
  /** A second stage a taka can be sent from (the mill: takas marked for refinish go back on a normal challan). */
  refinishStage?: TakaStage;
  /** Stage after sending / after receiving back. */
  sentStage: TakaStage;
  receivedStage: TakaStage;
  /** Label of the Send → "in …" tab. */
  inLabel: string;
  /** Accent colour (dots, thin bars, badges only). */
  colour: string;
}

export const CHALLAN_KIND_CONFIG: Record<ChallanKind, ChallanKindConfig> = {
  butta: {
    kind: 'butta',
    label: 'Butta cutting',
    prefix: 'GSM',
    counter: 'butta_challan_no',
    partyLabel: 'Butta party',
    place: 'butta cutting',
    sentToText: 'for butta cutting',
    route: '/butta',
    readyStage: 'entered',
    notSentStages: ['entered'],
    sentStage: 'at_butta',
    receivedStage: 'butta_qc',
    inLabel: 'In butta cutting',
    colour: '#F59E0B',
  },
  mill: {
    kind: 'mill',
    label: 'Mill',
    prefix: 'MIL',
    counter: 'mill_challan_no',
    partyLabel: 'Mill party',
    place: 'the mill',
    sentToText: 'to the mill',
    route: '/mill',
    readyStage: 'waiting_mill',
    notSentStages: ['entered', 'at_butta', 'butta_qc', 'waiting_mill'],
    refinishStage: 'refinish',
    sentStage: 'at_mill',
    receivedStage: 'mill_qc',
    inLabel: 'In mill',
    colour: '#8B5CF6',
  },
};

/** `GSM-173` / `MIL-12` (butta when the kind is not given). */
export const challanLabel = (challanNo: number, kind: ChallanKind = 'butta') => `${CHALLAN_KIND_CONFIG[kind].prefix}-${challanNo}`;

/** The challan number typed in a search box: "173", "GSM-173", "gsm 173" → 173 (else null). The prefix must match the kind. */
export function parseChallanNo(text: string, kind: ChallanKind = 'butta'): number | null {
  const m = new RegExp(`^(?:${CHALLAN_KIND_CONFIG[kind].prefix}[\\s-]*)?(\\d{1,9})$`, 'i').exec(text.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 ? n : null;
}

/* ------------------------------------------------------------------ */
/* Readiness ("18 / 20 ready to send")                                  */
/* ------------------------------------------------------------------ */

export interface SendableTaka {
  id: number;
  takaNo: string;
  stage: string;
}

/** A taka is "ready" in the Pending list when it is in the kind's ready stage. */
export const isTakaReady = (stage: string, kind: ChallanKind) => stage === CHALLAN_KIND_CONFIG[kind].readyStage;

/** Every stage a taka can be put on a challan from: the ready stage, and (the mill) the refinish stage. */
export const sendableStages = (kind: ChallanKind): TakaStage[] => {
  const cfg = CHALLAN_KIND_CONFIG[kind];
  return cfg.refinishStage ? [cfg.readyStage, cfg.refinishStage] : [cfg.readyStage];
};

/**
 * Splits a selection into the takas that can go now and the ones that are not ready yet ("Send ready takas only (N)").
 * Both lists keep the input order, so `notReady` can be grouped by order and listed with its current stage.
 */
export function splitReadyTakas<T extends SendableTaka>(takas: readonly T[], kind: ChallanKind): { ready: T[]; notReady: T[] } {
  const ready: T[] = [];
  const notReady: T[] = [];
  for (const t of takas) (isTakaReady(t.stage, kind) ? ready : notReady).push(t);
  return { ready, notReady };
}
