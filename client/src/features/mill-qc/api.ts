import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MillQcSubmitInput, MillQcTaka, QcPendingTaka, QcResult } from '@rivoora/shared';
import { useInfiniteList } from '@/hooks/useInfiniteList';
import { api } from '@/lib/api';
import { invalidateAfterChallanWrite } from '../challans/api';

/* ---------- Mill QC ---------- */

export const millQcKeys = { all: ['mill-qc'] as const, pending: ['mill-qc', 'pending'] as const };

export const useMillQcPending = (search: string) => useInfiniteList<QcPendingTaka>(millQcKeys.pending, '/mill-qc/pending', { search });

/** Opens a taka by number (numbers can contain `/`, so they are encoded). */
export const fetchMillQcTaka = (no: string) => api.get<MillQcTaka>(`/mill-qc/taka/${encodeURIComponent(no)}`);

export function useMillQcTaka(no: string) {
  return useQuery({
    queryKey: ['mill-qc', 'taka', no],
    queryFn: ({ signal }) => api.get<MillQcTaka>(`/mill-qc/taka/${encodeURIComponent(no)}`, undefined, signal),
    enabled: no.length > 0,
    staleTime: 0,
    retry: false,
  });
}

export function useSubmitMillQc(takaId: number) {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentFieldErrors: true },
    mutationFn: (data: MillQcSubmitInput) => api.post<QcResult>(`/mill-qc/${takaId}`, data),
    onSuccess: () => invalidateAfterChallanWrite(qc),
  });
}
