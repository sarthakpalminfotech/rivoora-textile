import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Beam,
  BeamZone,
  LookupItem,
  MoveFilter,
  Paginated,
  TfoBoard,
  TfoMachine,
  TfoMachineInput,
  TfoProgram,
  TfoProgramStartInput,
  TfoProgramStopInput,
  TfoSection,
  WarpingDoneResult,
  WarpingJob,
  WarpingJobDoneInput,
  WarpingJobStartInput,
  WarpingQuality,
  WarpingQualityInput,
  WarpingStatus,
  YarnBox,
  YarnLotStock,
  YarnMove,
  YarnParty,
  YarnPartyInput,
  YarnPoDetail,
  YarnPoInput,
  YarnPoListItem,
  YarnPoPrintData,
  YarnPoRemarkInput,
  YarnPoStatus,
  YarnPoWriteResult,
  YarnQuality,
  YarnQualityInput,
  YarnQualityLookupItem,
  YarnReceiptInput,
  YarnReceiptResult,
  YarnSummary,
  YarnTransferInput,
  YarnWithdrawInput,
  YarnZone,
  YarnZoneData,
} from '@rivoora/shared';
import { useInfiniteList } from '@/hooks/useInfiniteList';
import { api } from '@/lib/api';

/**
 * Sprint 17 — yarn: masters, Yarn POs, Yarn inventory (zones, ledger, TFO, warping). Every key starts with 'yarn'
 * and every yarn write invalidates ['yarn'] (yarn is not linked to orders, nothing else changes).
 */

export const yarnKeys = {
  all: ['yarn'] as const,
  parties: ['yarn', 'parties'] as const,
  qualities: ['yarn', 'qualities'] as const,
  machines: ['yarn', 'tfo-machines'] as const,
  warpingQualities: ['yarn', 'warping-qualities'] as const,
  lookupParties: (search: string) => ['yarn', 'lookup', 'parties', search] as const,
  lookupQualities: (search: string) => ['yarn', 'lookup', 'qualities', search] as const,
  lookupWarpingQualities: (search: string) => ['yarn', 'lookup', 'warping-qualities', search] as const,
  pos: ['yarn', 'pos'] as const,
  po: (id: number) => ['yarn', 'po', id] as const,
  poPrint: (id: number) => ['yarn', 'po', id, 'print'] as const,
  summary: ['yarn', 'summary'] as const,
  zone: (zone: YarnZone) => ['yarn', 'zone', zone] as const,
  moves: ['yarn', 'moves'] as const,
  beams: (zone?: BeamZone, status?: Beam['status']) => ['yarn', 'beams', zone ?? 'all', status ?? 'in_stock'] as const,
  lots: (zone: YarnZone, qualityId: number) => ['yarn', 'lots', zone, qualityId] as const,
  boxes: (zone?: YarnZone) => ['yarn', 'boxes', zone ?? 'all'] as const,
  board: ['yarn', 'tfo', 'board'] as const,
  programs: (machineId?: number, section?: TfoSection) => ['yarn', 'tfo', 'programs', machineId ?? 0, section ?? ''] as const,
  jobs: (status?: WarpingStatus) => ['yarn', 'warping', 'jobs', status ?? 'all'] as const,
};

function useYarnMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>, options: { silentFieldErrors?: boolean } = {}) {
  const qc = useQueryClient();
  return useMutation({
    meta: options.silentFieldErrors ? { silentFieldErrors: true } : undefined,
    mutationFn: fn,
    onSuccess: () => void qc.invalidateQueries({ queryKey: yarnKeys.all }),
  });
}

/* ---------- masters ---------- */

export const useYarnParties = (search: string) => useInfiniteList<YarnParty>([...yarnKeys.parties, 'list'], '/yarn-parties', { search });
export const useYarnQualities = (search: string) => useInfiniteList<YarnQuality>([...yarnKeys.qualities, 'list'], '/yarn-qualities', { search });
export const useTfoMachines = (search: string) => useInfiniteList<TfoMachine>([...yarnKeys.machines, 'list'], '/tfo-machines', { search });

export function useYarnPartyLookup(search = '', enabled = true) {
  return useQuery({
    queryKey: yarnKeys.lookupParties(search),
    queryFn: ({ signal }) => api.get<LookupItem[]>('/lookup/yarn-parties', { search }, signal),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    enabled,
  });
}

export function useYarnQualityLookup(search = '', enabled = true) {
  return useQuery({
    queryKey: yarnKeys.lookupQualities(search),
    queryFn: ({ signal }) => api.get<YarnQualityLookupItem[]>('/lookup/yarn-qualities', { search }, signal),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    enabled,
  });
}

export const useSaveYarnParty = () =>
  useYarnMutation(({ id, data }: { id?: number; data: YarnPartyInput }) => (id ? api.put<YarnParty>(`/yarn-parties/${id}`, data) : api.post<YarnParty>('/yarn-parties', data)), {
    silentFieldErrors: true,
  });
export const useDeleteYarnParty = () => useYarnMutation((id: number) => api.delete(`/yarn-parties/${id}`));

export const useSaveYarnQuality = () =>
  useYarnMutation(
    ({ id, data }: { id?: number; data: YarnQualityInput }) => (id ? api.put<YarnQuality>(`/yarn-qualities/${id}`, data) : api.post<YarnQuality>('/yarn-qualities', data)),
    { silentFieldErrors: true },
  );
export const useDeleteYarnQuality = () => useYarnMutation((id: number) => api.delete(`/yarn-qualities/${id}`));

export const useSaveTfoMachine = () =>
  useYarnMutation(({ id, data }: { id?: number; data: TfoMachineInput }) => (id ? api.put<TfoMachine>(`/tfo-machines/${id}`, data) : api.post<TfoMachine>('/tfo-machines', data)), {
    silentFieldErrors: true,
  });
export const useDeleteTfoMachine = () => useYarnMutation((id: number) => api.delete(`/tfo-machines/${id}`));

/** Sprint 20 — Warping qualities: twisted yarn's identity from the TFO stop onward. */
export const useWarpingQualities = (search: string) => useInfiniteList<WarpingQuality>([...yarnKeys.warpingQualities, 'list'], '/warping-qualities', { search });

export function useWarpingQualityLookup(search = '', enabled = true) {
  return useQuery({
    queryKey: yarnKeys.lookupWarpingQualities(search),
    queryFn: ({ signal }) => api.get<LookupItem[]>('/lookup/warping-qualities', { search }, signal),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    enabled,
  });
}

export const useSaveWarpingQuality = () =>
  useYarnMutation(
    ({ id, data }: { id?: number; data: WarpingQualityInput }) =>
      id ? api.put<WarpingQuality>(`/warping-qualities/${id}`, data) : api.post<WarpingQuality>('/warping-qualities', data),
    { silentFieldErrors: true },
  );
export const useDeleteWarpingQuality = () => useYarnMutation((id: number) => api.delete(`/warping-qualities/${id}`));

/* ---------- Yarn PO ---------- */

export interface YarnPoListParams {
  search: string;
  status: YarnPoStatus[];
  party: number[];
  quality: number[];
  from?: string;
  to?: string;
}

export const useYarnPos = (p: YarnPoListParams) =>
  useInfiniteList<YarnPoListItem>([...yarnKeys.pos, 'list'], '/yarn-pos', {
    search: p.search,
    status: p.status,
    party: p.party,
    quality: p.quality,
    from: p.from,
    to: p.to,
  });

export function useYarnPo(id: number) {
  return useQuery({
    queryKey: yarnKeys.po(id),
    queryFn: ({ signal }) => api.get<YarnPoDetail>(`/yarn-pos/${id}`, undefined, signal),
    enabled: id > 0,
  });
}

export function useYarnPoPrint(id: number) {
  return useQuery({
    queryKey: yarnKeys.poPrint(id),
    queryFn: ({ signal }) => api.get<YarnPoPrintData>(`/yarn-pos/${id}/print`, undefined, signal),
    enabled: id > 0,
  });
}

export const useCreateYarnPo = () => useYarnMutation((data: YarnPoInput) => api.post<YarnPoWriteResult>('/yarn-pos', data), { silentFieldErrors: true });
export const useUpdateYarnPo = (id: number) =>
  useYarnMutation((data: YarnPoInput | YarnPoRemarkInput) => api.put<YarnPoWriteResult>(`/yarn-pos/${id}`, data), { silentFieldErrors: true });
export const useCloseYarnPo = (id: number) => useYarnMutation(() => api.post<YarnPoWriteResult>(`/yarn-pos/${id}/close`));
export const useCancelYarnPo = (id: number) => useYarnMutation(() => api.post<YarnPoWriteResult>(`/yarn-pos/${id}/cancel`));
export const useReceiveYarn = (id: number) =>
  useYarnMutation((data: YarnReceiptInput) => api.post<YarnReceiptResult>(`/yarn-pos/${id}/receipts`, data), { silentFieldErrors: true });

/** Sprint 20 — live "lot no. is free for this party" check on the Receive screen. */
export function useCheckLotNo(partyId: number | null, lotNo: string, enabled = true) {
  return useQuery({
    queryKey: ['yarn', 'lot-no-check', partyId ?? 0, lotNo],
    queryFn: ({ signal }) => api.get<{ available: boolean }>('/yarn/lots/check', { partyId, lotNo }, signal),
    enabled: enabled && !!partyId && lotNo.trim().length > 0,
    staleTime: 5_000,
  });
}

/* ---------- inventory ---------- */

export function useYarnSummary() {
  return useQuery({
    queryKey: yarnKeys.summary,
    queryFn: ({ signal }) => api.get<YarnSummary>('/yarn/summary', undefined, signal),
    refetchInterval: 60_000,
  });
}

export function useYarnZone(zone: YarnZone, enabled = true) {
  return useQuery({
    queryKey: yarnKeys.zone(zone),
    queryFn: ({ signal }) => api.get<YarnZoneData>(`/yarn/zones/${zone}`, undefined, signal),
    enabled,
  });
}

export interface MovesParams {
  zone?: YarnZone;
  kind: MoveFilter[];
  quality: number[];
  from?: string;
  to?: string;
  /** Sprint 20 — matches a lot no or a box no. */
  search?: string;
}

export const useYarnMoves = (p: MovesParams) =>
  useInfiniteList<YarnMove>([...yarnKeys.moves, p.search ?? ''], '/yarn/moves', { zone: p.zone, kind: p.kind, quality: p.quality, from: p.from, to: p.to, search: p.search });

export function useBeams(zone: BeamZone | undefined, status: Beam['status'] = 'in_stock', enabled = true) {
  return useQuery({
    queryKey: yarnKeys.beams(zone, status),
    queryFn: ({ signal }) => api.get<Beam[]>('/yarn/beams', { zone, status }, signal),
    enabled,
  });
}

/** Sprint 20 — raw lots (+ "No lot") with stock of one quality in one zone, for the lot picker. */
export function useLotStock(zone: YarnZone, qualityId: number | null, enabled = true) {
  return useQuery({
    queryKey: yarnKeys.lots(zone, qualityId ?? 0),
    queryFn: ({ signal }) => api.get<YarnLotStock[]>('/yarn/lots', { zone, qualityId }, signal),
    enabled: enabled && !!qualityId,
  });
}

/** Sprint 20 — in-stock boxes of a zone, for the box checklist. */
export function useBoxStock(zone: YarnZone | undefined, enabled = true) {
  return useQuery({
    queryKey: yarnKeys.boxes(zone),
    queryFn: ({ signal }) => api.get<YarnBox[]>('/yarn/boxes', { zone, status: 'in_stock' }, signal),
    enabled,
  });
}

export const useTransfer = () => useYarnMutation((data: YarnTransferInput) => api.post<{ transferId: number }>('/yarn/transfers', data), { silentFieldErrors: true });
export const useWithdraw = () => useYarnMutation((data: YarnWithdrawInput) => api.post<{ withdrawalId: number }>('/yarn/withdrawals', data), { silentFieldErrors: true });

/* ---------- TFO ---------- */

export function useTfoBoard() {
  return useQuery({
    queryKey: yarnKeys.board,
    queryFn: ({ signal }) => api.get<TfoBoard>('/yarn/tfo/board', undefined, signal),
    refetchInterval: 30_000,
  });
}

export function useTfoPrograms(machineId: number | undefined, section: TfoSection | undefined, enabled = true) {
  return useQuery({
    queryKey: yarnKeys.programs(machineId, section),
    queryFn: ({ signal }) => api.get<Paginated<TfoProgram>>('/yarn/tfo/programs', { machineId, section, limit: 10 }, signal),
    enabled,
  });
}

export const useStartProgram = () => useYarnMutation((data: TfoProgramStartInput) => api.post<TfoProgram>('/yarn/tfo/programs', data), { silentFieldErrors: true });
export const useStopProgram = (id: number) =>
  useYarnMutation((data: TfoProgramStopInput) => api.post<TfoProgram>(`/yarn/tfo/programs/${id}/stop`, data), { silentFieldErrors: true });

/* ---------- warping ---------- */

export const useWarpingJobs = (status: WarpingStatus) => useInfiniteList<WarpingJob>([...yarnKeys.jobs(status)], '/yarn/warping/jobs', { status });

export const useStartWarping = () => useYarnMutation((data: WarpingJobStartInput) => api.post<WarpingJob>('/yarn/warping/jobs', data), { silentFieldErrors: true });
export const useFinishWarping = (id: number) =>
  useYarnMutation((data: WarpingJobDoneInput) => api.post<WarpingDoneResult>(`/yarn/warping/jobs/${id}/done`, data), { silentFieldErrors: true });
