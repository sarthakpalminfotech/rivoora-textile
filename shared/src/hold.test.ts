import { describe, expect, it } from 'vitest';
import { can } from './roles';
import { ORDER_ON_HOLD_HI, orderOnHoldMessage, planHold, seesHeldOrders } from './hold';
import { orderHoldSchema } from './schemas';

describe('hold permissions', () => {
  it('only Jenish can hold; Jenish and Gaurang still see held orders; everyone else does not', () => {
    expect(can('jemish', 'canHoldOrder')).toBe(true);
    expect(can('gaurang', 'canHoldOrder')).toBe(false);
    expect(seesHeldOrders('jemish')).toBe(true);
    expect(seesHeldOrders('gaurang')).toBe(true);
    for (const r of ['supervisor', 'taka_entry', 'qc', 'godown_supervisor', 'dhruvil'] as const) {
      expect(seesHeldOrders(r)).toBe(false);
      expect(can(r, 'canHoldOrder')).toBe(false);
    }
  });
});

describe('orderOnHoldMessage', () => {
  it('is English for English roles and bilingual for Taka entry / QC', () => {
    expect(orderOnHoldMessage(26)).toBe('Order #26 is on hold');
    expect(orderOnHoldMessage(26, 'supervisor')).toBe('Order #26 is on hold');
    expect(orderOnHoldMessage(26, 'taka_entry')).toBe(`Order #26 is on hold / ${ORDER_ON_HOLD_HI}`);
    expect(orderOnHoldMessage(26, 'qc')).toContain('होल्ड');
  });
});

describe('planHold — ongoing jobsheets are completed, the rest becomes a new Pending jobsheet', () => {
  const ongoing = [
    { id: 1, frames: 10 },
    { id: 2, frames: 8 },
  ];

  it('completes each ongoing jobsheet and returns the remaining frames', () => {
    const p = planHold(ongoing, [
      { jobsheetId: 1, completedFrames: 4 },
      { jobsheetId: 2, completedFrames: 8 },
    ]);
    expect(p.errors).toEqual([]);
    expect(p.completions).toEqual([
      { jobsheetId: 1, completedFrames: 4, remainingFrames: 6 },
      { jobsheetId: 2, completedFrames: 8, remainingFrames: 0 },
    ]);
  });

  it('0 completed frames is allowed (everything remains)', () => {
    const p = planHold([ongoing[0]], [{ jobsheetId: 1, completedFrames: 0 }]);
    expect(p.completions[0]).toMatchObject({ remainingFrames: 10 });
  });

  it('every ongoing jobsheet needs an entry, and entries must belong to one', () => {
    const missing = planHold(ongoing, [{ jobsheetId: 1, completedFrames: 4 }]);
    expect(missing.errors).toEqual([{ jobsheetId: 2, message: 'Enter the frames completed.' }]);
    const stranger = planHold([ongoing[0]], [{ jobsheetId: 1, completedFrames: 4 }, { jobsheetId: 9, completedFrames: 1 }]);
    expect(stranger.errors).toHaveLength(1);
    expect(stranger.errors[0].jobsheetId).toBe(9);
  });

  it('rejects more than assigned and non-whole / negative numbers', () => {
    expect(planHold([ongoing[0]], [{ jobsheetId: 1, completedFrames: 11 }]).errors[0].message).toMatch(/more than the 10/);
    expect(planHold([ongoing[0]], [{ jobsheetId: 1, completedFrames: -1 }]).errors).toHaveLength(1);
    expect(planHold([ongoing[0]], [{ jobsheetId: 1, completedFrames: 2.5 }]).errors).toHaveLength(1);
  });

  it('no ongoing jobsheets: nothing to do', () => {
    expect(planHold([], [])).toEqual({ completions: [], errors: [] });
  });
});

describe('orderHoldSchema', () => {
  it('note is optional, ongoing defaults to []', () => {
    expect(orderHoldSchema.parse({})).toEqual({ note: null, ongoing: [] });
    expect(orderHoldSchema.parse({ note: ' waiting for yarn ', ongoing: [{ jobsheetId: 3, completedFrames: 2 }] })).toEqual({
      note: 'waiting for yarn',
      ongoing: [{ jobsheetId: 3, completedFrames: 2 }],
    });
  });
  it('rejects negative frames', () => {
    expect(orderHoldSchema.safeParse({ ongoing: [{ jobsheetId: 3, completedFrames: -1 }] }).success).toBe(false);
  });
});
