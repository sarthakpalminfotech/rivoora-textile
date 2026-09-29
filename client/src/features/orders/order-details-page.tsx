import { ArrowLeft, CalendarClock, ImageOff, Phone, Undo2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { STATUS, type OrderDetail } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ImageThumb } from '@/components/ui/image-thumb';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { ROLES } from '@/config/roles';
import { getStatus } from '@/config/statuses';
import { useRole } from '@/hooks/useRole';
import { ApiError } from '@/lib/api';
import { formatDate, formatDateTime, formatMoney, formatOrderNo, formatQuantity } from '@/lib/format';
import { OrderJobsheetsSection } from '../jobsheets/order-jobsheets-section';
import { cn } from '@/lib/utils';
import { useOrder, useUndoProduction } from './api';

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

function History({ order }: { order: OrderDetail }) {
  const entries = [...order.history].reverse();
  return (
    <ol className="relative space-y-5 pl-6 before:absolute before:bottom-2 before:left-[7px] before:top-2 before:w-0.5 before:bg-slate-200">
      {entries.map((h, i) => {
        const to = getStatus(h.toStatus);
        const isUndo = h.fromStatus !== null && getStatus(h.fromStatus).sequence > to.sequence;
        const title = h.fromStatus === null ? 'Order created' : isUndo ? `Moved back to ${to.label}` : `Moved to ${to.label}`;
        return (
          <li key={h.id} className="relative">
            <span
              className="absolute -left-6 top-1 size-4 rounded-full border-[3px] border-white shadow"
              style={{ backgroundColor: i === 0 ? to.badge.dot : '#CBD5E1' }}
              aria-hidden
            />
            <p className="text-[15px] font-semibold text-slate-900">{title}</p>
            <p className="text-sm text-slate-500">
              {formatDateTime(h.changedAt)} · by {ROLES[h.role]?.name ?? h.role}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

export default function OrderDetailsPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const location = useLocation();
  const { can } = useRole();
  const { data: order, isPending, isError, error, refetch } = useOrder(id);
  const undo = useUndoProduction(id);
  const [confirmUndo, setConfirmUndo] = useState(false);
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

  if (isPending) {
    return (
      <div className="page-container space-y-4 py-5">
        {back}
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <Skeleton className="h-72 rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
      </div>
    );
  }
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
  const image = order.variation ?? order.design;
  const code = order.variation?.code ?? order.design?.code;

  return (
    <div className="page-container space-y-4 py-5">
      {back}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-2xl font-bold text-slate-900">Order {formatOrderNo(order.orderNo)}</h2>
        <StatusBadge status={order.status} />
        {canUndo && (
          <Button variant="secondary" size="sm" className="ml-auto" onClick={() => setConfirmUndo(true)}>
            <Undo2 /> Undo send for production
          </Button>
        )}
      </div>

      {/*
        Phone / tablet: one column ordered by priority (details → jobsheets → design → notes → dates → history).
        Desktop: two independent columns, so a long status history never pushes the jobsheets down.
        The column wrappers are `display: contents` below lg, which lets the `order-*` classes interleave the cards.
      */}
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <div className="contents lg:block lg:min-w-0 lg:space-y-4">
          <Card title="Order details" className="order-1 lg:order-none">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
              <Item label="Client">
                {order.customer.name}
                {order.customer.city && <span className="ml-1.5 text-sm font-normal text-slate-500">· {order.customer.city}</span>}
              </Item>
              <Item label="Phone">
                {order.customer.phone ? (
                  <a href={`tel:${order.customer.phone}`} className="inline-flex items-center gap-1.5 text-primary hover:underline">
                    <Phone className="size-3.5" /> {order.customer.phone}
                  </a>
                ) : (
                  '—'
                )}
              </Item>
              <Item label="Material / Quality">
                {order.material.name}
                {order.material.code && <span className="ml-1.5 text-sm font-normal text-slate-500">{order.material.code}</span>}
              </Item>
              <Item label="Quantity">{formatQuantity(order.quantity, order.unit)}</Item>
              {'rate' in order && <Item label="Rate">{formatMoney(order.rate)}</Item>}
              <Item label="Order date">{formatDate(order.orderDate)}</Item>
            </dl>
          </Card>

          <Card title="Notes" className="order-4 lg:order-none">
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

          <Card title="Dates" className="order-5 lg:order-none">
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Item label="Created">{formatDateTime(order.createdAt)}</Item>
              <Item label="Sent to production">
                {order.sentToProductionAt ? (
                  formatDateTime(order.sentToProductionAt)
                ) : (
                  <span className="font-normal text-slate-400">Not yet</span>
                )}
              </Item>
            </dl>
          </Card>

          <div className="order-2 min-w-0 empty:hidden lg:order-none">
            <OrderJobsheetsSection order={order} />
          </div>
        </div>

        <div className="contents lg:block lg:min-w-0 lg:space-y-4">
          <Card title="Design" className="order-3 lg:order-none">
            {image && code ? (
              <div className="space-y-3">
                <ImageThumb thumbUrl={image.thumbUrl} fullUrl={image.imageUrl} alt={`Design ${code}`} className="aspect-square w-full" rounded="rounded-xl" />
                <div>
                  <p className="text-xl font-bold text-slate-900">{code}</p>
                  {order.variation && order.design && (
                    <p className="text-sm text-slate-500">
                      Variation of {order.design.code}
                      {order.design.name ? ` · ${order.design.name}` : ''}
                    </p>
                  )}
                  {!order.variation && order.design?.name && <p className="text-sm text-slate-500">{order.design.name}</p>}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-muted-foreground">
                <ImageOff className="size-6 text-slate-300" aria-hidden />
                No design attached
              </div>
            )}
          </Card>

          <Card title="Status history" className="order-6 lg:order-none" action={<CalendarClock className="size-4 text-slate-400" aria-hidden />}>
            <History order={order} />
          </Card>
        </div>
      </div>

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
