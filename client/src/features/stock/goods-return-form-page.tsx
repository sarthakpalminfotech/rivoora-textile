import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { RETURN_RECEIVED_AS, RETURN_RECEIVED_AS_LABEL, type PartyReturnDetail, type ReturnReceivedAs } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { TickBox } from '@/components/ui/tick-box';
import { useDebounce } from '@/hooks/useDebounce';
import { ApiError, errorMessage } from '@/lib/api';
import { toApiDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { BackLink } from '../inventory/parts';
import { DamageImagePicker } from '../takas/damage-images';
import { useCreatePartyReturn, useDispatchedTakasOfParty, useReturnParties } from './api';

export interface ReturnHeaderValue {
  customerId: number | null;
  customerName: string | null;
  receivedDate: string;
  receivedAs: ReturnReceivedAs;
  receivedQty: string;
  takaIds: number[];
  note: string;
  images: { url: string; thumbUrl: string }[];
}
export const emptyReturnHeader = (): ReturnHeaderValue => ({ customerId: null, customerName: null, receivedDate: toApiDate(new Date()), receivedAs: 'pcs', receivedQty: '', takaIds: [], note: '', images: [] });
export const headerOf = (d: PartyReturnDetail, takaIds: number[]): ReturnHeaderValue => ({
  customerId: d.customer.id,
  customerName: d.customer.name,
  receivedDate: d.receivedDate,
  receivedAs: d.receivedAs,
  receivedQty: d.receivedAs === 'takas' ? '' : String(d.receivedQty),
  takaIds,
  note: d.note ?? '',
  images: d.images,
});

/** The "Mark goods received" fields — used for a new return and for editing a Pending one. Tablet 2 columns, desktop 3. */
export function ReturnHeaderForm({ value, onChange, errors, lockAs }: { value: ReturnHeaderValue; onChange: (v: ReturnHeaderValue) => void; errors: Record<string, string>; lockAs?: boolean }) {
  const [partySearch, setPartySearch] = useState('');
  const [takaSearch, setTakaSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const parties = useReturnParties(useDebounce(partySearch.trim(), 250));
  const takas = useDispatchedTakasOfParty(value.receivedAs === 'takas' ? value.customerId : null, useDebounce(takaSearch.trim(), 250));
  const set = (patch: Partial<ReturnHeaderValue>) => onChange({ ...value, ...patch });
  void busy;
  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Field label="Party" htmlFor="gr-party" required error={errors.customerId}>
          <Select<number>
            id="gr-party"
            value={value.customerId}
            selectedLabel={value.customerName ?? undefined}
            onChange={(id, opt) => set({ customerId: id, customerName: opt.label, takaIds: [] })}
            options={(parties.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
            placeholder="Select party"
            searchable
            searchPlaceholder="Search party…"
            onSearchChange={setPartySearch}
            loading={parties.isFetching}
          />
        </Field>
        <Field label="Date received" htmlFor="gr-date" required error={errors.receivedDate}>
          <DatePicker id="gr-date" value={value.receivedDate} onChange={(d) => set({ receivedDate: d })} />
        </Field>
        <Field label="Received as" required>
          <Segmented<ReturnReceivedAs>
            aria-label="Received as"
            size="lg"
            value={value.receivedAs}
            disabled={lockAs}
            onChange={(v) => set({ receivedAs: v, receivedQty: '', takaIds: [] })}
            options={RETURN_RECEIVED_AS.map((a) => ({ value: a, label: RETURN_RECEIVED_AS_LABEL[a] }))}
          />
        </Field>
        {value.receivedAs !== 'takas' && (
          <Field label={value.receivedAs === 'pcs' ? 'Quantity received (pcs)' : 'Quantity received (metres)'} htmlFor="gr-qty" required error={errors.receivedQty}>
            <Input
              id="gr-qty"
              value={value.receivedQty}
              onChange={(e) => set({ receivedQty: value.receivedAs === 'pcs' ? e.target.value.replace(/[^\d]/g, '') : e.target.value.replace(/[^\d.]/g, '') })}
              inputMode={value.receivedAs === 'pcs' ? 'numeric' : 'decimal'}
              autoComplete="off"
              className="h-12 text-lg font-bold"
            />
          </Field>
        )}
      </div>

      {value.receivedAs === 'takas' && (
        <div className="space-y-3">
          <Field label="Takas that came back" required hint="Our dispatched takas of this party — scan or type a number to find one" error={errors.takaIds}>
            <Input value={takaSearch} onChange={(e) => setTakaSearch(e.target.value)} placeholder="Taka number…" inputMode="tel" autoComplete="off" disabled={!value.customerId} />
          </Field>
          {!value.customerId ? (
            <p className="text-sm text-slate-500">Pick the party first.</p>
          ) : takas.isPending ? (
            <Skeleton className="h-24 rounded-xl" />
          ) : (takas.data ?? []).length === 0 && value.takaIds.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-slate-500">No dispatched takas found for this party.</p>
          ) : (
            <ul className="grid gap-2 md:grid-cols-2">
              {(takas.data ?? []).map((t) => (
                <li key={t.id}>
                  <label className={cn('flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2', value.takaIds.includes(t.id) ? 'border-primary/50 bg-primary-soft/40' : 'border-border bg-white')}>
                    <TickBox
                      size="lg"
                      checked={value.takaIds.includes(t.id)}
                      onCheckedChange={(on) => set({ takaIds: on ? [...value.takaIds, t.id] : value.takaIds.filter((x) => x !== t.id) })}
                      aria-label={`Taka ${t.takaNo} came back`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="text-lg font-bold tabular-nums">{t.takaNo}</span>
                      <span className="ml-2 text-sm text-slate-500">{t.unit === 'meters' ? `${t.meters ?? 0} m` : `${t.pcs ?? 0} pcs`}</span>
                      <span className="block text-xs text-slate-500">Order #{t.orderNo} · {t.designCode ?? '—'} · {t.quality}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Field label="Note" htmlFor="gr-note" hint="Optional">
        <Textarea id="gr-note" value={value.note} onChange={(e) => set({ note: e.target.value })} maxLength={300} rows={2} />
      </Field>
      <div>
        <p className="mb-1.5 text-sm font-medium text-slate-700">Photos <span className="font-normal text-slate-400">(optional)</span></p>
        <DamageImagePicker value={value.images} onChange={(images) => set({ images })} onBusyChange={setBusy} />
      </div>
    </div>
  );
}

/** The payload of a header value (shared by create and edit). */
export function headerPayload(v: ReturnHeaderValue) {
  return {
    customerId: v.customerId!,
    receivedDate: v.receivedDate,
    receivedAs: v.receivedAs,
    receivedQty: v.receivedAs === 'takas' || v.receivedQty === '' ? null : Number(v.receivedQty),
    takaIds: v.receivedAs === 'takas' ? v.takaIds : [],
    note: v.note.trim() || null,
    images: v.images,
  };
}
export function headerErrors(v: ReturnHeaderValue): Record<string, string> {
  const e: Record<string, string> = {};
  if (!v.customerId) e.customerId = 'Select the party';
  if (v.receivedAs === 'takas' ? v.takaIds.length === 0 : !(Number(v.receivedQty) > 0)) e[v.receivedAs === 'takas' ? 'takaIds' : 'receivedQty'] = v.receivedAs === 'takas' ? 'Pick the takas that came back' : 'Enter the quantity received';
  return e;
}

/** Goods return → Mark goods received: saves a Pending GR-n (nothing enters stock yet). */
export default function GoodsReturnFormPage() {
  usePageTitle('Mark goods received');
  const navigate = useNavigate();
  const [value, setValue] = useState<ReturnHeaderValue>(emptyReturnHeader());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useCreatePartyReturn();
  useEffect(() => setErrors({}), [value.receivedAs]);

  const submit = () => {
    const e = headerErrors(value);
    setErrors(e);
    if (Object.keys(e).length) return;
    create.mutate(headerPayload(value), {
      onSuccess: (r) => {
        toast.success(`${r.label} saved as Pending`);
        navigate(`/goods-return/${r.id}`, { replace: true });
      },
      onError: (err) => {
        if (err instanceof ApiError && err.field) setErrors({ [err.field.split('.')[0]]: err.message });
        else toast.error(errorMessage(err));
      },
    });
  };

  return (
    <div className="page-container max-w-5xl space-y-4 pb-28 pt-2 md:py-4">
      <BackLink fallback="/goods-return" label="Goods return" />
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Mark goods received</h1>
        <p className="text-sm text-slate-500">Saved as Pending (GR-n). Nothing enters stock until you organise it design-wise and Complete it.</p>
      </div>
      <section className="rounded-xl border border-border bg-white p-4 shadow-soft md:p-5">
        <ReturnHeaderForm value={value} onChange={setValue} errors={errors} />
      </section>
      <div className="kb-bar sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 -mx-4 flex gap-2 border-t border-border bg-white/95 px-4 py-3 backdrop-blur lg:bottom-0 lg:mx-0 lg:rounded-t-2xl lg:border-x">
        <Button variant="secondary" size="lg" className="h-12 flex-1 sm:flex-none" onClick={() => navigate(-1)} disabled={create.isPending}>Cancel</Button>
        <Button size="lg" className="h-12 flex-1 sm:flex-none" onClick={submit} loading={create.isPending}>Save as Pending</Button>
      </div>
    </div>
  );
}
