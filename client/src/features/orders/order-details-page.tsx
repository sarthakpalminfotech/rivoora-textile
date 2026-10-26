import { ArrowLeft, CalendarClock, Check, ImageOff, PackageCheck, Send, X as XIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { isReadyOrLater, ORDER_TYPE_LABEL, STEP_KEYS, STEP_LABEL, returnedSummary, stepOn, STATUS, type OrderDetail } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ImageThumb } from '@/components/ui/image-thumb';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useRole } from '@/hooks/useRole';
import { ApiError } from '@/lib/api';
import { formatDateTime, formatOrderNo } from '@/lib/format';
import { OrderJobsheetsSection } from '../jobsheets/order-jobsheets-section';
import { OutsideTab } from '../outside/outside-tab';
import { OrderTakasCard } from '../takas/takas-card';
import { cn } from '@/lib/utils';
import { useOrder, useUndoProduction } from './api';
import { useOrderDashboard } from './dashboard/api';
import { DamagesTab } from './dashboard/damages-tab';
import { DocsTab } from './dashboard/docs-tab';
import { DashboardSkeleton, DashboardTab } from './dashboard/dashboard-tab';
import { OrderHeader } from './dashboard/order-header';
import { useOrderView, type OrderTab } from './dashboard/view-state';
import { BlouseTag } from '../free-stock/blouse';
import { CloseOrderDialog } from './close/close-order-dialog';
import { HistoryTab } from './history-tab';
import { HoldOrderDialog, OnHoldBanner, ReleaseHoldDialog } from './hold/hold-order';

function Card({ title, children, action, className }: { title: string; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-xl border border-border bg-white p-4 shadow-soft md:p-5', className)}>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Item({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-[15px] font-semibold text-slate-900">{children}</dd>
    </div>
  );
}

/** Order details tab: notes, dates and the design (the header holds the main fields). */
function DetailsTab({ order }: { order: OrderDetail }) {
  const { can } = useRole();
  const image = order.design;
  const code = order.design?.code;
  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
      <div className="min-w-0 space-y-4">
        <Card title="Order">
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Item label="Order type">{ORDER_TYPE_LABEL[order.orderType]}</Item>
            <Item label="Blouse">{order.blouseOption ? <BlouseTag option={order.blouseOption} /> : <span className="font-normal text-slate-400">Not set</span>}</Item>
            {can('canSeeClient') && <Item label="Client">{order.customer.name}</Item>}
            {can('canSeeClient') && (
              <Item label="Broker">{order.broker ? order.broker.name : <span className="font-normal text-slate-400">—</span>}</Item>
            )}
            <Item label="Steps" className="sm:col-span-3">
              <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm font-semibold">
                {STEP_KEYS.map((k) => {
                  const on = stepOn(order, k);
                  return (
                    <span key={k} className={cn('inline-flex items-center gap-1', on ? 'text-slate-800' : 'text-slate-400')}>
                      {on ? <Check className="size-3.5 text-emerald-600" aria-hidden /> : <XIcon className="size-3.5" aria-hidden />}
                      {STEP_LABEL[k]}
                    </span>
                  );
                })}
              </span>
            </Item>
          </dl>
        </Card>

        {order.returned && (
          <p className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-[14px] font-medium text-sky-900">
            {returnedSummary(order.returned.takas, order.returned.pcs)}
            {' · '}
            <Link to={`/print/dispatch-challan/${order.returned.challanId}`} className="font-semibold underline underline-offset-2">
              See {order.returned.challanLabel}
            </Link>
          </p>
        )}

        <Card title="Notes">
          {order.notes ? (
            <p className="whitespace-pre-line text-[15px] leading-relaxed text-slate-700">{order.notes}</p>
          ) : (
            <p className="text-sm text-muted-foreground">No notes.</p>
          )}
          {order.noteImages.length > 0 && (
            <ul className="mt-4 flex flex-wrap gap-2">
              {order.noteImages.map((img, i) => (
                <li key={img.id}>
                  <ImageThumb thumbUrl={img.thumbUrl} fullUrl={img.imageUrl} alt={`Note image ${i + 1}`} className="size-20 md:size-24" />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Dates">
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Item label="Created">{formatDateTime(order.createdAt)}</Item>
            <Item label="Sent to production">
              {order.sentToProductionAt ? formatDateTime(order.sentToProductionAt) : <span className="font-normal text-slate-400">Not yet</span>}
            </Item>
            <Item label="Last updated">{formatDateTime(order.updatedAt)}</Item>
          </dl>
        </Card>
      </div>

      <Card title="Design" className="min-w-0">
        {image && code ? (
          <div className="space-y-3">
            <ImageThumb thumbUrl={image.thumbUrl} fullUrl={image.imageUrl} alt={`Design ${code}`} className="aspect-square w-full" rounded="rounded-xl" />
            <div>
              <p className="text-xl font-bold text-slate-900">{code}</p>
              {order.design?.name && <p className="text-sm text-slate-500">{order.design.name}</p>}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-muted-foreground">
            <ImageOff className="size-6 text-slate-300" aria-hidden />
            No design attached
          </div>
        )}
      </Card>
    </div>
  );
}

function NotSentCard() {
  return (
    <div className="rounded-xl border border-border bg-white shadow-soft">
      <EmptyState icon={Send} title="Not sent for production yet" className="py-10" />
    </div>
  );
}

/** Count bubble in a tab; red for damages when > 0. */
function TabCount({ n, danger }: { n: number | undefined; danger?: boolean }) {
  if (n === undefined) return null;
  return (
    <span
      className={cn(
        'ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold leading-5',
        danger && n > 0
          ? 'bg-red-600 text-white'
          : 'bg-slate-200/80 text-slate-600 group-data-[state=active]:bg-white/25 group-data-[state=active]:text-current md:group-data-[state=active]:bg-primary-soft',
      )}
    >
      {n}
    </span>
  );
}

function PageSkeleton({ back }: { back: ReactNode }) {
  return (
    <div className="page-container space-y-4 py-5">
      {back}
      <div className="flex gap-4 rounded-xl border border-border bg-white p-4 shadow-soft md:p-5">
        <Skeleton className="size-16 shrink-0 rounded-xl md:size-[88px]" />
        <div className="flex-1 space-y-3">
          <Skeleton className="h-8 w-48" />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        </div>
      </div>
      <Skeleton className="h-11 rounded-xl" />
      <DashboardSkeleton />
    </div>
  );
}

export default function OrderDetailsPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const location = useLocation();
  const { can, config } = useRole();
  const view = useOrderView();
  const { data: order, isPending, isError, error, refetch } = useOrder(id);
  const ready = !!order && isReadyOrLater(order.status);
  // Same query as the Dashboard tab (shared cache) — feeds the Takas / Damages tab counts.
  const dashboard = useOrderDashboard(id, ready);
  const undo = useUndoProduction(id);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  usePageTitle(order ? `Order ${formatOrderNo(order.orderNo)}` : 'Order details');

  const goBack = () => {
    // Return to the list with its filters when we came from it.
    if (location.key !== 'default') navigate(-1);
    else navigate('/orders');
  };
  const back = (
    <button type="button" onClick={goBack} className="inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-primary">
      <ArrowLeft className="size-4" /> Orders
    </button>
  );

  if (isPending) return <PageSkeleton back={back} />;
  if (isError || !order) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div className="page-container py-5">
        {back}
        {notFound ? (
          <div className="py-16 text-center">
            <h2 className="text-lg font-semibold text-slate-900">Order not found</h2>
            <p className="mt-1 text-sm text-muted-foreground">It may not exist or isn't visible for your role.</p>
            <Button asChild variant="secondary" className="mt-5">
              <Link to="/orders">Back to orders</Link>
            </Button>
          </div>
        ) : (
          <ErrorState error={error} onRetry={() => void refetch()} />
        )}
      </div>
    );
  }

  // Undo is only possible while no jobsheets exist (the server enforces the same rule).
  const canUndo = can('canUndoProduction') && order.status === STATUS.READY_PRODUCTION && order.jobsheetCount === 0;
  const canTakas = can('canViewTakas');
  const counts = dashboard.data;

  // Sprint 15: the godown supervisor's Orders — Dashboard · Takas · Damages · Docs · History (no Jobsheets, no Order details).
  const godownOnly = can('canViewGodownOrders') && !can('canViewOrders');
  // Sprint 16: the Outside production tab — always for roles that can create POs; for receive-only roles once the order has one.
  const showOutside = can('canCreateOutsidePo') || (can('canReceiveOutside') && order.outsidePoCount > 0);
  const allTabs: { key: OrderTab; label: string; count?: number; danger?: boolean }[] = [
    { key: 'dashboard', label: 'Dashboard' },
    // Sprint 16: no Jobsheets tab for an order without the Production step — it never gets jobsheets.
    ...(order.hasProduction ? [{ key: 'jobsheets' as const, label: 'Jobsheets', count: ready ? order.jobsheetCount : undefined }] : []),
    ...(showOutside ? [{ key: 'outside' as const, label: 'Outside production', count: order.outsidePoCount || undefined }] : []),
    ...(canTakas
      ? [
          { key: 'takas' as const, label: 'Takas', count: counts?.takaCount },
          { key: 'damages' as const, label: 'Damages', count: counts?.damageTotal, danger: true },
        ]
      : []),
    { key: 'details', label: 'Order details' },
    { key: 'history', label: 'History' },
    ...(canTakas ? [{ key: 'docs' as const, label: 'Docs' }] : []),
  ];
  const tabs = godownOnly ? allTabs.filter((t) => t.key !== 'jobsheets' && t.key !== 'details') : allTabs;
  // Roles with `jobsheetsTabWhenPending` (Gaurang) land on Jobsheets while the order is Jobsheet pending.
  const defaultTab: OrderTab = config.jobsheetsTabWhenPending && order.status === STATUS.READY_PRODUCTION ? 'jobsheets' : 'dashboard';
  const wanted = view.tabInUrl ? view.tab : defaultTab;
  const tab = tabs.some((t) => t.key === wanted) ? wanted : 'dashboard';

  return (
    <div className="page-container space-y-4 py-5">
      {back}

      {order.isClosed && (
        <div role="status" className="flex items-start gap-3 rounded-xl border border-slate-300 bg-slate-100 px-4 py-3 text-slate-800">
          <div className="min-w-0 text-[14px] leading-snug">
            <p className="font-bold">This order is closed</p>
            <p className="text-slate-600">It is hidden from production, QC, godown and dispatch. It stays visible to you and in Dispatched for what was sent.</p>
            {order.closeNote && <p className="mt-1 font-medium">Note: {order.closeNote}</p>}
          </div>
        </div>
      )}
      {order.isOnHold && <OnHoldBanner note={order.holdNote} canRelease={can('canHoldOrder')} />}

      <OrderHeader
        order={order}
        onUndo={canUndo ? () => setConfirmUndo(true) : undefined}
        onEdit={can('canEditOrder') ? () => navigate(`/orders/${order.id}/edit`) : undefined}
        onHold={can('canHoldOrder') ? () => setHoldOpen(true) : undefined}
        onRelease={can('canHoldOrder') ? () => setReleaseOpen(true) : undefined}
        onClose={can('canCloseOrder') ? () => setCloseOpen(true) : undefined}
      />

      <Tabs value={tab} onValueChange={(v) => view.setTab(v as OrderTab)}>
        {/* Phones: a horizontally scrollable pill row (active pill in primary). md+: the segmented tab bar. */}
        <TabsList
          aria-label="Order sections"
          className="-mx-4 flex w-auto justify-start gap-2 overflow-x-auto rounded-none bg-transparent px-4 py-0.5 scrollbar-none md:mx-0 md:inline-flex md:max-w-full md:gap-1 md:rounded-xl md:bg-muted md:p-1"
        >
          {tabs.map((t) => (
            <TabsTrigger
              key={t.key}
              value={t.key}
              className={cn(
                'group inline-flex shrink-0 items-center overflow-visible rounded-full border border-border bg-white px-3.5 font-semibold text-slate-600',
                'data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground',
                'md:rounded-lg md:border-transparent md:bg-transparent md:data-[state=active]:border-transparent md:data-[state=active]:bg-white md:data-[state=active]:text-primary',
              )}
            >
              {t.label}
              <TabCount n={t.count} danger={t.danger} />
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="dashboard" className="mt-4">
          <DashboardTab order={order} view={view} />
        </TabsContent>
        <TabsContent value="jobsheets" className="mt-4">
          {ready ? <OrderJobsheetsSection order={order} /> : <NotSentCard />}
        </TabsContent>
        {showOutside && (
          <TabsContent value="outside" className="mt-4">
            {ready ? (
              <OutsideTab orderId={order.id} orderNo={order.orderNo} material={order.material} orderType={order.orderType} />
            ) : (
              <NotSentCard />
            )}
          </TabsContent>
        )}
        {canTakas && (
          <TabsContent value="takas" className="mt-4">
            {/* Sprint 16: outside / FG orders never get real jobsheets — their takas come in on receipts instead. */}
            {order.jobsheetCount > 0 || order.receiptCount > 0 ? (
              <OrderTakasCard order={order} />
            ) : !ready ? (
              <NotSentCard />
            ) : (
              <div className="rounded-xl border border-border bg-white shadow-soft">
                <EmptyState
                  icon={PackageCheck}
                  title="No takas yet"
                  description={
                    order.kind === 'fg_purchase'
                      ? 'Takas appear here once the goods are received.'
                      : order.kind === 'outside_production'
                        ? 'Takas appear here once goods are received from an outside weaver.'
                        : 'Takas appear here once jobsheets are woven and entered.'
                  }
                  className="py-10"
                />
              </div>
            )}
          </TabsContent>
        )}
        {canTakas && (
          <TabsContent value="damages" className="mt-4">
            {ready ? <DamagesTab order={order} view={view} /> : <NotSentCard />}
          </TabsContent>
        )}
        <TabsContent value="details" className="mt-4">
          <DetailsTab order={order} />
        </TabsContent>
        <TabsContent value="history" className="mt-4">
          <Card title="History" className="lg:max-w-2xl" action={<CalendarClock className="size-4 text-slate-400" aria-hidden />}>
            <HistoryTab order={order} view={view} />
          </Card>
        </TabsContent>
        {canTakas && (
          <TabsContent value="docs" className="mt-4">
            <DocsTab orderId={order.id} />
          </TabsContent>
        )}
      </Tabs>

      <HoldOrderDialog orderId={order.id} orderNo={order.orderNo} open={holdOpen} onOpenChange={setHoldOpen} />
      <ReleaseHoldDialog orderId={order.id} orderNo={order.orderNo} open={releaseOpen} onOpenChange={setReleaseOpen} />
      <CloseOrderDialog orderId={order.id} orderNo={order.orderNo} open={closeOpen} onOpenChange={setCloseOpen} />

      <ConfirmDialog
        open={confirmUndo}
        onOpenChange={setConfirmUndo}
        title={`Move order ${formatOrderNo(order.orderNo)} back to Pending for production?`}
        description="It will no longer be visible to the production team until it is sent again."
        confirmLabel="Move back"
        loading={undo.isPending}
        onConfirm={() =>
          undo.mutate(undefined, {
            onSuccess: () => toast.success(`Order ${formatOrderNo(order.orderNo)} moved back to Pending for production`),
            onSettled: () => setConfirmUndo(false),
          })
        }
      />
    </div>
  );
}
