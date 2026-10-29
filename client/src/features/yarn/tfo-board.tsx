import { Ban, LayoutGrid, Pencil, Play, Plus, RotateCw, Square, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  checkTake,
  formatKg,
  MAX_PENDING_PROGRAMS,
  NO_LOT_LABEL,
  parseKgText,
  runningSectionsText,
  TAKE_ERROR_TEXT,
  TFO_SECTION_LABEL,
  tfoSectionLabel,
  TWIST_DIRECTION_LABEL,
  TWIST_DIRECTIONS,
  YARN_ZONE_CONFIG,
  type TfoBoard,
  type TfoBoardMachine,
  type TfoPendingProgram,
  type TfoPendingProgramInput,
  type TfoProgram,
  type TfoSection,
  type TwistDirection,
} from '@rivoora/shared';
import { ErrorState } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { useNow } from '@/hooks/useNow';
import { useRole } from '@/hooks/useRole';
import { ApiError, errorMessage } from '@/lib/api';
import { formatDateTime, formatElapsed } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useCancelPendingProgram, useCreatePendingPrograms, useStartPendingProgram, useTfoBoard, useUpdatePendingProgram } from './api';
import { DialogButtons, YarnDialog } from './dialog';
import { actorText, cleanDecimal, Kg, KgInput, LotSelect, numOrNull, Pill, QualitySelect, Toggle2 } from './parts';
import { StopProgramDialog } from './tfo-stop';

/**
 * Sprint 20 — TFO programs: Pending → Running → Completed.
 * - `TfoProgramsSection` (TFO zone screen): Running | Pending lists with Stop / Start · Edit · Cancel, "New programs"
 *   (owners) and the full-screen Machine view.
 * - Create many programs at once (rows), each reserving raw kg on a lot; edit / cancel while pending.
 * - Start = pick an idle section on tappable machine tiles; Stop = `StopProgramDialog` (boxes).
 */

const ACCENT = YARN_ZONE_CONFIG.tfo.accent;
const DIRECTION_OPTIONS = TWIST_DIRECTIONS.map((d) => ({ value: d, label: TWIST_DIRECTION_LABEL[d] }));
const lotText = (lot: { lotNo: string } | null) => (lot ? `Lot ${lot.lotNo}` : NO_LOT_LABEL);

/* ------------------------------------------------------------------ */
/* program form rows (create many / edit one)                           */
/* ------------------------------------------------------------------ */

interface ProgramRow {
  key: number;
  rawQualityId: number | null;
  /** null = not picked yet, 0 = "No lot". */
  lotId: number | null;
  /** What the picked lot has free (from the lot picker). */
  lotAvailableG: number;
  rawKg: string;
  outputQualityId: number | null;
  outputName?: string;
  outputTouched: boolean;
  tpm: string;
  direction: TwistDirection | null;
  winding: string;
  denier: string;
  note: string;
}
let rowKey = 0;
const emptyRow = (): ProgramRow => ({
  key: ++rowKey,
  rawQualityId: null,
  lotId: null,
  lotAvailableG: 0,
  rawKg: '',
  outputQualityId: null,
  outputTouched: false,
  tpm: '',
  direction: null,
  winding: '',
  denier: '',
  note: '',
});
/** "Add another": a new row with the previous row's quality / settings (not its lot / kg / note). */
const copyRow = (r: ProgramRow): ProgramRow => ({ ...emptyRow(), rawQualityId: r.rawQualityId, outputQualityId: r.outputQualityId, outputName: r.outputName, outputTouched: r.outputTouched, tpm: r.tpm, direction: r.direction, winding: r.winding, denier: r.denier });
const rowFromPending = (p: TfoPendingProgram): ProgramRow => ({
  key: ++rowKey,
  rawQualityId: p.rawQuality.id,
  lotId: p.lot?.id ?? 0,
  lotAvailableG: 0,
  rawKg: String(p.rawG / 1000),
  outputQualityId: p.outputQuality.id,
  outputName: p.outputQuality.name,
  outputTouched: true,
  tpm: String(p.tpm),
  direction: p.direction,
  winding: p.windingMeter != null ? String(p.windingMeter) : '',
  denier: p.denierFilament ?? '',
  note: p.note ?? '',
});
const toInput = (r: ProgramRow): TfoPendingProgramInput => ({
  rawQualityId: r.rawQualityId!,
  lotId: r.lotId ? r.lotId : null,
  rawKg: parseKgText(r.rawKg)! / 1000,
  outputQualityId: r.outputQualityId!,
  windingMeter: numOrNull(r.winding),
  denierFilament: r.denier.trim() || null,
  tpm: Number(r.tpm),
  direction: r.direction!,
  note: r.note.trim() || null,
});

type RowErrors = Partial<Record<'raw' | 'lot' | 'rawKg' | 'output' | 'tpm' | 'direction', string>>;

/** Row errors; kg of rows on the same lot add up against what that lot has free. */
function rowErrors(rows: ProgramRow[]): RowErrors[] {
  const used = new Map<string, number>();
  return rows.map((r) => {
    const e: RowErrors = {};
    if (!r.rawQualityId) e.raw = 'Select the raw yarn quality';
    if (r.lotId === null) e.lot = 'Pick the lot (or No lot)';
    const g = parseKgText(r.rawKg);
    if (g === null || g <= 0) e.rawKg = 'Enter the raw yarn kg';
    else if (r.rawQualityId && r.lotId !== null) {
      const k = `${r.rawQualityId}|${r.lotId}`;
      const total = (used.get(k) ?? 0) + g;
      used.set(k, total);
      const err = checkTake(r.lotAvailableG, total);
      if (err) e.rawKg = err === 'not_enough' ? `Only ${formatKg(r.lotAvailableG)} free on this lot` : TAKE_ERROR_TEXT[err];
    }
    if (!r.outputQualityId) e.output = 'Select the output quality';
    if (!(numOrNull(r.tpm) && numOrNull(r.tpm)! > 0)) e.tpm = 'Enter the TPM';
    if (!r.direction) e.direction = 'Pick S, Z or S + Z';
    return e;
  });
}

function ProgramFields({
  row,
  set,
  errors,
  stock,
  own,
  idPrefix,
}: {
  row: ProgramRow;
  set: (patch: Partial<ProgramRow>) => void;
  errors?: RowErrors;
  stock: { id: number; name: string; availableG: number }[];
  own?: { lotId: number | null; g: number };
  idPrefix: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-4 md:grid-cols-3 md:gap-x-4">
      <Field label="Raw quality" required error={errors?.raw} className="col-span-2 md:col-span-1">
        <QualitySelect
          value={row.rawQualityId}
          onChange={(id) => {
            const name = stock.find((s) => s.id === id)?.name;
            set({ rawQualityId: id, lotId: null, lotAvailableG: 0, ...(row.outputTouched ? {} : { outputQualityId: id, outputName: name }) });
          }}
          only={stock}
          invalid={!!errors?.raw}
          placeholder={stock.length ? 'Select quality' : 'No raw yarn in TFO'}
        />
      </Field>
      <Field label="Lot" required error={errors?.lot}>
        <LotSelect zone="tfo" qualityId={row.rawQualityId} value={row.lotId ?? -1} onChange={(lotId, availableG) => set({ lotId, lotAvailableG: availableG })} invalid={!!errors?.lot} own={own} />
      </Field>
      <Field label="Raw kg" required error={errors?.rawKg} hint={row.lotId !== null ? `${formatKg(row.lotAvailableG)} free` : undefined}>
        <KgInput value={row.rawKg} onValueChange={(v) => set({ rawKg: v })} invalid={!!errors?.rawKg} aria-label="Raw kg" />
      </Field>
      <Field label="Output quality" required error={errors?.output} className="col-span-2 md:col-span-1">
        <QualitySelect
          value={row.outputQualityId}
          selectedLabel={row.outputName}
          onChange={(id, q) => set({ outputTouched: true, outputQualityId: id, outputName: q?.name })}
          invalid={!!errors?.output}
        />
      </Field>
      <Field label="TPM" htmlFor={`${idPrefix}-tpm`} required error={errors?.tpm}>
        <Input
          id={`${idPrefix}-tpm`}
          inputMode="decimal"
          autoComplete="off"
          value={row.tpm}
          onChange={(e) => set({ tpm: cleanDecimal(e.target.value, 1, 6) })}
          invalid={!!errors?.tpm}
          className="text-right tabular-nums"
        />
      </Field>
      <Field label="Direction" required error={errors?.direction}>
        <Toggle2 value={row.direction} onChange={(d) => set({ direction: d })} options={DIRECTION_OPTIONS} invalid={!!errors?.direction} />
      </Field>
      <Field label="Winding meter" htmlFor={`${idPrefix}-wind`}>
        <Input id={`${idPrefix}-wind`} inputMode="decimal" autoComplete="off" value={row.winding} onChange={(e) => set({ winding: cleanDecimal(e.target.value, 1, 8) })} className="text-right tabular-nums" />
      </Field>
      <Field label="Denier / Filament" htmlFor={`${idPrefix}-den`}>
        <Input id={`${idPrefix}-den`} autoComplete="off" maxLength={40} value={row.denier} onChange={(e) => set({ denier: e.target.value })} placeholder="e.g. 75/36" />
      </Field>
      <Field label="Note" htmlFor={`${idPrefix}-note`} className="col-span-2 md:col-span-1">
        <Input id={`${idPrefix}-note`} autoComplete="off" maxLength={1000} value={row.note} onChange={(e) => set({ note: e.target.value })} />
      </Field>
    </div>
  );
}

const rawStockOf = (board: TfoBoard | undefined) => (board?.rawStock ?? []).map((s) => ({ id: s.quality.id, name: s.quality.name, availableG: s.availableG }));

function onFieldError(setServerErr: (m: string | null) => void) {
  return (err: unknown) => {
    if (err instanceof ApiError && err.field) setServerErr(err.message);
    toast.error(errorMessage(err));
  };
}

/** New programs (owners): one or more rows, each reserving raw kg on its lot. Wide dialog / full screen on phones. */
export function CreateProgramsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const board = useTfoBoard();
  const create = useCreatePendingPrograms();
  const [rows, setRows] = useState<ProgramRow[]>(() => [emptyRow()]);
  const [tried, setTried] = useState(false);
  const [serverErr, setServerErr] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setRows([emptyRow()]);
      setTried(false);
      setServerErr(null);
    }
  }, [open]);
  const stock = rawStockOf(board.data);
  const errors = rowErrors(rows);
  const set = (key: number, patch: Partial<ProgramRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const totalG = rows.reduce((s, r) => s + (parseKgText(r.rawKg) ?? 0), 0);

  const submit = () => {
    setTried(true);
    setServerErr(null);
    if (errors.some((e) => Object.keys(e).length)) return;
    create.mutate(
      { programs: rows.map(toInput) },
      {
        onSuccess: (list) => {
          toast.success(`${list.length} program${list.length === 1 ? '' : 's'} added to Pending · ${formatKg(totalG)} reserved`);
          onOpenChange(false);
        },
        onError: onFieldError(setServerErr),
      },
    );
  };

  return (
    <YarnDialog
      open={open}
      onOpenChange={onOpenChange}
      layout="wide"
      title="New TFO programs"
      description="Each program reserves its raw kg on the lot until someone starts it on a machine."
      busy={create.isPending}
      dirty={rows.some((r) => r.rawKg || r.tpm)}
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          <p className="mr-auto text-sm text-slate-600">
            {rows.length} program{rows.length === 1 ? '' : 's'} · <Kg g={totalG} className="font-semibold" />
          </p>
          <DialogButtons onCancel={() => onOpenChange(false)} busy={create.isPending} label={rows.length > 1 ? `Add ${rows.length} programs` : 'Add program'} form="tfo-create-form" />
        </div>
      }
    >
      <form
        id="tfo-create-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="grid gap-4"
      >
        {serverErr && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{serverErr}</p>}
        {rows.map((r, i) => (
          <fieldset key={r.key} className="rounded-2xl border border-border p-3 md:p-4">
            <div className="mb-3 flex items-center gap-2">
              <legend className="contents">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-bold" style={{ backgroundColor: ACCENT.soft, color: ACCENT.text }}>
                  {i + 1}
                </span>
                <span className="text-sm font-bold text-slate-800">Program {i + 1}</span>
              </legend>
              {rows.length > 1 && (
                <Button variant="ghost" size="icon" className="ml-auto text-slate-500" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label={`Remove program ${i + 1}`}>
                  <Trash2 className="!size-4" />
                </Button>
              )}
            </div>
            <ProgramFields row={r} set={(p) => set(r.key, p)} errors={tried ? errors[i] : undefined} stock={stock} idPrefix={`tfo-c${r.key}`} />
          </fieldset>
        ))}
        {rows.length < MAX_PENDING_PROGRAMS && (
          <Button variant="secondary" className="justify-self-start" onClick={() => setRows((rs) => [...rs, copyRow(rs[rs.length - 1])])}>
            <Plus /> Add another
          </Button>
        )}
      </form>
    </YarnDialog>
  );
}

/** Edit a pending program (owners + the floor): the reservation follows the new quality / lot / kg. */
function EditPendingDialog({ program, onOpenChange }: { program: TfoPendingProgram | null; onOpenChange: (o: boolean) => void }) {
  const board = useTfoBoard();
  const update = useUpdatePendingProgram(program?.id ?? 0);
  const [row, setRow] = useState<ProgramRow>(emptyRow);
  const [tried, setTried] = useState(false);
  const [serverErr, setServerErr] = useState<string | null>(null);
  useEffect(() => {
    if (program) {
      setRow(rowFromPending(program));
      setTried(false);
      setServerErr(null);
    }
  }, [program]);
  if (!program) return null;
  // The program's own reservation counts as free for itself.
  const stock = rawStockOf(board.data).map((s) => (s.id === program.rawQuality.id ? { ...s, availableG: s.availableG + program.rawG } : s));
  const own = { lotId: program.lot?.id ?? null, g: program.rawG };
  // Until the lot picker reports, the original lot has at least its own kg free.
  const r = row.lotAvailableG === 0 && row.lotId === (program.lot?.id ?? 0) && row.rawQualityId === program.rawQuality.id ? { ...row, lotAvailableG: program.rawG } : row;
  const errors = rowErrors([r])[0];
  const submit = () => {
    setTried(true);
    setServerErr(null);
    if (Object.keys(errors).length) return;
    update.mutate(toInput(r), {
      onSuccess: () => {
        toast.success('Program updated');
        onOpenChange(false);
      },
      onError: onFieldError(setServerErr),
    });
  };
  return (
    <YarnDialog
      open
      onOpenChange={onOpenChange}
      layout="wide"
      title="Edit pending program"
      busy={update.isPending}
      dirty
      footer={<DialogButtons onCancel={() => onOpenChange(false)} busy={update.isPending} label="Save" form="tfo-edit-form" />}
    >
      <form
        id="tfo-edit-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="grid gap-4"
      >
        {serverErr && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{serverErr}</p>}
        <ProgramFields row={r} set={(p) => setRow((x) => ({ ...x, ...p }))} errors={tried ? errors : undefined} stock={stock} own={own} idPrefix="tfo-e" />
      </form>
    </YarnDialog>
  );
}

/* ------------------------------------------------------------------ */
/* start: machine / section tiles                                       */
/* ------------------------------------------------------------------ */

function SectionTile({ machine, section, program, selected, onPick }: { machine: TfoBoardMachine; section: TfoSection; program: TfoProgram | null; selected: boolean; onPick: () => void }) {
  const label = tfoSectionLabel(machine.machineNo, section);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={!!program}
      onClick={onPick}
      className={cn(
        'flex min-h-[64px] w-full flex-col justify-center px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40',
        program ? 'cursor-not-allowed bg-slate-100 text-slate-400' : selected ? 'text-white' : 'bg-white hover:bg-violet-50',
      )}
      style={selected ? { backgroundColor: ACCENT.solid } : undefined}
      aria-label={program ? `${label} running` : `${label} idle`}
    >
      <span className="text-lg font-extrabold tabular-nums">{label}</span>
      <span className={cn('truncate text-xs font-medium', selected ? 'text-white/90' : 'text-slate-500')}>{program ? `Running · ${program.rawQuality.name}` : `${TFO_SECTION_LABEL[section]} · idle`}</span>
    </button>
  );
}

/** Start a pending program: tap an idle section (machines as cards, A on top, B below). */
function StartProgramDialog({ program, onOpenChange }: { program: TfoPendingProgram | null; onOpenChange: (o: boolean) => void }) {
  const board = useTfoBoard();
  const start = useStartPendingProgram();
  const [slot, setSlot] = useState<{ machineId: number; section: TfoSection } | null>(null);
  useEffect(() => setSlot(null), [program]);
  if (!program) return null;
  const machines = board.data?.machines ?? [];
  const submit = () => {
    if (!slot) return;
    start.mutate(
      { id: program.id, data: slot },
      {
        onSuccess: (p) => {
          toast.success(`Program started on ${tfoSectionLabel(p.machineNo, p.section)} · ${formatKg(p.rawG)} issued`);
          onOpenChange(false);
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  };
  return (
    <YarnDialog
      open
      onOpenChange={onOpenChange}
      layout="wide"
      title="Start program"
      description={`${program.rawQuality.name} · ${lotText(program.lot)} · ${formatKg(program.rawG)} · TPM ${program.tpm} · ${TWIST_DIRECTION_LABEL[program.direction]}`}
      busy={start.isPending}
      footer={<DialogButtons onCancel={() => onOpenChange(false)} busy={start.isPending} label={slot ? `Start on ${tfoSectionLabel(machines.find((m) => m.id === slot.machineId)?.machineNo ?? 0, slot.section)}` : 'Pick a section'} disabled={!slot} form="tfo-start-form" />}
    >
      <form
        id="tfo-start-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <p className="mb-3 text-sm text-slate-600">The raw kg leave TFO stock when the program starts.</p>
        {board.isPending ? (
          <Skeleton className="h-40 w-full rounded-2xl" />
        ) : machines.length === 0 ? (
          <EmptyState icon={RotateCw} title="No active TFO machines" className="py-8" />
        ) : (
          <div role="radiogroup" aria-label="Machine section" className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {machines.map((m) => (
              <div key={m.id} className="overflow-hidden rounded-xl border border-border">
                <p className="truncate border-b border-border bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-500">Machine {m.machineNo}{m.name ? ` · ${m.name}` : ''}</p>
                <div className="divide-y divide-border">
                  {m.sections.map((s) => (
                    <SectionTile key={s.section} machine={m} section={s.section} program={s.program} selected={slot?.machineId === m.id && slot.section === s.section} onPick={() => setSlot({ machineId: m.id, section: s.section })} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </form>
    </YarnDialog>
  );
}

/** From the Machine view: an idle section was tapped — pick one of the pending programs to start there. */
function PickPendingDialog({ target, onOpenChange, onCreate }: { target: { machine: TfoBoardMachine; section: TfoSection } | null; onOpenChange: (o: boolean) => void; onCreate?: () => void }) {
  const board = useTfoBoard();
  const start = useStartPendingProgram();
  const [picked, setPicked] = useState<number | null>(null);
  useEffect(() => setPicked(null), [target]);
  if (!target) return null;
  const label = tfoSectionLabel(target.machine.machineNo, target.section);
  const pending = board.data?.pending ?? [];
  const submit = () => {
    if (!picked) return;
    start.mutate(
      { id: picked, data: { machineId: target.machine.id, section: target.section } },
      {
        onSuccess: () => {
          toast.success(`Program started on ${label}`);
          onOpenChange(false);
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  };
  return (
    <YarnDialog
      open
      onOpenChange={onOpenChange}
      title={`Start on ${label}`}
      description={`Machine ${target.machine.machineNo} · ${TFO_SECTION_LABEL[target.section]} section`}
      busy={start.isPending}
      footer={<DialogButtons onCancel={() => onOpenChange(false)} busy={start.isPending} label="Start program" disabled={!picked} form="tfo-pick-form" />}
    >
      <form
        id="tfo-pick-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {pending.length === 0 ? (
          <EmptyState
            icon={RotateCw}
            title="No pending programs"
            description="Programs are created by the office and wait here until they start."
            action={onCreate && <Button onClick={onCreate}>New programs</Button>}
            className="py-8"
          />
        ) : (
          <ul role="radiogroup" aria-label="Pending program" className="grid gap-2">
            {pending.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={picked === p.id}
                  onClick={() => setPicked(p.id)}
                  className={cn('w-full rounded-xl border-2 px-3.5 py-3 text-left transition-colors', picked === p.id ? 'shadow-sm' : 'border-input bg-white hover:bg-muted')}
                  style={picked === p.id ? { borderColor: ACCENT.solid, backgroundColor: ACCENT.soft } : undefined}
                >
                  <p className="flex items-baseline gap-2">
                    <span className="truncate font-semibold text-slate-900">{p.rawQuality.name}</span>
                    <Kg g={p.rawG} className="ml-auto font-bold" />
                  </p>
                  <p className="truncate text-sm text-slate-600">
                    {lotText(p.lot)} · TPM {p.tpm} · {TWIST_DIRECTION_LABEL[p.direction]} → {p.outputQuality.name}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </form>
    </YarnDialog>
  );
}

/* ------------------------------------------------------------------ */
/* lists                                                                */
/* ------------------------------------------------------------------ */

function RunningRow({ p, now, onStop }: { p: TfoProgram; now: number; onStop: () => void }) {
  return (
    <li className="grid grid-cols-[3.75rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-white p-3 md:grid-cols-[4.5rem_minmax(0,1fr)_9.5rem_auto]">
      <span className="flex h-12 items-center justify-center rounded-lg text-xl font-extrabold tabular-nums" style={{ backgroundColor: ACCENT.soft, color: ACCENT.text }}>
        {tfoSectionLabel(p.machineNo, p.section)}
      </span>
      <div className="min-w-0">
        <p className="truncate font-semibold text-slate-900">
          {p.rawQuality.name} <span className="font-normal text-slate-400">→</span> {p.outputQuality.name}
        </p>
        <p className="truncate text-sm text-slate-600">
          {lotText(p.lot)} · TPM {p.tpm} · {TWIST_DIRECTION_LABEL[p.direction]}
        </p>
      </div>
      <p className="col-start-2 min-w-0 text-sm text-slate-600 md:col-start-auto">
        <Kg g={p.rawG} className="font-semibold text-slate-900" />
        <span className="block truncate text-xs text-slate-500">
          {formatElapsed(p.startedAt, now)} ago{actorText(p.startedBy) ? ` · ${actorText(p.startedBy)}` : ''}
        </span>
      </p>
      <Button onClick={onStop} className="col-span-2 md:col-span-1">
        <Square /> Stop
      </Button>
    </li>
  );
}

function PendingRow({ p, onStart, onEdit, onCancel }: { p: TfoPendingProgram; onStart: () => void; onEdit: () => void; onCancel: () => void }) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-white p-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <p className="truncate font-semibold text-slate-900">
          {p.rawQuality.name} <span className="font-normal text-slate-400">→</span> {p.outputQuality.name}
        </p>
        <p className="truncate text-sm text-slate-600">
          {lotText(p.lot)} · TPM {p.tpm} · {TWIST_DIRECTION_LABEL[p.direction]}
          {p.note ? ` · ${p.note}` : ''}
        </p>
      </div>
      <p className="text-right text-sm md:text-left">
        <Kg g={p.rawG} className="font-semibold text-slate-900" />
        <span className="block text-xs text-slate-500">
          {formatDateTime(p.createdAt)}
          {actorText(p.createdBy) ? ` · ${actorText(p.createdBy)}` : ''}
        </span>
      </p>
      <div className="col-span-2 flex gap-2 md:col-span-1">
        <Button onClick={onStart} className="flex-1 md:flex-none">
          <Play /> Start
        </Button>
        <Button variant="secondary" size="icon" onClick={onEdit} aria-label="Edit program" title="Edit">
          <Pencil className="!size-4" />
        </Button>
        <Button variant="secondary" size="icon" onClick={onCancel} aria-label="Cancel program" title="Cancel program" className="text-rose-700">
          <Ban className="!size-4" />
        </Button>
      </div>
    </li>
  );
}

/** The TFO zone's programs: Running | Pending, New programs (owners) and the Machine view. */
export function TfoProgramsSection() {
  const board = useTfoBoard();
  const now = useNow(30_000);
  const { can } = useRole();
  const [tab, setTab] = useState<'running' | 'pending'>('running');
  const [creating, setCreating] = useState(false);
  const [machineView, setMachineView] = useState(false);
  const [stopFor, setStopFor] = useState<TfoProgram | null>(null);
  const [startFor, setStartFor] = useState<TfoPendingProgram | null>(null);
  const [editFor, setEditFor] = useState<TfoPendingProgram | null>(null);
  const [cancelFor, setCancelFor] = useState<TfoPendingProgram | null>(null);
  const cancel = useCancelPendingProgram();
  const running = useMemo(
    () =>
      (board.data?.machines ?? [])
        .flatMap((m) => m.sections.map((s) => s.program))
        .filter((p): p is TfoProgram => !!p)
        .sort((a, b) => a.machineNo - b.machineNo || a.section.localeCompare(b.section)),
    [board.data],
  );
  const pending = board.data?.pending ?? [];

  return (
    <section className="rounded-2xl border border-border bg-white p-4 shadow-soft md:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto min-w-0 truncate text-[15px] font-bold text-slate-800">Programs</h2>
        <Pill on={tab === 'running'} onClick={() => setTab('running')}>
          Running {board.data ? `(${running.length})` : ''}
        </Pill>
        <Pill on={tab === 'pending'} onClick={() => setTab('pending')}>
          Pending {board.data ? `(${pending.length})` : ''}
        </Pill>
        <div className="flex w-full gap-2 sm:w-auto">
          <Button variant="secondary" onClick={() => setMachineView(true)} className="flex-1 sm:flex-none">
            <LayoutGrid /> Machine view
          </Button>
          {can('canPlanYarn') && (
            <Button onClick={() => setCreating(true)} className="flex-1 text-white hover:opacity-90 sm:flex-none" style={{ backgroundColor: ACCENT.solid }}>
              <Plus /> New programs
            </Button>
          )}
        </div>
      </div>
      {board.isPending ? (
        <Skeleton className="h-24 w-full rounded-xl" />
      ) : board.isError ? (
        <ErrorState error={board.error} onRetry={() => void board.refetch()} />
      ) : tab === 'running' ? (
        running.length === 0 ? (
          <EmptyState icon={RotateCw} title="Nothing running" description={pending.length ? `${pending.length} program${pending.length === 1 ? '' : 's'} waiting in Pending.` : 'Start a pending program on a machine section.'} className="py-8" />
        ) : (
          <ul className="grid gap-2.5 2xl:grid-cols-2">
            {running.map((p) => (
              <RunningRow key={p.id} p={p} now={now} onStop={() => setStopFor(p)} />
            ))}
          </ul>
        )
      ) : pending.length === 0 ? (
        <EmptyState
          icon={RotateCw}
          title="No pending programs"
          description="New programs wait here (their raw kg reserved) until someone starts them."
          action={can('canPlanYarn') && <Button onClick={() => setCreating(true)}>New programs</Button>}
          className="py-8"
        />
      ) : (
        <ul className="grid gap-2.5 2xl:grid-cols-2">
          {pending.map((p) => (
            <PendingRow key={p.id} p={p} onStart={() => setStartFor(p)} onEdit={() => setEditFor(p)} onCancel={() => setCancelFor(p)} />
          ))}
        </ul>
      )}

      <CreateProgramsDialog open={creating} onOpenChange={setCreating} />
      <EditPendingDialog program={editFor} onOpenChange={(o) => !o && setEditFor(null)} />
      <StartProgramDialog program={startFor} onOpenChange={(o) => !o && setStartFor(null)} />
      <StopProgramDialog program={stopFor} onOpenChange={(o) => !o && setStopFor(null)} />
      <MachineViewDialog open={machineView} onOpenChange={setMachineView} onCreate={can('canPlanYarn') ? () => setCreating(true) : undefined} />
      <ConfirmDialog
        open={!!cancelFor}
        onOpenChange={(o) => !o && setCancelFor(null)}
        title="Cancel this program?"
        description={cancelFor ? `${cancelFor.rawQuality.name} · ${lotText(cancelFor.lot)} · ${formatKg(cancelFor.rawG)} — the reserved kg become free again.` : undefined}
        confirmLabel="Cancel program"
        cancelLabel="Keep"
        destructive
        loading={cancel.isPending}
        onConfirm={() =>
          cancelFor &&
          cancel.mutate(cancelFor.id, {
            onSuccess: () => {
              toast.success('Program cancelled');
              setCancelFor(null);
            },
            onError: (err) => toast.error(errorMessage(err)),
          })
        }
      />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Machine view (full screen)                                           */
/* ------------------------------------------------------------------ */

function BoardSection({ machine, section, program, now, onOpen }: { machine: TfoBoardMachine; section: TfoSection; program: TfoProgram | null; now: number; onOpen: () => void }) {
  const label = tfoSectionLabel(machine.machineNo, section);
  if (!program) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="group flex min-h-[84px] w-full flex-col justify-center gap-1 bg-slate-50 px-3 py-2.5 text-left transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
        aria-label={`${label} idle — start a pending program`}
      >
        <span className="flex items-center gap-2">
          <span className="text-base font-bold tabular-nums text-slate-500">{label}</span>
          <span className="truncate text-[11px] font-medium uppercase tracking-wide text-slate-400">{TFO_SECTION_LABEL[section]} · idle</span>
        </span>
        <span className="inline-flex items-center gap-1 text-sm font-semibold text-slate-500 group-hover:text-violet-700">
          <Play className="size-4 shrink-0" aria-hidden /> Start
        </span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-[84px] w-full flex-col justify-center gap-0.5 px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
      style={{ backgroundColor: ACCENT.soft }}
      aria-label={`${label} running ${program.rawQuality.name} — stop`}
    >
      <span className="flex items-center gap-2">
        <span className="relative flex size-2.5 shrink-0" aria-hidden>
          <span className="absolute inline-flex size-full animate-ping rounded-full opacity-60" style={{ backgroundColor: ACCENT.solid }} />
          <span className="relative inline-flex size-2.5 rounded-full" style={{ backgroundColor: ACCENT.solid }} />
        </span>
        <span className="text-base font-bold tabular-nums" style={{ color: ACCENT.text }}>
          {label}
        </span>
        <span className="ml-auto text-xs font-semibold tabular-nums text-slate-500">{formatElapsed(program.startedAt, now)}</span>
      </span>
      <span className="truncate text-sm font-semibold text-slate-900">{program.rawQuality.name}</span>
      <span className="truncate text-xs text-slate-600">
        {lotText(program.lot)} · <Kg g={program.rawG} />
      </span>
    </button>
  );
}

/** Every active machine as a card split A (top) / B (bottom). Tap running → Stop; tap idle → start a pending program there. */
export function MachineViewDialog({ open, onOpenChange, onCreate }: { open: boolean; onOpenChange: (o: boolean) => void; onCreate?: () => void }) {
  const board = useTfoBoard();
  const now = useNow(30_000);
  const { can } = useRole();
  const [stopFor, setStopFor] = useState<TfoProgram | null>(null);
  const [startAt, setStartAt] = useState<{ machine: TfoBoardMachine; section: TfoSection } | null>(null);
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      variant="fullscreen"
      size="xl"
      title="TFO machine view"
      description={board.data ? `${runningSectionsText(board.data.runningSections, board.data.machines.length)} · ${board.data.pending.length} pending` : undefined}
      bodyClassName="md:px-6"
    >
      <div className="mb-4 flex flex-wrap items-center gap-4 text-xs font-medium text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded" style={{ backgroundColor: ACCENT.solid }} aria-hidden /> Running — tap to stop
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded border border-slate-300 bg-slate-50" aria-hidden /> Idle — tap to start a pending program
        </span>
      </div>
      {board.isPending ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {Array.from({ length: 8 }, (_, i) => (
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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {board.data.machines.map((m) => {
            const runningHere = m.sections.filter((s) => s.program).length;
            return (
              <div key={m.id} className={cn('overflow-hidden rounded-2xl border bg-white shadow-soft', runningHere ? 'border-violet-200' : 'border-border')}>
                <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                  <span className="text-2xl font-extrabold leading-none tabular-nums text-slate-900">{m.machineNo}</span>
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-500">{m.name ?? 'TFO'}</span>
                  {runningHere > 0 && (
                    <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ backgroundColor: ACCENT.soft, color: ACCENT.text }}>
                      {runningHere}/2
                    </span>
                  )}
                </div>
                <div className="divide-y divide-border">
                  {m.sections.map((s) => (
                    <BoardSection key={s.section} machine={m} section={s.section} program={s.program} now={now} onOpen={() => (s.program ? setStopFor(s.program) : setStartAt({ machine: m, section: s.section }))} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <StopProgramDialog program={stopFor} onOpenChange={(o) => !o && setStopFor(null)} />
      <PickPendingDialog
        target={startAt}
        onOpenChange={(o) => !o && setStartAt(null)}
        onCreate={
          onCreate &&
          (() => {
            setStartAt(null);
            onOpenChange(false);
            onCreate();
          })
        }
      />
    </Modal>
  );
}
