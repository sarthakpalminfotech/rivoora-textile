import { describe, expect, it } from 'vitest';
import { isOrderType } from './orderTypes';
import { parseIdList, parseKeyList } from './orderFilters';

describe('order list filter parsing', () => {
  it('parses comma separated ids (positive integers, unique)', () => {
    expect(parseIdList('3,7')).toEqual([3, 7]);
    expect(parseIdList(' 3, 7 ,3,x,-2,0,1.5,')).toEqual([3, 7]);
    expect(parseIdList('')).toEqual([]);
    expect(parseIdList(undefined)).toEqual([]);
  });
  it('parses key lists and drops unknown values', () => {
    expect(parseKeyList('lump,pcs_to_pcs,foo,lump', isOrderType)).toEqual(['lump', 'pcs_to_pcs']);
    expect(parseKeyList(null, isOrderType)).toEqual([]);
  });
});
