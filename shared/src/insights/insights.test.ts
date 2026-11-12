import { describe, expect, it } from 'vitest';
import { can, ROLE_KEYS } from '../roles';
import {
  ageBucket,
  averageStages,
  beyondTolerance,
  dashboardLayoutSchema,
  DASHBOARDS,
  defaultLayout,
  diffPct,
  dispatchWeek,
  formatValue,
  homeDashboard,
  lastMonths,
  median,
  mergeLayout,
  nextWeeks,
  overlapHours,
  percentile,
  periodRange,
  quietClient,
  rupeesShort,
  stageDurations,
  topShare,
  utilisation,
  visibleCardIds,
} from './index';

describe('Sprint 25 · periods', () => {
  const now = new Date('2026-11-12T10:00:00Z');
  it('periods end today (IST) and have a previous window of the same length', () => {
    const p = periodRange('30d', now);
    expect(p.to).toBe('2026-11-12');
    expect(p.from).toBe('2026-10-14');
    expect(p.days).toBe(30);
    expect(p.prevTo).toBe('2026-10-13');
    expect(periodRange('7d', now).from).toBe('2026-11-06');
    expect(periodRange('fy', now).from).toBe('2026-04-01');
    expect(periodRange('fy', new Date('2027-02-01T00:00:00Z')).from).toBe('2026-04-01');
  });
  it('an instant late in the UTC evening is already the next IST day', () => {
    expect(periodRange('7d', new Date('2026-11-12T19:00:00Z')).to).toBe('2026-11-13');
  });
  it('last 12 months, oldest first, ending this month', () => {
    const m = lastMonths(12, '2026-11-12');
    expect(m[0]).toBe('2025-12');
    expect(m[11]).toBe('2026-11');
  });
});

describe('Sprint 25 · maths', () => {
  it('median / 90th percentile', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
  });
  it('±10 %: only MORE than 10 % either way is listed', () => {
    expect(beyondTolerance(110, 100)).toBe(false);
    expect(beyondTolerance(90, 100)).toBe(false);
    expect(beyondTolerance(111, 100)).toBe(true);
    expect(beyondTolerance(89, 100)).toBe(true);
    expect(diffPct(80, 100)).toBe(-20);
  });
  it('top 3 share of the booked value', () => {
    const r = topShare([{ key: 1, value: 50 }, { key: 2, value: 20 }, { key: 3, value: 20 }, { key: 4, value: 10 }], 3);
    expect(r.share).toBe(90);
    expect(r.top.map((t) => t.key)).toEqual([1, 2, 3]);
  });
  it('clients gone quiet: usual gap = median of the last 5 gaps, passed by more than 50 %', () => {
    const days = ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01'];
    expect(quietClient(days, '2026-06-10')).toBeNull(); // 40 days since, gap ~30 → 1.33×
    const q = quietClient(days, '2026-06-20');
    expect(q?.daysSince).toBe(50);
    expect(q?.lastDay).toBe('2026-05-01');
    expect(quietClient(['2026-01-01'], '2026-12-01')).toBeNull();
  });
  it('QC / rework age buckets', () => {
    expect(ageBucket(0)).toBe('0–1 d');
    expect(ageBucket(1)).toBe('0–1 d');
    expect(ageBucket(3)).toBe('2–3 d');
    expect(ageBucket(4)).toBe('> 3 d');
  });
  it('where the days go: time between status changes, the last one running until the end', () => {
    const d = stageDurations({
      start: '2026-11-01T00:00:00Z',
      firstStatus: 'pending_production',
      changes: [
        { at: '2026-11-03T00:00:00Z', to: 'jobsheet_created' },
        { at: '2026-11-08T00:00:00Z', to: 'in_butta_cutting' },
      ],
      endAt: '2026-11-10T00:00:00Z',
    });
    expect(d.jobsheet_pending).toBe(2);
    expect(d.production).toBe(5);
    expect(d.butta).toBe(2);
    const avg = averageStages([d, { production: 1 }]);
    expect(avg.find((s) => s.key === 'production')?.days).toBe(3);
    expect(avg.find((s) => s.key === 'mill')?.orders).toBe(0);
  });
  it('loom hours inside the period, utilisation capped at 100 %', () => {
    expect(overlapHours('2026-11-01T00:00:00Z', '2026-11-03T00:00:00Z', '2026-11-02T00:00:00Z', '2026-11-05T00:00:00Z')).toBe(24);
    expect(overlapHours('2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z', '2026-11-02T00:00:00Z', '2026-11-05T00:00:00Z')).toBe(0);
    expect(utilisation(36, 3, 24)).toBe(50);
    expect(utilisation(36, 3, 12)).toBe(100);
    expect(utilisation(5, 0, 24)).toBeNull();
  });
  it('dispatch expected: week by stage, Monday-based week labels', () => {
    expect(dispatchWeek('ready_dispatch')).toBe(1);
    expect(dispatchWeek('final')).toBe(2);
    expect(dispatchWeek('at_mill')).toBe(3);
    expect(dispatchWeek('at_butta')).toBe(4);
    expect(dispatchWeek('dispatched')).toBeNull();
    const w = nextWeeks('2026-11-12', 4); // a Thursday
    expect(w[0]).toEqual({ from: '2026-11-09', label: 'This week' });
    expect(w[1].label).toBe('Wk of 16 Nov');
  });
  it('numbers with unit, Indian style', () => {
    expect(rupeesShort(480000)).toBe('₹ 4.8 L');
    expect(rupeesShort(12500000)).toBe('₹ 1.25 Cr');
    expect(rupeesShort(4820)).toBe('₹ 4,820');
    expect(formatValue(1240, 'pcs')).toBe('1,240 pcs');
    expect(formatValue(1, 'pcs')).toBe('1 pc');
    expect(formatValue(860.5, 'm')).toBe('860.5 m');
    expect(formatValue(12.34, 'pct')).toBe('12.3 %');
    expect(formatValue(null, 'pcs')).toBe('—');
  });
});

describe('Sprint 25 · registry + C11 layout', () => {
  it('exactly the considered cards, none of the "not considered" ones', () => {
    expect(DASHBOARDS.owner.cards).toHaveLength(35);
    expect(DASHBOARDS.partner.cards).toHaveLength(19);
    expect(DASHBOARDS.supervisor.cards).toHaveLength(11);
    const titles = Object.values(DASHBOARDS).flatMap((d) => d.cards.map((c) => c.title.toLowerCase()));
    for (const never of ['top clients (6 months)', 'new vs repeat clients', 'order mix', 'yarn rate trend', 'all looms right now', 'empty looms', 'start these first', 'beams used this week'])
      expect(titles).not.toContain(never);
    const ids = Object.values(DASHBOARDS).flatMap((d) => [...d.cards.map((c) => c.id), ...d.strip.map((s) => s.id)]);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('who opens which dashboard', () => {
    expect(homeDashboard('jemish')).toBe('owner');
    expect(homeDashboard('gaurang')).toBe('partner');
    expect(homeDashboard('supervisor')).toBe('supervisor');
    expect(homeDashboard('qc')).toBeNull();
    for (const r of ROLE_KEYS) expect(can(r, 'canArrangeDashboards')).toBe(r === 'jemish' || r === 'gaurang');
    expect(can('supervisor', 'canViewSupervisorDashboard')).toBe(true);
    expect(can('supervisor', 'canViewOwnerDashboard')).toBe(false);
    expect(can('gaurang', 'canViewOwnerDashboard')).toBe(true);
  });
  it('the default layout follows the prompt; the pinned attention card is not in it', () => {
    const l = defaultLayout('owner');
    expect(l.sections.map((s) => s.key)[0]).toBe('pulse');
    expect(l.sections[0].cards.map((c) => c.id)).toEqual(['o.glance', 'o.booked_month', 'o.value_month', 'o.open_status']);
    expect(l.sections.flatMap((s) => s.cards).some((c) => c.id === 'o.attention')).toBe(false);
    expect(visibleCardIds('owner', l)).toContain('o.attention');
  });
  it('a saved layout keeps its order / widths / hidden cards, drops unknown ones and adds new cards back', () => {
    const saved = {
      sections: [
        { key: 'clients', title: 'Our clients', cards: [{ id: 'o.quiet', width: 'full' as const, hidden: false }, { id: 'o.bogus', width: 'small' as const, hidden: false }, { id: 'o.glance', width: 'normal' as const, hidden: true }] },
      ],
    };
    const m = mergeLayout('owner', saved);
    expect(m.sections[0]).toEqual({ key: 'clients', title: 'Our clients', cards: [{ id: 'o.quiet', width: 'full', hidden: false }, { id: 'o.glance', width: 'normal', hidden: true }, { id: 'o.top3', width: 'normal', hidden: false }] });
    expect(m.sections).toHaveLength(DASHBOARDS.owner.sections.length);
    const all = m.sections.flatMap((s) => s.cards.map((c) => c.id));
    expect(all.filter((id) => id === 'o.glance')).toHaveLength(1);
    expect(all).toHaveLength(34);
    expect(visibleCardIds('owner', m)).not.toContain('o.glance');
  });
  it('the layout body is validated', () => {
    expect(dashboardLayoutSchema.safeParse({ sections: [] }).success).toBe(false);
    expect(dashboardLayoutSchema.safeParse({ sections: [{ key: 'pulse', title: ' ', cards: [] }] }).success).toBe(false);
    expect(dashboardLayoutSchema.safeParse({ sections: [{ key: 'pulse', title: 'Pulse', cards: [{ id: 'o.glance', width: 'huge' }] }] }).success).toBe(false);
  });
});
