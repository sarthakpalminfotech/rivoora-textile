import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QcResult, QcSubmitInput, TakaDetail } from '@rivoora/shared';
import { api } from '@/lib/api';
import { invalidateAfterChallanWrite } from '../challans/api';

/* ---------- Butta QC ---------- */


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
