import { AlertTriangle, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  CHALLAN_KIND_CONFIG,
  challanLabel,
  damageLabelOf,
  damageResolveSummary,
  damageResolvedText,
  formatMeters,
  formatPcs,
  jobsheetRefShort,
  ROLES,
  takaStageLabel,
  type TakaEventKind,
} from '@rivoora/shared';
import { ErrorState } from '@/components/list-parts';
import { Modal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { useRole } from '@/hooks/useRole';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { challanDetailsPath, kindPermission } from '../challans/kind';
import { useTakaDetail } from './api';
import { DamageGallery } from './damage-gallery';
import { FreshTag, StageDot } from './taka-chip';

const EVENT_LABEL: Record<TakaEventKind, string> = {
  entered: 'Entered',
  sent_butta: 'Sent to butta cutting',
  received_butta: 'Received from butta cutting',
  sent_mill: 'Sent to mill',
  received_mill: 'Received from mill',
  receive_undone: 'Receive undone',
  butta_qc_done: 'Butta QC done',
  damage_added: 'Damage added',
  damage_partly_resolved: 'Damage partly resolved',
  damage_resolved: 'Damage resolved',
  damage_kept: 'Damage kept (not resolved)',
  edited: 'Edited',
  challan_cancelled: 'Challan cancelled',
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-[15px] font-semibold text-slate-900">{children}</dd>
    </div>
  );
}

function Body({ takaId }: { takaId: number }) {
  const { can } = useRole();
  const query = useTakaDetail(takaId);
  if (query.isPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
      </div>
    );
  }
  if (query.isError || !query.data) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const t = query.data;
  const open = t.damages.filter((d) => d.status === 'open');
  const resolved = t.damages.filter((d) => d.status === 'resolved');
  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Row label="Order / Jobsheet">
          <Link to={`/jobsheets/${t.jobsheetId}`} className="text-primary hover:underline">
            {jobsheetRefShort(t.orderNo, t.jobsheetNo)}
          </Link>
        </Row>
        <Row label="Quality">{t.quality ?? '—'}</Row>
        <Row label="Meters">{t.meters != null ? formatMeters(t.meters) : '—'}</Row>
        <Row label="Pcs">{t.pcs != null ? formatPcs(t.pcs) : '—'}</Row>
        <Row label="Stage">
          <span className="inline-flex items-center gap-1.5">
            <StageDot stage={t.stage} />
            {takaStageLabel(t.stage)}
          </span>
        </Row>
        {t.challans.length === 0 && <Row label="Challan">—</Row>}
        {t.challans.map((c) => (
          <Row key={c.id} label={`${CHALLAN_KIND_CONFIG[c.kind].label} challan`}>
            {can(kindPermission(c.kind)) ? (
              <Link to={challanDetailsPath(c.kind, c.id)} className="inline-flex items-center gap-1 text-primary hover:underline">
                {challanLabel(c.challanNo, c.kind)} <ExternalLink className="size-3.5" aria-hidden />
              </Link>
            ) : (
              challanLabel(c.challanNo, c.kind)
            )}
            <span className="block text-[13px] font-medium text-slate-500">
              {c.receivedAt ? `Received ${formatDateTime(c.receivedAt)}` : 'Not received yet'}
              {c.kind === 'butta' && c.receivedAt ? ` · QC ${c.qcDone ? 'done' : 'pending'}` : ''}
            </span>
          </Row>
        ))}
      </dl>

      <section>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
          Damages
          {resolved.length > 0 && open.length === 0 && <FreshTag />}
        </h3>
        {t.damages.length === 0 ? (
          <p className="text-sm text-muted-foreground">No damage</p>
        ) : (
          <ul className="space-y-1.5">
            {t.damages.map((d) => {
              const r = damageResolvedText(d);
              return (
                <li
                  key={d.id}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-sm font-semibold',
                    r ? 'border-slate-200 bg-slate-50 text-slate-400' : 'border-red-200 bg-red-50 text-red-700',
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    {!r && <AlertTriangle className="size-4 shrink-0" aria-hidden />}
                    <span className={cn(r && 'line-through')}>{damageLabelOf(d)}</span>
                  </span>
                  {!r && damageResolveSummary(d) && <span className="block text-xs font-semibold text-amber-700">{damageResolveSummary(d)}</span>}
                  {!!d.images?.length && (
                    <div className="mt-2">
                      <DamageGallery images={d.images} alt={damageLabelOf(d)} />
                    </div>
                  )}
                  {r && (
                    <span className="block text-xs font-medium">
                      {r}
                      {d.resolvedAt && ` · ${formatDateTime(d.resolvedAt)}`}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-700">History</h3>
        {t.events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No history yet</p>
        ) : (
          <ol className="space-y-3 border-l-2 border-slate-200 pl-4">
            {t.events.map((e) => (
              <li key={e.id} className="relative">
                <span className="absolute -left-[1.45rem] top-1.5 size-2.5 rounded-full bg-primary ring-2 ring-white" aria-hidden />
                <p className="text-sm font-semibold text-slate-800">
                  {EVENT_LABEL[e.event] ?? e.event}
                  {e.challanNo != null && <span className="ml-1.5 font-medium text-amber-700">{challanLabel(e.challanNo, e.challanKind ?? 'butta')}</span>}
                </p>
                {e.note && <p className="text-[13px] text-slate-600">{e.note}</p>}
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(e.createdAt)} · {ROLES[e.role]?.name ?? e.role}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

/** Taka details: number, meters, pcs, stage, challan, damages (open / resolved) and the taka history. */
export function TakaDrawer({ takaId, takaNo, onClose }: { takaId: number | null; takaNo?: string; onClose: () => void }) {
  return (
    <Modal open={takaId !== null} onOpenChange={(o) => !o && onClose()} variant="right" title={takaNo ? `Taka ${takaNo}` : 'Taka'}>
      {takaId !== null && <Body takaId={takaId} />}
    </Modal>
  );
}
