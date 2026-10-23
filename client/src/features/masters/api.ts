import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Broker,
  ChallanKind,
  ChallanParty,
  PartyInput,
  Customer,
  CustomerInput,
  Damage,
  DamageInput,
  Design,
  DesignInput,
  DesignListItem,
  DesignVariation,
  LookupItem,
  Machine,
  MachineInput,
  MachineLookupItem,
  Material,
  MaterialInput,
  VariationInput,
  Weaver,
  WeaverInput,
  WeaverLookupItem,
} from '@rivoora/shared';
import { useInfiniteList } from '@/hooks/useInfiniteList';
import { api } from '@/lib/api';

export const masterKeys = {
  customers: ['customers'] as const,
  materials: ['materials'] as const,
  designs: ['designs'] as const,
  design: (id: number) => ['designs', 'detail', id] as const,
  lookupCustomers: ['lookup', 'customers'] as const,
  lookupMaterials: ['lookup', 'materials'] as const,
  machines: ['machines'] as const,
  lookupMachines: ['lookup', 'machines'] as const,
  /** The brokers of one customer (order form). Under `lookupCustomers`, so customer saves refresh it. */
  lookupBrokers: (customerId: number) => ['lookup', 'customers', 'brokers', customerId] as const,
  damages: ['damages'] as const,
  lookupDamages: ['lookup', 'damages'] as const,
  weavers: ['weavers'] as const,
  lookupWeavers: ['lookup', 'weavers'] as const,
};

/* ---------- lookups (dropdowns) ---------- */

export function useCustomerLookup(search: string, enabled = true) {
  return useQuery({
    enabled,
    queryKey: [...masterKeys.lookupCustomers, search],
    queryFn: ({ signal }) => api.get<LookupItem[]>('/lookup/customers', { search }, signal),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

/** A customer's brokers (disabled until a client is picked). */
export function useBrokerLookup(customerId: number | null) {
  return useQuery({
    queryKey: masterKeys.lookupBrokers(customerId ?? 0),
    queryFn: ({ signal }) => api.get<Broker[]>(`/lookup/customers/${customerId}/brokers`, undefined, signal),
    enabled: !!customerId,
    staleTime: 30_000,
  });
}

/** Damage master names for the damage popup (Jenish, Gaurang, Taka entry). */
export function useDamageLookup(search = '', enabled = true) {
  return useQuery({
    queryKey: [...masterKeys.lookupDamages, search],
    queryFn: ({ signal }) => api.get<LookupItem[]>('/lookup/damages', { search }, signal),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    enabled,
  });
}

export function useMaterialLookup(search = '') {
  return useQuery({
    queryKey: [...masterKeys.lookupMaterials, search],
    queryFn: ({ signal }) => api.get<LookupItem[]>('/lookup/materials', { search }, signal),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

/* ---------- customers ---------- */

export const useCustomers = (search: string) =>
  useInfiniteList<Customer>([...masterKeys.customers, 'list'], '/customers', { search });

export function useSaveCustomer() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentFieldErrors: true },
    mutationFn: ({ id, data }: { id?: number; data: CustomerInput }) =>
      id ? api.put<Customer>(`/customers/${id}`, data) : api.post<Customer>('/customers', data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: masterKeys.customers });
      void qc.invalidateQueries({ queryKey: masterKeys.lookupCustomers });
      // Customer names appear in order lists / details.
      void qc.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}

export function useDeleteCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`/customers/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: masterKeys.customers });
      void qc.invalidateQueries({ queryKey: masterKeys.lookupCustomers });
    },
  });
}

/* ---------- materials ---------- */

export const useMaterials = (search: string) =>
  useInfiniteList<Material>([...masterKeys.materials, 'list'], '/materials', { search });

export function useSaveMaterial() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentFieldErrors: true },
    mutationFn: ({ id, data }: { id?: number; data: MaterialInput }) =>
      id ? api.put<Material>(`/materials/${id}`, data) : api.post<Material>('/materials', data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: masterKeys.materials });
      void qc.invalidateQueries({ queryKey: masterKeys.lookupMaterials });
      void qc.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}

export function useDeleteMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`/materials/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: masterKeys.materials });
      void qc.invalidateQueries({ queryKey: masterKeys.lookupMaterials });
    },
  });
}

/* ---------- damage master ---------- */

export const useDamages = (search: string) => useInfiniteList<Damage>([...masterKeys.damages, 'list'], '/damages', { search });

export function useSaveDamage() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentFieldErrors: true },
    mutationFn: ({ id, data }: { id?: number; data: DamageInput }) =>
      id ? api.put<Damage>(`/damages/${id}`, data) : api.post<Damage>('/damages', data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: masterKeys.damages });
      void qc.invalidateQueries({ queryKey: masterKeys.lookupDamages });
      // Damage names appear on takas.
      void qc.invalidateQueries({ queryKey: ['takas'] });
      void qc.invalidateQueries({ queryKey: ['jobsheets'] });
      void qc.invalidateQueries({ queryKey: ['order-dashboard'] });
    },
  });
}

export function useDeleteDamage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`/damages/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: masterKeys.damages });
      void qc.invalidateQueries({ queryKey: masterKeys.lookupDamages });
    },
  });
}

/* ---------- designs ---------- */

export const useDesigns = (search: string, enabled = true) =>
  useInfiniteList<DesignListItem>([...masterKeys.designs, 'list'], '/designs', { search }, enabled);

export function useDesign(id: number | null) {
  return useQuery({
    queryKey: masterKeys.design(id ?? 0),
    queryFn: ({ signal }) => api.get<Design>(`/designs/${id}`, undefined, signal),
    enabled: id !== null && id > 0,
  });
}

export function useSaveDesign() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentFieldErrors: true },
    mutationFn: ({ id, data }: { id?: number; data: DesignInput }) =>
      id ? api.put<Design>(`/designs/${id}`, data) : api.post<Design>('/designs', data),
    onSuccess: (design) => {
      qc.setQueryData(masterKeys.design(design.id), design);
      void qc.invalidateQueries({ queryKey: [...masterKeys.designs, 'list'] });
      void qc.invalidateQueries({ queryKey: ['orders', 'detail'] });
    },
  });
}

export function useDeleteDesign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`/designs/${id}`),
    onSuccess: (_d, id) => {
      qc.removeQueries({ queryKey: masterKeys.design(id) });
      void qc.invalidateQueries({ queryKey: [...masterKeys.designs, 'list'] });
    },
  });
}

export function useAddVariation(designId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: VariationInput) => api.post<DesignVariation>(`/designs/${designId}/variations`, data),
    onSuccess: (variation) => {
      qc.setQueryData<Design>(masterKeys.design(designId), (d) =>
        d ? { ...d, variations: [...d.variations, variation] } : d,
      );
      void qc.invalidateQueries({ queryKey: [...masterKeys.designs, 'list'] });
    },
  });
}

export function useDeleteVariation(designId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (variationId: number) => api.delete(`/designs/${designId}/variations/${variationId}`),
    onSuccess: (_r, variationId) => {
      qc.setQueryData<Design>(masterKeys.design(designId), (d) =>
        d ? { ...d, variations: d.variations.filter((v) => v.id !== variationId) } : d,
      );
      void qc.invalidateQueries({ queryKey: [...masterKeys.designs, 'list'] });
    },
  });
}

/* ---------- machines ---------- */

export const useMachines = (search: string) =>
  useInfiniteList<Machine>([...masterKeys.machines, 'list'], '/machines', { search });

/** Active machines for the jobsheet dropdowns (small list, filtered client-side). */
export function useMachineLookup() {
  return useQuery({
    queryKey: masterKeys.lookupMachines,
    queryFn: ({ signal }) => api.get<MachineLookupItem[]>('/lookup/machines', undefined, signal),
    staleTime: 60_000,
  });
}

export function useSaveMachine() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentFieldErrors: true },
    mutationFn: ({ id, data }: { id?: number; data: MachineInput }) =>
      id ? api.put<Machine>(`/machines/${id}`, data) : api.post<Machine>('/machines', data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: masterKeys.machines });
      void qc.invalidateQueries({ queryKey: masterKeys.lookupMachines });
      // Machine names / status appear on jobsheets.
      void qc.invalidateQueries({ queryKey: ['jobsheets'] });
    },
  });
}

export function useDeleteMachine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`/machines/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: masterKeys.machines });
      void qc.invalidateQueries({ queryKey: masterKeys.lookupMachines });
    },
  });
}

/* ---------- butta / mill parties (one master, `kind` picks the endpoint) ---------- */

const partyBase = (kind: ChallanKind) => (kind === 'butta' ? '/butta-parties' : '/mill-parties');

export const partyKeys = {
  all: (kind: ChallanKind) => [`${kind}-parties`] as const,
  lookup: (kind: ChallanKind) => ['lookup', `${kind}-parties`] as const,
};

export const useParties = (kind: ChallanKind, search: string) =>
  useInfiniteList<ChallanParty>([...partyKeys.all(kind), 'list'], partyBase(kind), { search });

/** Active parties of a kind for the Send dialog. */
export function usePartyLookup(kind: ChallanKind, search = '', enabled = true) {
  return useQuery({
    queryKey: [...partyKeys.lookup(kind), search],
    queryFn: ({ signal }) => api.get<LookupItem[]>(`/lookup/${kind}-parties`, { search }, signal),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    enabled,
  });
}

export function useSaveParty(kind: ChallanKind) {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentFieldErrors: true },
    mutationFn: ({ id, data }: { id?: number; data: PartyInput }) =>
      id ? api.put<ChallanParty>(`${partyBase(kind)}/${id}`, data) : api.post<ChallanParty>(partyBase(kind), data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: partyKeys.all(kind) });
      void qc.invalidateQueries({ queryKey: partyKeys.lookup(kind) });
      // The party name is on the challans.
      void qc.invalidateQueries({ queryKey: ['challans'] });
    },
  });
}

export function useDeleteParty(kind: ChallanKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`${partyBase(kind)}/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: partyKeys.all(kind) });
      void qc.invalidateQueries({ queryKey: partyKeys.lookup(kind) });
    },
  });
}

/* ---------- Sprint 16: weavers (Weaver master) ---------- */

export const useWeavers = (search: string) => useInfiniteList<Weaver>([...masterKeys.weavers, 'list'], '/weavers', { search });

/** Active weavers for the outside PO form. */
export function useWeaverLookup(search = '', enabled = true) {
  return useQuery({
    queryKey: [...masterKeys.lookupWeavers, search],
    queryFn: ({ signal }) => api.get<WeaverLookupItem[]>('/lookup/weavers', { search }, signal),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    enabled,
  });
}

/** The short code suggested from a weaver's name (editable; a taken code is skipped). */
export function useSuggestWeaverCode(name: string, enabled: boolean) {
  return useQuery({
    queryKey: ['weavers', 'suggest-code', name],
    queryFn: ({ signal }) => api.get<{ code: string }>('/weavers/suggest-code', { name }, signal),
    enabled: enabled && name.trim().length > 0,
    staleTime: 0,
  });
}

export function useSaveWeaver() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentFieldErrors: true },
    mutationFn: ({ id, data }: { id?: number; data: WeaverInput }) =>
      id ? api.put<Weaver>(`/weavers/${id}`, data) : api.post<Weaver>('/weavers', data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: masterKeys.weavers });
      void qc.invalidateQueries({ queryKey: masterKeys.lookupWeavers });
      // The weaver's name appears on outside POs / receipts / challans.
      void qc.invalidateQueries({ queryKey: ['outside'] });
      void qc.invalidateQueries({ queryKey: ['receive-goods'] });
    },
  });
}

export function useDeleteWeaver() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`/weavers/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: masterKeys.weavers });
      void qc.invalidateQueries({ queryKey: masterKeys.lookupWeavers });
    },
  });
}
