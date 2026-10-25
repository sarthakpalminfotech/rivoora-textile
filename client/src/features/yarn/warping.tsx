import { CheckCircle2, Plus, Trash2, Waves } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  beamLabel,
  BEAM_INPUT_ERROR_TEXT,
  MAX_BEAMS_PER_JOB,
  MAX_WARPING_INPUTS,
  parseKgText,
  TAKE_ERROR_TEXT,
  validateBeam,
  validateWarpingInputs,
  warpingInputsSummary,
  warpingJobLabel,
  YARN_ITEM_LABEL,
  YARN_ZONE_CONFIG,
  type BeamZone,
  type WarpingJob,
  type YarnItem,
} from '@rivoora/shared';
import { ErrorState, LoadMore } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useFinishWarping, useStartWarping, useWarpingJobs, useYarnZone } from './api';
import { DialogButtons, YarnDialog } from './dialog';
import { actorText, cleanDecimal, Kg, KgInput, numOrNull, Pill, QualitySelect, Toggle2 } from './parts';
import { beamNos } from './movements';

const ACCENT = YARN_ZONE_CONFIG.warping.accent;
const ITEM_OPTIONS = [
  { value: 'raw' as const, label: 'Raw' },
  { value: 'twisted' as const, label: 'Twisted' },
];

/* ------------------------------------------------------------------ */
/* jobs list                                                            */
/* ------------------------------------------------------------------ */

function JobCard({ job, onDone }: { job: WarpingJob; onDone?: () => void }) {
  return (
    <li className="rounded-xl border border-border bg-white p-3 md:p-4">
      <div className="grid gap-3 md:grid-cols-[8rem_minmax(0,1fr)_auto] md:items-center">
        <div>
          <p className="text-lg font-extrabold tabular-nums" style={{ color: ACCENT.text }}>
            {warpingJobLabel(job.jobNo)}
          </p>
          <p className="text-xs text-slate-500">{formatDateTime(job.startedAt)}</p>
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-800">{warpingInputsSummary(job.inputs)}</p>
          <p className="truncate text-xs text-slate-500">
            {job.inputs.map((i) => `${YARN_ITEM_LABEL[i.item].split(' ')[0]} ${i.quality.name}`).join(' · ')}
            {actorText(job.startedBy) ? ` · by ${actorText(job.startedBy)}` : ''}
          </p>
          {job.note && <p className="truncate text-xs text-slate-500">{job.note}</p>}
          {job.status === 'done' && (
            <p className="mt-1 truncate text-sm text-emerald-700">
              <CheckCircle2 className="mr-1 inline size-4 align-text-bottom" aria-hidden />
              {job.beams.length} beam{job.beams.length === 1 ? '' : 's'}: {beamNos(job.beams.map((b) => b.beamNo))} · {formatDateTime(job.doneAt)}
            </p>
          )}
        </div>
        {onDone && (
          <Button onClick={onDone} className="w-full md:w-auto">
            <CheckCircle2 /> Mark done
          </Button>
        )}
      </div>
    </li>
  );
}

/** The Warping zone's jobs: In process (oldest first, Mark done) and Done. */
export function WarpingJobsSection() {
  const [tab, setTab] = useState<'in_process' | 'done'>('in_process');
  const jobs = useWarpingJobs(tab);
  const [doneFor, setDoneFor] = useState<WarpingJob | null>(null);
  return (
    <section className="rounded-2xl border border-border bg-white p-4 shadow-soft md:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 flex-1 truncate text-[15px] font-bold text-slate-800">Warping jobs</h2>
        <Pill on={tab === 'in_process'} onClick={() => setTab('in_process')}>
          In process
        </Pill>
        <Pill on={tab === 'done'} onClick={() => setTab('done')}>
          Done
        </Pill>
      </div>
      {jobs.isPending ? (
        <Skeleton className="h-24 w-full rounded-xl" />
      ) : jobs.isError ? (
        <ErrorState error={jobs.error} onRetry={() => void jobs.refetch()} />
      ) : jobs.items.length === 0 ? (
        <EmptyState icon={Waves} title={tab === 'in_process' ? 'No warping in process' : 'No finished jobs yet'} description={tab === 'in_process' ? 'Start warping to take raw / twisted yarn out of Warping stock.' : undefined} className="py-8" />
      ) : (
        <>
          <ul className="space-y-2.5">
            {jobs.items.map((j) => (
              <JobCard key={j.id} job={j} onDone={j.status === 'in_process' ? () => setDoneFor(j) : undefined} />
            ))}
          </ul>
          <LoadMore hasNextPage={!!jobs.hasNextPage} isFetchingNextPage={jobs.isFetchingNextPage} fetchNextPage={() => void jobs.fetchNextPage()} shown={jobs.items.length} total={jobs.total} noun="jobs" />
        </>
      )}
      <MarkDoneDialog job={doneFor} onOpenChange={(o) => !o && setDoneFor(null)} />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* start warping                                                        */
/* ------------------------------------------------------------------ */

interface InputRow {
  key: number;
  item: YarnItem;
  qualityId: number | null;
  kg: string;
}
let rowKey = 0;
const newInput = (item: YarnItem = 'raw'): InputRow => ({ key: ++rowKey, item, qualityId: null, kg: '' });

/**
 * Start warping (wide dialog): one row per input — Raw / Twisted · quality (Warping stock) · kg — as a real table row
 * from 768px. Rows of the same quality add up against the stock. The inputs leave Warping stock on save.
 */
export function StartWarpingDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const zone = useYarnZone('warping', open);
  const start = useStartWarping();
  const [rows, setRows] = useState<InputRow[]>(() => [newInput()]);
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const [serverErr, setServerErr] = useState<{ field: string; message: string } | null>(null);
  useEffect(() => {
    if (open) {
      setRows([newInput()]);
      setNote('');
      setTried(false);
      setServerErr(null);
    }
  }, [open]);

  const stockOf = (item: YarnItem) =>
    (zone.data?.qualities ?? []).map((q) => ({ id: q.quality.id, name: q.quality.name, availableG: item === 'raw' ? q.rawG : q.twistedG })).filter((q) => q.availableG > 0);
  const avail = (item: YarnItem, qualityId: number) => {
    const q = zone.data?.qualities.find((x) => x.quality.id === qualityId);
    return q ? (item === 'raw' ? q.rawG : q.twistedG) : 0;
  };
  const parsed = rows.map((r) => ({ item: r.item, qualityId: r.qualityId ?? 0, qtyG: parseKgText(r.kg) ?? 0 }));
  const check = validateWarpingInputs(parsed, avail);
  const rowError = (i: number): string | undefined => {
    const r = rows[i];
    if (!r.qualityId) return 'Select the quality';
    if (check && check.index === i && check.error !== 'none') return TAKE_ERROR_TEXT[check.error];
    return undefined;
  };
  const set = (key: number, patch: Partial<InputRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const totalG = parsed.reduce((s, r) => s + r.qtyG, 0);

  const submit = () => {
    setTried(true);
    setServerErr(null);
    if (rows.some((_, i) => rowError(i)) || check) return;
    start.mutate(
      { inputs: rows.map((r) => ({ item: r.item, qualityId: r.qualityId!, qtyKg: parseKgText(r.kg)! / 1000 })), note: note.trim() || null },
      {
        onSuccess: (j) => {
          toast.success(`${warpingJobLabel(j.jobNo)} started · ${warpingInputsSummary(j.inputs)}`);
          onOpenChange(false);
        },
        onError: (err) => {
          if (err instanceof ApiError && err.field) setServerErr({ field: err.field, message: err.message });
          toast.error(errorMessage(err));
        },
      },
    );
  };

  return (
    <YarnDialog
      open={open}
      onOpenChange={onOpenChange}
      layout="wide"
      title="Start warping"
      description="Raw and / or twisted yarn from Warping stock — any mix."
      busy={start.isPending}
      dirty={rows.some((r) => r.kg)}
      footer={<DialogButtons onCancel={() => onOpenChange(false)} busy={start.isPending} label="Start warping" form="warp-start-form" />}
    >
      <form
        id="warp-start-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="grid gap-5"
      >
        {zone.isPending ? (
          <Skeleton className="h-24 w-full rounded-xl" />
        ) : (
          <div>
            <div className="mb-2 flex items-center gap-2">
              <h3 className="min-w-0 flex-1 text-sm font-bold text-slate-800">Inputs</h3>
              {rows.length < MAX_WARPING_INPUTS && (
                <Button variant="secondary" size="sm" onClick={() => setRows((rs) => [...rs, newInput(rs[rs.length - 1]?.item)])}>
                  <Plus /> Add input
                </Button>
              )}
            </div>
            {serverErr?.field.startsWith('inputs') && <p className="mb-2 text-sm font-medium text-destructive">{serverErr.message}</p>}
            <div className="hidden grid-cols-[10rem_minmax(0,1fr)_10rem_2.75rem] gap-x-3 border-b border-border pb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 md:grid">
              <span>Yarn</span>
              <span>Quality *</span>
              <span className="text-right">Kg *</span>
              <span />
            </div>
            <ol className="space-y-3 md:space-y-0">
              {rows.map((r, i) => {
                const err = tried ? rowError(i) : undefined;
                return (
                  <li key={r.key} className="grid grid-cols-2 gap-3 rounded-xl border border-border p-3 md:grid-cols-[10rem_minmax(0,1fr)_10rem_2.75rem] md:items-start md:rounded-none md:border-0 md:border-b md:px-0 md:py-2.5">
                    <div className="col-span-2 md:col-span-1">
                      <Toggle2 value={r.item} onChange={(item) => set(r.key, { item, qualityId: null })} options={ITEM_OPTIONS} />
                    </div>
                    <div className="col-span-2 md:col-span-1">
                      <QualitySelect value={r.qualityId} onChange={(id) => set(r.key, { qualityId: id })} only={stockOf(r.item)} invalid={!!err && !r.qualityId} placeholder={stockOf(r.item).length ? 'Select quality' : `No ${r.item} yarn in Warping`} />
                      {err && <p className="mt-1 text-[13px] font-medium text-destructive">{err}</p>}
                    </div>
                    <KgInput value={r.kg} onValueChange={(kg) => set(r.key, { kg })} invalid={!!err && !!r.qualityId} aria-label={`Kg input ${i + 1}`} />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="justify-self-end text-slate-400 hover:bg-destructive-soft hover:text-destructive"
                      disabled={rows.length === 1}
                      onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                      aria-label={`Remove input ${i + 1}`}
                    >
                      <Trash2 />
                    </Button>
                  </li>
                );
              })}
            </ol>
            <p className="mt-3 text-right text-sm text-slate-600">
              Total <Kg g={totalG} className="font-bold text-slate-900" />
              <span className="ml-2 text-slate-400">({warpingInputsSummary(parsed)})</span>
            </p>
          </div>
        )}
        <Field label="Job note" htmlFor="warp-note">
          <Textarea id="warp-note" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} className="min-h-[64px]" />
        </Field>
      </form>
    </YarnDialog>
  );
}

/* ------------------------------------------------------------------ */
/* mark done → beams                                                    */
/* ------------------------------------------------------------------ */

interface BeamRow {
  key: number;
  taar: string;
  panna: string;
  meters: string;
  qualityId: number | null;
  qualityName?: string;
  zone: BeamZone | null;
}
const newBeam = (prev?: BeamRow): BeamRow => ({
  key: ++rowKey,
  taar: prev?.taar ?? '',
  panna: prev?.panna ?? '',
  meters: '',
  qualityId: prev?.qualityId ?? null,
  qualityName: prev?.qualityName,
  zone: prev?.zone ?? null,
});

const BEAM_ZONE_OPTIONS = [
  { value: 'direct' as const, label: 'Direct' },
  { value: 'warping' as const, label: 'Warping' },
];

/**
 * Mark done (wide dialog): one or more beams — Taar · Panna · Meters · Quality · Keep in — one table row each from
 * 768px. Each beam gets its BM number; the job becomes Done.
 */
export function MarkDoneDialog({ job, onOpenChange }: { job: WarpingJob | null; onOpenChange: (o: boolean) => void }) {
  const open = !!job;
  const finish = useFinishWarping(job?.id ?? 0);
  const [rows, setRows] = useState<BeamRow[]>(() => [newBeam()]);
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const [serverErr, setServerErr] = useState<{ field: string; message: string } | null>(null);
  const firstQuality = job?.inputs[0]?.quality;
  useEffect(() => {
    if (open) {
      setRows([{ ...newBeam(), qualityId: firstQuality?.id ?? null, qualityName: firstQuality?.name }]);
      setNote('');
      setTried(false);
      setServerErr(null);
    }
  }, [open, job?.id, firstQuality?.id, firstQuality?.name]);

  const errs = useMemo(
    () =>
      rows.map((r) =>
        validateBeam({
          taar: /^\d+$/.test(r.taar) ? Number(r.taar) : NaN,
          panna: numOrNull(r.panna) ?? 0,
          meters: numOrNull(r.meters) ?? 0,
          qualityId: r.qualityId ?? 0,
          zone: r.zone ?? '',
        }),
      ),
    [rows],
  );
  const set = (key: number, patch: Partial<BeamRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const submit = () => {
    setTried(true);
    setServerErr(null);
    if (errs.some(Boolean)) return;
    finish.mutate(
      { beams: rows.map((r) => ({ taar: Number(r.taar), panna: Number(r.panna), meters: Number(r.meters), qualityId: r.qualityId!, zone: r.zone! })), note: note.trim() || null },
      {
        onSuccess: (res) => {
          toast.success(`${job ? warpingJobLabel(job.jobNo) : 'Job'} done · ${res.beams.map((b) => beamLabel(b.beamNo)).join(', ')}`);
          onOpenChange(false);
        },
        onError: (err) => {
          if (err instanceof ApiError && err.field) setServerErr({ field: err.field, message: err.message });
          toast.error(errorMessage(err));
        },
      },
    );
  };
  const fieldErr = (i: number, f: 'taar' | 'panna' | 'meters' | 'quality' | 'zone') => tried && errs[i] === f;

  return (
    <YarnDialog
      open={open}
      onOpenChange={onOpenChange}
      layout="wide"
      title={job ? `Mark done · ${warpingJobLabel(job.jobNo)}` : 'Mark done'}
      description={job ? `Inputs: ${warpingInputsSummary(job.inputs)}. Add the beams it made.` : undefined}
      busy={finish.isPending}
      dirty={rows.some((r) => r.meters)}
      footer={<DialogButtons onCancel={() => onOpenChange(false)} busy={finish.isPending} label={`Save ${rows.length} beam${rows.length === 1 ? '' : 's'}`} form="warp-done-form" />}
    >
      <form
        id="warp-done-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="grid gap-5"
      >
        <div>
          <div className="mb-2 flex items-center gap-2">
            <h3 className="min-w-0 flex-1 text-sm font-bold text-slate-800">Beams ({rows.length})</h3>
            {rows.length < MAX_BEAMS_PER_JOB && (
              <Button variant="secondary" size="sm" onClick={() => setRows((rs) => [...rs, newBeam(rs[rs.length - 1])])}>
                <Plus /> Add beam
              </Button>
            )}
          </div>
          {serverErr?.field.startsWith('beams') && <p className="mb-2 text-sm font-medium text-destructive">{serverErr.message}</p>}
          <div className="hidden md:grid-cols-[4.75rem_4.75rem_6.25rem_minmax(0,1fr)_8.75rem_2.5rem] lg:grid-cols-[6rem_6rem_7.5rem_minmax(0,1fr)_10.5rem_2.75rem] gap-x-3 border-b border-border pb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 md:grid">
            <span className="text-right">Taar *</span>
            <span className="text-right">Panna *</span>
            <span className="text-right">Meters *</span>
            <span>Quality *</span>
            <span>Keep in *</span>
            <span />
          </div>
          <ol className="space-y-3 md:space-y-0">
            {rows.map((r, i) => (
              <li key={r.key} className="grid grid-cols-3 gap-3 rounded-xl border border-border p-3 md:grid-cols-[4.75rem_4.75rem_6.25rem_minmax(0,1fr)_8.75rem_2.5rem] lg:grid-cols-[6rem_6rem_7.5rem_minmax(0,1fr)_10.5rem_2.75rem] md:items-start md:rounded-none md:border-0 md:border-b md:px-0 md:py-2.5">
                <Field label={<span className="md:hidden">Taar</span>}>
                  <Input inputMode="numeric" autoComplete="off" value={r.taar} onChange={(e) => set(r.key, { taar: e.target.value.replace(/\D/g, '').slice(0, 7) })} invalid={fieldErr(i, 'taar')} className="text-right tabular-nums" aria-label={`Taar beam ${i + 1}`} />
                </Field>
                <Field label={<span className="md:hidden">Panna</span>}>
                  <Input inputMode="decimal" autoComplete="off" value={r.panna} onChange={(e) => set(r.key, { panna: cleanDecimal(e.target.value, 2, 5) })} invalid={fieldErr(i, 'panna')} className="text-right tabular-nums" aria-label={`Panna beam ${i + 1}`} />
                </Field>
                <Field label={<span className="md:hidden">Meters</span>}>
                  <Input inputMode="decimal" autoComplete="off" value={r.meters} onChange={(e) => set(r.key, { meters: cleanDecimal(e.target.value, 2, 7) })} invalid={fieldErr(i, 'meters')} className="text-right tabular-nums" aria-label={`Meters beam ${i + 1}`} />
                </Field>
                <div className="col-span-3 md:col-span-1">
                  <QualitySelect value={r.qualityId} selectedLabel={r.qualityName} onChange={(id, q) => set(r.key, { qualityId: id, qualityName: q?.name })} invalid={fieldErr(i, 'quality')} />
                </div>
                <div className="col-span-2 md:col-span-1">
                  <Toggle2 value={r.zone} onChange={(zone) => set(r.key, { zone })} options={BEAM_ZONE_OPTIONS} invalid={fieldErr(i, 'zone')} />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="justify-self-end text-slate-400 hover:bg-destructive-soft hover:text-destructive"
                  disabled={rows.length === 1}
                  onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                  aria-label={`Remove beam ${i + 1}`}
                >
                  <Trash2 />
                </Button>
                {tried && errs[i] && <p className={cn('col-span-3 text-[13px] font-medium text-destructive md:col-span-6')}>{BEAM_INPUT_ERROR_TEXT[errs[i]!]}</p>}
              </li>
            ))}
          </ol>
          <p className="mt-2 text-xs text-slate-500">Keep in: Direct consumption (used directly on looms) or Warping (stays here).</p>
        </div>
        <Field label="Note" htmlFor="warp-done-note">
          <Textarea id="warp-done-note" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} className="min-h-[64px]" />
        </Field>
      </form>
    </YarnDialog>
  );
}
