import { z } from 'zod';
import { parseIdList, parseKeyList } from './orderFilters';
import { isOrderType, type OrderType } from './orderTypes';

/**
 * Work filters: the Filters modal of the production supervisor (Jobsheets) and the godown supervisor (Butta cutting /
 * Mill). Every filter is multi-select and travels comma-separated in the URL and the API query, like the order list:
 * `loom=3,7&quality=2&type=lump&blouse=not_set&party=4&from=2026-10-01&to=2026-10-19`.
 */

export const BLOUSE_FILTER_KEYS = ['with_blouse', 'without_blouse', 'not_set'] as const;
export type BlouseFilterKey = (typeof BLOUSE_FILTER_KEYS)[number];
export const isBlouseFilterKey = (v: string): v is BlouseFilterKey => (BLOUSE_FILTER_KEYS as readonly string[]).includes(v);

export interface WorkFilters {
  /** Machine ids: a jobsheet assigned to OR running / ran on one of them (takas: their jobsheet's). */
  looms: number[];
  /** Material ids (the order's quality). */
  qualities: number[];
  types: OrderType[];
  blouse: BlouseFilterKey[];
  /** Butta / mill party ids (challan lists only). */
  parties: number[];
  /** Inclusive yyyy-MM-dd range: the jobsheet's sent date, or the challan date. */
  from?: string;
  to?: string;
}

export const EMPTY_WORK_FILTERS: WorkFilters = { looms: [], qualities: [], types: [], blouse: [], parties: [] };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Reads the filters from URL / query params (unknown values are dropped). */
export function parseWorkFilters(get: (key: string) => string | null | undefined): WorkFilters {
  const from = get('from') ?? '';
  const to = get('to') ?? '';
  return {
    looms: parseIdList(get('loom')),
    qualities: parseIdList(get('quality')),
    types: parseKeyList(get('type'), isOrderType),
    blouse: parseKeyList(get('blouse'), isBlouseFilterKey),
    parties: parseIdList(get('party')),
    from: DATE_RE.test(from) ? from : undefined,
    to: DATE_RE.test(to) ? to : undefined,
  };
}

/** The query params of the filters (empty ones are undefined, so they are left out). */
export function workFilterParams(f: WorkFilters): Record<string, string | undefined> {
  const list = (v: readonly (string | number)[]) => (v.length ? v.join(',') : undefined);
  return {
    loom: list(f.looms),
    quality: list(f.qualities),
    type: list(f.types),
    blouse: list(f.blouse),
    party: list(f.parties),
    from: f.from,
    to: f.to,
  };
}

export const WORK_FILTER_PARAM_KEYS = ['loom', 'quality', 'type', 'blouse', 'party', 'from', 'to'] as const;

/** How many filters are on (the badge on the Filters button); a date range counts once. */
export const workFilterCount = (f: WorkFilters) =>
  f.looms.length + f.qualities.length + f.types.length + f.blouse.length + f.parties.length + (f.from || f.to ? 1 : 0);

export const hasWorkFilters = (f: WorkFilters) => workFilterCount(f) > 0;

/** The zod fields for an API query: spread into a list query schema; `.transform` turns them into `WorkFilters`. */
const csv = z.string().optional();
export const workFilterQueryFields = {
  loom: csv,
  quality: csv,
  type: csv,
  blouse: csv,
  party: csv,
  from: csv,
  to: csv,
};

/** Picks the work filters out of a parsed query object. */
export const workFiltersOf = (q: Partial<Record<(typeof WORK_FILTER_PARAM_KEYS)[number], string | undefined>>): WorkFilters =>
  parseWorkFilters((k) => q[k as keyof typeof q]);
