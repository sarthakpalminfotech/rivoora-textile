import { describe, expect, it } from 'vitest';
import { counterNameFor, currentFy, fyOf, fyShort, fyStartDate, isFy } from './fy';

describe('financial year (India, 1 April – 31 March, IST)', () => {
  it('31 March is the old year, 1 April the new one', () => {
    expect(fyOf('2027-03-31')).toBe('2026-27');
    expect(fyOf('2027-04-01')).toBe('2027-28');
    expect(fyOf('2026-04-01')).toBe('2026-27');
    expect(fyOf('2026-03-31')).toBe('2025-26');
  });
  it('is IST-safe around midnight', () => {
    // 31 March 23:59 IST = 18:29 UTC → still the old FY
    expect(fyOf(new Date('2027-03-31T18:29:59Z'))).toBe('2026-27');
    // 1 April 00:00 IST = 18:30 UTC on 31 March → the new FY
    expect(fyOf(new Date('2027-03-31T18:30:00Z'))).toBe('2027-28');
    expect(fyOf('2027-03-31T18:30:00.000Z')).toBe('2027-28');
    expect(currentFy(new Date('2027-04-01T05:00:00Z'))).toBe('2027-28');
  });
  it('century roll-over', () => {
    expect(fyOf('2099-04-01')).toBe('2099-00');
    expect(fyOf('2100-03-31')).toBe('2099-00');
  });
  it('short form and validation', () => {
    expect(fyShort('2026-27')).toBe('26-27');
    expect(isFy('2026-27')).toBe(true);
    expect(isFy('2026-28')).toBe(false);
    expect(isFy('26-27')).toBe(false);
    expect(fyStartDate('2027-28')).toBe('2027-04-01');
  });
  it('counters: the start FY keeps the old global counter, later FYs get their own row', () => {
    expect(counterNameFor('taka_no', '2026-27', '2026-27')).toBe('taka_no');
    expect(counterNameFor('taka_no', '2025-26', '2026-27')).toBe('taka_no');
    expect(counterNameFor('taka_no', '2027-28', '2026-27')).toBe('taka_no:2027-28');
    // a test can move the start FY: then 2027-28 is the legacy one and 2028-29 restarts
    expect(counterNameFor('taka_no', '2027-28', '2027-28')).toBe('taka_no');
    expect(counterNameFor('taka_no', '2028-29', '2027-28')).toBe('taka_no:2028-29');
  });
});
