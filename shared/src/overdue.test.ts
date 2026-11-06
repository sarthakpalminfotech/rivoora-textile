import { describe, expect, it } from 'vitest';
import { alertCounts, buildOverdueAlerts, isOverdue, OVERDUE_LIMITS, wholeDays, type AlertInput } from './overdue';

const NOW = new Date('2026-11-06T12:00:00+05:30');
const daysAgo = (n: number, extraHours = 0) => new Date(NOW.getTime() - (n * 24 + extraHours) * 3_600_000).toISOString();

const base: AlertInput = { jobsheets: [], challans: [], orders: [] };
const js = (startedAt: string) => ({ jobsheetId: 1, jobsheetNo: 319, orderId: 7, orderNo: 26, designCode: 'D101', startedAt, machineNo: 7 });

describe('overdue limits', () => {
  it('lives in one config', () => {
    expect(OVERDUE_LIMITS.productionDays).toBe(3);
    expect(OVERDUE_LIMITS.buttaDays).toBe(3);
    expect(OVERDUE_LIMITS.millDays).toBe(8);
    expect(OVERDUE_LIMITS.wholeOrderDays).toEqual({ jemish: 25, gaurang: 20, supervisor: 20 });
  });
  it('is overdue only once LONGER than the limit', () => {
    expect(isOverdue(daysAgo(3), NOW, 3)).toBe(false);
    expect(isOverdue(daysAgo(3, 1), NOW, 3)).toBe(true);
    expect(wholeDays(daysAgo(4, 5), NOW)).toBe(4);
  });
});

describe('buildOverdueAlerts', () => {
  it('production: a jobsheet on the loom for more than 3 days', () => {
    const a = buildOverdueAlerts({ ...base, jobsheets: [js(daysAgo(5))] }, 'supervisor', NOW);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ type: 'production', orderNo: 26, days: 5, overBy: 2 });
    expect(buildOverdueAlerts({ ...base, jobsheets: [js(daysAgo(2))] }, 'jemish', NOW)).toEqual([]);
  });

  it('butta 3 days / mill 8 days, only while takas are pending', () => {
    const challans = [
      { kind: 'butta' as const, challanId: 1, label: 'GSM-12', challanDate: '2026-11-02', orderId: 7, orderNo: 26, designCode: 'D101', pendingTakas: 5 },
      { kind: 'mill' as const, challanId: 2, label: 'MIL-4', challanDate: '2026-10-30', orderId: 7, orderNo: 26, designCode: 'D101', pendingTakas: 3 },
      { kind: 'mill' as const, challanId: 3, label: 'MIL-5', challanDate: '2026-10-20', orderId: 8, orderNo: 27, designCode: null, pendingTakas: 0 },
    ];
    const a = buildOverdueAlerts({ ...base, challans }, 'gaurang', NOW);
    expect(a.map((x) => x.type).sort()).toEqual(['butta']); // butta 4 days > 3 ✓; mill 7 days < 8 ✗; MIL-5 nothing pending
    const later = buildOverdueAlerts({ ...base, challans }, 'gaurang', new Date('2026-11-09T12:00:00+05:30'));
    expect(later.map((x) => x.type).sort()).toEqual(['butta', 'mill']);
  });

  it('whole order: 25 days for Jenish, 20 for Gaurang and the supervisor; not once dispatched / closed', () => {
    const order = { orderId: 7, orderNo: 26, designCode: 'D101', firstStartedAt: daysAgo(22), status: 'in_production', ordered: 100, dispatched: 0, unit: 'pcs' };
    expect(buildOverdueAlerts({ ...base, orders: [order] }, 'jemish', NOW)).toEqual([]);
    expect(buildOverdueAlerts({ ...base, orders: [order] }, 'gaurang', NOW).map((a) => a.type)).toEqual(['whole_order']);
    expect(buildOverdueAlerts({ ...base, orders: [order] }, 'supervisor', NOW).map((a) => a.type)).toEqual(['whole_order']);
    expect(buildOverdueAlerts({ ...base, orders: [{ ...order, firstStartedAt: daysAgo(30) }] }, 'jemish', NOW)).toHaveLength(1);
    expect(buildOverdueAlerts({ ...base, orders: [{ ...order, firstStartedAt: daysAgo(30), status: 'dispatched', dispatched: 100 }] }, 'jemish', NOW)).toEqual([]);
    expect(buildOverdueAlerts({ ...base, orders: [{ ...order, firstStartedAt: null }] }, 'gaurang', NOW)).toEqual([]);
  });

  it('sent short: Dispatched / Closed with less sent than ordered — owners only', () => {
    const o = { orderId: 7, orderNo: 26, designCode: 'D101', firstStartedAt: daysAgo(10), status: 'dispatched', ordered: 100, dispatched: 90, unit: 'pcs' };
    expect(buildOverdueAlerts({ ...base, orders: [o] }, 'jemish', NOW)[0]).toMatchObject({ type: 'sent_short', stage: 'Sent 90 of 100 pcs' });
    expect(buildOverdueAlerts({ ...base, orders: [o] }, 'gaurang', NOW)).toHaveLength(1);
    expect(buildOverdueAlerts({ ...base, orders: [o] }, 'supervisor', NOW)).toEqual([]);
    expect(buildOverdueAlerts({ ...base, orders: [{ ...o, dispatched: 100 }] }, 'jemish', NOW)).toEqual([]);
    expect(buildOverdueAlerts({ ...base, orders: [{ ...o, status: 'closed' }] }, 'jemish', NOW)).toHaveLength(1);
    expect(buildOverdueAlerts({ ...base, orders: [{ ...o, status: 'in_production' }] }, 'jemish', NOW)).toEqual([]);
  });

  it('counts per type', () => {
    const a = buildOverdueAlerts({ ...base, jobsheets: [js(daysAgo(5)), { ...js(daysAgo(6)), jobsheetId: 2, jobsheetNo: 320 }] }, 'jemish', NOW);
    expect(alertCounts(a).production).toBe(2);
    expect(a[0].days).toBe(6); // most overdue first
  });
});
