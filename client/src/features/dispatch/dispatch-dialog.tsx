import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { dispatchChallanLabel } from '@rivoora/shared';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ResponsiveModal } from '@/components/ui/modal';
import { errorMessage } from '@/lib/api';
import { toApiDate } from '@/lib/format';
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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: number;
  clientName: string | null;
  totals: { takas: number; pcs: number; meters: number };
}) {
  const navigate = useNavigate();
  const create = useCreateDispatch(orderId);
  const [date, setDate] = useState(() => toApiDate(new Date()));
  const [transport, setTransport] = useState('');
  const [lrNo, setLrNo] = useState('');
  const [ewayNo, setEwayNo] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDate(toApiDate(new Date()));
    setTransport('');
    setLrNo('');
    setEwayNo('');
    setError(null);
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
