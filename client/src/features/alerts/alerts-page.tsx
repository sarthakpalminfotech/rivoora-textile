import { useQuery } from '@tanstack/react-query';
import { BellRing, CheckCircle2 } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { ALERT_ROLES, ALERT_TYPE_LABEL, ALERT_TYPES, isAlertType, type AlertType, type OverdueAlert } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState } from '@/components/list-parts';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { useRole } from '@/hooks/useRole';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

/* Sprint 21 (CR-11 + C5) — overdue alerts. On screen only; nothing is pushed or sent. */

export interface AlertsData {
  items: OverdueAlert[];
  counts: Record<AlertType, number>;
  total: number;
}

export const alertKeys = { all: ['alerts'] as const };

/** All alerts of the role (refetched every 5 minutes and on focus). Shared by the page, the nav badge, cards and banners. */
export function useAlerts(enabled = true) {
  return useQuery({
    queryKey: alertKeys.all,
    queryFn: ({ signal }) => api.get<AlertsData>('/alerts', undefined, signal),
    enabled,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
    staleTime: 60_000,
  });
}

const TYPE_TONE: Record<AlertType, string> = {
  production: 'bg-blue-100 text-blue-800',
  butta: 'bg-amber-100 text-amber-800',
  mill: 'bg-violet-100 text-violet-800',
  whole_order: 'bg-red-100 text-red-800',
  sent_short: 'bg-orange-100 text-orange-800',
};

function AlertCard({ a }: { a: OverdueAlert }) {
  return (
    <li className="rounded-xl border border-border bg-white p-4 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-lg font-bold text-slate-900">
            Order #{a.orderNo}
            {a.designCode && <span className="ml-2 text-sm font-medium text-slate-500">{a.designCode}</span>}
          </p>
          <p className="text-sm text-slate-700">{a.stage}</p>
        </div>
        {a.type !== 'sent_short' && (
          <span className="shrink-0 rounded-full bg-red-100 px-2.5 py-1 text-xs font-bold text-red-700">over by {a.overBy} {a.overBy === 1 ? 'day' : 'days'}</span>
        )}
      </div>
      <p className="mt-2 text-xs text-slate-500">
        {a.type === 'sent_short' ? 'Order closed / dispatched short' : `Started ${formatDateTime(a.startedAt)} · ${a.days} days (limit ${a.limitDays})`}
      </p>
      <Link to={a.link} className="mt-2 inline-flex min-h-10 items-center text-sm font-semibold text-primary hover:underline">
        Open
      </Link>
    </li>
  );
}

function AlertRow({ a }: { a: OverdueAlert }) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-3 py-2 font-semibold">#{a.orderNo}</td>
      <td className="px-3 py-2 text-slate-600">{a.designCode ?? '—'}</td>
      <td className="px-3 py-2">{a.stage}</td>
      <td className="px-3 py-2 text-slate-600">{a.type === 'sent_short' ? '—' : formatDateTime(a.startedAt)}</td>
      <td className="px-3 py-2 tabular-nums">{a.type === 'sent_short' ? '—' : a.days}</td>
      <td className="px-3 py-2 font-semibold text-red-700 tabular-nums">{a.type === 'sent_short' ? '—' : `+${a.overBy}`}</td>
      <td className="px-3 py-2 text-right">
        <Link to={a.link} className="font-semibold text-primary hover:underline">
          Open
        </Link>
      </td>
    </tr>
  );
}

export default function AlertsPage() {
  usePageTitle('Alerts');
  const { role } = useRole();
  const [params, setParams] = useSearchParams();
  const typeParam = params.get('type');
  const type: AlertType | 'all' = isAlertType(typeParam) ? typeParam : 'all';
  const q = useAlerts();
  const myTypes = ALERT_TYPES.filter((t) => ALERT_ROLES[t].includes(role));

  const options = [
    { value: 'all' as const, label: `All${q.data ? ` (${q.data.total})` : ''}` },
    ...myTypes.map((t) => ({ value: t, label: `${ALERT_TYPE_LABEL[t].replace(' overdue', '')}${q.data ? ` (${q.data.counts[t]})` : ''}` })),
  ];
  const items = (q.data?.items ?? []).filter((a) => type === 'all' || a.type === type);
  const groups = myTypes.filter((t) => type === 'all' || t === type).map((t) => ({ t, list: items.filter((a) => a.type === t) })).filter((g) => g.list.length > 0);

  return (
    <div className="page-container space-y-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Alerts</h1>
          <p className="text-sm text-slate-500">Work that has been in a stage longer than it should. Shown here only — nothing is sent.</p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <Segmented<AlertType | 'all'>
          aria-label="Alert type"
          options={options}
          value={type}
          onChange={(v) => setParams(v === 'all' ? {} : { type: v }, { replace: true })}
        />
      </div>

      {q.isPending ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-border bg-white px-6 py-14 text-center shadow-soft">
          <CheckCircle2 className="mb-3 size-10 text-green-600" aria-hidden />
          <p className="text-lg font-semibold text-slate-900">Nothing is overdue</p>
          <p className="text-sm text-slate-500">Everything is within its time limit.</p>
        </div>
      ) : (
        groups.map(({ t, list }) => (
          <section key={t} className="space-y-2">
            <h2 className="flex items-center gap-2 text-base font-bold text-slate-800">
              <BellRing className="size-4 text-slate-400" aria-hidden />
              <span className={cn('rounded-full px-2.5 py-0.5 text-sm', TYPE_TONE[t])}>{ALERT_TYPE_LABEL[t]}</span>
              <span className="text-sm font-medium text-slate-400">{list.length}</span>
            </h2>
            {/* phone + tablet: cards (2 columns from md) · desktop: a table */}
            <ul className="grid gap-3 md:grid-cols-2 lg:hidden">
              {list.map((a, i) => (
                <AlertCard key={`${a.type}-${a.orderId}-${a.stage}-${i}`} a={a} />
              ))}
            </ul>
            <div className="hidden overflow-hidden rounded-xl border border-border bg-white shadow-soft lg:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2">Order</th>
                    <th className="px-3 py-2">Design</th>
                    <th className="px-3 py-2">Stage</th>
                    <th className="px-3 py-2">Started</th>
                    <th className="px-3 py-2">Days</th>
                    <th className="px-3 py-2">Over by</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {list.map((a, i) => (
                    <AlertRow key={`${a.type}-${a.orderId}-${a.stage}-${i}`} a={a} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </div>
  );
}

/** Sprint 21: a red "Overdue" chip for an order card (nothing when the order has no active alert). */
export function useOverdueOrderIds(): Set<number> {
  const { can } = useRole();
  const q = useAlerts(can('canViewAlerts'));
  return new Set((q.data?.items ?? []).filter((a) => a.type !== 'sent_short').map((a) => a.orderId));
}

/** Sprint 21: one red line per active alert of this order, on the order page. */
export function OverdueBanner({ orderId }: { orderId: number }) {
  const { can } = useRole();
  const q = useAlerts(can('canViewAlerts'));
  const mine = (q.data?.items ?? []).filter((a) => a.orderId === orderId);
  if (!mine.length) return null;
  return (
    <div role="status" className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-red-950">
      <p className="mb-1 flex items-center gap-2 font-bold">
        <BellRing className="size-4 text-red-600" aria-hidden /> Overdue
      </p>
      <ul className="space-y-0.5 text-[14px]">
        {mine.map((a, i) => (
          <li key={i}>
            <span className="font-semibold">{ALERT_TYPE_LABEL[a.type]}</span> · {a.stage}
            {a.type !== 'sent_short' && <> · {a.days} days (limit {a.limitDays}) · over by {a.overBy}</>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Sprint 21: the count on the Alerts nav item. */
export function AlertsNavBadge() {
  const q = useAlerts();
  const n = q.data?.total ?? 0;
  if (!n) return null;
  return <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-[11px] font-bold leading-5 text-white">{n > 99 ? '99+' : n}</span>;
}
