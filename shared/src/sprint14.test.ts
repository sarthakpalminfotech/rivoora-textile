import { describe, expect, it } from 'vitest';
import { formatSpan, mainStepsOfHistory, orderMilestones, type OrderMilestoneInput } from './orderMilestones';
import { mergeOrderChallans } from './orderDocs';
import type { OrderChallan, OrderDeliveryChallan } from './types';

const lot = (iso: string, last = iso) => ({ first: iso, last });
const base: OrderMilestoneInput = {
  createdAt: '2026-10-01T09:00:00.000Z',
  productionStartedAt: null,
  buttaApplies: true,
  buttaSent: [],
  buttaReceived: [],
  millSent: [],
  millReceived: [],
  dispatched: [],
};
const byKey = (i: OrderMilestoneInput) => Object.fromEntries(orderMilestones(i).map((m) => [m.key, m]));

describe('formatSpan', () => {
  it('formats days / hours / minutes', () => {
    expect(formatSpan(((4 * 24 + 6) * 60) * 60000, true)).toBe('4 days 6 h');
    expect(formatSpan(((1 * 24) * 60) * 60000, true)).toBe('1 day');
    expect(formatSpan(((2 * 24 + 3) * 60) * 60000)).toBe('2 d 3 h');
    expect(formatSpan((5 * 60 + 20) * 60000)).toBe('5 h 20 min');
    expect(formatSpan(3 * 3600000)).toBe('3 h');
    expect(formatSpan(45 * 60000)).toBe('45 min');
    expect(formatSpan(10000)).toBe('under a minute');
  });
});

describe('orderMilestones', () => {
  it('a new order: created is done, everything else pending', () => {
    const m = orderMilestones(base);
    expect(m.map((s) => s.key)).toEqual(['created', 'in_production', 'butta_sent', 'butta_received', 'mill_sent', 'mill_received', 'dispatched']);
    expect(m[0]).toMatchObject({ state: 'done', lots: 1, sincePrevious: null });
    expect(m.slice(1).every((s) => s.state === 'pending' && s.at === null)).toBe(true);
  });

  it('measures the time between consecutive reached steps', () => {
    const m = byKey({
      ...base,
      productionStartedAt: '2026-10-02T09:00:00.000Z',
      buttaSent: [lot('2026-10-05T10:00:00.000Z')],
      buttaReceived: [lot('2026-10-09T16:00:00.000Z')],
    });
    expect(m.in_production.sincePrevious?.text).toBe('1 d');
    expect(m.butta_sent.sincePrevious?.text).toBe('3 d 1 h');
    expect(m.butta_received.sincePrevious?.text).toBe('Butta cutting took 4 days 6 h');
    expect(m.mill_sent.state).toBe('pending');
  });

  it('lots: first and last time, lot count', () => {
    const m = byKey({
      ...base,
      buttaSent: [lot('2026-10-05T10:00:00.000Z'), lot('2026-10-06T10:00:00.000Z')],
      buttaReceived: [lot('2026-10-08T10:00:00.000Z', '2026-10-08T12:00:00.000Z'), lot('2026-10-12T10:40:00.000Z', '2026-10-12T16:10:00.000Z'), lot('2026-10-10T10:00:00.000Z')],
    });
    expect(m.butta_sent).toMatchObject({ lots: 2, at: '2026-10-05T10:00:00.000Z', lastAt: '2026-10-06T10:00:00.000Z' });
    expect(m.butta_received).toMatchObject({ lots: 3, at: '2026-10-08T10:00:00.000Z', lastAt: '2026-10-12T16:10:00.000Z' });
  });

  it('a design without butta cutting skips both butta steps; the next step is measured from the last reached one', () => {
    const m = byKey({
      ...base,
      buttaApplies: false,
      productionStartedAt: '2026-10-02T09:00:00.000Z',
      millSent: [lot('2026-10-04T12:00:00.000Z')],
    });
    expect(m.butta_sent.state).toBe('skipped');
    expect(m.butta_received.state).toBe('skipped');
    expect(m.mill_sent.state).toBe('done');
    expect(m.mill_sent.sincePrevious?.text).toBe('2 d 3 h');
    expect(m.mill_received.state).toBe('pending');
  });

  it('butta steps that DID happen are done even when the design says skip', () => {
    const m = byKey({ ...base, buttaApplies: false, buttaSent: [lot('2026-10-03T09:00:00.000Z')] });
    expect(m.butta_sent.state).toBe('done');
    expect(m.butta_received.state).toBe('skipped');
  });

  it('mill took / dispatched pill and no negative durations', () => {
    const m = byKey({
      ...base,
      millSent: [lot('2026-10-10T09:00:00.000Z')],
      millReceived: [lot('2026-10-12T09:30:00.000Z')],
      dispatched: [lot('2026-10-11T09:00:00.000Z')],
    });
    expect(m.mill_received.sincePrevious?.text).toBe('Mill took 2 days');
    expect(m.dispatched.sincePrevious).toBeNull();
  });
});

describe('mainStepsOfHistory', () => {
  it('marks the first entry of each main step only', () => {
    const marks = mainStepsOfHistory([
      { id: 1, toStatus: 'pending_production', changedAt: '2026-10-01T09:00:00.000Z' },
      { id: 2, toStatus: 'ready_production', changedAt: '2026-10-01T10:00:00.000Z' },
      { id: 3, toStatus: 'in_production', changedAt: '2026-10-02T10:00:00.000Z' },
      { id: 4, toStatus: 'in_butta_cutting', changedAt: '2026-10-03T10:00:00.000Z' },
      { id: 5, toStatus: 'in_production', changedAt: '2026-10-04T10:00:00.000Z' },
      { id: 6, toStatus: 'partly_dispatched', changedAt: '2026-10-09T10:00:00.000Z' },
      { id: 7, toStatus: 'dispatched', changedAt: '2026-10-10T10:00:00.000Z' },
    ]);
    expect([...marks.entries()]).toEqual([
      [1, 'created'],
      [3, 'in_production'],
      [4, 'butta_sent'],
      [6, 'dispatched'],
    ]);
  });
});

describe('mergeOrderChallans (Docs tab)', () => {
  const challan = (id: number, createdAt: string): OrderChallan & { createdAt: string } => ({
    id,
    kind: 'butta',
    challanNo: id,
    status: 'active',
    partyName: 'P',
    challanDate: '2026-10-01',
    orderTakas: 1,
    orderMeters: 1,
    totalTakas: 1,
    receivedCount: 0,
    createdAt,
  });
  const delivery = (id: number, revision: number, createdAt: string): OrderDeliveryChallan & { createdAt: string } => ({
    id,
    kind: 'delivery',
    challanNo: 12,
    revision,
    label: revision ? `DC-12 R${revision}` : 'DC-12',
    status: revision ? 'active' : 'revised',
    challanDate: '2026-10-10',
    takas: 2,
    pcs: 24,
    meters: 100,
    createdAt,
  });
  it('lists delivery challans (every revision) with butta / mill ones, newest first, without createdAt', () => {
    const items = mergeOrderChallans([challan(1, '2026-10-02T00:00:00.000Z')], [delivery(7, 0, '2026-10-10T00:00:00.000Z'), delivery(8, 1, '2026-10-11T00:00:00.000Z')]);
    expect(items.map((i) => (i.kind === 'delivery' ? i.label : `b${i.id}`))).toEqual(['DC-12 R1', 'DC-12', 'b1']);
    expect(items.every((i) => !('createdAt' in i))).toBe(true);
  });
});
