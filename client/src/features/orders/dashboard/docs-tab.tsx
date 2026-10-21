import { Ban, CheckCircle2, FileText, Printer } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { CHALLAN_KIND_CONFIG, challanLabel, formatMeters, isDeliveryChallan, type OrderChallan, type OrderDeliveryChallan } from '@rivoora/shared';
import { ErrorState } from '@/components/list-parts';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useOrderChallans } from '../../challans/api';
import { challanDetailsPath, challanPrintPath } from '../../challans/kind';
import { RefinishTag } from '../../takas/taka-tags';

/** Delivery (dispatch) challan: DC-12 / DC-12 R1 with its Active / Revised state. Opens the order's dispatch screen. */
function DeliveryRow({ c, onOpen }: { c: OrderDeliveryChallan; onOpen: () => void }) {
  const revised = c.status === 'revised';
  return (
    <li
      role="link"
      tabIndex={0}
      aria-label={`Open delivery challan ${c.label}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('a, button')) return;
        onOpen();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) onOpen();
      }}
      className={cn(
        'flex min-w-0 cursor-pointer flex-col gap-3 rounded-xl border bg-white p-4 shadow-soft outline-none transition duration-150 hover:border-primary/30 hover:shadow-pop focus-visible:ring-2 focus-visible:ring-primary/40',
        revised ? 'border-slate-200 bg-slate-50' : 'border-border',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={cn('text-2xl font-bold leading-tight tabular-nums', revised ? 'text-slate-400' : 'text-slate-900')}>{c.label}</p>
          <p className="text-sm text-slate-500">{formatDate(c.challanDate)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-2.5 py-1 text-xs font-semibold text-slate-600">
            <span className="size-2 rounded-full bg-emerald-500" aria-hidden />
            Delivery
          </span>
          <Link
            to={`/print/dispatch-challan/${c.id}`}
            className="flex size-10 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-muted hover:text-primary"
            aria-label={`Print delivery challan ${c.label}`}
            title="Print"
                     >
            <Printer className="size-5" aria-hidden />
          </Link>
        </div>
      </div>
      <dl className="grid grid-cols-3 gap-x-3 text-sm">
        <div>
          <dt className="text-[12px] text-muted-foreground">Takas</dt>
          <dd className="text-[15px] font-bold tabular-nums text-slate-900">{c.takas}</dd>
        </div>
        <div>
          <dt className="text-[12px] text-muted-foreground">Pcs</dt>
          <dd className="text-[15px] font-bold tabular-nums text-slate-900">{c.pcs.toLocaleString('en-IN')}</dd>
        </div>
        <div>
          <dt className="text-[12px] text-muted-foreground">Meters</dt>
          <dd className="text-[15px] font-bold tabular-nums text-slate-900">{c.meters > 0 ? formatMeters(c.meters) : '—'}</dd>
        </div>
      </dl>
      <span
        className={cn(
          'inline-flex w-fit items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold',
          revised ? 'bg-slate-200 text-slate-600' : 'bg-green-100 text-green-700',
        )}
      >
        {revised ? 'Revised' : 'Active'}
      </span>
    </li>
  );
}

/** More document types can be added here later (each one gets its own pill). */
const DOC_SECTIONS = [{ key: 'challans', label: 'Challans' }] as const;

function ChallanRow({ c, onOpen }: { c: OrderChallan; onOpen: () => void }) {
  const cfg = CHALLAN_KIND_CONFIG[c.kind];
  const cancelled = c.status === 'cancelled';
  const done = c.totalTakas > 0 && c.receivedCount >= c.totalTakas;
  const share = c.totalTakas > 0 ? c.receivedCount / c.totalTakas : 0;
  return (
    <li
      role="link"
      tabIndex={0}
      aria-label={`Open challan ${challanLabel(c.challanNo, c.kind)}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('a, button')) return;
        onOpen();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) onOpen();
      }}
      className={cn(
        'flex min-w-0 cursor-pointer flex-col gap-3 rounded-xl border bg-white p-4 shadow-soft outline-none transition duration-150 hover:border-primary/30 hover:shadow-pop focus-visible:ring-2 focus-visible:ring-primary/40',
        cancelled ? 'border-slate-200 bg-slate-50' : 'border-border',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={cn('text-2xl font-bold leading-tight tabular-nums', cancelled ? 'text-slate-400 line-through' : 'text-slate-900')}>
            {challanLabel(c.challanNo, c.kind)}
          </p>
          <p className="truncate text-[15px] font-semibold text-slate-700">{c.partyName}</p>
          <p className="text-sm text-slate-500">{formatDate(c.challanDate)}</p>
          {c.isRefinish && <RefinishTag className="mt-1" />}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-2.5 py-1 text-xs font-semibold text-slate-600">
            <span className="size-2 rounded-full" style={{ backgroundColor: cfg.colour }} aria-hidden />
            {cfg.label}
          </span>
          <Link
            to={challanPrintPath(c.kind, c.id)}
            className="flex size-10 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-muted hover:text-primary"
            aria-label={`Print challan ${challanLabel(c.challanNo, c.kind)}`}
            title="Print"
          >
            <Printer className="size-5" aria-hidden />
          </Link>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 text-sm">
        <div>
          <dt className="text-[12px] text-muted-foreground">This order</dt>
          <dd className="text-[15px] font-bold tabular-nums text-slate-900">
            {c.orderTakas} of {c.totalTakas} takas
          </dd>
        </div>
        <div>
          <dt className="text-[12px] text-muted-foreground">Meters</dt>
          <dd className="text-[15px] font-bold tabular-nums text-slate-900">{formatMeters(c.orderMeters)}</dd>
        </div>
      </dl>
      {cancelled ? (
        <span className="inline-flex w-fit items-center gap-1 rounded-full bg-slate-200 px-2.5 py-1 text-xs font-bold text-slate-600">
          <Ban className="size-3.5" aria-hidden /> Cancelled
        </span>
      ) : (
        <div className="space-y-1">
          <div
            className="h-1.5 overflow-hidden rounded-full bg-slate-100"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={c.totalTakas}
            aria-valuenow={c.receivedCount}
            aria-label={`Sent ${c.totalTakas} takas, received ${c.receivedCount}`}
          >
            <div className={cn('h-full rounded-full', done ? 'bg-green-500' : 'bg-amber-500')} style={{ width: `${share * 100}%` }} />
          </div>
          {done ? (
            <p className="inline-flex items-center gap-1 text-sm font-bold text-green-700">
              <CheckCircle2 className="size-4" aria-hidden /> Sent {c.totalTakas} {c.totalTakas === 1 ? 'taka' : 'takas'} · Received {c.receivedCount}
            </p>
          ) : (
            <p className="text-sm font-semibold text-amber-700">
              Sent {c.totalTakas} {c.totalTakas === 1 ? 'taka' : 'takas'} · Received {c.receivedCount}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

/** Order details → Docs: a pill row of document types (Challans for now) and the documents of this order. */
export function DocsTab({ orderId }: { orderId: number }) {
  const [section, setSection] = useState<(typeof DOC_SECTIONS)[number]['key']>('challans');
  const navigate = useNavigate();
  const location = useLocation();
  const query = useOrderChallans(orderId);
  const from = `${location.pathname}${location.search}`;

  return (
    <div className="space-y-4">
      <div className="-mx-1 flex max-w-full gap-1.5 overflow-x-auto px-1 scrollbar-none" role="group" aria-label="Document type">
        {DOC_SECTIONS.map((d) => (
          <button
            key={d.key}
            type="button"
            onClick={() => setSection(d.key)}
            aria-pressed={section === d.key}
            className={cn(
              'min-h-9 shrink-0 rounded-full border px-3.5 text-[13px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40',
              section === d.key ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-white text-slate-600 hover:bg-muted',
            )}
          >
            {d.label}
          </button>
        ))}
      </div>

      {section === 'challans' &&
        (query.isPending ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(18rem,1fr))]">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-44 rounded-xl" />
            ))}
          </div>
        ) : query.isError || !query.data ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : query.data.items.length === 0 ? (
          <div className="rounded-xl border border-border bg-white shadow-soft">
            <EmptyState icon={FileText} title="No challans for this order yet" description="Butta cutting, mill and delivery challans of this order appear here." className="py-10" />
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(18rem,1fr))]">
            {query.data.items.map((c) =>
              isDeliveryChallan(c) ? (
                <DeliveryRow key={`dc-${c.id}`} c={c} onOpen={() => navigate(`/dispatched/${orderId}`, { state: { from } })} />
              ) : (
                <ChallanRow key={c.id} c={c} onOpen={() => navigate(challanDetailsPath(c.kind, c.id), { state: { from } })} />
              ),
            )}
          </ul>
        ))}
    </div>
  );
}
