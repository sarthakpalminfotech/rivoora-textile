import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QcPendingTaka, QcResult, QcSubmitInput, TakaDetail } from '@rivoora/shared';
import { useInfiniteList } from '@/hooks/useInfiniteList';
import { api } from '@/lib/api';
import { challanKeys, invalidateAfterChallanWrite } from '../challans/api';

/* ---------- Butta QC ---------- */

export const useQcPending = (search: string) => useInfiniteList<QcPendingTaka>(challanKeys.qc, '/butta-qc/pending', { search });

/** The one active taka with this number (Receive / Butta QC). Encoded: numbers can contain `/`. */
export const fetchTakaByNo = (no: string) => api.get<TakaDetail>(`/takas/by-no/${encodeURIComponent(no)}`);

export function useTakaByNo(no: string) {
  return useQuery({
    queryKey: ['butta-qc', 'taka', no],
    queryFn: ({ signal }) => api.get<TakaDetail>(`/takas/by-no/${encodeURIComponent(no)}`, undefined, signal),
    enabled: no.length > 0,
    staleTime: 0,
    retry: false,
  });
}

export function useSubmitQc(takaId: number) {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentFieldErrors: true },
    mutationFn: (data: QcSubmitInput) => api.post<QcResult>(`/butta-qc/${takaId}`, data),
    onSuccess: () => invalidateAfterChallanWrite(qc),
  });
}
