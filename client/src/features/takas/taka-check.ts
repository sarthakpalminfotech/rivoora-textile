import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';
import {
  jobsheetRefShort,
  TAKA_ERROR_TEXT,
  takaNoError,
  takaUsedText,
  type TakaAvailability,
  type TakaNoError,
} from '@rivoora/shared';
import { useDebounce } from '@/hooks/useDebounce';
import { api } from '@/lib/api';

/**
 * Live check while typing: which of these taka numbers are already used anywhere in the system (taka numbers are
 * unique across jobsheets, orders and years). Debounced; returns number → "#26 (319)" for the ones that are used.
 * `ignore` = numbers that belong to the screen's own saved takas (they are not "used by someone else").
 */
export function useUsedTakaNumbers(values: readonly string[], ignore: ReadonlySet<string> = new Set()): ReadonlyMap<string, string> {
  const joined = [...new Set(values.map((v) => v.trim()).filter((v) => v && takaNoError(v) === null && !ignore.has(v)))].sort().join('|');
  const debounced = useDebounce(joined, 400);
  const list = debounced ? debounced.split('|') : [];
  const results = useQueries({
    queries: list.map((no) => ({
      queryKey: ['takas', 'check', no],
      queryFn: ({ signal }: { signal?: AbortSignal }) => api.get<TakaAvailability>('/takas/check', { no }, signal),
      staleTime: 10_000,
    })),
  });
  const signature = results.map((r) => (r.data && !r.data.available ? `${r.data.usedBy?.orderNo}/${r.data.usedBy?.jobsheetNo}` : '')).join('|');
  return useMemo(() => {
    const used = new Map<string, string>();
    list.forEach((no, i) => {
      const d = results[i]?.data;
      if (d && !d.available && d.usedBy) used.set(no, jobsheetRefShort(d.usedBy.orderNo, d.usedBy.jobsheetNo));
    });
    return used;
    // `signature` captures the results; `list` is derived from `debounced`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, signature]);
}

/** English + Hindi text of a taka number error; "already used" names the order / jobsheet it is used in. */
export function takaErrorText(err: TakaNoError, value: string, used: ReadonlyMap<string, string>): { en: string; hi: string } {
  return err === 'already_used' ? takaUsedText(value.trim(), used.get(value.trim())) : TAKA_ERROR_TEXT[err];
}
