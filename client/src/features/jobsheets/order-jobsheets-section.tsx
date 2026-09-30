import { ArrowUpFromLine, ClipboardList, CornerDownRight, FilePlus2, Hourglass, Plus, Printer, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { isReadyOrLater, JOBSHEET_STATUS, type JobsheetListItem, type OrderDetail } from '@rivoora/shared';
import { ErrorState } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { Tooltip } from '@/components/ui/tooltip';
import { useRole } from '@/hooks/useRole';
import { cn } from '@/lib/utils';
import { printUrl, useOrderJobsheets, useSendJobsheets } from './api';
import { AddJobsheetDialog, CreateJobsheetsDialog } from './jobsheet-forms';
import { FramesValue, machineNumbers, StatTile, WarningList } from './parts';

const isPendingJs = (j: JobsheetListItem) => j.status === JOBSHEET_STATUS.PENDING;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function SectionShell({ count, actions, children }: { count?: number; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-white p-4 shadow-soft md:p-5" aria-labelledby="jobsheets-title">
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-3">
        <h2 id="jobsheets-title" className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Jobsheets
          {count !== undefined && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">{count}</span>
          )}
        </h2>
        {actions && <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-[15px] font-semibold text-slate-900">{children}</dd>
    </div>
  );
}

interface CardProps {
  js: JobsheetListItem;
  selecting: boolean;
  checked: boolean;
  onClick: () => void;
  onToggle: () => void;
}

/** One jobsheet in the grid. The whole card opens the details page — or toggles it in selection mode. */
function JobsheetCard({ js, selecting, checked, onClick, onToggle }: CardProps) {
  const selectable = selecting && isPendingJs(js);
  const disabled = selecting && !selectable;
  const machineDetail =
    js.status === JOBSHEET_STATUS.ONGOING && js.runningMachine ? (
      <Detail label="Running on">Machine {js.runningMachine.machineNo}</Detail>
    ) : js.status === JOBSHEET_STATUS.COMPLETED && js.runningMachine ? (
      <Detail label="Made on">Machine {js.runningMachine.machineNo}</Detail>
    ) : (
      <Detail label="Machines">{machineNumbers(js.machines)}</Detail>
    );

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      aria-pressed={selectable ? checked : undefined}
      aria-label={selectable ? `Select jobsheet ${js.jobsheetNo}` : `Open jobsheet ${js.jobsheetNo}`}
      onClick={() => !disabled && onClick()}
      onKeyDown={(e) => {
        if (!disabled && (e.key === 'Enter' || (selecting && e.key === ' '))) {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        'flex h-full w-full gap-3 rounded-xl border border-border bg-white p-4 text-left shadow-soft outline-none transition',
        disabled
          ? 'cursor-not-allowed opacity-40'
          : 'cursor-pointer hover:border-primary/30 hover:shadow-pop focus-visible:ring-2 focus-visible:ring-primary/40 active:bg-slate-50',
        checked && 'border-primary/40 bg-primary-soft/60',
      )}
    >
      {selectable && (
        <div onClick={(e) => e.stopPropagation()} className="pt-0.5">
          <Checkbox checked={checked} onCheckedChange={onToggle} aria-label={`Select jobsheet ${js.jobsheetNo}`} />
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex w-full items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Jobsheet</p>
            <p className="text-2xl font-bold leading-tight text-slate-900">{js.jobsheetNo}</p>
          </div>
          <StatusBadge kind="jobsheet" status={js.status} className="mt-0.5 min-w-0 shrink" />
        </div>
        {js.parentJobsheetNo !== null && (
          <p className="-mt-1 flex items-center gap-1 text-xs font-medium text-slate-500">
            <CornerDownRight className="size-3.5 shrink-0" aria-hidden /> continued from {js.parentJobsheetNo}
          </p>
        )}
        <dl className="mt-auto grid w-full grid-cols-3 gap-2 border-t border-border pt-3">
          <Detail label="Frames">
            <FramesValue status={js.status} frames={js.frames} completedFrames={js.completedFrames} />
          </Detail>
          <Detail label="Picks">{js.picks ?? <span className="font-normal text-slate-400">—</span>}</Detail>
          {machineDetail}
        </dl>
      </div>
    </div>
  );
}

export function OrderJobsheetsSection({ order }: { order: OrderDetail }) {
  const navigate = useNavigate();
  const { can } = useRole();
  const isPcs = order.unit === 'pcs';
  const visible = isReadyOrLater(order.status);
  const query = useOrderJobsheets(order.id, visible && isPcs);
  const [dialog, setDialog] = useState<'create' | 'single' | null>(null);

  // Selection mode for "Send to supervisor" (same pattern as the orders list).
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const send = useSendJobsheets(order.id);
  const list = useMemo(() => query.data?.jobsheets ?? [], [query.data]);
  const pendingList = useMemo(() => list.filter(isPendingJs), [list]);

  // Drop selections that are no longer Pending (e.g. after a refetch).
  useEffect(() => {
    if (!selecting) return;
    setSelected((prev) => {
      const ids = new Set(pendingList.map((j) => j.id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [pendingList, selecting]);

  const exitSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };
  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !confirmOpen && exitSelecting();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selecting, confirmOpen]);

  // Pending orders don't have a jobsheets section at all.
  if (!visible) return null;

  if (!isPcs) {
    return (
      <SectionShell>
        <EmptyState
          icon={Hourglass}
          title="Jobsheets for kg / g / meter orders — coming soon"
          description="For now, jobsheets can be created for orders in pieces (pcs)."
          className="py-10"
        />
      </SectionShell>
    );
  }

  const canManage = can('canManageJobsheets');
  const canPrint = can('canPrintJobsheets');
  const data = query.data;
  const count = selected.size;

  const confirmSend = () => {
    send.mutate([...selected], {
      onSuccess: (res) => {
        toast.success(`${plural(res.updated, 'jobsheet')} sent to supervisor`);
        setConfirmOpen(false);
        exitSelecting();
      },
      onError: () => setConfirmOpen(false),
    });
  };

  const onCardClick = (js: JobsheetListItem) => {
    if (selecting) {
      if (isPendingJs(js)) toggle(js.id);
      return;
    }
    navigate(`/jobsheets/${js.id}`);
  };

  const printButton = canPrint ? (
    <Tooltip content={list.length ? 'Print all jobsheets' : 'No jobsheets to print'}>
      <span className="inline-flex">
        <Button
          variant="secondary"
          size="icon-sm"
          aria-label="Print all jobsheets"
          disabled={list.length === 0}
          onClick={() => navigate(printUrl(list.map((j) => j.id)))}
        >
          <Printer />
        </Button>
      </span>
    </Tooltip>
  ) : null;

  const actions = selecting ? null : canManage ? (
    <>
      <Button size="sm" className="flex-1 sm:flex-none" onClick={() => setDialog('create')} disabled={!data}>
        <Plus /> Create jobsheets
      </Button>
      <Button variant="secondary" size="sm" className="flex-1 sm:flex-none" onClick={() => setDialog('single')} disabled={!data}>
        <FilePlus2 /> Add single jobsheet
      </Button>
      <Tooltip content={pendingList.length ? 'Send to supervisor' : 'No pending jobsheets to send'}>
        <span className="inline-flex">
          <Button
            variant="secondary"
            size="icon-sm"
            aria-label="Send to supervisor"
            disabled={pendingList.length === 0}
            onClick={() => {
              // Start with every Pending jobsheet selected; the user unticks the ones to keep back.
              setSelected(new Set(pendingList.map((j) => j.id)));
              setSelecting(true);
            }}
          >
            <ArrowUpFromLine />
          </Button>
        </span>
      </Tooltip>
      {printButton}
    </>
  ) : list.length > 0 ? (
    printButton
  ) : null;

  let body;
  if (query.isPending) {
    body = (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))]">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-[68px] rounded-[10px]" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(16rem,1fr))]">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-[118px] rounded-xl" />
          ))}
        </div>
      </div>
    );
  } else if (query.isError || !data) {
    body = <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  } else {
    const c = data.coverage;
    body = (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))]">
          <StatTile label="Order quantity" value={`${c.orderedPieces} pcs`} />
          <StatTile label="Jobsheet quantity" value={`${c.jobsheetPieces} pcs`} />
          <StatTile label="Frames needed" value={c.targetFrames} />
          <StatTile label="Frames in jobsheets" value={c.totalFrames} />
          <StatTile label="Jobsheets" value={c.jobsheetCount} />
          <StatTile label="Completed" value={`${data.completedCount} of ${c.jobsheetCount}`} />
        </div>
        <WarningList messages={data.warnings.map((w) => w.message)} />

        {selecting && (
          <div className="flex items-center gap-2 rounded-xl border border-primary/20 bg-primary-soft px-4 py-2.5 text-sm text-primary" role="status">
            <ArrowUpFromLine className="size-4 shrink-0" aria-hidden />
            <span className="flex-1">All pending jobsheets are selected. Untick the ones you don't want to send to the supervisor.</span>
          </div>
        )}

        {list.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border">
            <EmptyState
              icon={ClipboardList}
              title="No jobsheets yet"
              description={canManage ? 'Create the jobsheets for this order to send them to the looms.' : undefined}
              className="py-10"
              action={
                canManage ? (
                  <Button onClick={() => setDialog('create')}>
                    <Plus /> Create jobsheets
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(16rem,1fr))]">
            {list.map((js) => (
              <li key={js.id} className="min-w-0">
                <JobsheetCard
                  js={js}
                  selecting={selecting}
                  checked={selected.has(js.id)}
                  onClick={() => onCardClick(js)}
                  onToggle={() => toggle(js.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <SectionShell count={data?.coverage.jobsheetCount} actions={actions}>
      {body}

      {/* Selection action bar: fixed above the bottom nav on phones, sticky at the bottom of the card on md+. */}
      {selecting && (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t border-border bg-white/95 px-4 py-3 shadow-pop backdrop-blur md:sticky md:inset-x-auto md:bottom-4 md:mt-4 md:rounded-xl md:border">
          <div className="flex flex-wrap items-center gap-2">
            <p className="mr-auto text-sm font-medium text-slate-700">{count} selected</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelected(new Set(pendingList.map((j) => j.id)))}
              disabled={pendingList.length === 0 || count === pendingList.length}
            >
              Select all pending
            </Button>
            <Button variant="secondary" size="sm" onClick={exitSelecting}>
              <X /> Cancel
            </Button>
            <Button size="sm" className="flex-1 sm:flex-none" disabled={count === 0} onClick={() => setConfirmOpen(true)}>
              <ArrowUpFromLine />
              <span className="sm:hidden">Send ({count})</span>
              <span className="hidden sm:inline">Send for machine production ({count})</span>
            </Button>
          </div>
        </div>
      )}

      {data && (
        <>
          <CreateJobsheetsDialog open={dialog === 'create'} onOpenChange={(o) => !o && setDialog(null)} data={data} />
          <AddJobsheetDialog open={dialog === 'single'} onOpenChange={(o) => !o && setDialog(null)} data={data} />
        </>
      )}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Send ${plural(count, 'jobsheet')} to the supervisor?`}
        description="They will appear in the supervisor's Jobsheets list, ready to start on the machines. You can pull a jobsheet back until it has been started."
        confirmLabel="Send"
        loading={send.isPending}
        onConfirm={confirmSend}
      />
    </SectionShell>
  );
}
