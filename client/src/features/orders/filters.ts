import { endOfMonth, startOfMonth, subDays } from 'date-fns';
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { isOrderKind, isOrderType, isOutsideOrderFilter, isStatusKey, type OrderKind, type OrderStatusKey, type OrderType, type OutsideOrderFilter } from '@rivoora/shared';
import { toApiDate } from '@/lib/format';

export interface OrderFilters {
  search: string;
  statuses: OrderStatusKey[];
  materials: number[];
  /** Party (client) ids — only for roles that see the client. */
  parties: number[];
  /** Order type (Lump / Pcs to pcs). */
  types: OrderType[];
  /** Sprint 16: order kind (In-house / Outside production / FG purchase). */
  kinds: OrderKind[];
  /** Sprint 18: Outside order yes / no (only for roles that see the client). */
  outside: OutsideOrderFilter[];
  from?: string;
  to?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Filters live in the URL so they survive opening an order and coming back. */
export function useOrderFilters() {
  const [params, setParams] = useSearchParams();

  const filters = useMemo<OrderFilters>(() => {
    const list = (key: string) => (params.get(key) ?? '').split(',').filter(Boolean);
    const from = params.get('from') ?? '';
    const to = params.get('to') ?? '';
    return {
      search: params.get('q') ?? '',
      statuses: list('status').filter(isStatusKey),
      materials: list('material').map(Number).filter((n) => Number.isInteger(n) && n > 0),
      parties: list('party').map(Number).filter((n) => Number.isInteger(n) && n > 0),
      types: list('type').filter(isOrderType),
      kinds: list('kind').filter(isOrderKind),
      outside: list('outside').filter(isOutsideOrderFilter),
      from: DATE_RE.test(from) ? from : undefined,
      to: DATE_RE.test(to) ? to : undefined,
    };
  }, [params]);

  const setFilters = useCallback(
    (patch: Partial<OrderFilters>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const set = (key: string, value: string | undefined) => (value ? next.set(key, value) : next.delete(key));
          if ('search' in patch) set('q', patch.search?.trim());
          if ('statuses' in patch) set('status', patch.statuses?.join(','));
          if ('materials' in patch) set('material', patch.materials?.join(','));
          if ('parties' in patch) set('party', patch.parties?.join(','));
          if ('types' in patch) set('type', patch.types?.join(','));
          if ('kinds' in patch) set('kind', patch.kinds?.join(','));
          if ('outside' in patch) set('outside', patch.outside?.join(','));
          if ('from' in patch) set('from', patch.from);
          if ('to' in patch) set('to', patch.to);
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const activeCount =
    filters.statuses.length +
    filters.materials.length +
    filters.parties.length +
    filters.types.length +
    filters.kinds.length +
    filters.outside.length +
    (filters.from || filters.to ? 1 : 0);

  return { filters, setFilters, activeCount };
}

export const DATE_PRESETS = [
  { key: 'today', label: 'Today', range: () => ({ from: toApiDate(new Date()), to: toApiDate(new Date()) }) },
  { key: '7d', label: 'Last 7 days', range: () => ({ from: toApiDate(subDays(new Date(), 6)), to: toApiDate(new Date()) }) },
  {
    key: 'month',
    label: 'This month',
    range: () => ({ from: toApiDate(startOfMonth(new Date())), to: toApiDate(endOfMonth(new Date())) }),
  },
] as const;
