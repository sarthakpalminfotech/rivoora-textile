import { AlertTriangle, ArrowLeft, CheckCircle2, ExternalLink, Pencil, SearchX } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  CHALLAN_KIND_CONFIG,
  challanLabel,
  DAMAGE_RECORDED_AT_LABEL,
  DAMAGE_TYPE_LABEL,
  damageLabelOf,
  damageOpenPcs,
  damageShareMessage,
  formatMeters,
  formatPcs,
  ROLES,
  takaStageLabel,
  type TakaDamageFull,
  type TakaDamagesDetail,
  type TakaEvent,
} from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ImageThumb } from '@/components/ui/image-thumb';
import { JobsheetRef } from '@/components/ui/jobsheet-ref';
import { Skeleton } from '@/components/ui/skeleton';
import { useRole } from '@/hooks/useRole';
import { ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { challanDetailsPath, kindPermission } from '../challans/kind';
import { useOrderTakas, useTakaDamages } from './api';
import { DamageGallery } from './damage-gallery';
import { EditTakasDialog, type EditTakasTarget } from './edit-takas-dialog';
import { FreshTag, StageDot } from './taka-chip';
import { toTarget } from './takas-card';

/** What each damage event reads like on the timeline. */
const DAMAGE_EVENT_TEXT: Partial<Record<TakaEvent['event'], string>> = {
  damage_added: 'Added',
  damage_kept: 'Kept (not resolved)',
  damage_partly_resolved: 'Partly resolved',
  damage_resolved: 'Resolved',
  edited: 'Edited',
};

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'red' | 'green' | 'amber' }) {
  return (
    <div className="min-w-0 rounded-lg bg-white/70 px-3 py-2">
      <dt className="text-[12px] text-muted-foreground">{label}</dt>
      <dd className={cn('text-xl font-bold tabular-nums', tone === 'red' ? 'text-red-700' : tone === 'green' ? 'text-green-700' : tone === 'amber' ? 'text-amber-700' : 'text-slate-900')}>
        {value}
      </dd>
    </div>
  );
}

function Timeline({ events }: { events: TakaEvent[] }) {
  return (
    <ol className="space-y-3 border-l-2 border-slate-200 pl-4">
      {events.map((e) => (
        <li key={e.id} className="relative">
          <span className="absolute -left-[1.45rem] top-1.5 size-2.5 rounded-full bg-primary ring-2 ring-white" aria-hidden />
          <p className="text-sm font-semibold text-slate-800">{DAMAGE_EVENT_TEXT[e.event] ?? e.event}</p>
          {e.note && <p className="text-[13px] text-slate-600">{e.note}</p>}
          <p className="text-xs text-muted-foreground">
            {formatDateTime(e.createdAt)} · {ROLES[e.role]?.name ?? e.role}
          </p>
        </li>
      ))}
    </ol>
  );
}

function DamageSection({ d, taka }: { d: TakaDamageFull; taka: { takaNo: string; orderNo: number; jobsheetNo: number } }) {
  const resolved = d.status === 'resolved';
  const open = damageOpenPcs(d);
  const name = d.damageName ?? 'Damage (no name)';
  return (
    <section
      className={cn('rounded-2xl border p-4 shadow-soft md:p-5', resolved ? 'border-slate-200 bg-slate-50/60' : 'border-red-200 bg-red-50/40')}
      aria-label={name}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className={cn('flex items-center gap-2 text-xl font-bold', resolved ? 'text-slate-500' : 'text-red-700')}>
            {resolved ? <CheckCircle2 className="size-5 shrink-0 text-green-600" aria-hidden /> : <AlertTriangle className="size-5 shrink-0" aria-hidden />}
            {name}
          </h2>
          <p className="mt-0.5 text-sm font-medium text-slate-600">
            {DAMAGE_TYPE_LABEL[d.foundAt]}
            {d.recordedAt && <span className="text-slate-400"> · recorded at {DAMAGE_RECORDED_AT_LABEL[d.recordedAt]}</span>}
          </p>
        </div>
        <span
          className={cn(
            'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold',
            resolved ? 'bg-green-100 text-green-800' : d.resolvedPcs > 0 ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-700',
          )}
        >
          {resolved ? 'Resolved' : d.resolvedPcs > 0 ? 'Partly resolved' : 'Open'}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2">
        <Stat label="Damaged" value={d.pcs != null ? formatPcs(d.pcs) : '—'} />
        <Stat label="Resolved" value={d.pcs != null ? formatPcs(resolved ? d.pcs : d.resolvedPcs) : '—'} tone={d.resolvedPcs > 0 || resolved ? 'green' : undefined} />
        <Stat label="Still open" value={open != null ? formatPcs(open) : '—'} tone={open ? 'red' : undefined} />
      </dl>

      <p className="mt-3 text-sm text-slate-600">
        Added by <b className="font-semibold text-slate-800">{ROLES[d.createdBy]?.name ?? d.createdBy}</b> on {formatDateTime(d.createdAt)}
        {resolved && d.resolvedAt && (
          <>
            {' '}
            · resolved {formatDateTime(d.resolvedAt)}
            {d.resolvedBy ? ` by ${ROLES[d.resolvedBy]?.name ?? d.resolvedBy}` : ''}
          </>
        )}
      </p>

      {d.images.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-700">Photos</h3>
          <DamageGallery
            images={d.images}
            alt={`${name} photo`}
            thumbClassName="size-20"
            shareText={damageShareMessage({ damage: damageLabelOf(d), takaNo: taka.takaNo, orderNo: taka.orderNo, jobsheetNo: taka.jobsheetNo })}
          />
        </div>
      )}

      <div className="mt-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-700">Timeline</h3>
        <Timeline events={d.events} />
      </div>
    </section>
  );
}

function Header({ data, onEdit, canEdit }: { data: TakaDamagesDetail; onEdit: () => void; canEdit: boolean }) {
  const { can } = useRole();
  const t = data.taka;
  return (
    <section className="rounded-2xl border border-border bg-white p-4 shadow-soft md:p-5">
      <div className="flex items-start gap-4">
        <ImageThumb
          thumbUrl={t.design.thumbUrl}
          fullUrl={t.design.imageUrl}
          alt={t.design.code ? `Design ${t.design.code}` : 'No design'}
          className="size-20 shrink-0 md:size-24"
          rounded="rounded-xl"
        />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold uppercase tracking-wide text-slate-400">Taka</p>
          <h1 className="break-all text-4xl font-extrabold leading-none tracking-tight text-slate-900 md:text-5xl">{t.takaNo}</h1>
          <p className="mt-2 text-base font-bold text-primary">
            {can('canViewOrders') || can('canViewProductionOrders') ? (
              <Link to={`/jobsheets/${t.jobsheetId}`} className="hover:underline">
                <JobsheetRef orderNo={t.orderNo} jobsheetNo={t.jobsheetNo} variant="short" bracketClassName="text-[0.7em] font-bold" />
              </Link>
            ) : (
              <JobsheetRef orderNo={t.orderNo} jobsheetNo={t.jobsheetNo} variant="short" bracketClassName="text-[0.7em] font-bold" />
            )}
          </p>
        </div>
        <div className="shrink-0">{t.isDamaged ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-1 text-xs font-bold text-red-700">
            <AlertTriangle className="size-3.5" aria-hidden /> Damaged
          </span>
        ) : (
          <FreshTag />
        )}</div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-4 sm:grid-cols-4">
        <div>
          <dt className="text-[13px] text-muted-foreground">Design</dt>
          <dd className="text-[15px] font-semibold text-slate-900">{t.design.code ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-[13px] text-muted-foreground">Quality</dt>
          <dd className="text-[15px] font-semibold text-slate-900">{t.quality ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-[13px] text-muted-foreground">Meters</dt>
          <dd className="text-[15px] font-semibold tabular-nums text-slate-900">{t.meters != null ? formatMeters(t.meters) : '—'}</dd>
        </div>
        <div>
          <dt className="text-[13px] text-muted-foreground">Pcs</dt>
          <dd className="text-[15px] font-semibold tabular-nums text-slate-900">{t.pcs != null ? formatPcs(t.pcs) : '—'}</dd>
        </div>
        <div>
          <dt className="text-[13px] text-muted-foreground">Stage</dt>
          <dd className="flex items-center gap-1.5 text-[15px] font-semibold text-slate-900">
            <StageDot stage={t.stage} />
            {takaStageLabel(t.stage)}
          </dd>
        </div>
        <div className="col-span-1 sm:col-span-3">
          <dt className="text-[13px] text-muted-foreground">Challans</dt>
          <dd className="flex flex-wrap gap-x-4 gap-y-1 text-[15px] font-semibold">
            {t.challans.length === 0 && '—'}
            {t.challans.map((c) =>
              can(kindPermission(c.kind)) ? (
                <Link key={c.id} to={challanDetailsPath(c.kind, c.id)} className="inline-flex items-center gap-1 text-primary hover:underline">
                  {challanLabel(c.challanNo, c.kind)} <span className="font-medium text-slate-400">· {CHALLAN_KIND_CONFIG[c.kind].label}</span>
                  <ExternalLink className="size-3.5" aria-hidden />
                </Link>
              ) : (
                <span key={c.id}>{challanLabel(c.challanNo, c.kind)}</span>
              ),
            )}
          </dd>
        </div>
      </dl>
      {canEdit && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onEdit}>
          <Pencil /> Edit takas
        </Button>
      )}
    </section>
  );
}

/** `/orders/:orderId/takas/:takaId/damages` — every damage of one taka: pcs, who / when, photos and a timeline. */
export default function DamageDetailsPage() {
  const params = useParams();
  const orderId = Number(params.orderId);
  const takaId = Number(params.takaId);
  const navigate = useNavigate();
  const location = useLocation();
  const { can } = useRole();
  const query = useTakaDamages(takaId);
  usePageTitle(query.data ? `Taka ${query.data.taka.takaNo} damages` : 'Damages');
  const canEdit = can('canEditTakas');
  const takas = useOrderTakas(orderId, canEdit);
  const [editing, setEditing] = useState<EditTakasTarget | null>(null);
  const backTo =
    (location.state as { from?: string } | null)?.from ?? (can('canViewOrders') || can('canViewProductionOrders') ? `/orders/${orderId}?tab=damages` : `/godown/orders/${orderId}?tab=damage`);

  const edit = () => {
    const g = takas.data?.groups.find((x) => x.jobsheetId === query.data?.taka.jobsheetId);
    if (g) setEditing(toTarget(g));
  };

  return (
    <div className="page-container max-w-4xl space-y-4 pb-10 pt-3 md:pt-5">
      <button type="button" onClick={() => navigate(backTo)} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-primary">
        <ArrowLeft className="size-4" /> Damages
      </button>
      {query.isPending ? (
        <div className="space-y-4">
          <Skeleton className="h-44 rounded-2xl" />
          <Skeleton className="h-56 rounded-2xl" />
        </div>
      ) : query.isError || !query.data ? (
        <div className="rounded-xl border border-border bg-white shadow-soft">
          {query.error instanceof ApiError && query.error.status === 404 ? (
            <EmptyState icon={SearchX} title="Taka not found" />
          ) : (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          )}
        </div>
      ) : (
        <>
          <Header data={query.data} onEdit={edit} canEdit={canEdit && !!takas.data} />
          {query.data.damages.length === 0 ? (
            <div className="rounded-xl border border-border bg-white shadow-soft">
              <EmptyState icon={CheckCircle2} title="No damage on this taka" className="py-10" />
            </div>
          ) : (
            query.data.damages.map((d) => <DamageSection key={d.id} d={d} taka={query.data.taka} />)
          )}
        </>
      )}
      {canEdit && <EditTakasDialog target={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
