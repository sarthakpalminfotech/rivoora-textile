import { keepPreviousData, useInfiniteQuery, type QueryKey } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { Paginated } from '@rivoora/shared';
import { api, buildQuery } from '@/lib/api';

export const PAGE_SIZE = 20;

type Params = Parameters<typeof buildQuery>[0];

/** Server-paginated list with infinite loading. */
export function useInfiniteList<T>(key: QueryKey, path: string, params: Params = {}, enabled = true) {
  const query = useInfiniteQuery({
    queryKey: [...key, params],
    queryFn: ({ pageParam, signal }) =>
      api.get<Paginated<T>>(path, { ...params, page: pageParam, limit: PAGE_SIZE }, signal),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
    placeholderData: keepPreviousData,
    enabled,
  });
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const total = query.data?.pages[0]?.total;
  return { ...query, items, total };
}
