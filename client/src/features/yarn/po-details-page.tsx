import { Ban, ChevronDown, Lock, PackageCheck, Pencil, Printer } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { formatKg, YARN_PO_EVENT_LABEL, type YarnPoDetail, type YarnReceipt } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useRole } from '@/hooks/useRole';
import { ApiError, errorMessage } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useCancelYarnPo, useCloseYarnPo, useYarnPo } from './api';
import { actorText, BackLink, Kg, money, ProgressBar, Section, YarnPoStatusBadge, ZoneTag } from './parts';

function Info({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <div className="mt-0.5 truncate text-[15px] font-medium text-slate-800">{children}</div>
    </div>
  );
}

function ReceiptRow({ r }: { r: YarnReceipt }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border-b border-border last:border-0">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3 text-left md:grid-cols-[9rem_7rem_minmax(0,1fr)_8rem_2rem]">
        <div className="min-w-0">
          <p className="font-semibold text-slate-900">Challan {r.challanNo}</p>
          <p className="text-xs text-slate-500 md:hidden">
            {formatDate(r.receiptDate)} · {actorText(r) ?? '—'}
          </p>
        </div>
        <span className="hidden text-sm text-slate-600 md:block">{formatDate(r.receiptDate)}</span>
        <div className="hidden min-w-0 items-center gap-2 md:flex">
          <ZoneTag zone={r.zone} />
          <span className="truncate text-sm text-slate-500">{actorText(r) ?? ''}</span>
        </div>
        <span className="flex items-center gap-2 justify-self-end">
          <Kg g={r.totalG} className="font-bold text-slate-900" />
          <ChevronDown className={cn('size-4 text-slate-400 transition-transform md:hidden', open && 'rotate-180')} />
        </span>
        <ChevronDown className={cn('hidden size-4 justify-self-end text-slate-400 transition-transform md:block', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="mb-3 rounded-xl bg-slate-50 p-3 text-sm">
          <div className="mb-2 md:hidden">
            <ZoneTag zone={r.zone} />
          </div>
          <table className="w-full">
            <thead className="text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="pb-1 text-left font-semibold">Quality</th>
                <th className="pb-1 text-left font-semibold">Lot</th>
                <th className="pb-1 text-right font-semibold">Kg</th>
                <th className="pb-1 text-right font-semibold">Boxes</th>
                <th className="pb-1 text-left font-semibold">Where it went</th>
              </tr>
            </thead>
            <tbody>
              {r.lines.map((l) => (
                <tr key={l.id} className="border-t border-slate-200">
                  <td className="py-1.5 font-medium text-slate-800">{l.quality.name}</td>
                  <td className="py-1.5 text-slate-600">{l.lot ? l.lot.lotNo : '—'}</td>
                  <td className="py-1.5 text-right">
                    <Kg g={l.qtyG} />
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-slate-600">{l.boxes ?? '—'}</td>
                  <td className="py-1.5 text-slate-600">{l.allocations.length ? l.allocations.map((a) => `${a.zone} ${formatKg(a.qtyG)}`).join(', ') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {r.notes && <p className="mt-2 whitespace-pre-line text-slate-600">{r.notes}</p>}
        </div>
      )}
    </li>
  );
}

function Actions({ po }: { po: YarnPoDetail }) {
  const navigate = useNavigate();
  const close = useCloseYarnPo(po.id);
  const cancel = useCancelYarnPo(po.id);
  const [confirm, setConfirm] = useState<'close' | 'cancel' | null>(null);
  const canPrint = useRole().can('canManageYarnPo');
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {po.canReceive && (
          <Button onClick={() => navigate(`/yarn-po/${po.id}/receive`)}>
            <PackageCheck /> Receive challan
          </Button>
        )}
        {canPrint && (
          <Button variant="secondary" onClick={() => navigate(`/print/yarn-po/${po.id}`)}>
            <Printer /> Print PO
          </Button>
        )}
        {(po.canEditAll || po.canEditRemark) && (
          <Button variant="secondary" onClick={() => navigate(`/yarn-po/${po.id}/edit`)}>
            <Pencil /> {po.canEditAll ? 'Edit' : 'Edit remark'}
          </Button>
        )}
        {po.canClose && (
          <Button variant="secondary" onClick={() => setConfirm('close')}>
            <Lock /> Close PO
          </Button>
        )}
        {po.canCancel && (
          <Button variant="secondary" className="text-destructive hover:bg-destructive-soft" onClick={() => setConfirm('cancel')}>
            <Ban /> Cancel
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={confirm === 'close'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Close PO ${po.poNo}?`}
        description={
          <>
            <Kg g={po.totals.pendingG} className="font-semibold" /> is still pending. Closing ends the PO short — no more challans can be received on it.
          </>
        }
        confirmLabel="Close PO"
        loading={close.isPending}
        onConfirm={() =>
          close.mutate(undefined, {
            onSuccess: () => (toast.success(`PO ${po.poNo} closed`), setConfirm(null)),
            onError: (e) => (toast.error(errorMessage(e)), setConfirm(null)),
          })
        }
      />
      <ConfirmDialog
        open={confirm === 'cancel'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Cancel PO ${po.poNo}?`}
        description="Nothing has been received yet. The PO stays on record as Cancelled and its number can't be used again."
        confirmLabel="Cancel PO"
        cancelLabel="Keep it"
        destructive
        loading={cancel.isPending}
        onConfirm={() =>
          cancel.mutate(undefined, {
            onSuccess: () => (toast.success(`PO ${po.poNo} cancelled`), setConfirm(null)),
            onError: (e) => (toast.error(errorMessage(e)), setConfirm(null)),
          })
        }
      />
    </>
  );
}

/** Sprint 17 — Yarn PO details (`/yarn-po/:id`): header + actions, lines with progress, challans received, activity. */
export default function YarnPoDetailsPage() {
  const id = Number(useParams().id);
  const { data: po, isPending, isError, error, refetch } = useYarnPo(id);
  usePageTitle(po ? `PO ${po.poNo}` : 'Yarn PO');

  if (isPending) {
    return (
      <div className="page-container space-y-4 pb-24 pt-5">
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-56 w-full rounded-2xl" />
      </div>
    );
  }
  if (isError || !po) {
    return (
      <div className="page-container space-y-4 pb-24 pt-5">
        <BackLink to="/yarn-po" label="Yarn PO" />
        {error instanceof ApiError && error.status === 404 ? <p className="py-16 text-center font-semibold text-slate-700">PO not found</p> : <ErrorState error={error} onRetry={() => void refetch()} />}
      </div>
    );
  }

  const showRate = po.totals.amountPaise !== null;
  const closed = po.status === 'closed' || po.status === 'cancelled';

  return (
    <div className="page-container space-y-4 pb-24 pt-3 lg:pb-6">
      <BackLink to="/yarn-po" label="Yarn PO" />

      <section className="rounded-2xl border border-border bg-white p-4 shadow-soft md:p-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="text-2xl font-extrabold tracking-tight text-slate-900">PO {po.poNo}</h2>
          <YarnPoStatusBadge status={po.status} />
          <span className="text-sm text-slate-500">{formatDate(po.poDate)}</span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
          <Info label="Party" className="col-span-2">
            {po.party.name}
          </Info>
          <Info label="Mobile">{po.party.mobile ?? '—'}</Info>
          <Info label="GSTIN">{po.party.gstin ?? '—'}</Info>
          <Info label="Ordered">
            <Kg g={po.totals.orderedG} />
          </Info>
          <Info label="Received">
            <Kg g={po.totals.receivedG} />
          </Info>
          <Info label={closed ? 'Not received' : 'Pending'}>
            <Kg g={closed ? Math.max(0, po.totals.orderedG - po.totals.receivedG) : po.totals.pendingG} />
          </Info>
          {showRate && <Info label="Amount">{money(po.totals.amountPaise)}</Info>}
          <Info label="Created by" className="col-span-2">
            {actorText(po.createdBy) ?? '—'} · {formatDateTime(po.createdAt)}
          </Info>
          {po.remark && (
            <Info label="Remark" className="col-span-2 md:col-span-4">
              <span className="whitespace-pre-line">{po.remark}</span>
            </Info>
          )}
        </div>
        <ProgressBar value={po.totals.progress} className="mt-4 h-2" />
        <div className="mt-4">
          <Actions po={po} />
        </div>
      </section>

      <Section title="Lines">
        <div className="hidden md:block">
          <table className="w-full table-fixed text-sm">
            <thead className="border-b border-border text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2 text-left">Quality</th>
                <th className="w-[13%] py-2 text-right">Ordered</th>
                <th className="w-[16%] py-2 text-right">Received</th>
                <th className="w-[13%] py-2 text-right">Pending</th>
                {showRate && <th className="w-[11%] py-2 text-right">Rate</th>}
                {showRate && <th className="w-[14%] py-2 text-right">Amount</th>}
              </tr>
            </thead>
            <tbody>
              {po.lines.map((l) => (
                <tr key={l.id} className="border-b border-border last:border-0">
                  <td className="truncate py-3 font-semibold text-slate-900">{l.quality.name}</td>
                  <td className="py-3 text-right">
                    <Kg g={l.qtyG} />
                  </td>
                  <td className="py-3 text-right">
                    <Kg g={l.receivedG} className="font-semibold" />
                    {l.overG > 0 && <p className="text-xs font-semibold text-amber-700">+<Kg g={l.overG} /> over</p>}
                    <ProgressBar value={l.progress} className="ml-auto mt-1 max-w-24" />
                  </td>
                  <td className="py-3 text-right">
                    <Kg g={l.pendingG} className={l.pendingG ? 'font-semibold text-amber-700' : 'text-slate-400'} />
                  </td>
                  {showRate && <td className="py-3 text-right tabular-nums text-slate-600">{money(l.ratePaise)}</td>}
                  {showRate && <td className="py-3 text-right font-semibold tabular-nums text-slate-800">{money(l.amountPaise)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="space-y-3 md:hidden">
          {po.lines.map((l) => (
            <li key={l.id} className="rounded-xl border border-border p-3">
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate font-semibold text-slate-900">{l.quality.name}</p>
                {showRate && <span className="text-sm font-semibold tabular-nums text-slate-700">{money(l.amountPaise)}</span>}
              </div>
              <ProgressBar value={l.progress} className="mt-2" />
              <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
                <div>
                  <p className="text-xs text-slate-400">Ordered</p>
                  <Kg g={l.qtyG} />
                </div>
                <div>
                  <p className="text-xs text-slate-400">Received</p>
                  <Kg g={l.receivedG} className="font-semibold" />
                </div>
                <div>
                  <p className="text-xs text-slate-400">Pending</p>
                  <Kg g={l.pendingG} />
                </div>
              </div>
              {showRate && <p className="mt-1 text-xs text-slate-500">Rate {money(l.ratePaise)} / kg</p>}
            </li>
          ))}
        </ul>
      </Section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Section title={`Challans received (${po.receipts.length})`}>
          {po.receipts.length ? (
            <ul>
              {po.receipts.map((r) => (
                <ReceiptRow key={r.id} r={r} />
              ))}
            </ul>
          ) : (
            <p className="py-6 text-center text-sm text-slate-500">
              No challans yet.
              {po.canReceive && (
                <>
                  {' '}
                  <Link to={`/yarn-po/${po.id}/receive`} className="font-semibold text-primary hover:underline">
                    Receive the first one
                  </Link>
                </>
              )}
            </p>
          )}
        </Section>
        <Section title="Activity">
          <ol className="relative space-y-4 border-l-2 border-slate-100 pl-4">
            {po.events.map((e) => (
              <li key={e.id} className="relative">
                <span className="absolute -left-[1.4rem] top-1 size-3 rounded-full border-2 border-white bg-primary" aria-hidden />
                <p className="text-sm font-semibold text-slate-800">{YARN_PO_EVENT_LABEL[e.kind]}</p>
                {e.note && <p className="text-sm text-slate-600">{e.note}</p>}
                <p className="text-xs text-slate-400">
                  {formatDateTime(e.createdAt)}
                  {actorText(e) ? ` · ${actorText(e)}` : ''}
                </p>
              </li>
            ))}
          </ol>
        </Section>
      </div>
    </div>
  );
}
