import { Info, Printer } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  changeMachineSummary,
  completedFramesNote,
  completedMetersNote,
  formatQty,
  jobsheetRef,
  jobsheetRefShort,
  nextFramesAfterCompletedChange,
  nextFramesMax,
  nextMetersAfterCompletedChange,
  remainingFrames,
  type JobsheetMachine,
  type JobsheetStatusKey,
  type MachineRef,
} from '@rivoora/shared';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { ImageThumb } from '@/components/ui/image-thumb';
import { JobsheetRef } from '@/components/ui/jobsheet-ref';
import { NumberInput } from '@/components/ui/input';
import { ResponsiveModal } from '@/components/ui/modal';
import { Select, type SelectOption } from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { printUrl, useChangeMachine, useCompleteJobsheet, useMachineView, useStartJobsheet } from './api';
import { machineLabel, parseDecimalOrNull } from './parts';

/** What the dialogs need to know about a jobsheet (from the supervisor list or the details page). */
export interface RunJobsheet {
  id: number;
  jobsheetNo: number;
  orderNo: number;
  status: JobsheetStatusKey;
  frames: number;
  /** Sprint 19: set instead of `frames` for a meter order's jobsheet. */
  meters: number | null;
  machines: JobsheetMachine[];
  runningMachine: MachineRef | null;
  suggestedMachineId: number | null;
  designCode: string | null;
  thumbUrl: string | null;
}

export type RunAction = { kind: 'start' | 'complete' | 'change'; js: RunJobsheet };

const fr = (n: number) => `${n} frame${n === 1 ? '' : 's'}`;
/** "50 m" / "10 frames" — whichever this jobsheet is in. */
const qtyOf = (js: RunJobsheet) => (js.meters !== null ? formatQty(js.meters, 'meters') : fr(js.frames));

/** Ongoing jobsheets per machine id (from the machine board), for the "busy" hints. */
function useBusyMachines() {
  const view = useMachineView();
  return useMemo(() => {
    const map = new Map<number, { jobsheetNo: number; orderNo: number }[]>();
    for (const m of [...(view.data?.machines ?? []), ...(view.data?.inactive ?? [])]) {
      if (m.ongoing.length) map.set(m.id, m.ongoing.map((j) => ({ jobsheetNo: j.jobsheetNo, orderNo: j.orderNo })));
    }
    return { busy: map, active: view.data?.machines ?? [], isPending: view.isPending, isError: view.isError };
  }, [view.data, view.isPending, view.isError]);
}

function DialogShell({
  open,
  onOpenChange,
  title,
  description,
  busy,
  footer,
  children,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: ReactNode;
  busy: boolean;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(o) => !busy && onOpenChange(o)}
      title={title}
      description={description}
      desktopVariant="center"
      mobileVariant="bottom"
      size="lg"
      dismissible={!busy}
      footer={<div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">{footer}</div>}
    >
      {children}
    </ResponsiveModal>
  );
}

function JobsheetHeader({ js }: { js: RunJobsheet }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-slate-50/70 p-3">
      <ImageThumb thumbUrl={js.thumbUrl} alt={js.designCode ? `Design ${js.designCode}` : 'No design'} preview={false} className="size-14 shrink-0 ring-1 ring-inset ring-black/5" />
      <div className="min-w-0">
        <p className="text-lg font-bold leading-tight text-slate-900">
          <JobsheetRef orderNo={js.orderNo} jobsheetNo={js.jobsheetNo} />
        </p>
        <p className="truncate text-sm text-slate-500">
          {js.designCode ? `Design ${js.designCode}` : 'No design'} · {qtyOf(js)}
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Start                                                                */
/* ------------------------------------------------------------------ */

function StartDialog({ js, open, onOpenChange }: { js: RunJobsheet; open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const start = useStartJobsheet();
  const { busy } = useBusyMachines();
  // Active machines assigned to this jobsheet only.
  const chips = useMemo(() => js.machines.filter((m) => m.isActive), [js.machines]);
  const [machineId, setMachineId] = useState<number | null>(() =>
    js.suggestedMachineId && chips.some((m) => m.id === js.suggestedMachineId) ? js.suggestedMachineId : chips.length === 1 ? chips[0].id : null,
  );
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (!machineId) return;
    setError(null);
    start.mutate(
      { id: js.id, machineId },
      {
        onSuccess: (res) => {
          toast.success(`${jobsheetRefShort(res.orderNo, res.jobsheetNo)} started on Machine ${res.machineNo}`);
          onOpenChange(false);
          // Start & print: straight to the print preview (Close there returns to the list).
          navigate(printUrl([js.id]));
        },
        onError: (err) => {
          if (err instanceof ApiError && err.field) setError(err.message);
        },
      },
    );
  };

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={`Start · ${jobsheetRef(js.orderNo, js.jobsheetNo)}`}
      busy={start.isPending}
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)} disabled={start.isPending}>
            Cancel
          </Button>
          <Button size="lg" onClick={submit} disabled={!machineId} loading={start.isPending}>
            <Printer /> Start & print
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <JobsheetHeader js={js} />
        <fieldset>
          <legend className="mb-3 text-[15px] font-semibold text-slate-900">
            Select machine <span className="text-destructive">*</span>
          </legend>
          {chips.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              None of this jobsheet's machines are active. Ask the office to update the jobsheet.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4" role="radiogroup" aria-label="Machine">
              {chips.map((m) => {
                const selected = machineId === m.id;
                const running = (busy.get(m.id) ?? []).filter((r) => r.jobsheetNo !== js.jobsheetNo);
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setMachineId(m.id)}
                    title={machineLabel(m)}
                    className={cn(
                      'relative flex aspect-square min-h-[88px] flex-col items-center justify-center rounded-2xl border-2 bg-white px-1 transition active:scale-[0.97]',
                      selected
                        ? 'border-primary bg-primary-soft text-primary shadow-soft ring-4 ring-primary/10'
                        : 'border-border text-slate-800 hover:border-primary/40',
                    )}
                  >
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Machine</span>
                    <span className="text-3xl font-bold leading-none tabular-nums">{m.machineNo}</span>
                    {running.length > 0 && (
                      <span className="mt-1.5 max-w-full truncate rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                        busy · {running.map((r) => jobsheetRefShort(r.orderNo, r.jobsheetNo)).join(', ')}
                      </span>
                    )}
                    {js.suggestedMachineId === m.id && !running.length && (
                      <span className="mt-1.5 text-[11px] font-semibold text-primary/80">Suggested</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          {error && <p className="mt-2 text-sm font-medium text-destructive">{error}</p>}
        </fieldset>
      </div>
    </DialogShell>
  );
}

/* ------------------------------------------------------------------ */
/* Complete                                                             */
/* ------------------------------------------------------------------ */

function CompleteDialog({ js, open, onOpenChange }: { js: RunJobsheet; open: boolean; onOpenChange: (o: boolean) => void }) {
  const meterOrder = js.meters !== null;
  const complete = useCompleteJobsheet();
  const [text, setText] = useState(() => (meterOrder ? String(js.meters) : String(js.frames)));
  const [error, setError] = useState<string | null>(null);
  const value = meterOrder ? parseDecimalOrNull(text) ?? (text.trim() === '0' ? 0 : null) : /^\d+$/.test(text.trim()) ? Number(text.trim()) : null;
  const note = value !== null ? (meterOrder ? completedMetersNote(js.meters!, value) : completedFramesNote(js.frames, value)) : null;

  const submit = () => {
    if (value === null) {
      setError(meterOrder ? 'Enter the metres completed (0 or more).' : 'Enter the frames completed (0 or more).');
      return;
    }
    setError(null);
    complete.mutate(
      meterOrder ? { id: js.id, completedMeters: value } : { id: js.id, completedFrames: value },
      {
        onSuccess: (res) => {
          toast.success(`${jobsheetRefShort(res.orderNo, res.jobsheetNo)} completed (${meterOrder ? formatQty(value, 'meters') : fr(value)})`);
          onOpenChange(false);
        },
        onError: (err) => {
          if (err instanceof ApiError && err.field) setError(err.message);
        },
      },
    );
  };

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={`Complete · ${jobsheetRef(js.orderNo, js.jobsheetNo)}`}
      description={`${js.runningMachine ? `Machine ${js.runningMachine.machineNo} · ` : ''}${qtyOf(js)} assigned`}
      busy={complete.isPending}
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)} disabled={complete.isPending}>
            Cancel
          </Button>
          <Button size="lg" onClick={submit} disabled={value === null} loading={complete.isPending}>
            Complete
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <JobsheetHeader js={js} />
        <Field label={meterOrder ? 'Metres completed' : 'Frames completed'} htmlFor="complete-qty" required error={error ?? undefined}>
          <NumberInput
            id="complete-qty"
            inputMode={meterOrder ? 'decimal' : 'numeric'}
            autoFocus
            autoComplete="off"
            value={text}
            onChange={(e) => setText(meterOrder ? e.target.value.replace(/[^\d.]/g, '') : e.target.value.replace(/[^\d]/g, ''))}
            invalid={!!error}
            suffix={meterOrder ? <span className="pr-1.5 text-sm text-slate-400">m</span> : undefined}
            className="h-14 text-center text-2xl font-bold tabular-nums"
          />
        </Field>
        {note && (
          <p className="flex items-start gap-2 rounded-[10px] border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm font-medium text-amber-900" role="status">
            <Info className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
            {note}
          </p>
        )}
      </div>
    </DialogShell>
  );
}

/* ------------------------------------------------------------------ */
/* Change machine                                                       */
/* ------------------------------------------------------------------ */

function ChangeMachineDialogPcs({ js, open, onOpenChange }: { js: RunJobsheet; open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const change = useChangeMachine();
  const completeJs = useCompleteJobsheet();
  const current = js.runningMachine;
  const [completed, setCompleted] = useState<number | null>(null);
  const [next, setNext] = useState(() => remainingFrames(js.frames, 0));
  const [nextTouched, setNextTouched] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // "Frames to make next" follows the remaining frames until the user picks it.
  useEffect(() => {
    setNext((n) => nextFramesAfterCompletedChange({ assigned: js.frames, completed: completed ?? 0, current: n, touched: nextTouched }));
  }, [completed, js.frames, nextTouched]);

  const completedOptions = useMemo<SelectOption<number>[]>(
    () => Array.from({ length: js.frames + 1 }, (_, i) => ({ value: i, label: fr(i) })),
    [js.frames],
  );
  const nextOptions = useMemo<SelectOption<number>[]>(
    () => Array.from({ length: nextFramesMax(js.frames) }, (_, i) => ({ value: i + 1, label: fr(i + 1) })),
    [js.frames],
  );
  // All the frames were made on this machine: nothing is left, so the jobsheet is simply completed (no split).
  const allDone = completed !== null && completed >= js.frames;
  const ready = completed !== null && (allDone || next >= 1);

  const submit = () => {
    if (!ready) return;
    setErrors({});
    if (allDone) {
      completeJs.mutate(
        { id: js.id, completedFrames: completed },
        {
          onSuccess: (res) => {
            toast.success(`${jobsheetRefShort(res.orderNo, res.jobsheetNo)} completed (${fr(completed)})`);
            onOpenChange(false);
          },
          onError: (err) => {
            if (err instanceof ApiError && err.field) setErrors({ [err.field]: err.message });
          },
        },
      );
      return;
    }
    change.mutate(
      { id: js.id, completedFrames: completed, nextFrames: next },
      {
        onSuccess: (res) => {
          toast.success(
            `${jobsheetRefShort(res.orderNo, res.completed.jobsheetNo)} completed (${fr(res.completed.frames)}). New jobsheet ${jobsheetRefShort(res.orderNo, res.created.jobsheetNo)} (${fr(res.created.frames)}) is waiting to start.`,
            { duration: 10_000, action: { label: 'Print', onClick: () => navigate(printUrl([res.created.id])) } },
          );
          onOpenChange(false);
        },
        onError: (err) => {
          if (err instanceof ApiError && err.field) setErrors({ [err.field]: err.message });
        },
      },
    );
  };

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={`Change machine · ${jobsheetRef(js.orderNo, js.jobsheetNo)}`}
      description={`Currently on ${current ? `Machine ${current.machineNo}` : 'no machine'} · ${fr(js.frames)} assigned`}
      busy={change.isPending || completeJs.isPending}
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)} disabled={change.isPending || completeJs.isPending}>
            Cancel
          </Button>
          <Button size="lg" onClick={submit} disabled={!ready} loading={change.isPending || completeJs.isPending}>
            {allDone ? 'Mark complete' : 'Confirm'}
          </Button>
        </>
      }
    >
      <div className="grid gap-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label={`Frames completed on ${current ? `Machine ${current.machineNo}` : 'this machine'}`}
            htmlFor="cm-completed"
            required
            error={errors.completedFrames}
          >
            <Select
              id="cm-completed"
              value={completed}
              onChange={(v) => {
                setCompleted(v);
                if (!nextTouched) setNext(nextFramesAfterCompletedChange({ assigned: js.frames, completed: v, current: next, touched: false }));
              }}
              options={completedOptions}
              placeholder="Select"
              invalid={!!errors.completedFrames}
              triggerClassName="h-12"
            />
          </Field>
          {!allDone && (
          <Field label="Frames to make next" htmlFor="cm-next" required error={errors.nextFrames} hint={nextTouched ? undefined : 'Remaining frames'}>
            <Select
              id="cm-next"
              value={next}
              onChange={(v) => {
                setNext(v);
                setNextTouched(true);
              }}
              options={nextOptions}
              invalid={!!errors.nextFrames}
              triggerClassName="h-12"
            />
          </Field>
          )}
        </div>
        {allDone && (
          <p className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-[15px] font-medium leading-relaxed text-green-900" aria-live="polite">
            All {fr(js.frames)} are done on this machine, so {jobsheetRefShort(js.orderNo, js.jobsheetNo)} will be marked complete. No new jobsheet is made.
          </p>
        )}
        {completed !== null && !allDone && (
          <p className="rounded-xl border border-primary/15 bg-primary-soft/70 px-4 py-3 text-[15px] font-medium leading-relaxed text-slate-800" aria-live="polite">
            {changeMachineSummary({ orderNo: js.orderNo, jobsheetNo: js.jobsheetNo, completed, next, newMachineNo: null })}
          </p>
        )}
      </div>
    </DialogShell>
  );
}

/** Sprint 19: the meter twin of `ChangeMachineDialogPcs` — plain decimal fields instead of enumerable Selects. */
function ChangeMachineDialogMeters({ js, open, onOpenChange }: { js: RunJobsheet; open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const change = useChangeMachine();
  const completeJs = useCompleteJobsheet();
  const current = js.runningMachine;
  const assigned = js.meters!;
  const [completedText, setCompletedText] = useState('');
  const [nextText, setNextText] = useState('');
  const [nextTouched, setNextTouched] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const completed = parseDecimalOrNull(completedText) ?? (completedText.trim() === '0' ? 0 : null);
  const allDone = completed !== null && completed >= assigned;

  useEffect(() => {
    if (completed === null || nextTouched || allDone) return;
    setNextText(String(nextMetersAfterCompletedChange({ assigned, completed, current: parseDecimalOrNull(nextText) ?? 0, touched: false })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completed]);

  const next = parseDecimalOrNull(nextText);
  const ready = completed !== null && (allDone || (next !== null && next > 0));

  const submit = () => {
    if (!ready) return;
    setErrors({});
    if (allDone) {
      completeJs.mutate(
        { id: js.id, completedMeters: completed },
        {
          onSuccess: (res) => {
            toast.success(`${jobsheetRefShort(res.orderNo, res.jobsheetNo)} completed (${formatQty(completed, 'meters')})`);
            onOpenChange(false);
          },
          onError: (err) => {
            if (err instanceof ApiError && err.field) setErrors({ [err.field]: err.message });
          },
        },
      );
      return;
    }
    change.mutate(
      { id: js.id, completedMeters: completed, nextMeters: next! },
      {
        onSuccess: (res) => {
          const completedM = res.completed.meters ?? 0;
          const createdM = res.created.meters ?? 0;
          toast.success(
            `${jobsheetRefShort(res.orderNo, res.completed.jobsheetNo)} completed (${formatQty(completedM, 'meters')}). New jobsheet ${jobsheetRefShort(res.orderNo, res.created.jobsheetNo)} (${formatQty(createdM, 'meters')}) is waiting to start.`,
            { duration: 10_000, action: { label: 'Print', onClick: () => navigate(printUrl([res.created.id])) } },
          );
          onOpenChange(false);
        },
        onError: (err) => {
          if (err instanceof ApiError && err.field) setErrors({ [err.field]: err.message });
        },
      },
    );
  };

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={`Change machine · ${jobsheetRef(js.orderNo, js.jobsheetNo)}`}
      description={`Currently on ${current ? `Machine ${current.machineNo}` : 'no machine'} · ${formatQty(assigned, 'meters')} assigned`}
      busy={change.isPending || completeJs.isPending}
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)} disabled={change.isPending || completeJs.isPending}>
            Cancel
          </Button>
          <Button size="lg" onClick={submit} disabled={!ready} loading={change.isPending || completeJs.isPending}>
            {allDone ? 'Mark complete' : 'Confirm'}
          </Button>
        </>
      }
    >
      <div className="grid gap-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={`Metres completed on ${current ? `Machine ${current.machineNo}` : 'this machine'}`} htmlFor="cm-m-completed" required error={errors.completedMeters}>
            <NumberInput
              id="cm-m-completed"
              inputMode="decimal"
              autoFocus
              value={completedText}
              onChange={(e) => setCompletedText(e.target.value.replace(/[^\d.]/g, ''))}
              invalid={!!errors.completedMeters}
              suffix={<span className="pr-1.5 text-sm text-slate-400">m</span>}
              className="h-12"
            />
          </Field>
          {!allDone && (
            <Field label="Metres to make next" htmlFor="cm-m-next" required error={errors.nextMeters} hint={nextTouched ? undefined : 'Remaining metres'}>
              <NumberInput
                id="cm-m-next"
                inputMode="decimal"
                value={nextText}
                onChange={(e) => {
                  setNextText(e.target.value.replace(/[^\d.]/g, ''));
                  setNextTouched(true);
                }}
                invalid={!!errors.nextMeters}
                suffix={<span className="pr-1.5 text-sm text-slate-400">m</span>}
                className="h-12"
              />
            </Field>
          )}
        </div>
        {allDone && (
          <p className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-[15px] font-medium leading-relaxed text-green-900" aria-live="polite">
            All {formatQty(assigned, 'meters')} are done on this machine, so {jobsheetRefShort(js.orderNo, js.jobsheetNo)} will be marked complete. No new jobsheet is made.
          </p>
        )}
        {completed !== null && !allDone && next !== null && next > 0 && (
          <p className="rounded-xl border border-primary/15 bg-primary-soft/70 px-4 py-3 text-[15px] font-medium leading-relaxed text-slate-800" aria-live="polite">
            {jobsheetRef(js.orderNo, js.jobsheetNo)} will be completed with {formatQty(completed, 'meters')}. A new jobsheet with {formatQty(next, 'meters')} will be created.
          </p>
        )}
      </div>
    </DialogShell>
  );
}

function ChangeMachineDialog(props: { js: RunJobsheet; open: boolean; onOpenChange: (o: boolean) => void }) {
  return props.js.meters !== null ? <ChangeMachineDialogMeters {...props} /> : <ChangeMachineDialogPcs {...props} />;
}

/** Renders the dialog for the current action. Pass `null` to close. */
export function JobsheetRunDialogs({ action, onClose }: { action: RunAction | null; onClose: () => void }) {
  // Keep the last jobsheet while the dialog animates out.
  const [last, setLast] = useState<RunAction | null>(action);
  useEffect(() => {
    if (action) setLast(action);
  }, [action]);
  const a = action ?? last;
  if (!a) return null;
  const key = `${a.kind}-${a.js.id}`;
  const props = { js: a.js, open: action !== null, onOpenChange: (o: boolean) => !o && onClose() };
  if (a.kind === 'start') return <StartDialog key={key} {...props} />;
  if (a.kind === 'complete') return <CompleteDialog key={key} {...props} />;
  return <ChangeMachineDialog key={key} {...props} />;
}
