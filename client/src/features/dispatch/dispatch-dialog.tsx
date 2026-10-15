import { AlertTriangle, ChevronDown } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { damageLabel, damageOpenPcs, dispatchChallanLabel, type OrderType } from '@rivoora/shared';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ResponsiveModal } from '@/components/ui/modal';
import { errorMessage } from '@/lib/api';
import { toApiDate } from '@/lib/format';
import { useGodownDamages } from '../godown/api';
import { useCreateDispatch } from './api';

/**
 * Dispatch confirmation (Dhruvil): the client, the totals of everything ready for dispatch, the challan date and the
 * optional transport / LR / Eway numbers. On success the new DC challan opens in the print preview.
 */
export function DispatchDialog({
  open,
  onOpenChange,
  orderId,
  clientName,
  totals,
  orderType,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: number;
  clientName: string | null;
  totals: { takas: number; pcs: number; meters: number };
  orderType?: OrderType;
}) {
  const navigate = useNavigate();
  const create = useCreateDispatch(orderId);
  const [date, setDate] = useState(() => toApiDate(new Date()));
  const [transport, setTransport] = useState('');
  const [lrNo, setLrNo] = useState('');
  const [ewayNo, setEwayNo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [damageOpen, setDamageOpen] = useState(false);
  const damages = useGodownDamages(orderId, open);
  // Takas ready to dispatch that still carry an OPEN damage: a notice only, never a blocker.
  const damaged = useMemo(() => {
    const rows = (damages.data?.items ?? [])
      .filter((t) => t.stage === 'ready_dispatch')
      .map((t) => {
        const open = t.damages.filter((d) => d.status === 'open');
        const pcs = open.reduce((n, d) => n + (damageOpenPcs(d) ?? 0), 0);
        return { id: t.id, takaNo: t.takaNo, pcs: pcs > 0 ? pcs : (t.pcs ?? 0), damages: open };
      })
      .filter((t) => t.damages.length > 0);
    return { rows, pcs: rows.reduce((n, t) => n + t.pcs, 0) };
  }, [damages.data]);

  useEffect(() => {
    if (!open) return;
    setDate(toApiDate(new Date()));
    setTransport('');
    setLrNo('');
    setEwayNo('');
    setError(null);
    setDamageOpen(false);
  }, [open]);

  const submit = () => {
    setError(null);
    create.mutate(
      { challanDate: date, transport, lrNo, ewayNo },
      {
        onSuccess: (res) => {
          onOpenChange(false);
          toast.success(`${dispatchChallanLabel(res.challanNo)} created · ${res.takas} ${res.takas === 1 ? 'taka' : 'takas'} · ${res.pcs.toLocaleString('en-IN')} pcs`);
          navigate(`/print/dispatch-challan/${res.challanId}?preview=1`);
        },
        onError: (err) => setError(errorMessage(err)),
      },
    );
  };

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(o) => !create.isPending && onOpenChange(o)}
      title="Create dispatch challan"
      desktopVariant="center"
      mobileVariant="bottom"
      size="md"
      dismissible={!create.isPending}
      footer={
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
          <Button variant="secondary" size="lg" className="h-12" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            Cancel
          </Button>
          <Button size="lg" className="h-12" onClick={submit} loading={create.isPending} disabled={totals.takas === 0 || !date}>
            Create dispatch challan
          </Button>
        </div>
      }
    >
      <div className="space-y-4 pb-1">
        {clientName && (
          <p className="text-[15px] font-semibold text-slate-900">
            M/s <span className="uppercase">{clientName}</span>
          </p>
        )}
        <dl className="grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3 text-center">
          <div>
            <dt className="text-[12px] text-muted-foreground">Takas</dt>
            <dd className="text-2xl font-bold tabular-nums text-slate-900">{totals.takas}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-muted-foreground">Total pcs</dt>
            <dd className="text-2xl font-bold tabular-nums text-slate-900">{totals.pcs.toLocaleString('en-IN')}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-muted-foreground">Total meters</dt>
            <dd className="text-2xl font-bold tabular-nums text-slate-900">{totals.meters > 0 ? totals.meters.toFixed(2) : '—'}</dd>
          </div>
        </dl>
        {damaged.rows.length > 0 && (
          <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 text-amber-900">
            <button
              type="button"
              onClick={() => setDamageOpen((o) => !o)}
              aria-expanded={damageOpen}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold"
            >
              <AlertTriangle className="size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">
                {damaged.rows.length} {damaged.rows.length === 1 ? 'taka' : 'takas'} ({damaged.pcs.toLocaleString('en-IN')} pcs) still have damage
              </span>
              <ChevronDown className={`size-4 shrink-0 transition-transform ${damageOpen ? 'rotate-180' : ''}`} aria-hidden />
            </button>
            {damageOpen && (
              <ul className="space-y-1 border-t border-amber-200 px-3 py-2 text-[13px]">
                {damaged.rows.map((t) => (
                  <li key={t.id} className="flex flex-wrap gap-x-2">
                    {orderType !== 'pcs_to_pcs' && <span className="font-bold tabular-nums">{t.takaNo}</span>}
                    <span>
                      {t.damages
                        .map((d) => damageLabel(d.foundAt, d.damageName, damageOpenPcs(d)))
                        .join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <Field label="Challan date" htmlFor="dc-date">
          <DatePicker id="dc-date" value={date} onChange={setDate} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Transport" htmlFor="dc-transport">
            <Input id="dc-transport" value={transport} onChange={(e) => setTransport(e.target.value)} maxLength={80} autoComplete="off" />
          </Field>
          <Field label="LR no" htmlFor="dc-lr">
            <Input id="dc-lr" value={lrNo} onChange={(e) => setLrNo(e.target.value)} maxLength={40} autoComplete="off" />
          </Field>
          <Field label="Eway no" htmlFor="dc-eway">
            <Input id="dc-eway" value={ewayNo} onChange={(e) => setEwayNo(e.target.value)} maxLength={40} autoComplete="off" />
          </Field>
        </div>
        {error && (
          <p role="alert" className="text-[13px] font-medium text-destructive">
            {error}
          </p>
        )}
      </div>
    </ResponsiveModal>
  );
}
