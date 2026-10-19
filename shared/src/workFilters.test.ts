import { describe, expect, it } from 'vitest';
import { EMPTY_WORK_FILTERS, parseWorkFilters, workFilterCount, workFilterParams, workFiltersOf } from './workFilters';

const from = (q: Record<string, string>) => parseWorkFilters((k) => q[k]);

describe('work filters', () => {
  it('parses comma lists and drops unknown values', () => {
    expect(from({ loom: '3,7,x,3', quality: '2', type: 'lump,bad', blouse: 'not_set,with_blouse,nope', party: '4', from: '2026-10-01', to: 'oops' })).toEqual({
      looms: [3, 7],
      qualities: [2],
      types: ['lump'],
      blouse: ['not_set', 'with_blouse'],
      parties: [4],
      from: '2026-10-01',
      to: undefined,
    });
  });

  it('round-trips through query params', () => {
    const f = { ...EMPTY_WORK_FILTERS, looms: [1, 2], blouse: ['without_blouse' as const], from: '2026-10-01', to: '2026-10-19' };
    expect(workFiltersOf(workFilterParams(f))).toEqual(f);
    expect(workFilterParams(EMPTY_WORK_FILTERS)).toEqual({ loom: undefined, quality: undefined, type: undefined, blouse: undefined, party: undefined, from: undefined, to: undefined });
  });

  it('counts a date range once', () => {
    expect(workFilterCount({ ...EMPTY_WORK_FILTERS, looms: [1, 2], qualities: [5], from: '2026-10-01', to: '2026-10-02' })).toBe(4);
    expect(workFilterCount(EMPTY_WORK_FILTERS)).toBe(0);
  });
});
