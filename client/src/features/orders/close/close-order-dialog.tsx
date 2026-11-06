import { Ban, CheckCircle2, ExternalLink, Info, ShieldAlert, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { formatQty, isMeterOrder, type ClosePreview, type Unit } from '@rivoora/shared';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { ResponsiveModal } from '@/components/ui/modal';
import { errorMessage } from '@/lib/api';
import { formatOrderNo } from '@/lib/format';
import { useCloseOrder, useClosePreview } from './api';

/** What Close will do when the order is clear (Sprint 21). */
function WhatHappens({ preview, meterOrder }: { preview: ClosePreview; meterOrder: boolean }) {
  const parts: string[] = [];
  if (preview.pendingJobsheets) parts.push(`${preview.pendingJobsheets} pending jobsheet${preview.pendingJobsheets === 1 ? '' : 's'} will be cancelled`);
  if (preview.freeTakas)
    parts.push(
      `${preview.freeTakas} taka${preview.freeTakas === 1 ? '' : 's'} with us (${meterOrder ? formatQty(preview.freeMeters, 'meters') : `${preview.freePcs} pcs`}) go to free stock`,
    );
  if (preview.dispatchedTakas) parts.push(`${preview.dispatchedTakas} dispatched taka${preview.dispatchedTakas === 1 ? '' : 's'} stay with the client`);
  if (!parts.length) return <p className="text-sm text-slate-500">Nothing is in progress — the order will simply be marked Closed.</p>;
  return (
    <ul className="space-y-1.5 text-sm text-slate-700">
      {parts.map((p, i) => (
        <li key={i} className="flex items-start gap-2">
          <Info className="mt-0.5 size-4 shrink-0 text-slate-400" aria-hidden />
          {p}
        </li>
      ))}
    </ul>
  );
}

/** The red panel: what must be cleared first. Phone: stacked cards · tablet: 2-column cards · desktop: a table. */
function BlockerList({ blockers, onNavigate }: { blockers: ClosePreview['blockers']; onNavigate: () => void }) {
  return (
    <section role="alert" aria-label="Why this order can't be closed" className="rounded-xl border border-red-300 bg-red-50 p-4">
      <p className="flex items-start gap-2 text-[15px] font-semibold text-red-900">
        <ShieldAlert className="mt-0.5 size-5 shrink-0 text-red-600" aria-hidden />
        This order can't be closed yet — clear these first:
      </p>
      {/* phone + tablet: cards (2 columns from md) */}
      <ul className="mt-3 grid gap-2 md:grid-cols-2 lg:hidden">
        {blockers.map((b) => (
          <li key={b.kind} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2.5 shadow-soft">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">{b.label}</p>
              <p className="text-xs text-slate-500">{b.count}</p>
            </div>
            <Link to={b.link} onClick={onNavigate} className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-3 text-sm font-semibold text-primary hover:bg-primary-soft">
              Open <ExternalLink className="size-4" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
      {/* desktop: a table */}
      <table className="mt-3 hidden w-full overflow-hidden rounded-lg bg-white text-sm shadow-soft lg:table">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="px-3 py-2 font-semibold">Still in process</th>
            <th className="px-3 py-2 text-right font-semibold">Count</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {blockers.map((b) => (
            <tr key={b.kind} className="border-b border-border last:border-0">
              <td className="px-3 py-2 font-medium text-slate-900">{b.label}</td>
              <td className="px-3 py-2 text-right tabular-nums">{b.count}</td>
              <td className="px-3 py-2 text-right">
                <Link to={b.link} onClick={onNavigate} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
                  Open <ExternalLink className="size-4" aria-hidden />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/**
 * Close order (Jenish, Gaurang). Sprint 21 (CR-04): only when nothing of the order is in process. The dialog opens with
 * the preview — blockers (Close disabled) or a summary of what will happen.
 */
export function CloseOrderDialog({ orderId, orderNo, unit, open, onOpenChange }: { orderId: number; orderNo: number; unit: Unit; open: boolean; onOpenChange: (open: boolean) => void }) {
  const preview = useClosePreview(orderId, open);
  const close = useCloseOrder(orderId);
  const meterOrder = isMeterOrder({ unit });
  const [note, setNote] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setNote('');
    setServerError(null);
  }, [open]);

  const blockers = preview.data?.blockers ?? [];
  const ready = !preview.isPending && !preview.isError && blockers.length === 0;

  const submit = () => {
    setServerError(null);
    close.mutate(
      { note: note.trim() || null },
      {
        onSuccess: (res) => {
          toast.success(
            `Order ${formatOrderNo(orderNo)} is closed` +
              (res.freeTakas > 0 ? ` · ${res.freeTakas} taka${res.freeTakas === 1 ? '' : 's'} to free stock` : ''),
          );
          onOpenChange(false);
        },
        // A 409 means something changed meanwhile — show it and reload the blocker list.
        onError: (err) => {
          setServerError(errorMessage(err));
          void preview.refetch();
        },
      },
    );
  };

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(o) => !close.isPending && onOpenChange(o)}
      title={`Close order ${formatOrderNo(orderNo)}?`}
      size="md"
      footer={
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
          <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)} disabled={close.isPending}>
            Cancel
          </Button>
          <Button variant="destructive" size="lg" onClick={submit} disabled={!ready} loading={close.isPending}>
            <Ban /> Close order
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <p className="rounded-[10px] bg-slate-50 px-3.5 py-3 text-[15px] leading-relaxed text-slate-700">
          This closes the order for good. It is hidden from production, QC, godown and dispatch (besides what was already dispatched) — there is no reopening it.
        </p>

        {preview.isPending ? (
          <p className="text-sm text-muted-foreground">Checking what's in progress…</p>
        ) : preview.isError ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {errorMessage(preview.error)}
          </p>
        ) : blockers.length > 0 ? (
          <BlockerList blockers={blockers} onNavigate={() => onOpenChange(false)} />
        ) : (
          <div className="rounded-xl border border-green-200 bg-green-50/60 p-3.5">
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-green-900">
              <CheckCircle2 className="size-4 text-green-600" aria-hidden /> Everything is cleared. On close:
            </p>
            <WhatHappens preview={preview.data!} meterOrder={meterOrder} />
          </div>
        )}

        <Field label="Note (optional)" htmlFor="close-note" hint="Shown on the order and in its History.">
          <textarea
            id="close-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={300}
            rows={3}
            disabled={close.isPending}
            className="w-full resize-none rounded-[10px] border border-input bg-white px-3 py-2.5 text-[15px] text-slate-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15"
          />
        </Field>

        {serverError && (
          <p role="alert" className="flex items-start gap-2 rounded-lg bg-destructive-soft px-3 py-2 text-sm font-medium text-destructive">
            <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {serverError}
          </p>
        )}
      </div>
    </ResponsiveModal>
  );
}
