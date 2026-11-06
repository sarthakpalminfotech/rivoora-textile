import { describe, expect, it } from 'vitest';
import { jobsheetQrUrl, parseJobsheetQr, parseJobsheetQrFull } from './takas';
import { fyOf, numberWithFy } from './fy';

describe('Sprint 23 — jobsheet QR carries the financial year', () => {
  it('new prints encode /j/<fy>/<no>; the old form still builds without a year', () => {
    expect(jobsheetQrUrl('https://app.example.com/', 319, '2026-27')).toBe('https://app.example.com/j/2026-27/319');
    expect(jobsheetQrUrl('https://app.example.com', 319)).toBe('https://app.example.com/j/319');
  });
  it('parseJobsheetQr accepts both forms (any host)', () => {
    expect(parseJobsheetQr('https://a.b/j/2026-27/319')).toBe(319);
    expect(parseJobsheetQr('https://a.b/j/319')).toBe(319);
    expect(parseJobsheetQrFull('https://old-domain.in/j/2026-27/319/')).toEqual({ no: 319, fy: '2026-27' });
    expect(parseJobsheetQrFull('http://x/j/319')).toEqual({ no: 319, fy: null });
  });
  it('rejects what is not ours', () => {
    expect(parseJobsheetQrFull('https://a.b/j/2026/319')).toBeNull();
    expect(parseJobsheetQrFull('https://a.b/k/319')).toBeNull();
    expect(parseJobsheetQrFull('ftp://a.b/j/319')).toBeNull();
    expect(parseJobsheetQrFull('hello')).toBeNull();
    expect(parseJobsheetQrFull('https://a.b/j/2026-27/0')).toBeNull();
  });
  it('picker text shows the year only when given', () => {
    expect(numberWithFy(6245, '2026-27')).toBe('6245 · 2026-27');
    expect(numberWithFy(6245, null)).toBe('6245');
  });
  it('the record dates around the year change', () => {
    expect(fyOf('2027-03-31')).toBe('2026-27');
    expect(fyOf('2027-04-01')).toBe('2027-28');
  });
});
