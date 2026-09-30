import { ArrowLeft, ArrowLeftRight, CheckCircle2, History, ImageOff, Pencil, Play, Printer, Trash2, Undo2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { JOBSHEET_STATUS, type JobsheetDetail } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ImageThumb } from '@/components/ui/image-thumb';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { Tooltip } from '@/components/ui/tooltip';
import { ROLES } from '@/config/roles';
import { useNow } from '@/hooks/useNow';
import { useRole } from '@/hooks/useRole';
import { ApiError } from '@/lib/api';
import { formatDateTime, formatElapsed, formatOrderNo } from '@/lib/format';
import { ActivityTimeline } from './activity';
import { printUrl, useDeleteJobsheet, useJobsheet, usePullBackJobsheet } from './api';
import { EditJobsheetDialog } from './edit-jobsheet-form';
import { FramesValue, machineNumbers, WarningList } from './parts';
import { JobsheetRunDialogs, type RunAction, type RunJobsheet } from './run-dialogs';

function Card({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-white p-4 shadow-soft md:p-5">
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

const Muted = ({ children }: { children: ReactNode }) => <span className="font-normal text-slate-400">{children}</span>;

function toRunJobsheet(js: JobsheetDetail): RunJobsheet {
  return {
    id: js.id,
    jobsheetNo: js.jobsheetNo,
    status: js.status,
    frames: js.frames,
    machines: js.machines,
    runningMachine: js.runningMachine,
    suggestedMachineId: js.suggestedMachineId,
    designCode: js.design?.code ?? null,
    thumbUrl: js.design?.thumbUrl ?? null,
  };
}

export default function JobsheetDetailsPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const location = useLocation();
  const { can } = useRole();
  const now = useNow();
  const { data: js, isPending, isError, error, refetch } = useJobsheet(id);
  const del = useDeleteJobsheet(js?.order?.id ?? 0);
  const pullBack = usePullBackJobsheet(js?.order?.id);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<'delete' | 'pull-back' | null>(null);
  const [run, setRun] = useState<RunAction | null>(null);
  usePageTitle(js ? `Jobsheet ${js.jobsheetNo}` : 'Jobsheet');

  // The supervisor has no order access: his jobsheets live in the Jobsheets module.
  const restricted = !can('canViewOrders');
  const fallback = restricted ? '/jobsheets' : js?.order ? `/orders/${js.order.id}` : '/orders';
  const goBack = () => {
    if (location.key !== 'default') navigate(-1);
    else navigate(fallback);
  };
  const back = (
    <button type="button" onClick={goBack} className="inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-primary">
      <ArrowLeft className="size-4" /> {restricted ? 'Jobsheets' : js?.order ? `Order ${formatOrderNo(js.order.orderNo)}` : 'Back'}
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
              <Link to={restricted ? '/jobsheets' : '/orders'}>{restricted ? 'Back to jobsheets' : 'Back to orders'}</Link>
            </Button>
          </div>
        ) : (
          <ErrorState error={error} onRetry={() => void refetch()} />
        )}
      </div>
    );
  }

  const canManage = can('canManageJobsheets');
  const canRun = can('canRunJobsheets');
  const { order, design } = js;
  const isPendingJs = js.status === JOBSHEET_STATUS.PENDING;
  const isSent = js.status === JOBSHEET_STATUS.SENT;
  const isOngoing = js.status === JOBSHEET_STATUS.ONGOING;
  const isCompleted = js.status === JOBSHEET_STATUS.COMPLETED;
  const runJs = toRunJobsheet(js);
  const jsLink = (j: { id: number; jobsheetNo: number }) => (
    <Link key={j.id} to={`/jobsheets/${j.id}`} className="text-primary hover:underline">
      {j.jobsheetNo}
    </Link>
  );

  return (
    <div className="page-container space-y-4 py-5">
      {back}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
        <h2 className="text-2xl font-bold text-slate-900">Jobsheet {js.jobsheetNo}</h2>
        <StatusBadge kind="jobsheet" status={js.status} />
        <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
          {can('canPrintJobsheets') && (
            <Tooltip content="Print jobsheet">
              <Button variant="secondary" size={restricted ? 'icon' : 'icon-sm'} aria-label="Print jobsheet" onClick={() => navigate(printUrl([js.id]))}>
                <Printer />
              </Button>
            </Tooltip>
          )}
          {canManage && isPendingJs && (
            <>
              <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                <Pencil /> Edit
              </Button>
              <Button variant="secondary" size="sm" className="text-destructive hover:bg-destructive-soft" onClick={() => setConfirm('delete')}>
                <Trash2 /> Delete
              </Button>
            </>
          )}
          {canManage && isSent && (
            <Button variant="secondary" size="sm" onClick={() => setConfirm('pull-back')}>
              <Undo2 /> Pull back from supervisor
            </Button>
          )}
          {canRun && isSent && (
            <Button size="lg" className="flex-1 sm:flex-none" onClick={() => setRun({ kind: 'start', js: runJs })}>
              <Play /> Start
            </Button>
          )}
          {canRun && isOngoing && (
            <>
              <Button size="lg" className="flex-1 sm:flex-none" onClick={() => setRun({ kind: 'complete', js: runJs })}>
                <CheckCircle2 /> Complete
              </Button>
              <Tooltip content="Change machine">
                <Button
                  variant="secondary"
                  size="lg"
                  className="w-12 shrink-0 px-0"
                  title="Change machine"
                  aria-label="Change machine"
                  onClick={() => setRun({ kind: 'change', js: runJs })}
                >
                  <ArrowLeftRight />
                </Button>
              </Tooltip>
            </>
          )}
        </div>
      </div>

      <WarningList messages={js.warnings.map((w) => w.message)} />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <Card title="Jobsheet details">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
              <Item label="Order">
                {order ? (
                  <>
                    <Link to={`/orders/${order.id}`} className="text-primary hover:underline">
                      {formatOrderNo(order.orderNo)}
                    </Link>
                    <StatusBadge status={order.status} className="ml-2 align-middle" />
                  </>
                ) : (
                  // The supervisor sees only the order number, as plain text.
                  formatOrderNo(js.orderNo)
                )}
              </Item>
              {order && (
                <>
                  <Item label="Client">
                    {order.customer.name}
                    {order.customer.city && <span className="ml-1.5 text-sm font-normal text-slate-500">· {order.customer.city}</span>}
                  </Item>
                  <Item label="Material / Quality">
                    {order.material.name}
                    {order.material.code && <span className="ml-1.5 text-sm font-normal text-slate-500">{order.material.code}</span>}
                  </Item>
                </>
              )}
              <Item label="Design">{design?.code ?? <Muted>No design</Muted>}</Item>
              <Item label="Status">
                <StatusBadge kind="jobsheet" status={js.status} />
              </Item>
              <Item label={isCompleted ? 'Frames (made / assigned)' : 'Frames'}>
                <FramesValue status={js.status} frames={js.frames} completedFrames={js.completedFrames} withUnit />
              </Item>
              <Item label="Picks">{js.picks ?? <Muted>—</Muted>}</Item>
              <Item label="Machines">
                {machineNumbers(js.machines)}
                {js.machines.some((m) => !m.isActive) && (
                  <span className="ml-1.5 text-sm font-normal text-slate-500">
                    (inactive: {js.machines.filter((m) => !m.isActive).map((m) => m.machineNo).join(', ')})
                  </span>
                )}
              </Item>
              {js.runningMachine && (
                <Item label={isOngoing ? 'Running on' : 'Made on'}>Machine {js.runningMachine.machineNo}</Item>
              )}
              {js.startedAt && (
                <Item label="Started">
                  {formatDateTime(js.startedAt)}
                  {isOngoing && <span className="block text-sm font-normal text-slate-500">{formatElapsed(js.startedAt, now)} ago</span>}
                </Item>
              )}
              {js.completedAt && <Item label="Completed">{formatDateTime(js.completedAt)}</Item>}
              {!restricted && js.sentAt && <Item label="Sent to supervisor">{formatDateTime(js.sentAt)}</Item>}
              {js.parent && <Item label="Continued from">Jobsheet {jsLink(js.parent)}</Item>}
              {js.children.length > 0 && (
                <Item label="Continued as">
                  Jobsheet{' '}
                  {js.children.map((c, i) => (
                    <span key={c.id}>
                      {i > 0 && ', '}
                      {jsLink(c)}
                    </span>
                  ))}
                </Item>
              )}
              {order && <Item label="Jobsheet quantity">{order.jobsheetPieces} pcs</Item>}
              <Item label="Created">
                {formatDateTime(js.createdAt)}
                <span className="block text-sm font-normal text-slate-500">by {ROLES[js.createdBy]?.name ?? js.createdBy}</span>
              </Item>
            </dl>
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          <Card title="Design">
            {design ? (
              <div className="space-y-3">
                <ImageThumb thumbUrl={design.thumbUrl} fullUrl={design.imageUrl} alt={`Design ${design.code}`} className="aspect-square w-full" rounded="rounded-xl" />
                <div>
                  <p className="text-xl font-bold text-slate-900">{design.code}</p>
                  {design.baseCode && <p className="text-sm text-slate-500">Variation of {design.baseCode}</p>}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-muted-foreground">
                <ImageOff className="size-6 text-slate-300" aria-hidden />
                No design attached
              </div>
            )}
          </Card>

          <Card title="Activity" action={<History className="size-4 text-slate-400" aria-hidden />}>
            <ActivityTimeline events={js.events} assignedFrames={js.frames} />
          </Card>
        </div>
      </div>

      {canManage && <EditJobsheetDialog jobsheetId={editing ? js.id : null} onOpenChange={setEditing} />}
      {canRun && <JobsheetRunDialogs action={run} onClose={() => setRun(null)} />}
      <ConfirmDialog
        open={confirm === 'delete'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Delete jobsheet ${js.jobsheetNo}?`}
        description="The other jobsheets are not adjusted, and this number is never used again. Any shortfall will show as a warning on the order."
        confirmLabel="Delete"
        destructive
        loading={del.isPending}
        onConfirm={() =>
          del.mutate(js.id, {
            onSuccess: (res) => {
              toast.success(`Jobsheet #${js.jobsheetNo} deleted`);
              if (res.orderReset && order) toast.info(`Order ${formatOrderNo(order.orderNo)} moved back to Jobsheet pending`);
              navigate(order ? `/orders/${order.id}` : '/orders', { replace: true });
            },
            onSettled: () => setConfirm(null),
          })
        }
      />
      <ConfirmDialog
        open={confirm === 'pull-back'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Pull back jobsheet ${js.jobsheetNo} from the supervisor?`}
        description="It moves back to Pending, so you can edit or delete it. The supervisor will no longer see it."
        confirmLabel="Pull back"
        loading={pullBack.isPending}
        onConfirm={() =>
          pullBack.mutate(js.id, {
            onSuccess: () => toast.success(`Jobsheet ${js.jobsheetNo} pulled back from the supervisor`),
            onSettled: () => setConfirm(null),
          })
        }
      />
    </div>
  );
}
