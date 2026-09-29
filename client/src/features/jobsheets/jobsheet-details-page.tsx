import { ArrowLeft, ImageOff, Pencil, Printer, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { DEFAULT_JOBSHEET_STATUS } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ImageThumb } from '@/components/ui/image-thumb';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { Tooltip } from '@/components/ui/tooltip';
import { ROLES } from '@/config/roles';
import { useRole } from '@/hooks/useRole';
import { ApiError } from '@/lib/api';
import { formatDateTime, formatOrderNo } from '@/lib/format';
import { printUrl, useDeleteJobsheet, useJobsheet } from './api';
import { EditJobsheetDialog } from './edit-jobsheet-form';
import { machineNumbers, WarningList } from './parts';

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-white p-4 shadow-soft md:p-5">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
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

export default function JobsheetDetailsPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const location = useLocation();
  const { can } = useRole();
  const { data: js, isPending, isError, error, refetch } = useJobsheet(id);
  const del = useDeleteJobsheet(js?.order.id ?? 0);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  usePageTitle(js ? `Jobsheet ${js.jobsheetNo}` : 'Jobsheet');

  const goBack = () => {
    if (location.key !== 'default') navigate(-1);
    else navigate(js ? `/orders/${js.order.id}` : '/orders');
  };
  const back = (
    <button type="button" onClick={goBack} className="inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-primary">
      <ArrowLeft className="size-4" /> {js ? `Order ${formatOrderNo(js.order.orderNo)}` : 'Back'}
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
  if (isError || !js) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div className="page-container py-5">
        {back}
        {notFound ? (
          <div className="py-16 text-center">
            <h2 className="text-lg font-semibold text-slate-900">Jobsheet not found</h2>
            <p className="mt-1 text-sm text-muted-foreground">It may have been deleted or isn't visible for your role.</p>
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

  const canManage = can('canManageJobsheets');
  const { order } = js;
  const image = order.variation ?? order.design;
  const code = order.variation?.code ?? order.design?.code;
  const orderPath = `/orders/${order.id}`;

  return (
    <div className="page-container space-y-4 py-5">
      {back}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
        <h2 className="text-2xl font-bold text-slate-900">Jobsheet {js.jobsheetNo}</h2>
        <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
          <Tooltip content="Print jobsheet">
            <Button variant="secondary" size="icon-sm" aria-label="Print jobsheet" onClick={() => navigate(printUrl([js.id]))}>
              <Printer />
            </Button>
          </Tooltip>
          {canManage && (
            <>
              <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                <Pencil /> Edit
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="text-destructive hover:bg-destructive-soft"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 /> Delete
              </Button>
            </>
          )}
        </div>
      </div>

      <WarningList messages={js.warnings.map((w) => w.message)} />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card title="Jobsheet details">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            <Item label="Order">
              <Link to={orderPath} className="text-primary hover:underline">
                {formatOrderNo(order.orderNo)}
              </Link>
              <StatusBadge status={order.status} className="ml-2 align-middle" />
            </Item>
            <Item label="Client">
              {order.customer.name}
              {order.customer.city && <span className="ml-1.5 text-sm font-normal text-slate-500">· {order.customer.city}</span>}
            </Item>
            <Item label="Material / Quality">
              {order.material.name}
              {order.material.code && <span className="ml-1.5 text-sm font-normal text-slate-500">{order.material.code}</span>}
            </Item>
            <Item label="Design">{code ?? <span className="font-normal text-slate-400">No design</span>}</Item>
            <Item label="Status">
              <StatusBadge kind="jobsheet" status={DEFAULT_JOBSHEET_STATUS} />
            </Item>
            <Item label="Frames">{js.frames}</Item>
            <Item label="Picks">{js.picks ?? <span className="font-normal text-slate-400">—</span>}</Item>
            <Item label="Machines">
              {machineNumbers(js.machines)}
              {js.machines.some((m) => !m.isActive) && (
                <span className="ml-1.5 text-sm font-normal text-slate-500">
                  (inactive: {js.machines.filter((m) => !m.isActive).map((m) => m.machineNo).join(', ')})
                </span>
              )}
            </Item>
            <Item label="Jobsheet quantity">{order.jobsheetPieces} pcs</Item>
            <Item label="Created">
              {formatDateTime(js.createdAt)}
              <span className="block text-sm font-normal text-slate-500">by {ROLES[js.createdBy]?.name ?? js.createdBy}</span>
            </Item>
            <Item label="Last updated">{formatDateTime(js.updatedAt)}</Item>
          </dl>
        </Card>

        <Card title="Design">
          {image && code ? (
            <div className="space-y-3">
              <ImageThumb thumbUrl={image.thumbUrl} fullUrl={image.imageUrl} alt={`Design ${code}`} className="aspect-square w-full" rounded="rounded-xl" />
              <div>
                <p className="text-xl font-bold text-slate-900">{code}</p>
                {order.variation && order.design && <p className="text-sm text-slate-500">Variation of {order.design.code}</p>}
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

      <EditJobsheetDialog jobsheetId={editing ? js.id : null} onOpenChange={setEditing} />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete jobsheet ${js.jobsheetNo}?`}
        description="The other jobsheets are not adjusted, and this number is never used again. Any shortfall will show as a warning on the order."
        confirmLabel="Delete"
        destructive
        loading={del.isPending}
        onConfirm={() =>
          del.mutate(js.id, {
            onSuccess: (res) => {
              toast.success(`Jobsheet #${js.jobsheetNo} deleted`);
              if (res.orderReset) toast.info(`Order ${formatOrderNo(order.orderNo)} moved back to Ready for production`);
              navigate(orderPath, { replace: true });
            },
            onSettled: () => setConfirmDelete(false),
          })
        }
      />
    </div>
  );
}
