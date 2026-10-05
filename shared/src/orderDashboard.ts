import { coverageWarnings, effectiveFrames, coverageFrames, jobsheetRef, type CoverageWarningKind } from './jobsheets';
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
import { SECTIONS_PER_BEAM } from './production';
import type { JobsheetStatusKey, OrderStatusKey } from './statuses';

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
  /** `orders.jobsheet_pieces` */
  jobsheetPieces: number;
  /** `orders.target_frames` */
  targetFrames: number;
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
}

/* ------------------------------------------------------------------ */
/* output                                                               */
/* ------------------------------------------------------------------ */

export interface SubStageCount {
  key: SubStageKey;
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
  /** The stage's share of the frames (see `bar`), and that share in pieces. */
  frames: number;
  pcs: number;
  /** Anything in this stage right now. */
  hasWork: boolean;
}

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
  frames: number;
  /** 0–1 of `barTotalFrames`. */
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
  isPcs: boolean;
  hasJobsheets: boolean;
  progress: DashboardProgress;
  bar: BarShare[];
  barTotalFrames: number;
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
const round2 = (n: number) => Math.round(n * 100) / 100;

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
  }
  for (const [key, set] of subJobsheets) subs.get(key)!.jobsheetCount = set.size;

  // Jobsheet sub-stages, production totals and the bar shares.
  const barFrames = new Map<MainStageKey, number>(MAIN_STAGES.map((m) => [m.key, 0]));
  const loomMachines = new Set<number>();
  let wovenFrames = 0;
  let onLoomFrames = 0;
  const alerts: DashboardAlert[] = [];
  const sorted = [...jobsheets].sort((a, b) => a.jobsheetNo - b.jobsheetNo);

  for (const j of sorted) {
    const frames = effectiveFrames({ frames: j.frames, status: j.status as JobsheetStatusKey, completedFrames: j.completedFrames });
    const perMain = takasByJobsheet.get(j.id);
    const jsTakas = perMain ? [...perMain.values()].reduce((s, n) => s + n, 0) : 0;

    if (j.status === 'completed') wovenFrames += frames;
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

    // Bar: no takas → all of it is still Production; otherwise spread over the stages of its takas.
    if (!perMain || jsTakas === 0) {
      barFrames.set('production', barFrames.get('production')! + frames);
    } else {
      for (const [main, n] of perMain) barFrames.set(main, barFrames.get(main)! + (frames * n) / jsTakas);
    }
  }
  subs.get('on_loom')!.machines = loomMachines.size;
  const waiting = subs.get('with_supervisor')!;
  const oldestHours = hoursSince(waiting.oldestSince, now);
  waiting.overdue = oldestHours !== null && oldestHours > ALERT_NOT_STARTED_HOURS;

  // Rule 2: the coverage warnings (frames short / over, jobsheet quantity less / more), texts unchanged.
  if (isPcs && jobsheets.length > 0) {
    const warnings = coverageWarnings({
      orderedPieces: order.quantity,
      jobsheetPieces: order.jobsheetPieces,
      targetFrames: order.targetFrames,
      totalFrames: coverageFrames(jobsheets.map((j) => ({ frames: j.frames, status: j.status as JobsheetStatusKey, completedFrames: j.completedFrames }))),
      jobsheetCount: jobsheets.length,
    });
    for (const w of warnings) alerts.push({ rule: 'coverage', kind: w.kind, message: w.message });
  }

  const totalFrames = [...barFrames.values()].reduce((s, n) => s + n, 0);
  const bar: BarShare[] = MAIN_STAGES.map((m) => {
    const f = barFrames.get(m.key)!;
    return { stage: m.key, frames: round2(f), share: totalFrames > 0 ? f / totalFrames : 0 };
  });

  const subList = SUB_STAGES.map((s) => subs.get(s.key)!);
  const mainStages: MainStageCount[] = MAIN_STAGES.map((m) => {
    const own = subList.filter((s) => s.mainStage === m.key);
    const takasHere = own.filter((s) => s.unit === 'takas').reduce((n, s) => n + s.count, 0);
    const frames = barFrames.get(m.key)!;
    return {
      key: m.key,
      unit: m.unit,
      connected: m.connected,
      count: m.key === 'production' ? jobsheets.length : takasHere,
      takas: m.key === 'production' ? takaCount : takasHere,
      damaged: own.reduce((n, s) => n + s.damaged, 0),
      frames: round2(frames),
      pcs: Math.round(frames * SECTIONS_PER_BEAM),
      hasWork: own.some((s) => s.count > 0),
    };
  });

  const wovenPcs = wovenFrames * SECTIONS_PER_BEAM;
  const targetPcs = jobsheets.length > 0 ? order.jobsheetPieces : order.quantity;
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
    isPcs,
    hasJobsheets: jobsheets.length > 0,
    progress: {
      wovenFrames,
      wovenPcs,
      targetPcs,
      percent: targetPcs > 0 ? Math.round((wovenPcs / targetPcs) * 1000) / 10 : 0,
    },
    bar,
    barTotalFrames: round2(totalFrames),
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
    defaultStage: mainStages.find((m) => m.hasWork)?.key ?? 'production',
  };
}
