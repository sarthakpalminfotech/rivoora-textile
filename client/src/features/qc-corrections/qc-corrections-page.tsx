import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Search, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ROLES, takaStageStatusText, type QcCorrectionResult, type QcCorrectionTaka } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ReasonDialog } from '@/components/ui/reason-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { invalidateAfterWrite } from '../jobsheets/api';

/* Sprint 21 (C6) — QC corrections: find a taka by number, undo its last QC result or cancel its refinish. */

const key = (no: string) => ['qc-corrections', 'taka', no] as const;

function useTakaForCorrection(no: string) {
  return useQuery({
    queryKey: key(no),
    queryFn: ({ signal }) => api.get<QcCorrectionTaka>(`/qc-corrections/taka/${encodeURIComponent(no)}`, undefined, signal),
    enabled: no !== '',
    retry: false,
    staleTime: 0,
  });
}

function useCorrect(action: 'undo-qc' | 'cancel-refinish') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ takaId, reason }: { takaId: number; reason: string }) => api.post<QcCorrectionResult>(`/qc-corrections/${takaId}/${action}`, { reason }),
    onSuccess: () => {
      invalidateAfterWrite(qc);
      void qc.invalidateQueries({ queryKey: ['qc-corrections'] });
      void qc.invalidateQueries({ queryKey: ['challans'] });
    },
  });
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600">{children}</p>;
}

export default function QcCorrectionsPage() {
  usePageTitle('QC corrections');
  const [params, setParams] = useSearchParams();
  const no = (params.get('taka') ?? '').trim();
  const [text, setText] = useState(no);
  const taka = useTakaForCorrection(no);
  const [dialog, setDialog] = useState<'undo' | 'refinish' | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const undo = useCorrect('undo-qc');
  const cancel = useCorrect('cancel-refinish');
  const t = taka.data;

  const search = () => setParams(text.trim() ? { taka: text.trim() } : {}, { replace: true });
  const run = (m: typeof undo, label: string) => (reason: string) =>
    m.mutate(
      { takaId: t!.id, reason },
      {
        onSuccess: () => {
          toast.success(label);
          setDialog(null);
        },
        onError: (err) => setDialogError(errorMessage(err)),
      },
    );

  return (
    <div className="page-container max-w-5xl space-y-4 py-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">QC corrections</h1>
        <p className="text-sm text-slate-500">Undo the last Butta / Mill QC result of a taka, or cancel its refinish.</p>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
      >
        <Input value={text} onChange={(e) => setText(e.target.value)} inputMode="tel" placeholder="Taka number" aria-label="Taka number" className="h-12 flex-1 text-lg" autoFocus />
        <Button type="submit" size="lg" className="h-12" disabled={!text.trim()}>
          <Search /> Find
        </Button>
      </form>

      {no === '' ? null : taka.isPending ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : taka.isError ? (
        <p role="alert" className="rounded-xl border border-border bg-white p-6 text-center font-medium text-slate-700">
          {taka.error instanceof ApiError && taka.error.status === 404 ? `No taka with number ${no}.` : errorMessage(taka.error)}
        </p>
      ) : t ? (
        <div className="grid gap-4 md:grid-cols-2">
          {/* card */}
          <section className="space-y-4 rounded-xl border border-border bg-white p-4 shadow-soft">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-3xl font-extrabold tabular-nums text-slate-900">{t.takaNo}</p>
                <p className="text-sm text-slate-500">
                  Order #{t.orderNo}
                  {t.designCode ? ` · ${t.designCode}` : ''}
                </p>
              </div>
              <span className="rounded-full bg-primary-soft px-3 py-1 text-sm font-semibold text-primary">{takaStageStatusText(t.stage)}</span>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-slate-500">Pcs</dt>
                <dd className="font-semibold">{t.pcs ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Meters</dt>
                <dd className="font-semibold">{t.meters ?? '—'}</dd>
              </div>
            </dl>
            <div>
              <p className="mb-1 text-sm font-semibold text-slate-600">Last QC result</p>
              {t.lastQc ? (
                <p className="text-sm text-slate-700">
                  {t.lastQc.kind === 'butta' ? 'Butta QC' : 'Mill QC'} → {takaStageStatusText(t.lastQc.result)} · {formatDateTime(t.lastQc.at)} · {t.lastQc.byName ?? ROLES[t.lastQc.byRole].name}
                </p>
              ) : (
                <p className="text-sm text-slate-400">None on record.</p>
              )}
            </div>
            <div>
              <p className="mb-1 text-sm font-semibold text-slate-600">Damages</p>
              {t.damages.length === 0 ? (
                <p className="text-sm text-slate-400">No damage.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {t.damages.map((d) => (
                    <li key={d.id} className={d.status === 'open' ? 'font-semibold text-red-600' : 'text-slate-500'}>
                      {d.label} · {d.status === 'open' ? 'open' : 'resolved'}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="space-y-2 border-t border-border pt-3">
              {t.undoQc.allowed ? (
                <Button
                  variant="secondary"
                  size="lg"
                  className="w-full"
                  onClick={() => {
                    setDialogError(null);
                    setDialog('undo');
                  }}
                >
                  <Undo2 /> Undo QC result
                </Button>
              ) : (
                <Note>Undo QC result: {t.undoQc.reason}</Note>
              )}
              {t.cancelRefinish.allowed ? (
                <Button
                  variant="secondary"
                  size="lg"
                  className="w-full"
                  onClick={() => {
                    setDialogError(null);
                    setDialog('refinish');
                  }}
                >
                  <RotateCcw /> Cancel refinish
                </Button>
              ) : (
                t.stage === 'refinish' || t.stage === 'at_mill' ? <Note>Cancel refinish: {t.cancelRefinish.reason}</Note> : null
              )}
            </div>
          </section>
          {/* history */}
          <section className="rounded-xl border border-border bg-white p-4 shadow-soft">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Recent history</h2>
            <ol className="space-y-2">
              {[...t.events].reverse().map((e) => (
                <li key={e.id} className="border-l-2 border-slate-200 pl-3">
                  <p className="text-sm font-semibold text-slate-800">{e.event.replace(/_/g, ' ')}</p>
                  {e.note && <p className="text-sm text-slate-600">{e.note}</p>}
                  <p className="text-xs text-slate-400">{formatDateTime(e.createdAt)}</p>
                </li>
              ))}
            </ol>
          </section>
        </div>
      ) : null}

      <ReasonDialog
        open={dialog === 'undo'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Undo QC result"
        confirmLabel="Undo QC result"
        loading={undo.isPending}
        error={dialogError}
        onConfirm={run(undo, 'QC result undone')}
      >
        Taka {t?.takaNo} goes back to {t?.lastQc?.kind === 'mill' ? 'Mill QC' : 'Butta QC'}. Damages added in that QC are removed; damages resolved in it are reopened.
      </ReasonDialog>
      <ReasonDialog
        open={dialog === 'refinish'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Cancel refinish"
        confirmLabel="Cancel refinish"
        destructive
        loading={cancel.isPending}
        error={dialogError}
        onConfirm={run(cancel, 'Refinish cancelled')}
      >
        Taka {t?.takaNo} goes back to the godown (final takas).
      </ReasonDialog>
    </div>
  );
}
