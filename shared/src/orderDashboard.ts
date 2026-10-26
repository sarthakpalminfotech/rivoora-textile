import { coverageWarnings, effectiveFrames, coverageFrames, jobsheetRef, orderJobsheetPlan, sectionsOf, type CoverageWarningKind } from './jobsheets';
import {
  ALERT_NOT_STARTED_HOURS,
  DAMAGE_TYPE_CONFIG,
  formatHours,
  isDamageType,
  isTakaStage,
  jobsheetSubStage,
  MAIN_STAGES,
  SUB_STAGES,
  TAKA_STAGE_SUB,
  takaStageMain,
  type AlertKind,
  type DamageType,
  type MainStageKey,
  type StageUnit,
  type SubStageKey,
} from './pipeline';
import type { JobsheetStatusKey, OrderStatusKey } from './statuses';
import { ALL_STEPS, orderKind, type OrderKind, type OrderSteps } from './orderSteps';
import { EMPTY_OUTSIDE_TOTALS, type OutsidePoTotals } from './outside';

/**
 * The order dashboard (order details → Dashboard tab), computed from the order, its ACTIVE jobsheets and its ACTIVE
 * takas. Pure: the server loads the rows with aggregate queries and calls this; tests call it directly.
 * Stages, sub-stages, damage types and alert limits come from `pipeline.ts`.
 */

/* ------------------------------------------------------------------ */
/* input                                                                */
/* ------------------------------------------------------------------ */

export interface DashboardOrderInput {
  orderNo: number;
  unit: string;
  quantity: number;
}

export interface DashboardJobsheetInput {
  id: number;
  jobsheetNo: number;
  status: string;
  frames: number;
  completedFrames: number | null;
  sentAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  runningMachineId: number | null;
  /** Sprint 18: sections per beam of the jobsheet (default 3). */
  sections?: number | null;
}

/** Active takas — one row per taka, or aggregated rows with a `count` (default 1). */
export interface DashboardTakaInput {
  jobsheetId: number;
  stage: string;
  /** The taka has at least one OPEN damage. */
  isDamaged: boolean;
  count?: number;
  /** Pcs of the taka (aggregated rows: the sum; null when none of them has pcs). */
  pcs?: number | null;
  /** Aggregated rows: how many of the takas have no pcs (default: all of them when `pcs` is null, else none). */
  withoutPcs?: number;
}

/** OPEN damages of the order, aggregated by where they were found (`taka_damages.found_at`). */
export interface DashboardDamageInput {
  foundAt: string | null;
  count?: number;
  /** Damaged pcs (the sum; null when none of them has pcs). */
  pcs?: number | null;
}

export interface DashboardInput {
  order: DashboardOrderInput;
  jobsheets: readonly DashboardJobsheetInput[];
  takas: readonly DashboardTakaInput[];
  /** Open damages by `found_at` (the damage tiles). Taka rows only say WHICH takas are damaged. */
  damages?: readonly DashboardDamageInput[];
  /** How many active takas went through butta cutting (have a butta challan). 0 = the order skipped it. Default: unknown (counts as gone through). */
  buttaTakas?: number;
  /** Sprint 16: the order's steps (default: all ticked — the old dashboard). */
  steps?: OrderSteps;
  /** Sprint 16: the order's outside POs (default: none). */
  outside?: OutsidePoTotals;
}

/* ------------------------------------------------------------------ */
/* output                                                               */
/* ------------------------------------------------------------------ */

export interface SubStageCount {
  key: SubStageKey;
  /** Sprint 16: a label that replaces the config's for this order ("Received · waiting for butta cutting"). */
  label?: string;
  mainStage: MainStageKey;
  unit: StageUnit;
  connected: boolean;
  /** Jobsheets or takas, per `unit`. */
  count: number;
  /** Jobsheet sub-stages: frames (actual frames once completed). */
  frames: number;
  /** Taka sub-stages: how many jobsheets the takas come from. */
  jobsheetCount: number;
  /** On loom: distinct running machines. */
  machines: number;
  damaged: number;
  /** Taka sub-stages: pcs entered on its takas (null when none has pcs). */
  takaPcs: number | null;
  /** Waiting to start: the oldest `sent_at`. */
  oldestSince: string | null;
  /** True when the oldest item is over the alert limit. */
  overdue: boolean;
}

export interface MainStageCount {
  key: MainStageKey;
  unit: StageUnit;
  connected: boolean;
  /** Production: active jobsheets. Other stages: takas. */
  count: number;
  takas: number;
  damaged: number;
  /** The stage's share of the pcs (see `bar`). */
  pcs: number;
  /** Anything in this stage right now. */
  hasWork: boolean;
  /** Fully finished for this order ("✓ Completed"), or passed over ("Skipped": no taka went to butta cutting). */
  state: StageState;
}

export type StageState = 'completed' | 'skipped' | null;

export interface ProductionTotals {
  jobsheets: number;
  /** Frames in the jobsheets (actual frames for Completed ones). */
  frames: number;
  /** Actual frames of Completed jobsheets. */
  wovenFrames: number;
  wovenPcs: number;
  onLoomFrames: number;
  takas: number;
  /** Pcs entered on the takas (null when no taka has pcs yet). */
  takaPcs: number | null;
}

export interface DashboardProgress {
  wovenFrames: number;
  wovenPcs: number;
  /** The jobsheet quantity, or the order quantity while there are no jobsheets. */
  targetPcs: number;
  /** 0–100 (can exceed 100 when more was woven than planned). */
  percent: number;
}

export interface BarShare {
  stage: MainStageKey;
  pcs: number;
  /** 0–1 of `barTotalPcs`. */
  share: number;
}

export interface DamageCount {
  type: DamageType;
  /** Open damages found at this point. */
  count: number;
  /** Damaged pcs of those damages (null when none has pcs). */
  pcs: number | null;
  connected: boolean;
}

export interface DashboardAlert {
  rule: AlertKind;
  kind: 'not_started' | CoverageWarningKind;
  message: string;
  jobsheetId?: number;
  jobsheetNo?: number;
}

export interface OrderDashboardData {
  /** Sprint 16: in-house / outside production / FG purchase, and the ticked steps. */
  kind: OrderKind;
  steps: OrderSteps;
  /** Sprint 16: the order's outside POs (all zero when it has none). */
  outside: OutsidePoTotals;
  isPcs: boolean;
  hasJobsheets: boolean;
  progress: DashboardProgress;
  bar: BarShare[];
  barTotalPcs: number;
  mainStages: MainStageCount[];
  subStages: SubStageCount[];
  production: ProductionTotals;
  damages: DamageCount[];
  damageTotal: number;
  takaCount: number;
  alerts: DashboardAlert[];
  /** Production, or the earliest main stage that has work. */
  defaultStage: MainStageKey;
}

/** GET /orders/:id/dashboard */
export interface OrderDashboard extends OrderDashboardData {
  orderId: number;
  orderNo: number;
  status: OrderStatusKey;
  generatedAt: string;
}

/* ------------------------------------------------------------------ */
/* build                                                                */
/* ------------------------------------------------------------------ */

const HOUR_MS = 3_600_000;

function hoursSince(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : (now.getTime() - t) / HOUR_MS;
}

const takaSub = (stage: string): SubStageKey => (isTakaStage(stage) ? TAKA_STAGE_SUB[stage] : 'taka_done');
const damageOf = (foundAt: string | null): DamageType => (isDamageType(foundAt) ? foundAt : 'machine');

export function buildOrderDashboard(input: DashboardInput, now: Date = new Date()): OrderDashboardData {
  const { order, jobsheets, takas, damages: openDamages = [] } = input;
  const isPcs = order.unit === 'pcs';
  // Sprint 16: the order's steps decide which main stages show; outside / FG orders get their own first card.
  const steps = input.steps ?? ALL_STEPS;
  const kind = orderKind(steps);
  const outside = input.outside ?? EMPTY_OUTSIDE_TOTALS;
  const firstStage: MainStageKey = kind === 'in_house' ? 'production' : kind === 'outside_production' ? 'outside' : 'purchase';

  const subs = new Map<SubStageKey, SubStageCount>(
    SUB_STAGES.map((s) => [
      s.key,
      {
        key: s.key,
        mainStage: s.mainStage,
        unit: s.unit,
        connected: s.connected,
        count: 0,
        frames: 0,
        jobsheetCount: 0,
        machines: 0,
        damaged: 0,
        takaPcs: null,
        oldestSince: null,
        overdue: false,
      },
    ]),
  );

  // Takas per jobsheet and per main stage (for the jobsheet rules and the bar shares).
  const takasByJobsheet = new Map<number, Map<MainStageKey, number>>();
  // Own pcs of the takas per jobsheet and main stage, and how many of them have none (they get a share of the frames).
  const pcsByJobsheet = new Map<number, Map<MainStageKey, { pcs: number; without: number }>>();
  const subJobsheets = new Map<SubStageKey, Set<number>>();
  let takaCount = 0;
  let takaPcs: number | null = null;
  for (const t of takas) {
    const n = t.count ?? 1;
    if (n <= 0) continue;
    takaCount += n;
    if (t.pcs != null) takaPcs = (takaPcs ?? 0) + t.pcs;
    const sub = subs.get(takaSub(t.stage))!;
    sub.count += n;
    if (t.pcs != null) sub.takaPcs = (sub.takaPcs ?? 0) + t.pcs;
    if (t.isDamaged) sub.damaged += n;
    const set = subJobsheets.get(sub.key) ?? new Set<number>();
    set.add(t.jobsheetId);
    subJobsheets.set(sub.key, set);
    const perMain = takasByJobsheet.get(t.jobsheetId) ?? new Map<MainStageKey, number>();
    const main = takaStageMain(t.stage);
    perMain.set(main, (perMain.get(main) ?? 0) + n);
    takasByJobsheet.set(t.jobsheetId, perMain);
    const perPcs = pcsByJobsheet.get(t.jobsheetId) ?? new Map<MainStageKey, { pcs: number; without: number }>();
    const cur = perPcs.get(main) ?? { pcs: 0, without: 0 };
    cur.pcs += t.pcs ?? 0;
    cur.without += Math.min(n, t.withoutPcs ?? (t.pcs == null ? n : 0));
    perPcs.set(main, cur);
    pcsByJobsheet.set(t.jobsheetId, perPcs);
  }
  for (const [key, set] of subJobsheets) subs.get(key)!.jobsheetCount = set.size;

  // Jobsheet sub-stages, production totals and the bar shares.
  const barPcs = new Map<MainStageKey, number>(MAIN_STAGES.map((m) => [m.key, 0]));
  const addPcs = (stage: MainStageKey, n: number) => barPcs.set(stage, barPcs.get(stage)! + n);
  const loomMachines = new Set<number>();
  let wovenFrames = 0;
  let wovenPcs = 0;
  let onLoomFrames = 0;
  const alerts: DashboardAlert[] = [];
  const sorted = [...jobsheets].sort((a, b) => a.jobsheetNo - b.jobsheetNo);

  for (const j of sorted) {
    const frames = effectiveFrames({ frames: j.frames, status: j.status as JobsheetStatusKey, completedFrames: j.completedFrames });
    const perMain = takasByJobsheet.get(j.id);
    const jsTakas = perMain ? [...perMain.values()].reduce((s, n) => s + n, 0) : 0;
    // Sprint 18: every jobsheet has its own sections per beam.
    const sheetPcs = frames * sectionsOf(j);

    if (j.status === 'completed') {
      wovenFrames += frames;
      wovenPcs += sheetPcs;
    }
    if (j.status === 'ongoing') {
      onLoomFrames += frames;
      if (j.runningMachineId !== null) loomMachines.add(j.runningMachineId);
    }

    const subKey = jobsheetSubStage(j.status, jsTakas);
    if (subKey) {
      const sub = subs.get(subKey)!;
      sub.count += 1;
      sub.frames += frames;
      if (subKey === 'with_supervisor' && j.sentAt && (!sub.oldestSince || j.sentAt < sub.oldestSince)) {
        sub.oldestSince = j.sentAt;
      }
    }

    // Rule 1: sent to the supervisor more than ALERT_NOT_STARTED_HOURS ago and not started.
    if (j.status === 'sent') {
      const h = hoursSince(j.sentAt, now);
      if (h !== null && h > ALERT_NOT_STARTED_HOURS) {
        alerts.push({
          rule: 'not_started',
          kind: 'not_started',
          message: `${jobsheetRef(order.orderNo, j.jobsheetNo)} sent to supervisor ${formatHours(h)} ago, not started yet`,
          jobsheetId: j.id,
          jobsheetNo: j.jobsheetNo,
        });
      }
    }

    // Bar (in pcs): no takas → the jobsheet's frames × its sections per beam, still Production; otherwise every taka
    // counts its own pcs, and a taka without pcs gets its share of the jobsheet's frames × sections.
    if (!perMain || jsTakas === 0) {
      addPcs('production', sheetPcs);
    } else {
      const perTaka = sheetPcs / jsTakas;
      for (const [main, p] of pcsByJobsheet.get(j.id) ?? []) addPcs(main, p.pcs + p.without * perTaka);
    }
  }
  // Takas moved here from another order keep their old jobsheet: their own pcs still count in the bar.
  const ownJobsheets = new Set(sorted.map((j) => j.id));
  for (const [jobsheetId, perPcs] of pcsByJobsheet) {
    if (ownJobsheets.has(jobsheetId)) continue;
    for (const [main, p] of perPcs) addPcs(main, p.pcs);
  }
  // Sprint 16: pcs still at outside weavers (open pcs POs) count where the order is being made (same as the inventory).
  addPcs('production', outside.pcsPending);
  // Orders without Production: everything before butta cutting belongs to their first card (Outside production / Purchase).
  if (firstStage !== 'production') {
    addPcs(firstStage, barPcs.get('production')!);
    barPcs.set('production', 0);
  }
  subs.get('on_loom')!.machines = loomMachines.size;
  const waiting = subs.get('with_supervisor')!;
  const oldestHours = hoursSince(waiting.oldestSince, now);
  waiting.overdue = oldestHours !== null && oldestHours > ALERT_NOT_STARTED_HOURS;

  // Live jobsheet figures (Sprint 15): from the active jobsheets, never from stored order counters.
  // Sprint 16: pcs given outside on pcs POs don't need jobsheets.
  const livePlan = orderJobsheetPlan(
    Math.max(0, order.quantity - outside.pcsCommitted),
    jobsheets.map((j) => ({ frames: j.frames, status: j.status as JobsheetStatusKey, completedFrames: j.completedFrames, sections: j.sections, jobsheetNo: j.jobsheetNo })),
  );
  // Rule 2: the coverage warnings (frames short / over, jobsheet quantity less / more), texts unchanged.
  if (isPcs && jobsheets.length > 0) {
    const warnings = coverageWarnings(livePlan);
    for (const w of warnings) alerts.push({ rule: 'coverage', kind: w.kind, message: w.message });
  }

  const totalPcs = [...barPcs.values()].reduce((s, n) => s + n, 0);
  const allBar: BarShare[] = MAIN_STAGES.map((m) => {
    const p = barPcs.get(m.key)!;
    return { stage: m.key, pcs: Math.round(p), share: totalPcs > 0 ? p / totalPcs : 0 };
  });

  // Completed / skipped main stages (visual state only).
  const stageCount = (...stages: string[]) => takas.reduce((n, t) => n + (stages.includes(t.stage) ? t.count ?? 1 : 0), 0);
  const productionDone =
    kind === 'in_house'
      ? jobsheets.length > 0 &&
        jobsheets.every((j) => j.status === 'completed' && (takasByJobsheet.get(j.id)?.size ?? 0) > 0) &&
        stageCount('entered') === 0 &&
        outside.openPos === 0
      : kind === 'outside_production'
        ? outside.pos > 0 && outside.openPos === 0 && takaCount > 0 && stageCount('entered') === 0
        : takaCount > 0;
  const buttaDone = productionDone && stageCount('entered', 'rework_butta', 'at_butta', 'butta_qc') === 0 && takaCount > 0;
  const buttaSkipped = buttaDone && input.buttaTakas === 0;
  const millDone = buttaDone && takaCount > 0 && stageCount('final', 'ready_dispatch', 'dispatched') === takaCount;
  const readyDone = takaCount > 0 && stageCount('ready_dispatch', 'dispatched') === takaCount;
  const stateOf = (key: MainStageKey, connected: boolean): StageState => {
    if (!connected) return null;
    if (key === 'production' || key === 'outside' || key === 'purchase') return productionDone ? 'completed' : null;
    if (key === 'butta') return buttaSkipped ? 'skipped' : buttaDone ? 'completed' : null;
    if (key === 'mill') return millDone ? 'completed' : null;
    if (key === 'ready') return readyDone ? 'completed' : null;
    return null;
  };

  // Sprint 16: sub-stages that apply to this order. Outside / FG orders have no jobsheet sub-stages; their takas waiting
  // for butta cutting belong to the first card; the PO sub-stages count open POs.
  for (const key of ['outside_po', 'at_weaver'] as const) {
    const s = subs.get(key)!;
    s.count = outside.openPos;
    s.takaPcs = outside.pcsPending > 0 ? outside.pcsPending : null;
  }
  const subList: SubStageCount[] = [];
  for (const cfg of SUB_STAGES) {
    const s = subs.get(cfg.key)!;
    if (cfg.unit === 'jobsheets' && kind !== 'in_house') continue;
    if (cfg.key === 'outside_po' && !(kind === 'in_house' && outside.pos > 0)) continue;
    if (cfg.key === 'at_weaver' && kind !== 'outside_production') continue;
    if (cfg.key === 'taka_done' && kind !== 'in_house') {
      if (!steps.hasButta && s.count === 0) continue;
      subList.push({ ...s, mainStage: firstStage, label: 'Received · waiting for butta cutting' });
      continue;
    }
    subList.push(s);
  }

  const shownMain = (key: MainStageKey, work: boolean, pcs: number): boolean => {
    if (key === 'production' || key === 'outside' || key === 'purchase') return key === firstStage;
    // A step that is not ticked shows only while a taka is there anyway (rework / refinish is always allowed).
    if (key === 'butta') return steps.hasButta || work || pcs > 0;
    if (key === 'mill') return steps.hasMill || work || pcs > 0;
    return true;
  };
  const allMain: MainStageCount[] = MAIN_STAGES.map((m) => {
    const own = subList.filter((s) => s.mainStage === m.key);
    const takasHere = own.filter((s) => s.unit === 'takas').reduce((n, s) => n + s.count, 0);
    const base: MainStageCount = {
      key: m.key,
      unit: m.unit,
      connected: m.connected,
      count: m.key === 'production' ? jobsheets.length : takasHere,
      takas: m.key === 'production' ? takaCount : takasHere,
      damaged: own.reduce((n, s) => n + s.damaged, 0),
      pcs: allBar.find((b) => b.stage === m.key)!.pcs,
      hasWork: own.some((s) => s.count > 0),
      state: stateOf(m.key, m.connected),
    };
    // Outside production: the POs (and how many takas came); Purchase: what was received (awaiting = work to do).
    if (m.key === 'outside') return { ...base, unit: 'pos', count: outside.pos, takas: outside.takasReceived };
    if (m.key === 'purchase') return { ...base, count: takaCount, takas: takaCount, hasWork: takaCount === 0 };
    return base;
  });
  const mainStages = allMain.filter((m) => shownMain(m.key, m.hasWork, m.pcs));
  const shownKeys = new Set(mainStages.map((m) => m.key));
  const bar = allBar.filter((b) => shownKeys.has(b.stage));

  // In-house: the jobsheet quantity (+ what is given outside); outside / FG orders: the order quantity.
  const targetPcs = kind === 'in_house' && jobsheets.length > 0 ? livePlan.jobsheetPieces + outside.pcsCommitted : order.quantity;
  const damageCounts = new Map<DamageType, { count: number; pcs: number | null }>();
  for (const d of openDamages) {
    const n = d.count ?? 1;
    if (n <= 0) continue;
    const type = damageOf(d.foundAt);
    const cur = damageCounts.get(type) ?? { count: 0, pcs: null };
    cur.count += n;
    if (d.pcs != null) cur.pcs = (cur.pcs ?? 0) + d.pcs;
    damageCounts.set(type, cur);
  }
  const damages: DamageCount[] = DAMAGE_TYPE_CONFIG.map((d) => ({
    type: d.key,
    count: damageCounts.get(d.key)?.count ?? 0,
    pcs: damageCounts.get(d.key)?.pcs ?? null,
    connected: d.connected,
  }));

  return {
    kind,
    steps,
    outside,
    isPcs,
    hasJobsheets: jobsheets.length > 0,
    progress: {
      wovenFrames,
      wovenPcs,
      targetPcs,
      percent: targetPcs > 0 ? Math.round((wovenPcs / targetPcs) * 1000) / 10 : 0,
    },
    bar,
    barTotalPcs: Math.round(totalPcs),
    mainStages,
    subStages: subList,
    production: {
      jobsheets: jobsheets.length,
      frames: coverageFrames(jobsheets.map((j) => ({ frames: j.frames, status: j.status as JobsheetStatusKey, completedFrames: j.completedFrames }))),
      wovenFrames,
      wovenPcs,
      onLoomFrames,
      takas: takaCount,
      takaPcs,
    },
    damages,
    damageTotal: damages.reduce((n, d) => n + d.count, 0),
    takaCount,
    alerts,
    defaultStage: mainStages.find((m) => m.hasWork)?.key ?? firstStage,
  };
}
