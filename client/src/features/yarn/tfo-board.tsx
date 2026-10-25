import { Plus, RotateCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  checkTake,
  formatKg,
  parseKgText,
  PROGRAM_STOP_ERROR_TEXT,
  programResultLine,
  runningSectionsText,
  TAKE_ERROR_TEXT,
  TFO_SECTION_LABEL,
  tfoSectionLabel,
  validateProgramStop,
  YARN_ZONE_CONFIG,
  type TfoBoard,
  type TfoBoardMachine,
  type TfoProgram,
  type TfoSection,
  type TwistDirection,
} from '@rivoora/shared';
import { ErrorState } from '@/components/list-parts';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useNow } from '@/hooks/useNow';
import { useRole } from '@/hooks/useRole';
import { ApiError, errorMessage } from '@/lib/api';
import { formatDateTime, formatElapsed } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useStartProgram, useStopProgram, useTfoBoard, useTfoPrograms } from './api';
import { DialogButtons, YarnDialog } from './dialog';
import { actorText, cleanDecimal, Kg, KgInput, numOrNull, QualitySelect, Toggle2 } from './parts';

const ACCENT = YARN_ZONE_CONFIG.tfo.accent;

/* ------------------------------------------------------------------ */
/* the board                                                            */
/* ------------------------------------------------------------------ */

function SectionButton({ machine, section, program, now, onOpen }: { machine: TfoBoardMachine; section: TfoSection; program: TfoProgram | null; now: number; onOpen: () => void }) {
  const label = tfoSectionLabel(machine.machineNo, section);
  if (!program) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="group flex min-h-[76px] w-full flex-col justify-center gap-1 bg-slate-50 px-3 py-2.5 text-left transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
        aria-label={`${label} idle — assign program`}
      >
        <span className="flex items-center gap-2">
          <span className="text-sm font-bold tabular-nums text-slate-500">{label}</span>
          <span className="hidden truncate text-[11px] font-medium uppercase tracking-wide text-slate-400 sm:inline">{TFO_SECTION_LABEL[section]} · idle</span>
        </span>
        <span className="inline-flex items-center gap-1 text-sm font-semibold text-slate-500 group-hover:text-violet-700">
          <Plus className="size-4 shrink-0" aria-hidden />
          <span className="sm:hidden">Assign</span>
          <span className="hidden sm:inline">Assign program</span>
        </span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-[76px] w-full flex-col justify-center gap-0.5 px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
      style={{ backgroundColor: ACCENT.soft }}
      aria-label={`${label} running ${program.outputQuality.name} — open program`}
    >
      <span className="flex items-center gap-2">
        <span className="relative flex size-2.5 shrink-0" aria-hidden>
          <span className="absolute inline-flex size-full animate-ping rounded-full opacity-60" style={{ backgroundColor: ACCENT.solid }} />
          <span className="relative inline-flex size-2.5 rounded-full" style={{ backgroundColor: ACCENT.solid }} />
        </span>
        <span className="text-sm font-bold tabular-nums" style={{ color: ACCENT.text }}>
          {label}
        </span>
        <span className="ml-auto text-xs font-semibold tabular-nums text-slate-500">{formatElapsed(program.startedAt, now)}</span>
      </span>
      <span className="truncate text-sm font-semibold text-slate-900">{program.rawQuality.name}</span>
      <span className="truncate text-xs text-slate-600">
        TPM {program.tpm} · {program.direction} · <Kg g={program.rawG} />
      </span>
    </button>
  );
}

function MachineCard({ machine, now, onSection }: { machine: TfoBoardMachine; now: number; onSection: (m: TfoBoardMachine, s: TfoSection, p: TfoProgram | null) => void }) {
  const running = machine.sections.filter((s) => s.program).length;
  return (
    <div className={cn('overflow-hidden rounded-2xl border bg-white shadow-soft', running ? 'border-violet-200' : 'border-border')}>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-2xl font-extrabold leading-none tabular-nums text-slate-900">{machine.machineNo}</span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-500">{machine.name ?? 'TFO'}</span>
        {running > 0 && (
          <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ backgroundColor: ACCENT.soft, color: ACCENT.text }}>
            {running}/2
          </span>
        )}
      </div>
      <div className="divide-y divide-border">
        {machine.sections.map((s) => (
          <SectionButton key={s.section} machine={machine} section={s.section} program={s.program} now={now} onOpen={() => onSection(machine, s.section, s.program)} />
        ))}
      </div>
    </div>
  );
}

/** The TFO machine board: every active machine as a card split into A (top) and B (bottom). */
export function TfoBoardSection() {
  const board = useTfoBoard();
  const now = useNow(30_000);
  const { can } = useRole();
  const [assign, setAssign] = useState<{ machine: TfoBoardMachine; section: TfoSection } | null>(null);
  const [openProgram, setOpenProgram] = useState<TfoProgram | null>(null);

  return (
    <section className="rounded-2xl border border-border bg-white p-4 shadow-soft md:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 flex-1 truncate text-[15px] font-bold text-slate-800">Machine board</h2>
        {board.data && (
          <span className="rounded-full px-2.5 py-1 text-xs font-semibold" style={{ backgroundColor: ACCENT.soft, color: ACCENT.text }}>
            {runningSectionsText(board.data.runningSections, board.data.machines.length)}
          </span>
        )}
      </div>
      {board.isPending ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-48 rounded-2xl" />
          ))}
        </div>
      ) : board.isError ? (
        <ErrorState error={board.error} onRetry={() => void board.refetch()} />
      ) : board.data.machines.length === 0 ? (
        <EmptyState
          icon={RotateCw}
          title="No active TFO machines"
          description={
            can('canManageYarnMasters') ? (
              <>
                Add them in{' '}
                <Link to="/tfo-machines" className="font-semibold text-primary hover:underline">
                  Masters → TFO machines
                </Link>
                .
              </>
            ) : (
              'Ask the office to add the TFO machines.'
            )
          }
          className="py-8"
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {board.data.machines.map((m) => (
            <MachineCard key={m.id} machine={m} now={now} onSection={(machine, section, p) => (p ? setOpenProgram(p) : setAssign({ machine, section }))} />
          ))}
        </div>
      )}
      <AssignProgramDialog open={!!assign} onOpenChange={(o) => !o && setAssign(null)} target={assign} board={board.data} />
      <ProgramDialog program={openProgram} onOpenChange={(o) => !o && setOpenProgram(null)} />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* assign program                                                       */
/* ------------------------------------------------------------------ */

/**
 * Assign a program to an idle section (side sheet from 1024px). The raw kg leave TFO raw stock now. Opened from a
 * section (machine + section read-only) or from the zone's Run program button (pick an idle section).
 */
export function AssignProgramDialog({
  open,
  onOpenChange,
  target,
  board,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  target: { machine: TfoBoardMachine; section: TfoSection } | null;
  board: TfoBoard | undefined;
}) {
  const start = useStartProgram();
  const [slot, setSlot] = useState<string | null>(null);
  const [rawQualityId, setRawQualityId] = useState<number | null>(null);
  const [outputQualityId, setOutputQualityId] = useState<number | null>(null);
  const [outputTouched, setOutputTouched] = useState(false);
  const [outputName, setOutputName] = useState<string | undefined>();
  const [rawKg, setRawKg] = useState('');
  const [tpm, setTpm] = useState('');
  const [direction, setDirection] = useState<TwistDirection | null>(null);
  const [winding, setWinding] = useState('');
  const [denier, setDenier] = useState('');
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const [serverErr, setServerErr] = useState<{ field: string; message: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setSlot(target ? `${target.machine.id}|${target.section}` : null);
    setRawQualityId(null);
    setOutputQualityId(null);
    setOutputTouched(false);
    setOutputName(undefined);
    setRawKg('');
    setTpm('');
    setDirection(null);
    setWinding('');
    setDenier('');
    setNote('');
    setTried(false);
    setServerErr(null);
  }, [open, target]);

  const idleSlots = useMemo(
    () =>
      (board?.machines ?? []).flatMap((m) =>
        m.sections.filter((s) => !s.program).map((s) => ({ value: `${m.id}|${s.section}`, label: tfoSectionLabel(m.machineNo, s.section), description: `${TFO_SECTION_LABEL[s.section]} section${m.name ? ` · ${m.name}` : ''}` })),
      ),
    [board],
  );
  const [machineId, section] = slot ? [Number(slot.split('|')[0]), slot.split('|')[1] as TfoSection] : [null, null];
  const machine = board?.machines.find((m) => m.id === machineId) ?? target?.machine;
  const stock = (board?.rawStock ?? []).map((s) => ({ id: s.quality.id, name: s.quality.name, availableG: s.rawG }));
  const available = stock.find((s) => s.id === rawQualityId)?.availableG ?? 0;
  const grams = parseKgText(rawKg);
  const takeErr = grams === null ? 'zero' : checkTake(available, grams);
  const errors = {
    slot: !slot ? 'Pick the machine section' : undefined,
    raw: !rawQualityId ? 'Select the raw yarn quality' : undefined,
    rawKg: rawQualityId && takeErr ? (grams === null ? 'Enter the raw yarn kg' : TAKE_ERROR_TEXT[takeErr]) : undefined,
    output: !outputQualityId ? 'Select the output quality' : undefined,
    tpm: !(numOrNull(tpm) && numOrNull(tpm)! > 0) ? 'Enter the TPM' : undefined,
    direction: !direction ? 'Pick S or Z' : undefined,
  };
  const show = (m?: string) => (tried ? m : undefined);
  const server = (f: string) => (serverErr?.field === f ? serverErr.message : undefined);

  const submit = () => {
    setTried(true);
    setServerErr(null);
    if (Object.values(errors).some(Boolean)) return;
    start.mutate(
      {
        machineId: machineId!,
        section: section!,
        rawQualityId: rawQualityId!,
        rawKg: grams! / 1000,
        outputQualityId: outputQualityId!,
        windingMeter: numOrNull(winding),
        denierFilament: denier.trim() || null,
        tpm: Number(tpm),
        direction: direction!,
        note: note.trim() || null,
      },
      {
        onSuccess: (p) => {
          toast.success(`Program started on ${tfoSectionLabel(p.machineNo, p.section)}`);
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
      title={target && machine ? `Assign program · ${tfoSectionLabel(machine.machineNo, target.section)}` : 'Run program'}
      description="The raw yarn kg are taken from TFO raw stock when the program starts."
      busy={start.isPending}
      dirty={!!rawKg || !!tpm}
      footer={<DialogButtons onCancel={() => onOpenChange(false)} busy={start.isPending} label="Start program" form="tfo-assign-form" />}
    >
      <form
        id="tfo-assign-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="grid gap-5"
      >
        {target && machine ? (
          <div className="flex items-center gap-3 rounded-xl px-3 py-2.5" style={{ backgroundColor: ACCENT.soft }}>
            <span className="text-2xl font-extrabold tabular-nums" style={{ color: ACCENT.text }}>
              {tfoSectionLabel(machine.machineNo, target.section)}
            </span>
            <span className="text-sm text-slate-600">
              Machine {machine.machineNo} · {TFO_SECTION_LABEL[target.section]} section
            </span>
          </div>
        ) : (
          <Field label="Machine + section" required error={show(errors.slot) ?? server('section')}>
            <Select value={slot} onChange={setSlot} options={idleSlots} placeholder={idleSlots.length ? 'Pick an idle section' : 'Every section is running'} searchable invalid={tried && !!errors.slot} />
          </Field>
        )}

        <fieldset className="grid gap-4 md:grid-cols-[minmax(0,1fr)_11rem]">
          <legend className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Raw yarn (TFO stock)</legend>
          <Field label="Raw yarn quality" required error={show(errors.raw) ?? server('rawQualityId')}>
            <QualitySelect
              value={rawQualityId}
              onChange={(id) => {
                setRawQualityId(id);
                if (!outputTouched) {
                  setOutputQualityId(id);
                  setOutputName(stock.find((s) => s.id === id)?.name);
                }
              }}
              only={stock}
              invalid={tried && !!errors.raw}
              placeholder={stock.length ? 'Select quality' : 'No raw yarn in TFO'}
            />
          </Field>
          <Field
            label="Raw yarn kg"
            required
            error={show(errors.rawKg) ?? server('rawKg')}
            hint={rawQualityId ? `${formatKg(available)} available` : undefined}
          >
            <KgInput value={rawKg} onValueChange={setRawKg} invalid={tried && !!errors.rawKg} />
          </Field>
        </fieldset>

        <Field label="Output quality" required error={show(errors.output)} hint="The quality the twisted yarn is recorded as (defaults to the raw quality).">
          <QualitySelect
            value={outputQualityId}
            selectedLabel={outputName}
            onChange={(id, q) => {
              setOutputTouched(true);
              setOutputQualityId(id);
              setOutputName(q?.name);
            }}
            invalid={tried && !!errors.output}
          />
        </Field>

        <fieldset className="grid grid-cols-2 gap-4 md:grid-cols-[6.5rem_7rem_minmax(0,1fr)_minmax(0,1fr)]">
          <legend className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Twist settings</legend>
          <Field label="TPM" htmlFor="tfo-tpm" required error={show(errors.tpm)}>
            <Input id="tfo-tpm" inputMode="decimal" autoComplete="off" value={tpm} onChange={(e) => setTpm(cleanDecimal(e.target.value, 1, 6))} invalid={tried && !!errors.tpm} className="text-right tabular-nums" />
          </Field>
          <Field label="Direction" required error={show(errors.direction)}>
            <Toggle2
              value={direction}
              onChange={setDirection}
              options={[
                { value: 'S', label: 'S' },
                { value: 'Z', label: 'Z' },
              ]}
              invalid={tried && !!errors.direction}
            />
          </Field>
          <Field label="Winding meter" htmlFor="tfo-wind">
            <Input id="tfo-wind" inputMode="decimal" autoComplete="off" value={winding} onChange={(e) => setWinding(cleanDecimal(e.target.value, 1, 8))} className="text-right tabular-nums" />
          </Field>
          <Field label="Denier / Filament" htmlFor="tfo-den">
            <Input id="tfo-den" autoComplete="off" maxLength={40} value={denier} onChange={(e) => setDenier(e.target.value)} placeholder="e.g. 75/36" />
          </Field>
        </fieldset>

        <Field label="Note" htmlFor="tfo-note">
          <Textarea id="tfo-note" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} className="min-h-[72px]" />
        </Field>
      </form>
    </YarnDialog>
  );
}

/* ------------------------------------------------------------------ */
/* program: running view + stop + history                               */
/* ------------------------------------------------------------------ */

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <div className="mt-0.5 truncate text-[15px] font-medium text-slate-800">{children}</div>
    </div>
  );
}

/** A running program: its parameters, the Stop form (twisted kg + meters + raw returned) and the section's history. */
export function ProgramDialog({ program, onOpenChange }: { program: TfoProgram | null; onOpenChange: (o: boolean) => void }) {
  const open = !!program;
  const stop = useStopProgram(program?.id ?? 0);
  const history = useTfoPrograms(program?.machineId, program?.section, open);
  const now = useNow(30_000);
  const [twisted, setTwisted] = useState('');
  const [meters, setMeters] = useState('');
  const [returned, setReturned] = useState('');
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const [serverErr, setServerErr] = useState<{ field: string; message: string } | null>(null);
  useEffect(() => {
    if (open) {
      setTwisted('');
      setMeters('');
      setReturned('');
      setNote('');
      setTried(false);
      setServerErr(null);
    }
  }, [open, program?.id]);

  if (!program) return null;
  const label = tfoSectionLabel(program.machineNo, program.section);
  const twistedG = parseKgText(twisted);
  const returnedG = returned.trim() ? parseKgText(returned) : 0;
  const stopErr =
    twistedG === null ? 'Enter the twisted yarn produced' : returnedG === null ? 'Use at most 3 decimals' : validateProgramStop({ rawG: program.rawG, twistedG, returnedG })
      ? PROGRAM_STOP_ERROR_TEXT[validateProgramStop({ rawG: program.rawG, twistedG, returnedG })!]
      : null;
  const submit = () => {
    setTried(true);
    setServerErr(null);
    if (stopErr) return;
    stop.mutate(
      { twistedKg: twistedG! / 1000, twistedMeters: numOrNull(meters), returnedRawKg: (returnedG ?? 0) / 1000, note: note.trim() || null },
      {
        onSuccess: (p) => {
          toast.success(`${label} stopped · ${formatKg(p.twistedG ?? 0)} twisted yarn added to TFO`);
          onOpenChange(false);
        },
        onError: (err) => {
          if (err instanceof ApiError && err.field) setServerErr({ field: err.field, message: err.message });
          toast.error(errorMessage(err));
        },
      },
    );
  };
  const past = (history.data?.items ?? []).filter((p) => p.status === 'completed');

  return (
    <YarnDialog
      open={open}
      onOpenChange={onOpenChange}
      layout="wide"
      title={`Program · ${label}`}
      description={`Running for ${formatElapsed(program.startedAt, now)} · started ${formatDateTime(program.startedAt)}${actorText(program.startedBy) ? ` by ${actorText(program.startedBy)}` : ''}`}
      busy={stop.isPending}
      dirty={!!twisted || !!returned}
      footer={<DialogButtons onCancel={() => onOpenChange(false)} busy={stop.isPending} label="Stop program" form="tfo-stop-form" />}
    >
      <div className="grid gap-5">
        <div className="grid grid-cols-2 gap-4 rounded-xl p-4 md:grid-cols-4" style={{ backgroundColor: ACCENT.soft }}>
          <Fact label="Raw quality">{program.rawQuality.name}</Fact>
          <Fact label="Raw issued">
            <Kg g={program.rawG} />
          </Fact>
          <Fact label="Output quality">{program.outputQuality.name}</Fact>
          <Fact label="TPM · direction">
            {program.tpm} · {program.direction}
          </Fact>
          <Fact label="Winding meter">{program.windingMeter?.toLocaleString('en-IN') ?? '—'}</Fact>
          <Fact label="Denier / Filament">{program.denierFilament ?? '—'}</Fact>
          {program.note && (
            <div className="col-span-2">
              <Fact label="Note">{program.note}</Fact>
            </div>
          )}
        </div>

        <form
          id="tfo-stop-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="grid gap-4"
        >
          <h3 className="text-sm font-bold text-slate-800">Stop the program</h3>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <Field
              label="Twisted yarn produced"
              required
              error={(tried && stopErr && stopErr !== PROGRAM_STOP_ERROR_TEXT.returned_too_much ? stopErr : undefined) ?? (serverErr?.field === 'twistedKg' ? serverErr.message : undefined)}
            >
              <KgInput value={twisted} onValueChange={setTwisted} autoFocus invalid={tried && !!stopErr && stopErr !== PROGRAM_STOP_ERROR_TEXT.returned_too_much} />
            </Field>
            <Field label="Meters" htmlFor="tfo-m">
              <Input id="tfo-m" inputMode="decimal" autoComplete="off" value={meters} onChange={(e) => setMeters(cleanDecimal(e.target.value, 2, 9))} className="text-right tabular-nums" />
            </Field>
            <Field
              label="Raw yarn returned"
              error={(tried && stopErr === PROGRAM_STOP_ERROR_TEXT.returned_too_much ? stopErr : undefined) ?? (serverErr?.field === 'returnedRawKg' ? serverErr.message : undefined)}
              hint="Goes back to TFO raw stock"
              className="col-span-2 md:col-span-1"
            >
              <KgInput value={returned} onValueChange={setReturned} invalid={tried && stopErr === PROGRAM_STOP_ERROR_TEXT.returned_too_much} />
            </Field>
          </div>
          {twistedG !== null && (
            <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">{programResultLine({ rawG: program.rawG, twistedG, returnedG: returnedG ?? 0 })}</p>
          )}
          <Field label="Note" htmlFor="tfo-stop-note">
            <Textarea id="tfo-stop-note" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} className="min-h-[64px]" />
          </Field>
        </form>

        <div>
          <h3 className="mb-2 text-sm font-bold text-slate-800">History of {label}</h3>
          {history.isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : past.length === 0 ? (
            <p className="text-sm text-slate-500">No earlier programs on this section.</p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {past.map((p) => (
                <li key={p.id} className="px-3 py-2.5 text-sm">
                  <p className="font-semibold text-slate-800">
                    {p.rawQuality.name} → {p.outputQuality.name}
                    <span className="ml-2 font-normal text-slate-500">
                      TPM {p.tpm} · {p.direction}
                    </span>
                  </p>
                  <p className="text-slate-600">{programResultLine({ rawG: p.rawG, twistedG: p.twistedG, returnedG: p.returnedRawG })}</p>
                  <p className="text-xs text-slate-400">
                    {formatDateTime(p.startedAt)} – {formatDateTime(p.stoppedAt)}
                    {actorText(p.stoppedBy) ? ` · stopped by ${actorText(p.stoppedBy)}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </YarnDialog>
  );
}

