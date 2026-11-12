import { Ban, CheckCircle2, Pencil, Play, Plus, Trash2, Waves } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  availableText,
  boxNoWithFy,
  BEAM_REMARK_MAX_LENGTH,
  BEAM_INPUT_ERROR_TEXT,
  checkTake,
  formatKg,
  MAX_BEAMS_PER_JOB,
  MAX_WARPING_INPUTS,
  NO_LOT_LABEL,
  parseKgText,
  prefillBeamQuality,
  TAKE_ERROR_TEXT,
  tfoProgramLabel,
  validateBeam,
  validateWarpingJob,
  WARPING_INPUT_KIND_LABEL,
  WARPING_JOB_ERROR_TEXT,
  warpingFormulaText,
  warpingInputsSummary,
  warpingJobLabel,
  warpingLeftover,
  YARN_ZONE_CONFIG,
  type WarpingInputInput,
  type WarpingInputKind,
  type WarpingJob,
  type WarpingJobInput,
  type WarpingPendingJob, kgText, gramsToKg,
} from '@rivoora/shared';
import { ErrorState, LoadMore } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  useBoxStock,
  useCancelPendingJob,
  useCreatePendingJob,
  useFinishWarping,
  useNoBoxStock,
  usePendingJobs,
  useStartPendingJob,
  useUpdatePendingJob,
  useWarpingJobs,
  useYarnZone,
} from './api';
import { DialogButtons, YarnDialog } from './dialog';
import { actorText, cleanDecimal, Kg, KgInput, LotSelect, numOrNull, QualitySelect, Toggle2, WarpingQualitySelect } from './parts';

/**
 * Sprint 20 — Warping: Pending → In process → Done (no machines).
 * - New job (owners): inputs from Warping stock — raw (quality + lot), a TFO box (whole or part) or "No box" twisted
 *   yarn — reserved while pending; taar, panna and meters OR Full meter.
 * - Start → In process (the inputs leave stock); Mark done → beams (typed beam no., warping quality, taar, panna,
 *   meters, Direct / Warping).
 */

const ACCENT = YARN_ZONE_CONFIG.warping.accent;
const KIND_OPTIONS = (['raw', 'box', 'no_box'] as const).map((k) => ({ value: k, label: WARPING_INPUT_KIND_LABEL[k] }));

/** "Raw 75D · lot 12 · 40 kg" / "Box B-7 (WQ 1) · 38.5 kg" */
export function inputText(i: WarpingJobInput): string {
  if (i.kind === 'box') return `Box ${i.box?.boxNo ?? '—'} · ${i.quality.name} · ${formatKg(i.qtyG)}`;
  if (i.kind === 'raw') return `Raw ${i.quality.name} · ${i.lot ? `lot ${i.lot.lotNo}` : NO_LOT_LABEL} · ${formatKg(i.qtyG)}`;
  return `Twisted ${i.quality.name} (no box) · ${formatKg(i.qtyG)}`;
}

const sizeText = (j: { taar: number | null; panna: number | null; meters: number | null; fullMeter: boolean }) =>
  j.taar === null ? null : `Taar ${j.taar} · Panna ${j.panna} · ${j.fullMeter ? 'Full meter' : `${(j.meters ?? 0).toLocaleString('en-IN')} m`}`;

/* ------------------------------------------------------------------ */
/* lists                                                                */
/* ------------------------------------------------------------------ */

function JobCard({ job, onDone }: { job: WarpingJob; onDone?: () => void }) {
  return (
    <li className="rounded-xl border border-border bg-white p-3 md:p-4">
      <div className="grid gap-3 md:grid-cols-[7rem_minmax(0,1fr)_auto] md:items-center">
        <div>
          <p className="text-lg font-extrabold tabular-nums" style={{ color: ACCENT.text }}>
            {warpingJobLabel(job.jobNo)}
          </p>
          <p className="text-xs text-slate-500">{formatDateTime(job.startedAt)}</p>
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-800">
            {warpingInputsSummary(job.inputs)}
            {sizeText(job) ? <span className="font-normal text-slate-500"> · {sizeText(job)}</span> : null}
          </p>
          <p className="line-clamp-2 text-xs text-slate-500">
            {job.inputs.map(inputText).join(' · ')}
            {actorText(job.startedBy) ? ` · started by ${actorText(job.startedBy)}` : ''}
          </p>
          {job.note && <p className="truncate text-xs text-slate-500">{job.note}</p>}
          {job.status === 'done' && (
            <p className="mt-1 truncate text-sm text-emerald-700">
              <CheckCircle2 className="mr-1 inline size-4 align-text-bottom" aria-hidden />
              {job.beams.length} beam{job.beams.length === 1 ? '' : 's'}: {job.beams.map((b) => b.beamCode).join(', ')} · {formatDateTime(job.doneAt)}
            </p>
          )}
          {job.status === 'done' && job.usedG !== null && (
            <p className="truncate text-xs text-slate-600">
              Denier {job.denier} · used <Kg g={job.usedG} /> of <Kg g={job.totalG} />
              {job.leftover.length ? ` · ${job.leftover.map((l) => `${l.label}: ${formatKg(l.g)}`).join(' · ')}` : job.usedG > job.totalG ? ' · used more than issued' : ''}
            </p>
          )}
          {job.status === 'in_process' && job.denier !== null && <p className="truncate text-xs text-slate-500">Denier {job.denier}</p>}
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

function PendingJobCard({ job, onStart, onEdit, onCancel }: { job: WarpingPendingJob; onStart: () => void; onEdit: () => void; onCancel: () => void }) {
  return (
    <li className="grid gap-3 rounded-xl border border-border bg-white p-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:p-4">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-800">
          {warpingInputsSummary(job.inputs)} <span className="font-normal text-slate-500">· {sizeText(job)}</span>
        </p>
        <p className="line-clamp-2 text-xs text-slate-500">{job.inputs.map(inputText).join(' · ')}</p>
        <p className="truncate text-xs text-slate-400">
          {formatDateTime(job.createdAt)}
          {actorText(job.createdBy) ? ` · ${actorText(job.createdBy)}` : ''}
          {job.note ? ` · ${job.note}` : ''}
        </p>
      </div>
      <div className="flex gap-2">
        <Button onClick={onStart} className="flex-1 md:flex-none">
          <Play /> Start
        </Button>
        <Button variant="secondary" size="icon" onClick={onEdit} aria-label="Edit job" title="Edit">
          <Pencil className="!size-4" />
        </Button>
        <Button variant="secondary" size="icon" onClick={onCancel} aria-label="Cancel job" title="Cancel job" className="text-rose-700">
          <Ban className="!size-4" />
        </Button>
      </div>
    </li>
  );
}

/** Sprint 24 (CR-24) — Start a pending job: the denier (required, > 0); the inputs leave Warping stock now. */
function StartJobDialog({ job, busy, onOpenChange, onStart }: { job: WarpingPendingJob | null; busy: boolean; onOpenChange: (o: boolean) => void; onStart: (denier: number) => void }) {
  const [denier, setDenier] = useState('');
  const [tried, setTried] = useState(false);
  useEffect(() => {
    setDenier('');
    setTried(false);
  }, [job]);
  if (!job) return null;
  const value = numOrNull(denier);
  const err = value === null || !(value > 0) ? 'Enter the denier' : null;
  return (
    <YarnDialog
      open
      onOpenChange={onOpenChange}
      title="Start this warping job?"
      description={`${job.inputs.map(inputText).join(' · ')} — taken out of Warping stock now.`}
      busy={busy}
      footer={<DialogButtons onCancel={() => onOpenChange(false)} busy={busy} label="Start job" form="warp-start-form" />}
    >
      <form
        id="warp-start-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setTried(true);
          if (!err) onStart(value!);
        }}
        className="grid gap-3"
      >
        <Field label="Denier" htmlFor="warp-denier" required error={tried ? (err ?? undefined) : undefined} hint="Used at Mark done: kg used = meters × denier × taar ÷ 9,000,000" className="md:max-w-xs">
          <Input id="warp-denier" inputMode="decimal" autoFocus autoComplete="off" value={denier} onChange={(e) => setDenier(cleanDecimal(e.target.value, 4, 6))} invalid={tried && !!err} className="h-12 text-right text-lg tabular-nums" />
        </Field>
        {sizeText(job) && <p className="text-sm text-slate-600">{sizeText(job)}</p>}
      </form>
    </YarnDialog>
  );
}

export type JobsTab = 'in_process' | 'pending' | 'done';

/** The Warping zone's jobs for one tab: In process (Mark done) · Pending (Start / Edit / Cancel) · Done. */
export function WarpingJobsSection({ tab, onTab }: { tab: JobsTab; onTab: (t: JobsTab) => void }) {
  const jobs = useWarpingJobs(tab === 'done' ? 'done' : 'in_process');
  const pending = usePendingJobs();
  const start = useStartPendingJob();
  const cancel = useCancelPendingJob();
  const [editFor, setEditFor] = useState<WarpingPendingJob | null>(null);
  const [startFor, setStartFor] = useState<WarpingPendingJob | null>(null);
  const [cancelFor, setCancelFor] = useState<WarpingPendingJob | null>(null);
  const [doneFor, setDoneFor] = useState<WarpingJob | null>(null);
  const list = tab === 'pending' ? pending : jobs;
  return (
    <div>
      {list.isPending ? (
        <Skeleton className="h-24 w-full rounded-xl" />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : tab === 'pending' ? (
        !pending.data?.length ? (
          <EmptyState icon={Waves} title="No pending jobs" description="New warping jobs wait here (their inputs reserved) until someone starts them." className="py-8" />
        ) : (
          <ul className="space-y-2.5">
            {pending.data.map((j) => (
              <PendingJobCard key={j.id} job={j} onStart={() => setStartFor(j)} onEdit={() => setEditFor(j)} onCancel={() => setCancelFor(j)} />
            ))}
          </ul>
        )
      ) : jobs.items.length === 0 ? (
        <EmptyState
          icon={Waves}
          title={tab === 'in_process' ? 'No warping in process' : 'No finished jobs yet'}
          description={tab === 'in_process' ? 'Start a pending job to take its yarn out of Warping stock.' : undefined}
          className="py-8"
        />
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
      <WarpingJobDialog open={!!editFor} onOpenChange={(o) => !o && setEditFor(null)} job={editFor} />
      <MarkDoneDialog job={doneFor} onOpenChange={(o) => !o && setDoneFor(null)} />
      <StartJobDialog
        job={startFor}
        busy={start.isPending}
        onOpenChange={(o) => !o && setStartFor(null)}
        onStart={(denier) =>
          startFor &&
          start.mutate(
            { id: startFor.id, data: { denier } },
            {
              onSuccess: (j) => {
                toast.success(`${warpingJobLabel(j.jobNo)} started · ${warpingInputsSummary(j.inputs)} · denier ${j.denier}`);
                setStartFor(null);
                onTab('in_process');
              },
              onError: (err) => toast.error(errorMessage(err)),
            },
          )
        }
      />
      <ConfirmDialog
        open={!!cancelFor}
        onOpenChange={(o) => !o && setCancelFor(null)}
        title="Cancel this warping job?"
        description="Its reserved yarn becomes free again."
        confirmLabel="Cancel job"
        cancelLabel="Keep"
        destructive
        loading={cancel.isPending}
        onConfirm={() =>
          cancelFor &&
          cancel.mutate(cancelFor.id, {
            onSuccess: () => {
              toast.success('Warping job cancelled');
              setCancelFor(null);
            },
            onError: (err) => toast.error(errorMessage(err)),
          })
        }
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* new / edit job                                                       */
/* ------------------------------------------------------------------ */

interface InputRow {
  key: number;
  kind: WarpingInputKind;
  /** raw: the yarn quality */
  qualityId: number | null;
  /** raw: null = not picked, 0 = No lot */
  lotId: number | null;
  /** raw: what the picked lot has free (incl. this job's own reservation when editing) */
  lotAvailableG: number;
  boxId: number | null;
  /** no_box: `q-<yarn quality id>` / `w-<warping quality id>` */
  noBoxKey: string | null;
  kg: string;
}
let rowKey = 0;
const newInput = (kind: WarpingInputKind = 'raw'): InputRow => ({ key: ++rowKey, kind, qualityId: null, lotId: null, lotAvailableG: 0, boxId: null, noBoxKey: null, kg: '' });
const rowFromInput = (i: WarpingJobInput): InputRow => ({
  ...newInput(i.kind),
  qualityId: i.kind === 'raw' ? i.qualityId : null,
  lotId: i.kind === 'raw' ? (i.lot?.id ?? 0) : null,
  boxId: i.box?.id ?? null,
  noBoxKey: i.kind === 'no_box' ? (i.warpingQualityId ? `w-${i.warpingQualityId}` : `q-${i.qualityId}`) : null,
  kg: kgText(i.qtyG),
});
/** The stock bucket an input takes from (rows on the same bucket add up). */
const bucketOf = (r: InputRow) => (r.kind === 'raw' ? `r|${r.qualityId}|${r.lotId}` : r.kind === 'box' ? `b|${r.boxId}` : `n|${r.noBoxKey}`);
const bucketOfInput = (i: WarpingJobInput) =>
  i.kind === 'raw' ? `r|${i.qualityId}|${i.lot?.id ?? 0}` : i.kind === 'box' ? `b|${i.box?.id}` : `n|${i.warpingQualityId ? `w-${i.warpingQualityId}` : `q-${i.qualityId}`}`;

/** New warping job (owners) / edit a pending one (owners + floor). Wide dialog; inputs as table rows from 768px. */
export function WarpingJobDialog({ open, onOpenChange, job }: { open: boolean; onOpenChange: (o: boolean) => void; job?: WarpingPendingJob | null }) {
  const editing = !!job;
  const zone = useYarnZone('warping', open);
  const boxes = useBoxStock('warping', open);
  const noBox = useNoBoxStock('warping', open);
  const create = useCreatePendingJob();
  const update = useUpdatePendingJob(job?.id ?? 0);
  const save = editing ? update : create;
  const [rows, setRows] = useState<InputRow[]>(() => [newInput()]);
  const [taar, setTaar] = useState('');
  const [panna, setPanna] = useState('');
  const [meters, setMeters] = useState('');
  const [fullMeter, setFullMeter] = useState(false);
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const [serverErr, setServerErr] = useState<{ field: string; message: string } | null>(null);
  useEffect(() => {
    if (!open) return;
    setRows(job ? job.inputs.map(rowFromInput) : [newInput()]);
    setTaar(job ? String(job.taar) : '');
    setPanna(job ? String(job.panna) : '');
    setMeters(job?.meters ? String(job.meters) : '');
    setFullMeter(job?.fullMeter ?? false);
    setNote(job?.note ?? '');
    setTried(false);
    setServerErr(null);
  }, [open, job]);

  // What this job already reserves counts as free for itself while editing.
  const own = new Map<string, number>();
  for (const i of job?.inputs ?? []) own.set(bucketOfInput(i), (own.get(bucketOfInput(i)) ?? 0) + i.qtyG);
  const ownLots = (job?.inputs ?? []).filter((i) => i.kind === 'raw').map((i) => ({ lotId: i.lot?.id ?? null, g: i.qtyG, qualityId: i.qualityId }));
  const rawQualities = (zone.data?.qualities ?? []).filter((q) => q.rawG > 0).map((q) => ({ id: q.quality.id, name: q.quality.name, availableG: q.rawG }));
  const boxOptions = (boxes.data ?? []).map((b) => {
    const availableG = b.remainingG - b.reservedG + (own.get(`b|${b.id}`) ?? 0);
    return { value: b.id, label: boxNoWithFy(b.boxNo, b.fy), description: `${b.kind === 'remaining' ? 'Remaining · ' : b.kind === 'palti' ? 'Palti · ' : ''}${b.warpingQuality.name} · ${availableText(availableG, b.reservedG - (own.get(`b|${b.id}`) ?? 0))}`, disabled: availableG <= 0, availableG };
  });
  const noBoxOptions = (noBox.data ?? []).map((n) => {
    const key = n.warpingQualityId ? `w-${n.warpingQualityId}` : `q-${n.qualityId}`;
    const availableG = n.availableG + (own.get(`n|${key}`) ?? 0);
    return { value: key, label: n.name, description: availableText(availableG, n.reservedG - (own.get(`n|${key}`) ?? 0)), disabled: availableG <= 0, availableG };
  });
  const availOf = (r: InputRow): number =>
    r.kind === 'raw' ? r.lotAvailableG : r.kind === 'box' ? (boxOptions.find((o) => o.value === r.boxId)?.availableG ?? 0) : (noBoxOptions.find((o) => o.value === r.noBoxKey)?.availableG ?? 0);

  const used = new Map<string, number>();
  const rowErrors = rows.map((r): string | undefined => {
    if (r.kind === 'raw' && !r.qualityId) return 'Select the quality';
    if (r.kind === 'raw' && r.lotId === null) return 'Pick the lot (or No lot)';
    if (r.kind === 'box' && !r.boxId) return 'Pick the box';
    if (r.kind === 'no_box' && !r.noBoxKey) return 'Select the quality';
    const g = parseKgText(r.kg);
    if (g === null || g <= 0) return 'Enter the kg';
    const total = (used.get(bucketOf(r)) ?? 0) + g;
    used.set(bucketOf(r), total);
    const err = checkTake(availOf(r), total);
    return err ? (err === 'not_enough' ? `Only ${formatKg(availOf(r))} free` : TAKE_ERROR_TEXT[err]) : undefined;
  });
  const headErr = validateWarpingJob({ taar: Number(taar), panna: numOrNull(panna) ?? 0, meters: numOrNull(meters), fullMeter, inputs: rows.length });
  const set = (key: number, patch: Partial<InputRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const totalG = rows.reduce((s, r) => s + (parseKgText(r.kg) ?? 0), 0);

  const toInput = (r: InputRow): WarpingInputInput => {
    const qtyKg = gramsToKg(parseKgText(r.kg)!);
    if (r.kind === 'raw') return { kind: 'raw', qualityId: r.qualityId!, lotId: r.lotId || null, qtyKg };
    if (r.kind === 'box') return { kind: 'box', boxId: r.boxId!, qtyKg };
    const [t, id] = r.noBoxKey!.split('-');
    return t === 'w' ? { kind: 'no_box', warpingQualityId: Number(id), qtyKg } : { kind: 'no_box', qualityId: Number(id), qtyKg };
  };
  const submit = () => {
    setTried(true);
    setServerErr(null);
    if (headErr || rowErrors.some(Boolean)) return;
    save.mutate(
      { inputs: rows.map(toInput), taar: Number(taar), panna: Number(panna), meters: fullMeter ? null : numOrNull(meters), fullMeter, note: note.trim() || null },
      {
        onSuccess: () => {
          toast.success(editing ? 'Warping job updated' : `Warping job added to Pending · ${formatKg(totalG)} reserved`);
          onOpenChange(false);
        },
        onError: (err) => {
          if (err instanceof ApiError && err.field) setServerErr({ field: err.field, message: err.message });
          toast.error(errorMessage(err));
        },
      },
    );
  };
  const headShow = (e: typeof headErr, ...which: (typeof headErr)[]) => (tried && e && which.includes(e) ? WARPING_JOB_ERROR_TEXT[e] : undefined);
  const GRID = 'md:grid-cols-[9.5rem_minmax(0,1.2fr)_minmax(0,1fr)_9rem_2.75rem]';

  return (
    <YarnDialog
      open={open}
      onOpenChange={onOpenChange}
      layout="wide"
      title={editing ? 'Edit pending warping job' : 'New warping job'}
      description="Raw (by lot), TFO boxes and “No box” twisted yarn from Warping stock — reserved until the job starts."
      busy={save.isPending}
      dirty={rows.some((r) => r.kg) || !!taar}
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          <p className="mr-auto text-sm text-slate-600">
            Total <Kg g={totalG} className="font-semibold text-slate-900" />
          </p>
          <DialogButtons onCancel={() => onOpenChange(false)} busy={save.isPending} label={editing ? 'Save' : 'Add job'} form="warp-job-form" />
        </div>
      }
    >
      <form
        id="warp-job-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="grid gap-5"
      >
        {serverErr && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{serverErr.message}</p>}
        <div>
          <div className="mb-2 flex items-center gap-2">
            <h3 className="min-w-0 flex-1 text-sm font-bold text-slate-800">Inputs</h3>
            {rows.length < MAX_WARPING_INPUTS && (
              <Button variant="secondary" size="sm" onClick={() => setRows((rs) => [...rs, newInput(rs[rs.length - 1]?.kind)])}>
                <Plus /> Add input
              </Button>
            )}
          </div>
          <div className={cn('hidden gap-x-3 border-b border-border pb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 md:grid', GRID)}>
            <span>Yarn</span>
            <span>Quality / box *</span>
            <span>Lot</span>
            <span className="text-right">Kg *</span>
            <span />
          </div>
          {zone.isPending ? (
            <Skeleton className="mt-2 h-14 w-full rounded-xl" />
          ) : (
            <ol className="space-y-3 md:space-y-0">
              {rows.map((r, i) => {
                const err = tried ? rowErrors[i] : undefined;
                return (
                  <li key={r.key} className={cn('grid grid-cols-2 gap-3 rounded-xl border border-border p-3 md:items-start md:rounded-none md:border-0 md:border-b md:px-0 md:py-2.5', GRID)}>
                    <div className="col-span-2 md:col-span-1">
                      <Toggle2 value={r.kind} onChange={(kind) => set(r.key, { ...newInput(kind), key: r.key, kg: r.kg })} options={KIND_OPTIONS} />
                    </div>
                    <div className={cn('col-span-2 min-w-0', r.kind === 'raw' ? 'md:col-span-1' : 'md:col-span-2')}>
                      {r.kind === 'raw' ? (
                        <QualitySelect value={r.qualityId} onChange={(id) => set(r.key, { qualityId: id, lotId: null, lotAvailableG: 0 })} only={rawQualities} invalid={!!err && !r.qualityId} placeholder={rawQualities.length ? 'Select quality' : 'No raw yarn in Warping'} />
                      ) : r.kind === 'box' ? (
                        <Select
                          value={r.boxId}
                          onChange={(id, o) => set(r.key, { boxId: id, kg: r.kg || String(gramsToKg((o as { availableG?: number }).availableG ?? 0)) })}
                          options={boxOptions}
                          placeholder={boxOptions.length ? 'Select box' : 'No boxes in Warping'}
                          searchable
                          searchPlaceholder="Search box no…"
                          loading={boxes.isPending}
                          emptyText="No boxes in Warping"
                          invalid={!!err && !r.boxId}
                          panelClassName="min-w-[min(320px,calc(100vw-24px))]"
                          aria-label="Box"
                        />
                      ) : (
                        <Select
                          value={r.noBoxKey}
                          onChange={(v) => set(r.key, { noBoxKey: v })}
                          options={noBoxOptions}
                          placeholder={noBoxOptions.length ? 'Select quality' : 'No “No box” yarn here'}
                          searchable
                          loading={noBox.isPending}
                          emptyText="No “No box” twisted yarn in Warping"
                          invalid={!!err && !r.noBoxKey}
                          panelClassName="min-w-[min(300px,calc(100vw-24px))]"
                          aria-label="No box quality"
                        />
                      )}
                    </div>
                    {r.kind === 'raw' && (
                      <div className="col-span-2 min-w-0 md:col-span-1">
                        <LotSelect
                          zone="warping"
                          qualityId={r.qualityId}
                          value={r.lotId ?? -1}
                          onChange={(lotId, availableG) => set(r.key, { lotId, lotAvailableG: availableG })}
                          invalid={!!err && r.lotId === null && !!r.qualityId}
                          own={ownLots.filter((l) => l.qualityId === r.qualityId)}
                        />
                      </div>
                    )}
                    <KgInput value={r.kg} onValueChange={(kg) => set(r.key, { kg })} invalid={!!err} aria-label={`Kg input ${i + 1}`} />
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
                    {err && <p className="col-span-2 text-[13px] font-medium text-destructive md:col-span-5">{err}</p>}
                  </li>
                );
              })}
            </ol>
          )}
          {tried && headErr === 'no_inputs' && <p className="mt-2 text-[13px] font-medium text-destructive">{WARPING_JOB_ERROR_TEXT.no_inputs}</p>}
        </div>

        <fieldset className="grid grid-cols-2 gap-4 md:grid-cols-[8rem_8rem_minmax(0,1fr)_minmax(0,1fr)] md:items-start">
          <legend className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Beam size</legend>
          <Field label="Taar" htmlFor="warp-taar" required error={headShow(headErr, 'taar')}>
            <Input id="warp-taar" inputMode="numeric" autoComplete="off" value={taar} onChange={(e) => setTaar(cleanDecimal(e.target.value, 0, 7))} invalid={!!headShow(headErr, 'taar')} className="text-right tabular-nums" />
          </Field>
          <Field label="Panna" htmlFor="warp-panna" required error={headShow(headErr, 'panna')}>
            <Input id="warp-panna" inputMode="decimal" autoComplete="off" value={panna} onChange={(e) => setPanna(cleanDecimal(e.target.value, 4, 6))} invalid={!!headShow(headErr, 'panna')} className="text-right tabular-nums" />
          </Field>
          <Field label="Meters" htmlFor="warp-m" required={!fullMeter} error={headShow(headErr, 'meters')} hint={fullMeter ? 'Entered per beam at Mark done' : undefined}>
            <Input id="warp-m" inputMode="decimal" autoComplete="off" value={fullMeter ? '' : meters} disabled={fullMeter} onChange={(e) => setMeters(cleanDecimal(e.target.value, 4, 8))} invalid={!!headShow(headErr, 'meters')} className="text-right tabular-nums" />
          </Field>
          <label className="flex min-h-11 cursor-pointer items-center gap-2.5 self-end rounded-xl border border-input px-3 py-2 md:mb-0">
            <Checkbox checked={fullMeter} onCheckedChange={(c) => setFullMeter(c === true)} aria-label="Full meter" />
            <span className="text-sm font-medium text-slate-800">Full meter</span>
          </label>
        </fieldset>

        <Field label="Note" htmlFor="warp-note">
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
  wqId: number | null;
  wqName?: string;
  taar: string;
  panna: string;
  meters: string;
  remark: string;
}
const newBeam = (job: WarpingJob | null, prev?: BeamRow): BeamRow => {
  const wq = prefillBeamQuality(job?.inputs ?? []);
  const wqName = wq ? job?.inputs.find((i) => i.warpingQualityId === wq)?.quality.name : undefined;
  return {
    key: ++rowKey,
    wqId: prev?.wqId ?? wq,
    wqName: prev ? prev.wqName : wqName,
    taar: prev?.taar ?? (job?.taar != null ? String(job.taar) : ''),
    panna: prev?.panna ?? (job?.panna != null ? String(job.panna) : ''),
    meters: job && !job.fullMeter && job.meters != null ? String(job.meters) : '',
    remark: '',
  };
};

/**
 * Sprint 24 (CR-24) — the Mark done summary card: meters · denier · taar · kg used (with the formula) · kg issued ·
 * remaining → where it goes ("P-12: 3.25 kg · P-11: 3.25 kg", or back to the input lots). Amber when more was used than
 * issued. The same shared `warpingLeftover` the server uses.
 */
function LeftoverSummary({ job, beams, denier }: { job: WarpingJob; beams: { meters: number; taar: number }[]; denier: number | null }) {
  const meters = beams.reduce((s, b) => s + (Number.isFinite(b.meters) ? b.meters : 0), 0);
  const taar = job.taar ?? (beams[0]?.taar || 0);
  const ready = meters > 0 && !!denier && taar > 0;
  const left = ready
    ? warpingLeftover({ meters, denier: denier!, taar, issuedG: job.totalG, programs: job.inputs.flatMap((i) => (i.program ? [i.program] : [])), inputs: job.inputs.map((i) => ({ g: i.qtyG })) })
    : null;
  const Row = ({ label, children, strong }: { label: string; children: React.ReactNode; strong?: boolean }) => (
    <div className="flex items-baseline justify-between gap-2 py-1">
      <dt className="text-slate-500">{label}</dt>
      <dd className={cn('text-right tabular-nums', strong ? 'font-bold text-slate-900' : 'font-medium text-slate-800')}>{children}</dd>
    </div>
  );
  return (
    <section aria-label="Kg used and remaining" className="rounded-xl border p-3 text-sm" style={{ borderColor: ACCENT.border, backgroundColor: ACCENT.soft }}>
      <h3 className="mb-1 text-xs font-bold uppercase tracking-wide" style={{ color: ACCENT.text }}>
        Kg used · remaining
      </h3>
      <dl className="divide-y divide-amber-200/60">
        <Row label="Meters">{meters ? meters.toLocaleString('en-IN', { maximumFractionDigits: 4 }) : '—'}</Row>
        <Row label="Denier">{denier ?? '—'}</Row>
        <Row label="Taar">{taar || '—'}</Row>
        <Row label="Kg used">{left ? <Kg g={left.usedG} /> : '—'}</Row>
        <Row label="Kg issued">
          <Kg g={job.totalG} />
        </Row>
        <Row label="Remaining" strong>
          {left ? <Kg g={left.remainingG} /> : '—'}
        </Row>
      </dl>
      {ready && <p className="mt-1 text-[11px] leading-snug text-slate-500">{warpingFormulaText(meters, denier!, taar)}</p>}
      {left && left.overG > 0 && (
        <p className="mt-2 rounded-lg bg-amber-100 px-2 py-1.5 text-xs font-semibold text-amber-900">Used more than issued by {formatKg(left.overG)} — check denier / taar / meters</p>
      )}
      {left && left.splits.length > 0 && (
        <p className="mt-2 text-xs font-semibold text-slate-800">
          →{' '}
          {left.splits
            .map((s) => {
              if (s.kind === 'program') return `${tfoProgramLabel(s.programId)}: ${formatKg(s.g)}`;
              const i = job.inputs[s.index];
              return `${i.kind === 'raw' ? (i.lot ? `Lot ${i.lot.lotNo}` : NO_LOT_LABEL) : i.box ? `Box ${i.box.boxNo}` : i.quality.name}: ${formatKg(s.g)}`;
            })
            .join(' · ')}
        </p>
      )}
      {!ready && <p className="mt-2 text-xs text-slate-500">Enter the beams’ meters{job.denier === null ? ' and the denier' : ''} to see the kg used.</p>}
    </section>
  );
}

/**
 * Mark done (wide dialog): one or more beams — Warping quality · Taar · Panna · Meters · Remark — one table row each
 * from 768px, cards on phones. Sprint 20c: beam numbers are given by the system and every beam stays in Warping
 * (move it later with Transfer). Taar / panna / meters come from the job (meters empty with Full meter).
 */
export function MarkDoneDialog({ job, onOpenChange }: { job: WarpingJob | null; onOpenChange: (o: boolean) => void }) {
  const open = !!job;
  const finish = useFinishWarping(job?.id ?? 0);
  const [rows, setRows] = useState<BeamRow[]>(() => [newBeam(null)]);
  const [note, setNote] = useState('');
  const [denierText, setDenierText] = useState('');
  const [tried, setTried] = useState(false);
  const [serverErr, setServerErr] = useState<{ field: string; message: string } | null>(null);
  useEffect(() => {
    if (open) {
      setRows([newBeam(job)]);
      setNote('');
      setDenierText('');
      setTried(false);
      setServerErr(null);
    }
  }, [open, job]);

  const parsed = rows.map((r) => ({ taar: Number(r.taar), panna: numOrNull(r.panna) ?? 0, meters: numOrNull(r.meters) ?? 0, warpingQualityId: r.wqId ?? 0, remark: r.remark.trim() || null }));
  const errs = parsed.map((b) => {
    const e = validateBeam(b);
    return e ? BEAM_INPUT_ERROR_TEXT[e] : null;
  });
  // Sprint 24 (CR-24): jobs started before the denier was asked at Start give it here.
  const askDenier = !!job && job.denier === null;
  const denier = job?.denier ?? numOrNull(denierText);
  const denierErr = askDenier && !(denier !== null && denier > 0) ? 'Enter the denier' : null;
  const set = (key: number, patch: Partial<BeamRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const submit = () => {
    setTried(true);
    setServerErr(null);
    if (errs.some(Boolean) || denierErr) return;
    finish.mutate(
      { beams: parsed, note: note.trim() || null, denier: askDenier ? denier : null },
      {
        onSuccess: (res) => {
          const rest = res.leftover.length ? ` · remaining ${res.leftover.map((l) => `${l.label} ${formatKg(l.g)}`).join(', ')}` : '';
          toast.success(`${job ? warpingJobLabel(job.jobNo) : 'Job'} done · beam${res.beams.length === 1 ? '' : 's'} ${res.beams.map((b) => b.beamCode).join(', ')} in Warping${rest}`);
          onOpenChange(false);
        },
        onError: (err) => {
          if (err instanceof ApiError && err.field) setServerErr({ field: err.field, message: err.message });
          toast.error(errorMessage(err));
        },
      },
    );
  };
  // One line per beam on desktop; cards (3 columns) on phones and next to the summary card on tablets.
  const GRID = 'lg:grid-cols-[minmax(0,1.6fr)_4.75rem_4.75rem_6.25rem_minmax(0,1.2fr)_2.5rem]';
  const summary = job ? <LeftoverSummary job={job} beams={parsed} denier={denier} /> : null;

  return (
    <YarnDialog
      open={open}
      onOpenChange={onOpenChange}
      layout="wide"
      title={job ? `Mark done · ${warpingJobLabel(job.jobNo)}` : 'Mark done'}
      description={job ? `${warpingInputsSummary(job.inputs)}${sizeText(job) ? ` · ${sizeText(job)}` : ''} · beam no. and date are set automatically; beams stay in Warping.` : undefined}
      busy={finish.isPending}
      dirty={rows.some((r) => r.meters || r.remark)}
      footer={<DialogButtons onCancel={() => onOpenChange(false)} busy={finish.isPending} label={`Done · ${rows.length} beam${rows.length === 1 ? '' : 's'}`} form="warp-done-form" />}
    >
      <form
        id="warp-done-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="grid gap-4"
      >
        {serverErr && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{serverErr.message}</p>}
        {job?.fullMeter && <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">Full meter job — enter the meters of each beam.</p>}
        {askDenier && (
          <Field label="Denier" htmlFor="warp-done-denier" required error={tried ? (denierErr ?? (serverErr?.field === 'denier' ? serverErr.message : undefined)) : undefined} hint="This job started before the denier was asked at Start" className="md:max-w-xs">
            <Input id="warp-done-denier" inputMode="decimal" autoComplete="off" value={denierText} onChange={(e) => setDenierText(cleanDecimal(e.target.value, 4, 6))} invalid={tried && !!denierErr} className="text-right tabular-nums" />
          </Field>
        )}
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_15rem] md:items-start">
        <div className="grid min-w-0 gap-4">
        <div className={cn('hidden gap-x-2 border-b border-border pb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 lg:grid', GRID)}>
          <span>Warping quality *</span>
          <span className="text-right">Taar *</span>
          <span className="text-right">Panna *</span>
          <span className="text-right">Meters *</span>
          <span>Remark</span>
          <span />
        </div>
        <ol className="space-y-3 lg:-mt-4 lg:space-y-0">
          {rows.map((r, i) => {
            const err = tried ? errs[i] : null;
            return (
              <li key={r.key} className={cn('grid grid-cols-3 gap-3 rounded-xl border border-border p-3 lg:items-start lg:gap-2 lg:rounded-none lg:border-0 lg:border-b lg:px-0 lg:py-2.5', GRID)}>
                <p className="col-span-3 text-xs font-bold uppercase tracking-wide text-slate-500 lg:hidden">Beam {i + 1}</p>
                <div className="col-span-3 min-w-0 lg:col-span-1">
                  <WarpingQualitySelect value={r.wqId} selectedLabel={r.wqName} onChange={(id, name) => set(r.key, { wqId: id, wqName: name })} invalid={!!err && !r.wqId} />
                </div>
                <Input inputMode="numeric" autoComplete="off" placeholder="Taar" value={r.taar} onChange={(e) => set(r.key, { taar: cleanDecimal(e.target.value, 0, 7) })} className="text-right tabular-nums" aria-label={`Beam ${i + 1} taar`} />
                <Input inputMode="decimal" autoComplete="off" placeholder="Panna" value={r.panna} onChange={(e) => set(r.key, { panna: cleanDecimal(e.target.value, 4, 6) })} className="text-right tabular-nums" aria-label={`Beam ${i + 1} panna`} />
                <Input inputMode="decimal" autoComplete="off" placeholder="Meters" value={r.meters} onChange={(e) => set(r.key, { meters: cleanDecimal(e.target.value, 4, 8) })} className="text-right tabular-nums" aria-label={`Beam ${i + 1} meters`} />
                <div className="col-span-2 min-w-0 lg:col-span-1">
                  <Input autoComplete="off" placeholder="Remark" maxLength={BEAM_REMARK_MAX_LENGTH} value={r.remark} onChange={(e) => set(r.key, { remark: e.target.value })} aria-label={`Beam ${i + 1} remark`} />
                </div>
                <Button variant="ghost" size="icon" className="justify-self-end text-slate-400 hover:text-destructive" disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label={`Remove beam ${i + 1}`}>
                  <Trash2 />
                </Button>
                {err && <p className="col-span-3 text-[13px] font-medium text-destructive lg:col-span-6">{err}</p>}
              </li>
            );
          })}
        </ol>
        {rows.length < MAX_BEAMS_PER_JOB && (
          <Button variant="secondary" className="justify-self-start" onClick={() => setRows((rs) => [...rs, newBeam(job, rs[rs.length - 1])])}>
            <Plus /> Add beam
          </Button>
        )}
        </div>
        {/* Tablet / desktop: the summary beside the beams; phones: at the bottom, above the Save bar. */}
        <div className="order-last md:order-none md:sticky md:top-0">{summary}</div>
        </div>
        <Field label="Note" htmlFor="warp-done-note">
          <Textarea id="warp-done-note" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} className="min-h-[64px]" />
        </Field>
      </form>
    </YarnDialog>
  );
}
