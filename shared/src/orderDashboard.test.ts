import { describe, expect, it } from 'vitest';
import { buildOrderDashboard, type DashboardJobsheetInput, type DashboardTakaInput } from './orderDashboard';
import { ALERT_NOT_STARTED_HOURS, getSubStage, jobsheetSubStage, takaStageColour, takaStageMain, TAKA_STAGES } from './pipeline';

const NOW = new Date('2026-09-30T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

const order = { orderNo: 26, unit: 'pcs', quantity: 90, jobsheetPieces: 90, targetFrames: 30 };

let nextId = 1;
function js(p: Partial<DashboardJobsheetInput> & Pick<DashboardJobsheetInput, 'status'>): DashboardJobsheetInput {
  const id = p.id ?? nextId++;
  return {
    id,
    jobsheetNo: p.jobsheetNo ?? 300 + id,
    frames: 10,
    completedFrames: p.status === 'completed' ? (p.frames ?? 10) : null,
    sentAt: null,
    startedAt: null,
    completedAt: null,
    runningMachineId: null,
    ...p,
  };
}
const taka = (jobsheetId: number, p: Partial<DashboardTakaInput> = {}): DashboardTakaInput => ({
  jobsheetId,
  stage: 'entered',
  isDamaged: false,
  ...p,
});

const sub = (d: ReturnType<typeof buildOrderDashboard>, key: string) => d.subStages.find((s) => s.key === key)!;
const main = (d: ReturnType<typeof buildOrderDashboard>, key: string) => d.mainStages.find((s) => s.key === key)!;
const bar = (d: ReturnType<typeof buildOrderDashboard>, key: string) => d.bar.find((s) => s.stage === key)!.frames;

describe('pipeline config', () => {
  it('maps every taka stage to a main stage', () => {
    expect(TAKA_STAGES.map(takaStageMain)).toEqual(['production', 'butta', 'butta', 'mill', 'mill', 'mill', 'ready']);
  });

  it('jobsheet sub-stage rules', () => {
    expect(jobsheetSubStage('pending', 0)).toBe('not_sent');
    expect(jobsheetSubStage('sent', 0)).toBe('with_supervisor');
    expect(jobsheetSubStage('ongoing', 0)).toBe('on_loom');
    expect(jobsheetSubStage('completed', 0)).toBe('taka_pending');
    expect(jobsheetSubStage('completed', 2)).toBeNull();
  });
});

describe('buildOrderDashboard — sub-stages', () => {
  it('counts every production sub-stage', () => {
    const a = js({ status: 'pending', frames: 12 });
    const b = js({ status: 'sent', frames: 10, sentAt: hoursAgo(5) });
    const c = js({ status: 'sent', frames: 10, sentAt: hoursAgo(30) });
    const d = js({ status: 'ongoing', frames: 10, runningMachineId: 7 });
    const e = js({ status: 'ongoing', frames: 10, runningMachineId: 7 });
    const f = js({ status: 'ongoing', frames: 10, runningMachineId: 9 });
    const g = js({ status: 'completed', frames: 10 }); // no takas → taka entry pending
    const h = js({ status: 'completed', frames: 10, completedFrames: 8 }); // takas → counted as takas
    const d0 = buildOrderDashboard(
      {
        order,
        jobsheets: [a, b, c, d, e, f, g, h],
        takas: [taka(h.id), taka(h.id, { isDamaged: true }), taka(h.id)],
        damages: [{ foundAt: 'machine', count: 1, pcs: 2 }],
      },
      NOW,
    );
    expect(sub(d0, 'not_sent')).toMatchObject({ count: 1, frames: 12 });
    expect(sub(d0, 'with_supervisor')).toMatchObject({ count: 2, frames: 20, oldestSince: c.sentAt, overdue: true });
    expect(sub(d0, 'on_loom')).toMatchObject({ count: 3, frames: 30, machines: 2 });
    expect(sub(d0, 'taka_pending')).toMatchObject({ count: 1, frames: 10 });
    expect(sub(d0, 'taka_done')).toMatchObject({ count: 3, jobsheetCount: 1, damaged: 1 });

    expect(main(d0, 'production')).toMatchObject({ count: 8, takas: 3, damaged: 1, hasWork: true });
    expect(d0.production).toEqual({ jobsheets: 8, frames: 80, wovenFrames: 18, wovenPcs: 54, onLoomFrames: 30, takas: 3, takaPcs: null });
    expect(d0.progress).toMatchObject({ wovenFrames: 18, wovenPcs: 54, targetPcs: 90, percent: 60 });
    expect(d0.defaultStage).toBe('production');
  });

  it('counts takas in future stages under their own sub-stage', () => {
    const a = js({ status: 'completed', frames: 10 });
    const d = buildOrderDashboard(
      { order, jobsheets: [a], takas: [taka(a.id, { stage: 'at_butta', count: 2 }), taka(a.id, { stage: 'mill_qc', isDamaged: true })] },
      NOW,
    );
    expect(sub(d, 'at_butta').count).toBe(2);
    expect(sub(d, 'mill_qc')).toMatchObject({ count: 1, damaged: 1 });
    expect(sub(d, 'taka_pending').count).toBe(0);
    expect(main(d, 'butta')).toMatchObject({ count: 2, takas: 2 });
    expect(main(d, 'mill')).toMatchObject({ count: 1, damaged: 1 });
    expect(main(d, 'production').hasWork).toBe(false);
    expect(d.defaultStage).toBe('butta');
  });
});

describe('buildOrderDashboard — bar shares (frames)', () => {
  it('a jobsheet without takas counts fully in Production; entered takas stay in Production', () => {
    const a = js({ status: 'ongoing', frames: 10 });
    const b = js({ status: 'completed', frames: 10, completedFrames: 8 });
    const d = buildOrderDashboard({ order, jobsheets: [a, b], takas: [taka(b.id), taka(b.id)] }, NOW);
    expect(bar(d, 'production')).toBe(18);
    expect(bar(d, 'butta')).toBe(0);
    expect(d.barTotalFrames).toBe(18);
    expect(d.bar.find((s) => s.stage === 'production')!.share).toBe(1);
  });

  it('spreads a jobsheet over the stages of its takas, by taka count (fake future stages)', () => {
    const a = js({ status: 'completed', frames: 10, completedFrames: 8 });
    const b = js({ status: 'pending', frames: 6 });
    const d = buildOrderDashboard(
      {
        order,
        jobsheets: [a, b],
        // 4 takas: 1 entered, 2 at butta, 1 ready → 8 frames split 2 / 4 / 0 / 2.
        takas: [taka(a.id), taka(a.id, { stage: 'at_butta', count: 2 }), taka(a.id, { stage: 'ready' })],
      },
      NOW,
    );
    expect(bar(d, 'production')).toBe(2 + 6);
    expect(bar(d, 'butta')).toBe(4);
    expect(bar(d, 'mill')).toBe(0);
    expect(bar(d, 'ready')).toBe(2);
    expect(d.barTotalFrames).toBe(14);
    expect(main(d, 'butta').pcs).toBe(12);
    expect(d.bar.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1);
  });
});

describe('buildOrderDashboard — alerts', () => {
  it(`raises "not started" only after ${ALERT_NOT_STARTED_HOURS}h`, () => {
    const early = js({ status: 'sent', jobsheetNo: 327, sentAt: hoursAgo(23) });
    const late = js({ status: 'sent', jobsheetNo: 328, sentAt: hoursAgo(25) });
    const d1 = buildOrderDashboard({ order: { ...order, jobsheetPieces: 30, targetFrames: 10, quantity: 30 }, jobsheets: [early], takas: [] }, NOW);
    expect(d1.alerts).toEqual([]);
    expect(sub(d1, 'with_supervisor').overdue).toBe(false);

    const d2 = buildOrderDashboard(
      { order: { ...order, jobsheetPieces: 60, targetFrames: 20, quantity: 60 }, jobsheets: [early, late], takas: [] },
      NOW,
    );
    expect(d2.alerts).toEqual([
      {
        rule: 'not_started',
        kind: 'not_started',
        message: 'Order #26 (328) sent to supervisor 25h ago, not started yet',
        jobsheetId: late.id,
        jobsheetNo: 328,
      },
    ]);
  });

  it('includes the coverage warnings with their existing texts', () => {
    const a = js({ status: 'pending', frames: 10 });
    const d = buildOrderDashboard({ order: { orderNo: 26, unit: 'pcs', quantity: 90, jobsheetPieces: 30, targetFrames: 10 }, jobsheets: [a], takas: [] }, NOW);
    expect(d.alerts.map((a) => a.kind)).toEqual(['pieces_less']);
    expect(d.alerts[0]!.message).toBe('Jobsheet quantity (30 pcs) is less than the order (90 pcs).');
  });
});

describe('buildOrderDashboard — damages (open damages by where they were found)', () => {
  it('counts open damages and their pcs per found_at; damaged takas per sub-stage', () => {
    const a = js({ status: 'completed' });
    const d = buildOrderDashboard(
      {
        order,
        jobsheets: [a],
        takas: [taka(a.id, { isDamaged: true, count: 2 }), taka(a.id, { isDamaged: true, stage: 'butta_qc' }), taka(a.id, { count: 5 })],
        // One taka has two open damages (machine + butta); a null found_at counts as machine.
        damages: [
          { foundAt: 'machine', count: 2, pcs: 5 },
          { foundAt: null, count: 1 },
          { foundAt: 'butta', count: 2, pcs: 3 },
        ],
      },
      NOW,
    );
    expect(d.damages).toEqual([
      { type: 'machine', count: 3, pcs: 5, connected: true },
      { type: 'butta', count: 2, pcs: 3, connected: true },
      { type: 'mill', count: 0, pcs: null, connected: false },
    ]);
    expect(d.damageTotal).toBe(5);
    expect(d.takaCount).toBe(8);
    expect(main(d, 'production').damaged).toBe(2);
    expect(main(d, 'butta').damaged).toBe(1);
  });

  it('no damages input = no damage counts', () => {
    const a = js({ status: 'completed' });
    const d = buildOrderDashboard({ order, jobsheets: [a], takas: [taka(a.id)] }, NOW);
    expect(d.damageTotal).toBe(0);
  });
});

describe('buildOrderDashboard — butta cutting is connected (Sprint 7)', () => {
  it('counts the new stages under their sub-stages and flags what is connected', () => {
    const a = js({ status: 'completed' });
    const d = buildOrderDashboard(
      {
        order,
        jobsheets: [a],
        takas: [taka(a.id, { stage: 'entered', count: 3 }), taka(a.id, { stage: 'at_butta', count: 4 }), taka(a.id, { stage: 'butta_qc', count: 2 }), taka(a.id, { stage: 'waiting_mill', count: 5 })],
      },
      NOW,
    );
    expect(sub(d, 'taka_done').count).toBe(3);
    expect(sub(d, 'at_butta')).toMatchObject({ count: 4, connected: true });
    expect(sub(d, 'butta_qc')).toMatchObject({ count: 2, connected: true });
    expect(sub(d, 'waiting_mill')).toMatchObject({ count: 5, connected: true, mainStage: 'mill' });
    expect(sub(d, 'at_mill').connected).toBe(false);
    expect(d.subStages.some((s) => (s.key as string) === 'butta_done')).toBe(false);
    expect(main(d, 'butta')).toMatchObject({ count: 6, connected: true });
    expect(main(d, 'mill')).toMatchObject({ count: 5 });
    expect(getSubStage('butta_qc').label).toBe('Received · QC pending');
  });

  it('maps every taka stage to its colour dot', () => {
    expect(takaStageColour('at_butta')).toBe('#F59E0B');
    expect(takaStageColour('nonsense')).toBe('#94A3B8');
  });
});

describe('buildOrderDashboard — no jobsheets', () => {
  it('returns zeros and falls back to the order quantity', () => {
    const d = buildOrderDashboard({ order: { orderNo: 26, unit: 'pcs', quantity: 304, jobsheetPieces: 0, targetFrames: 0 }, jobsheets: [], takas: [] }, NOW);
    expect(d.hasJobsheets).toBe(false);
    expect(d.progress).toEqual({ wovenFrames: 0, wovenPcs: 0, targetPcs: 304, percent: 0 });
    expect(d.mainStages.every((m) => m.count === 0 && !m.hasWork)).toBe(true);
    expect(d.subStages.every((s) => s.count === 0)).toBe(true);
    expect(d.bar.every((b) => b.frames === 0 && b.share === 0)).toBe(true);
    expect(d.alerts).toEqual([]);
    expect(d.defaultStage).toBe('production');
  });

  it('non-pcs orders are flagged', () => {
    const d = buildOrderDashboard({ order: { orderNo: 26, unit: 'kg', quantity: 50, jobsheetPieces: 0, targetFrames: 0 }, jobsheets: [], takas: [] }, NOW);
    expect(d.isPcs).toBe(false);
    expect(d.progress.targetPcs).toBe(50);
  });
});

describe('buildOrderDashboard — taka pcs', () => {
  it('totals the pcs of the takas (aggregated rows carry sums); null while no taka has pcs', () => {
    const a = js({ status: 'completed' });
    const withPcs = buildOrderDashboard(
      { order, jobsheets: [a], takas: [taka(a.id, { count: 2, pcs: 24 }), taka(a.id, { pcs: null }), taka(a.id, { isDamaged: true, pcs: 5 })] },
      NOW,
    );
    expect(withPcs.production.takaPcs).toBe(29);
    expect(sub(withPcs, 'taka_done').takaPcs).toBe(29);
    expect(withPcs.production.takas).toBe(4);
    const none = buildOrderDashboard({ order, jobsheets: [a], takas: [taka(a.id)] }, NOW);
    expect(none.production.takaPcs).toBeNull();
  });

  it('uses the new production sub-stage labels', () => {
    expect(getSubStage('not_sent').label).toBe('Not assigned to supervisor');
    expect(getSubStage('with_supervisor').label).toBe('Waiting to start on loom');
  });
});
