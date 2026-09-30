import { Info, Minus, Plus } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  changeMachineSummary,
  completedFramesNote,
  nextFramesAfterCompletedChange,
  nextFramesMax,
  remainingFrames,
  type JobsheetMachine,
  type JobsheetStatusKey,
  type MachineRef,
} from '@rivoora/shared';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { ImageThumb } from '@/components/ui/image-thumb';
import { ResponsiveModal } from '@/components/ui/modal';
import { Select, type SelectOption } from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { printUrl, useChangeMachine, useCompleteJobsheet, useMachineView, useStartJobsheet } from './api';
import { machineLabel } from './parts';

/** What the dialogs need to know about a jobsheet (from the supervisor list or the details page). */
export interface RunJobsheet {
  id: number;
  jobsheetNo: number;
  status: JobsheetStatusKey;
  frames: number;
  machines: JobsheetMachine[];
  runningMachine: MachineRef | null;
  suggestedMachineId: number | null;
  designCode: string | null;
  thumbUrl: string | null;
}

export type RunAction = { kind: 'start' | 'complete' | 'change'; js: RunJobsheet };

const fr = (n: number) => `${n} frame${n === 1 ? '' : 's'}`;

/** Ongoing jobsheet numbers per machine id (from the machine board), for the "busy" hints. */
function useBusyMachines() {
  const view = useMachineView();
  return useMemo(() => {
    const map = new Map<number, number[]>();
    for (const m of [...(view.data?.machines ?? []), ...(view.data?.inactive ?? [])]) {
      if (m.ongoing.length) map.set(m.id, m.ongoing.map((j) => j.jobsheetNo));
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
        <p className="text-lg font-bold leading-tight text-slate-900">Jobsheet {js.jobsheetNo}</p>
        <p className="truncate text-sm text-slate-500">
          {js.designCode ? `Design ${js.designCode}` : 'No design'} · {fr(js.frames)}
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Start                                                                */
/* ------------------------------------------------------------------ */

function StartDialog({ js, open, onOpenChange }: { js: RunJobsheet; open: boolean; onOpenChange: (o: boolean) => void }) {
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
          toast.success(`Jobsheet ${res.jobsheetNo} started on Machine ${res.machineNo}`);
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
      title={`Start jobsheet ${js.jobsheetNo}`}
      busy={start.isPending}
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)} disabled={start.isPending}>
            Cancel
          </Button>
          <Button size="lg" onClick={submit} disabled={!machineId} loading={start.isPending}>
            Start
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
                const running = (busy.get(m.id) ?? []).filter((n) => n !== js.jobsheetNo);
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
                        busy · {running.join(', ')}
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
  const complete = useCompleteJobsheet();
  const [text, setText] = useState(String(js.frames));
  const [error, setError] = useState<string | null>(null);
  const value = /^\d+$/.test(text.trim()) ? Number(text.trim()) : null;
  const note = value !== null ? completedFramesNote(js.frames, value) : null;
  const step = (d: number) => setText(String(Math.max(0, (value ?? 0) + d)));

  const submit = () => {
    if (value === null) {
      setError('Enter the frames completed (0 or more).');
      return;
    }
    setError(null);
    complete.mutate(
      { id: js.id, completedFrames: value },
      {
        onSuccess: (res) => {
          toast.success(`Jobsheet ${res.jobsheetNo} completed (${fr(value)})`);
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
      title={`Complete jobsheet ${js.jobsheetNo}`}
      description={`${js.runningMachine ? `Machine ${js.runningMachine.machineNo} · ` : ''}${fr(js.frames)} assigned`}
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
        <Field label="Frames completed" htmlFor="complete-frames" required error={error ?? undefined}>
          <div className="flex items-stretch gap-2">
            <Button
              variant="secondary"
              className="size-14 shrink-0 p-0 [&_svg]:size-6"
              onClick={() => step(-1)}
              disabled={value === 0 || complete.isPending}
              aria-label="One frame less"
            >
              <Minus />
            </Button>
            <input
              id="complete-frames"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={text}
              onChange={(e) => setText(e.target.value.replace(/[^\d]/g, ''))}
              aria-invalid={!!error || undefined}
              className="h-14 min-w-0 flex-1 rounded-[10px] border border-input bg-slate-50/60 text-center text-2xl font-bold tabular-nums text-slate-900 focus:border-primary focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/15"
            />
            <Button
              variant="secondary"
              className="size-14 shrink-0 p-0 [&_svg]:size-6"
              onClick={() => step(1)}
              disabled={complete.isPending}
              aria-label="One frame more"
            >
              <Plus />
            </Button>
          </div>
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

function ChangeMachineDialog({ js, open, onOpenChange }: { js: RunJobsheet; open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const change = useChangeMachine();
  const { busy, active, isPending, isError } = useBusyMachines();
  const current = js.runningMachine;
  const [newMachineId, setNewMachineId] = useState<number | null>(null);
  const [completed, setCompleted] = useState<number | null>(null);
  const [next, setNext] = useState(() => remainingFrames(js.frames, 0));
  const [nextTouched, setNextTouched] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // "Frames to make next" follows the remaining frames until the user picks it.
  useEffect(() => {
    setNext((n) => nextFramesAfterCompletedChange({ assigned: js.frames, completed: completed ?? 0, current: n, touched: nextTouched }));
  }, [completed, js.frames, nextTouched]);

  const machineOptions = useMemo<SelectOption<number>[]>(
    () =>
      active
        .filter((m) => m.id !== current?.id)
        .map((m) => {
          const running = busy.get(m.id);
          return { value: m.id, label: machineLabel(m), description: running ? `Busy · jobsheet ${running.join(', ')}` : null };
        }),
    [active, busy, current?.id],
  );
  const completedOptions = useMemo<SelectOption<number>[]>(
    () => Array.from({ length: js.frames + 1 }, (_, i) => ({ value: i, label: fr(i) })),
    [js.frames],
  );
  const nextOptions = useMemo<SelectOption<number>[]>(
    () => Array.from({ length: nextFramesMax(js.frames) }, (_, i) => ({ value: i + 1, label: fr(i + 1) })),
    [js.frames],
  );
  const newMachine = active.find((m) => m.id === newMachineId) ?? null;
  const ready = newMachineId !== null && completed !== null && next >= 1;

  const submit = () => {
    if (!ready) return;
    setErrors({});
    change.mutate(
      { id: js.id, newMachineId, completedFrames: completed, nextFrames: next },
      {
        onSuccess: (res) => {
          toast.success(
            `Jobsheet ${res.completed.jobsheetNo} completed (${fr(res.completed.frames)}). New jobsheet ${res.created.jobsheetNo} (${fr(res.created.frames)}) is waiting to start.`,
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
      title={`Change machine — Jobsheet ${js.jobsheetNo}`}
      description={`Currently on ${current ? `Machine ${current.machineNo}` : 'no machine'} · ${fr(js.frames)} assigned`}
      busy={change.isPending}
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)} disabled={change.isPending}>
            Cancel
          </Button>
          <Button size="lg" onClick={submit} disabled={!ready} loading={change.isPending}>
            Confirm
          </Button>
        </>
      }
    >
      <div className="grid gap-5">
        <Field label="New machine" htmlFor="cm-machine" required error={errors.newMachineId}>
          <Select
            id="cm-machine"
            value={newMachineId}
            onChange={(v) => setNewMachineId(v)}
            options={machineOptions}
            placeholder="Select the new machine"
            searchable
            searchPlaceholder="Search machine number or name…"
            loading={isPending}
            emptyText={isError ? "Couldn't load machines" : 'No other active machines'}
            invalid={!!errors.newMachineId}
            triggerClassName="h-12"
          />
        </Field>
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
              onChange={(v) => setCompleted(v)}
              options={completedOptions}
              placeholder="Select"
              invalid={!!errors.completedFrames}
              triggerClassName="h-12"
            />
          </Field>
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
        </div>
        {completed !== null && (
          <p className="rounded-xl border border-primary/15 bg-primary-soft/70 px-4 py-3 text-[15px] font-medium leading-relaxed text-slate-800" aria-live="polite">
            {changeMachineSummary({ jobsheetNo: js.jobsheetNo, completed, next, newMachineNo: newMachine?.machineNo ?? null })}
          </p>
        )}
      </div>
    </DialogShell>
  );
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
