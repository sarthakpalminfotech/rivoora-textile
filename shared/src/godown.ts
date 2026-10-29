/**
 * Mill QC and the godown (Sprint 9): which takas the Mill QC may open, and the godown order screen's numbers (KPIs,
 * the checked-pcs bar, expected vs actual pcs, the ready-to-dispatch rules). Pure — server and client share it.
 */
import { takaActualMeters, takaActualPcs } from './takas';

/* ------------------------------------------------------------------ */
/* Mill QC: which takas can be opened                                   */
/* ------------------------------------------------------------------ */

/**
 * What the Mill QC does with a taka it opens by number:
 * `qc` = `mill_qc`, the normal check · `qc_not_received` = `at_mill` (sent, not marked received yet — opens with a
 * warning and is marked received on save) · `checked` = already final / ready to dispatch (read-only) ·
 * `never_sent` = it was never sent to the mill, or it is marked for refinish (blocked).
 */
export type MillQcOpenState = 'qc' | 'qc_not_received' | 'checked' | 'never_sent';

export function millQcOpenState(stage: string): MillQcOpenState {
  switch (stage) {
    case 'mill_qc':
      return 'qc';
    case 'at_mill':
      return 'qc_not_received';
    case 'final':
    case 'ready_dispatch':
      return 'checked';
    default:
      return 'never_sent';
  }
}

export const MILL_QC_TEXT = {
  notReceived: {
    en: 'Not marked received from the mill yet — it will be marked received when you save',
    hi: 'मिल से वापसी दर्ज नहीं है — सेव करने पर दर्ज हो जाएगी',
  },
  neverSent: { en: 'This taka was not sent to the mill', hi: 'यह टाका मिल नहीं गया' },
  checked: { en: 'Already checked', hi: 'पहले से जांचा गया' },
} as const;

/* ------------------------------------------------------------------ */
/* Godown order screen                                                  */
/* ------------------------------------------------------------------ */

export interface GodownTakaLike {
  stage: string;
  pcs: number | null;
  actualPcs: number | null;
  /** Sprint 19: the meter twins (set instead, for a meter order's taka). */
  meters?: number | null;
  actualMeters?: number | null;
  /** Ticked by the godown supervisor ("I have checked this taka"). */
  checked: boolean;
}

/** Stages of the order's FINAL takas (Mill QC done): in the godown, or already confirmed ready to dispatch. */
export const FINAL_STAGES: readonly string[] = ['final', 'ready_dispatch'];

export interface GodownKpis {
  /** All active takas of the order. */
  total: number;
  /** Takas that passed the Mill QC (final + ready to dispatch, damaged ones included). */
  cleared: number;
  /** Checked takas (ticked final takas + the ones already ready to dispatch) and their actual pcs. */
  checkedTakas: number;
  checkedPcs: number;
  /** Takas marked for refinish. */
  refinish: number;
  /** Final takas ticked and still waiting for "Ready to dispatch" (the sticky button's N). */
  readyCount: number;
  readyPcs: number;
  /** Final takas not ticked yet. */
  uncheckedCount: number;
  /** Expected vs actual pcs of all final takas (final + ready to dispatch). */
  expectedPcs: number;
  actualPcs: number;
  /** Sprint 19: the meter twins — populated instead of the pcs figures above for a meter order's takas. */
  checkedMeters: number;
  readyMeters: number;
  expectedMeters: number;
  actualMeters: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function godownKpis(takas: readonly GodownTakaLike[]): GodownKpis {
  const k: GodownKpis = {
    total: takas.length,
    cleared: 0,
    checkedTakas: 0,
    checkedPcs: 0,
    refinish: 0,
    readyCount: 0,
    readyPcs: 0,
    uncheckedCount: 0,
    expectedPcs: 0,
    actualPcs: 0,
    checkedMeters: 0,
    readyMeters: 0,
    expectedMeters: 0,
    actualMeters: 0,
  };
  for (const t of takas) {
    if (t.stage === 'refinish') k.refinish += 1;
    if (!FINAL_STAGES.includes(t.stage)) continue;
    const meterTaka = t.pcs == null && t.meters != null;
    const actualP = takaActualPcs(t) ?? 0;
    const actualM = takaActualMeters(t) ?? 0;
    k.cleared += 1;
    k.expectedPcs += t.pcs ?? 0;
    k.actualPcs += actualP;
    k.expectedMeters = round2(k.expectedMeters + (meterTaka ? t.meters ?? 0 : 0));
    k.actualMeters = round2(k.actualMeters + (meterTaka ? actualM : 0));
    if (t.stage === 'ready_dispatch' || t.checked) {
      k.checkedTakas += 1;
      k.checkedPcs += actualP;
      k.checkedMeters = round2(k.checkedMeters + (meterTaka ? actualM : 0));
    }
    if (t.stage === 'final') {
      if (t.checked) {
        k.readyCount += 1;
        k.readyPcs += actualP;
        k.readyMeters = round2(k.readyMeters + (meterTaka ? actualM : 0));
      } else k.uncheckedCount += 1;
    }
  }
  return k;
}

export interface PcsBar {
  /** 0–100 of the fill (capped at 100). */
  fillPercent: number;
  /** More pcs were checked than ordered (a different shade). */
  over: boolean;
  /** "236 / 300 pcs checked" */
  text: string;
}

/** The slim bar: actual pcs of the checked takas against the ordered pcs. */
export function checkedPcsBar(checkedPcs: number, orderedPcs: number): PcsBar {
  const percent = orderedPcs > 0 ? (checkedPcs / orderedPcs) * 100 : 0;
  return {
    fillPercent: Math.min(100, Math.round(percent * 10) / 10),
    over: orderedPcs > 0 && checkedPcs > orderedPcs,
    text: `${checkedPcs.toLocaleString('en-IN')} / ${orderedPcs.toLocaleString('en-IN')} pcs checked`,
  };
}

/** "Actual 296 pcs vs expected 300 (−4)" and whether the two differ. */
export function actualVsExpectedLine(actual: number, expected: number): { text: string; differs: boolean } {
  const diff = actual - expected;
  const sign = diff === 0 ? '' : ` (${diff > 0 ? '+' : '−'}${Math.abs(diff)})`;
  return { text: `Actual ${actual.toLocaleString('en-IN')} pcs vs expected ${expected.toLocaleString('en-IN')}${sign}`, differs: diff !== 0 };
}

/** Sprint 19: the meter twin of `checkedPcsBar`. */
export function checkedMetersBar(checkedMeters: number, orderedMeters: number): PcsBar {
  const percent = orderedMeters > 0 ? (checkedMeters / orderedMeters) * 100 : 0;
  const fmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  return {
    fillPercent: Math.min(100, Math.round(percent * 10) / 10),
    over: orderedMeters > 0 && checkedMeters > orderedMeters,
    text: `${fmt(checkedMeters)} / ${fmt(orderedMeters)} m checked`,
  };
}

/** Sprint 19: the meter twin of `actualVsExpectedLine`. */
export function actualVsExpectedMetersLine(actual: number, expected: number): { text: string; differs: boolean } {
  const diff = round2(actual - expected);
  const fmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const sign = diff === 0 ? '' : ` (${diff > 0 ? '+' : '−'}${fmt(Math.abs(diff))})`;
  return { text: `Actual ${fmt(actual)} m vs expected ${fmt(expected)}${sign}`, differs: diff !== 0 };
}

/** A taka can be confirmed "Ready to dispatch" only when it is final (in the godown) and ticked. */
export const canReadyDispatch = (t: Pick<GodownTakaLike, 'stage' | 'checked'>) => t.stage === 'final' && t.checked;

/** Which of the chosen takas can't be confirmed (not final, or not checked) — the server answers 409 with these. */
export function readyDispatchBlockers<T extends GodownTakaLike>(takas: readonly T[]): T[] {
  return takas.filter((t) => !canReadyDispatch(t));
}
