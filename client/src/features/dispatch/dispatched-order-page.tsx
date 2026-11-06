import { ArrowLeft, Pencil, Printer, SearchX, Undo2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ORDER_TYPE_LABEL, returnedSummary, type DispatchChallanListItem } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ImageThumb } from '@/components/ui/image-thumb';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { ApiError, errorMessage } from '@/lib/api';
import { ReasonDialog } from '@/components/ui/reason-dialog';
import { formatDate, formatOrderNo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useDispatchedOrder, useUndoDispatch } from './api';
import { EditDispatchChallanDialog } from './edit-challan-dialog';
import { BlouseTag } from '../free-stock/blouse';
import { OnHoldBadge } from '../orders/hold/hold-order';

/** `/dispatched/:orderId` — the order header and every dispatch challan (all revisions) with Print and GR. */
export default function DispatchedOrderPage() {
  const orderId = Number(useParams().orderId);
  const navigate = useNavigate();
  const query = useDispatchedOrder(orderId);
  usePageTitle(query.data ? `Dispatched · Order ${formatOrderNo(query.data.orderNo)}` : 'Dispatched');
  const o = query.data;
  const [undoFor, setUndoFor] = useState<DispatchChallanListItem | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);
  const [editFor, setEditFor] = useState<DispatchChallanListItem | null>(null);
  const undo = useUndoDispatch(undoFor?.id ?? 0);

  return (
    <div className="page-container space-y-4 pb-6 pt-3 md:pt-5">
      <button type="button" onClick={() => navigate('/dispatched')} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-primary">
        <ArrowLeft className="size-4" /> Dispatched
      </button>
      {query.isPending ? (
        <div className="space-y-4">
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      ) : query.isError || !o ? (
        <div className="rounded-xl border border-border bg-white shadow-soft">
          {query.error instanceof ApiError && query.error.status === 404 ? <EmptyState icon={SearchX} title="Nothing dispatched on this order" /> : <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
        </div>
      ) : (
        <>
          <section className="flex items-center gap-4 rounded-2xl border border-border bg-white p-4 shadow-soft">
            <ImageThumb thumbUrl={o.thumbUrl} fullUrl={o.imageUrl} alt={o.designCode ? `Design ${o.designCode}` : 'No design'} className="size-20 shrink-0 md:size-24" rounded="rounded-xl" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-slate-900">Order {formatOrderNo(o.orderNo)}</h1>
                <StatusBadge status={o.status} />
                {o.isOnHold && <OnHoldBadge />}
              </div>
              <p className="truncate text-[15px] font-semibold text-slate-700">{o.customerName}</p>
              <p className="truncate text-sm text-slate-500">
                {o.designCode ? `Design ${o.designCode}` : 'No design'}
                {o.quality && ` · ${o.quality}`} · {ORDER_TYPE_LABEL[o.orderType]}
                {o.blouseOption && <BlouseTag option={o.blouseOption} className="ml-2 align-middle" />}
              </p>
              <p className="text-sm font-semibold tabular-nums text-slate-800">
                {o.dispatchedPcs.toLocaleString('en-IN')} <span className="font-medium text-slate-500">/ {o.orderedPcs.toLocaleString('en-IN')} pcs dispatched</span>
              </p>
            </div>
          </section>

          {o.returned && (
            <p className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-[14px] font-medium text-sky-900">
              {returnedSummary(o.returned.takas, o.returned.pcs)}
              {' · '}
              <Link to={`/print/dispatch-challan/${o.returned.challanId}`} className="font-semibold underline underline-offset-2">
                See {o.returned.challanLabel}
              </Link>
            </p>
          )}

          <section className="overflow-hidden rounded-xl border border-border bg-white shadow-soft">
            <h2 className="border-b border-border bg-slate-50 px-4 py-2 text-[12px] font-semibold uppercase tracking-wide text-slate-500">Dispatch challans</h2>
            <ul className="divide-y divide-border">
              {o.challans.map((c) => (
                <li key={c.id} className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3', c.status === 'revised' && 'bg-slate-50/60')}>
                  <div className="min-w-0 flex-1 basis-40">
                    <p className="flex items-center gap-2 text-xl font-bold tabular-nums text-slate-900">
                      {c.label}
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-[11px] font-bold',
                          c.status === 'active' ? 'bg-emerald-100 text-emerald-800' : c.status === 'cancelled' ? 'bg-red-100 text-red-700' : 'bg-slate-200 text-slate-600',
                        )}
                      >
                        {c.status === 'active' ? 'Active' : c.status === 'cancelled' ? 'Cancelled' : 'Revised'}
                      </span>
                    </p>
                    <p className="text-sm tabular-nums text-slate-500">{formatDate(c.challanDate)}</p>
                  </div>
                  <p className="text-sm font-medium tabular-nums text-slate-600">
                    {c.takas} {c.takas === 1 ? 'taka' : 'takas'} · {c.pcs.toLocaleString('en-IN')} pcs{c.meters > 0 && ` · ${c.meters.toFixed(2)} m`}
                  </p>
                  <div className="ml-auto flex items-center gap-2">
                    <Button variant="secondary" size="icon" className="size-11" aria-label={`Print ${c.label}`} onClick={() => navigate(`/print/dispatch-challan/${c.id}`)}>
                      <Printer />
                    </Button>
                    {c.canUndo && (
                      <Button variant="secondary" size="icon" className="size-11" aria-label={`Edit ${c.label}`} onClick={() => setEditFor(c)}>
                        <Pencil />
                      </Button>
                    )}
                    {c.canUndo && (
                      <Button
                        variant="secondary"
                        className="h-11 text-destructive hover:bg-destructive-soft"
                        onClick={() => {
                          setUndoError(null);
                          setUndoFor(c);
                        }}
                      >
                        <XCircle /> Undo dispatch
                      </Button>
                    )}
                    {c.canGoodsReturn && (
                      <Button variant="secondary" className="h-11" onClick={() => navigate(`/dispatched/${o.orderId}/challans/${c.id}/gr`)}>
                        <Undo2 /> GR
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
      <EditDispatchChallanDialog challan={editFor} open={editFor !== null} onOpenChange={(o) => !o && setEditFor(null)} />
      <ReasonDialog
        open={undoFor !== null}
        onOpenChange={(o) => !o && setUndoFor(null)}
        title={`Undo dispatch ${undoFor?.label ?? ''}`}
        confirmLabel="Undo dispatch"
        destructive
        loading={undo.isPending}
        error={undoError}
        onConfirm={(reason) =>
          undo.mutate(
            { reason },
            {
              onSuccess: (r) => {
                toast.success(`${r.label} cancelled · ${r.takas} takas back to Ready for dispatch`);
                setUndoFor(null);
              },
              onError: (err) => setUndoError(errorMessage(err)),
            },
          )
        }
      >
        {undoFor?.takas} {undoFor?.takas === 1 ? 'taka goes' : 'takas go'} back to Ready for dispatch · {undoFor?.label} will be marked Cancelled (its number is never reused).
      </ReasonDialog>
    </div>
  );
}
