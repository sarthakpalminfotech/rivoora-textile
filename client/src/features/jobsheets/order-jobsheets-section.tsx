import { ClipboardList, FilePlus2, Hourglass, Plus, Printer } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { DEFAULT_JOBSHEET_STATUS, isReadyOrLater, type JobsheetListItem, type OrderDetail } from '@rivoora/shared';
import { ErrorState } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { Tooltip } from '@/components/ui/tooltip';
import { useRole } from '@/hooks/useRole';
import { printUrl, useOrderJobsheets } from './api';
import { AddJobsheetDialog, CreateJobsheetsDialog } from './jobsheet-forms';
import { machineNumbers, StatTile, WarningList } from './parts';

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

/** One jobsheet in the grid. The whole card opens the details page (print / edit live there). */
function JobsheetCard({ js, onOpen }: { js: JobsheetListItem; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex h-full w-full flex-col gap-3 rounded-xl border border-border bg-white p-4 text-left shadow-soft transition hover:border-primary/30 hover:shadow-pop focus-visible:border-primary/40 active:bg-slate-50"
      aria-label={`Open jobsheet ${js.jobsheetNo}`}
    >
      <div className="flex w-full items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Jobsheet</p>
          <p className="text-2xl font-bold leading-tight text-slate-900">{js.jobsheetNo}</p>
        </div>
        {/* Per-jobsheet status — only "Pending" for now; space is reserved for later statuses. */}
        <StatusBadge kind="jobsheet" status={DEFAULT_JOBSHEET_STATUS} className="mt-0.5 shrink-0" />
      </div>
      <dl className="grid w-full grid-cols-3 gap-2 border-t border-border pt-3">
        <Detail label="Frames">{js.frames}</Detail>
        <Detail label="Picks">{js.picks ?? <span className="font-normal text-slate-400">—</span>}</Detail>
        <Detail label="Machines">{machineNumbers(js.machines)}</Detail>
      </dl>
    </button>
  );
}

export function OrderJobsheetsSection({ order }: { order: OrderDetail }) {
  const navigate = useNavigate();
  const { can } = useRole();
  const isPcs = order.unit === 'pcs';
  const visible = isReadyOrLater(order.status);
  const query = useOrderJobsheets(order.id, visible && isPcs);
  const [dialog, setDialog] = useState<'create' | 'single' | null>(null);

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
  const data = query.data;
  const list = data?.jobsheets ?? [];
  const open = (js: JobsheetListItem) => navigate(`/jobsheets/${js.id}`);

  const actions = canManage ? (
    <>
      <Button size="sm" className="flex-1 sm:flex-none" onClick={() => setDialog('create')} disabled={!data}>
        <Plus /> Create jobsheets
      </Button>
      <Button variant="secondary" size="sm" className="flex-1 sm:flex-none" onClick={() => setDialog('single')} disabled={!data}>
        <FilePlus2 /> Add single jobsheet
      </Button>
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
    </>
  ) : list.length > 0 ? (
    <Tooltip content="Print all jobsheets">
      <Button variant="secondary" size="icon-sm" aria-label="Print all jobsheets" onClick={() => navigate(printUrl(list.map((j) => j.id)))}>
        <Printer />
      </Button>
    </Tooltip>
  ) : null;

  let body;
  if (query.isPending) {
    body = (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 2xl:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-[68px] rounded-[10px]" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
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
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 2xl:grid-cols-5">
          <StatTile label="Order quantity" value={`${c.orderedPieces} pcs`} />
          <StatTile label="Jobsheet quantity" value={`${c.jobsheetPieces} pcs`} />
          <StatTile label="Frames needed" value={c.targetFrames} />
          <StatTile label="Frames in jobsheets" value={c.totalFrames} />
          <StatTile label="Jobsheets" value={c.jobsheetCount} className="col-span-2 sm:col-span-1" />
        </div>
        <WarningList messages={data.warnings.map((w) => w.message)} />

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
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
            {list.map((js) => (
              <li key={js.id} className="min-w-0">
                <JobsheetCard js={js} onOpen={() => open(js)} />
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
      {data && (
        <>
          <CreateJobsheetsDialog open={dialog === 'create'} onOpenChange={(o) => !o && setDialog(null)} data={data} />
          <AddJobsheetDialog open={dialog === 'single'} onOpenChange={(o) => !o && setDialog(null)} data={data} />
        </>
      )}
    </SectionShell>
  );
}
