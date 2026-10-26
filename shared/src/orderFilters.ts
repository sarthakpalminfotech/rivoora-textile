/** Order list filters: every filter is multi-select and travels as a comma-separated list (`party=3,7`). */

/** `"3,7,x,-2,3"` → `[3, 7]`: positive integers only, no duplicates, order kept. */
export function parseIdList(value: string | null | undefined): number[] {
  const out: number[] = [];
  for (const part of (value ?? '').split(',')) {
    const n = Number(part.trim());
    if (part.trim() !== '' && Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n);
  }
  return out;
}

/** `"a,b,,a"` → `["a", "b"]` filtered by `isValid` (unknown values are dropped, not errors). */
export function parseKeyList<T extends string>(value: string | null | undefined, isValid: (v: string) => v is T): T[] {
  const out: T[] = [];
  for (const part of (value ?? '').split(',')) {
    const v = part.trim();
    if (isValid(v) && !out.includes(v)) out.push(v);
  }
  return out;
}

/** Sprint 18: the Outside order filter (`outside=yes` / `outside=no`; both or none = no filter). */
export const OUTSIDE_ORDER_FILTERS = ['yes', 'no'] as const;
export type OutsideOrderFilter = (typeof OUTSIDE_ORDER_FILTERS)[number];
export const isOutsideOrderFilter = (v: string): v is OutsideOrderFilter => (OUTSIDE_ORDER_FILTERS as readonly string[]).includes(v);
