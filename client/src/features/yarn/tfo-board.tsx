import { Ban, PackageCheck, Pause, Pencil, Play, Plus, RotateCw, Square, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  checkHoldRolls,
  checkStartRolls,
  checkTake,
  formatKg,
  HOLD_ROLLS_ERROR_TEXT,
  holdRollsText,
  REASON_MAX,
  REASON_MIN,
  tfoProgramLabel,
  MAX_PENDING_PROGRAMS,
  NO_LOT_LABEL,
  parseKgText,
  programSectionsLabel,
  rawFromRolls,
  runningSectionsText,
  START_ROLLS_ERROR_TEXT,
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
  type TwistDirection, kgText, gramsToKg,
} from '@rivoora/shared';
import { ErrorState } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { useNow } from '@/hooks/useNow';
import { useRole } from '@/hooks/useRole';
import { ApiError, errorMessage } from '@/lib/api';
import { formatDateTime, formatElapsed } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useCancelPendingProgram, useCreatePendingPrograms, useHoldProgram, useResumeProgram, useStartPendingProgram, useTfoBoard, useUpdatePendingProgram } from './api';
import { DialogButtons, YarnDialog } from './dialog';
import { actorText, cleanDecimal, Kg, KgInput, LotSelect, numOrNull, QualitySelect, Toggle2 } from './parts';
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
  rolls: string;
  /** Winding kg (per roll). */
  winding: string;
  tpm: string;
  direction: TwistDirection | null;
  denier: string;
  note: string;
}
let rowKey = 0;
const emptyRow = (): ProgramRow => ({ key: ++rowKey, rawQualityId: null, lotId: null, lotAvailableG: 0, rolls: '', winding: '', tpm: '', direction: null, denier: '', note: '' });
/** "Add another": a new row with the previous row's quality / settings (not its lot / rolls / note). */
const copyRow = (r: ProgramRow): ProgramRow => ({ ...emptyRow(), rawQualityId: r.rawQualityId, winding: r.winding, tpm: r.tpm, direction: r.direction, denier: r.denier });
const rowFromPending = (p: TfoPendingProgram): ProgramRow => ({
  key: ++rowKey,
  rawQualityId: p.rawQuality.id,
  lotId: p.lot?.id ?? 0,
  lotAvailableG: 0,
  // Programs created before Sprint 20b have no rolls / winding kg: start them as 1 roll of the raw kg.
  rolls: String(p.rolls ?? 1),
  winding: kgText(p.windingG ?? p.rawG),
  tpm: String(p.tpm),
  direction: p.direction,
  denier: p.denierFilament ?? '',
  note: p.note ?? '',
});
/** Raw kg of a row = rolls × winding kg (units); 0 while either is missing. */
const rowRawG = (r: ProgramRow) => rawFromRolls(Number(r.rolls), parseKgText(r.winding) ?? 0);
const toInput = (r: ProgramRow): TfoPendingProgramInput => ({
  rawQualityId: r.rawQualityId!,
  lotId: r.lotId ? r.lotId : null,
  rolls: Number(r.rolls),
  windingKg: gramsToKg(parseKgText(r.winding)!),
  denierFilament: r.denier.trim() || null,
  tpm: Number(r.tpm),
  direction: r.direction!,
  note: r.note.trim() || null,
});

type RowErrors = Partial<Record<'raw' | 'lot' | 'rolls' | 'winding' | 'rawKg' | 'tpm' | 'direction', string>>;

/** Row errors; raw kg (rolls × winding kg) of rows on the same lot add up against what that lot has free. */
function rowErrors(rows: ProgramRow[]): RowErrors[] {
  const used = new Map<string, number>();
  return rows.map((r) => {
    const e: RowErrors = {};
    if (!r.rawQualityId) e.raw = 'Select the raw yarn quality';
    if (r.lotId === null) e.lot = 'Pick the lot (or No lot)';
    if (!(Number.isInteger(Number(r.rolls)) && Number(r.rolls) >= 1)) e.rolls = 'Enter the rolls';
    if (!((parseKgText(r.winding) ?? 0) > 0)) e.winding = 'Enter the winding kg';
    const g = rowRawG(r);
    if (g > 0 && r.rawQualityId && r.lotId !== null) {
      const k = `${r.rawQualityId}|${r.lotId}`;
      const total = (used.get(k) ?? 0) + g;
      used.set(k, total);
      const err = checkTake(r.lotAvailableG, total);
      if (err) e.rawKg = err === 'not_enough' ? `Only ${formatKg(r.lotAvailableG)} free on this lot` : TAKE_ERROR_TEXT[err];
    }
    if (!(numOrNull(r.tpm) && numOrNull(r.tpm)! > 0)) e.tpm = 'Enter the TPM';
    if (!r.direction) e.direction = 'Pick S, Z or S + Z';
    return e;
  });
}

/**
 * One program's fields, in the order they are filled: raw quality · lot · rolls · winding kg → raw kg (calculated) ·
 * TPM · direction · denier / filament · note. 2 columns on phones, 3 from 768px.
 */
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
  own?: { lotId: number | null; g: number }[];
  idPrefix: string;
}) {
  const rawG = rowRawG(row);
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-4 md:grid-cols-3 md:gap-x-4">
      <Field label="Raw quality" required error={errors?.raw} className="col-span-2 md:col-span-1">
        <QualitySelect
          value={row.rawQualityId}
          onChange={(id) => set({ rawQualityId: id, lotId: null, lotAvailableG: 0 })}
          only={stock}
          invalid={!!errors?.raw}
          placeholder={stock.length ? 'Select quality' : 'No raw yarn in TFO'}
        />
      </Field>
      <Field label="Lot" required error={errors?.lot} className="col-span-2 md:col-span-1">
        <LotSelect zone="tfo" qualityId={row.rawQualityId} value={row.lotId ?? -1} onChange={(lotId, availableG) => set({ lotId, lotAvailableG: availableG })} invalid={!!errors?.lot} own={own} />
      </Field>
      <Field label="Rolls" htmlFor={`${idPrefix}-rolls`} required error={errors?.rolls}>
        <Input
          id={`${idPrefix}-rolls`}
          inputMode="numeric"
          autoComplete="off"
          value={row.rolls}
          onChange={(e) => set({ rolls: cleanDecimal(e.target.value, 0, 7) })}
          invalid={!!errors?.rolls}
          className="text-right tabular-nums"
        />
      </Field>
      <Field label="Winding kg" required error={errors?.winding}>
        <KgInput value={row.winding} onValueChange={(v) => set({ winding: v })} invalid={!!errors?.winding} aria-label="Winding kg" />
      </Field>
      <Field label="Raw kg" error={errors?.rawKg} hint={row.lotId !== null ? `Rolls × winding kg · ${formatKg(row.lotAvailableG)} free` : 'Rolls × winding kg'} className="col-span-2 md:col-span-1">
        <div
          className={cn('flex h-11 items-center justify-end rounded-[10px] border bg-slate-50 px-3 text-right font-semibold tabular-nums', errors?.rawKg ? 'border-destructive text-destructive' : 'border-input text-slate-900')}
          aria-live="polite"
          aria-label="Raw kg (calculated)"
        >
          {rawG > 0 ? formatKg(rawG) : <span className="font-normal text-slate-400">—</span>}
        </div>
      </Field>
      <Field label="TPM" htmlFor={`${idPrefix}-tpm`} required error={errors?.tpm}>
        <Input
          id={`${idPrefix}-tpm`}
          inputMode="decimal"
          autoComplete="off"
          value={row.tpm}
          onChange={(e) => set({ tpm: cleanDecimal(e.target.value, 4, 6) })}
          invalid={!!errors?.tpm}
          className="text-right tabular-nums"
        />
      </Field>
      <Field label="Direction" required error={errors?.direction}>
        <Toggle2 value={row.direction} onChange={(d) => set({ direction: d })} options={DIRECTION_OPTIONS} invalid={!!errors?.direction} />
      </Field>
      <Field label="Denier / Filament" htmlFor={`${idPrefix}-den`}>
        <Input id={`${idPrefix}-den`} autoComplete="off" maxLength={40} value={row.denier} onChange={(e) => set({ denier: e.target.value })} placeholder="e.g. 75/36" />
      </Field>
      <Field label="Note" htmlFor={`${idPrefix}-note`} className="col-span-2 md:col-span-3">
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
  const totalG = rows.reduce((s, r) => s + rowRawG(r), 0);

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
      dirty={rows.some((r) => r.rolls || r.tpm)}
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
  const own = [{ lotId: program.lot?.id ?? null, g: program.rawG }];
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
      role="checkbox"
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

/**
 * Start a pending program: tap one or more idle sections — any machines, both sections of one machine too (machines as
 * cards, A on top, B below). The program runs on all of them and is stopped once.
 */
function StartProgramDialog({ program, onOpenChange }: { program: TfoPendingProgram | null; onOpenChange: (o: boolean) => void }) {
  const board = useTfoBoard();
  const start = useStartPendingProgram();
  const [picked, setPicked] = useState<{ machineId: number; section: TfoSection }[]>([]);
  /** Sprint 20c: rolls to start now ('' = all) — the rest stays pending. */
  const [rollsText, setRollsText] = useState('');
  useEffect(() => {
    setPicked([]);
    setRollsText(program?.rolls != null ? String(program.rolls) : '');
  }, [program]);
  if (!program) return null;
  const canSplit = program.rolls !== null && program.windingG !== null;
  const startRolls = canSplit ? numOrNull(rollsText) : null;
  const rollsErr = canSplit ? (startRolls === null ? 'Enter the rolls to start' : checkStartRolls(program.rolls, startRolls) ? START_ROLLS_ERROR_TEXT[checkStartRolls(program.rolls, startRolls)!] : null) : null;
  const restRolls = canSplit && startRolls !== null && !rollsErr ? program.rolls! - startRolls : 0;
  const startRawG = canSplit && startRolls !== null && !rollsErr ? rawFromRolls(startRolls, program.windingG!) : program.rawG;
  const machines = board.data?.machines ?? [];
  const isPicked = (machineId: number, section: TfoSection) => picked.some((x) => x.machineId === machineId && x.section === section);
  const toggle = (machineId: number, section: TfoSection) =>
    setPicked((xs) => (isPicked(machineId, section) ? xs.filter((x) => !(x.machineId === machineId && x.section === section)) : [...xs, { machineId, section }]));
  const pickedLabel = programSectionsLabel(picked.map((x) => ({ machineNo: machines.find((m) => m.id === x.machineId)?.machineNo ?? 0, section: x.section })));
  const submit = () => {
    if (!picked.length || rollsErr) return;
    start.mutate(
      { id: program.id, data: { sections: picked, rolls: restRolls > 0 ? startRolls : null } },
      {
        onSuccess: (p) => {
          toast.success(`Program started on ${programSectionsLabel(p.sections)} · ${formatKg(p.rawG)} issued${restRolls > 0 ? ` · ${restRolls} roll${restRolls === 1 ? '' : 's'} stay pending` : ''}`);
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
      description={`${program.rawQuality.name} · ${lotText(program.lot)} · ${formatKg(program.rawG)}${program.rolls !== null ? ` (${program.rolls} rolls)` : ''} · TPM ${program.tpm} · ${TWIST_DIRECTION_LABEL[program.direction]}`}
      busy={start.isPending}
      footer={<DialogButtons onCancel={() => onOpenChange(false)} busy={start.isPending} label={picked.length ? `Start on ${pickedLabel}` : 'Pick sections'} disabled={!picked.length || !!rollsErr} form="tfo-start-form" />}
    >
      <form
        id="tfo-start-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {canSplit && (
          <div className="mb-4 grid gap-3 rounded-xl border border-border bg-slate-50 p-3 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-end">
            <Field label="Rolls to start now" required error={rollsErr ?? undefined} htmlFor="tfo-start-rolls">
              <Input
                id="tfo-start-rolls"
                inputMode="numeric"
                autoComplete="off"
                value={rollsText}
                onChange={(e) => setRollsText(cleanDecimal(e.target.value, 0, 6))}
                className="text-right tabular-nums"
                invalid={!!rollsErr}
              />
            </Field>
            <p className="pb-2.5 text-sm text-slate-600">
              of {program.rolls} rolls · <Kg g={startRawG} className="font-semibold text-slate-900" /> issued now
              {restRolls > 0 && (
                <span className="block font-medium text-amber-800">
                  {restRolls} roll{restRolls === 1 ? '' : 's'} (<Kg g={rawFromRolls(restRolls, program.windingG!)} />) stay pending — start them later.
                </span>
              )}
            </p>
          </div>
        )}
        <p className="mb-3 text-sm text-slate-600">Tap one or more idle sections (any machines). The raw kg leave TFO stock when the program starts.</p>
        <SectionPicker loading={board.isPending} machines={machines} isPicked={isPicked} onToggle={toggle} />
      </form>
    </YarnDialog>
  );
}

/** Machines as cards (A on top, B below); idle sections are tappable (Start, Resume). */
function SectionPicker({
  loading,
  machines,
  isPicked,
  onToggle,
}: {
  loading: boolean;
  machines: TfoBoardMachine[];
  isPicked: (machineId: number, section: TfoSection) => boolean;
  onToggle: (machineId: number, section: TfoSection) => void;
}) {
  if (loading) return <Skeleton className="h-40 w-full rounded-2xl" />;
  if (machines.length === 0) return <EmptyState icon={RotateCw} title="No active TFO machines" className="py-8" />;
  return (
    <div role="group" aria-label="Machine sections" className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {machines.map((m) => (
        <div key={m.id} className="overflow-hidden rounded-xl border border-border">
          <p className="truncate border-b border-border bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-500">
            Machine {m.machineNo}
            {m.name ? ` · ${m.name}` : ''}
          </p>
          <div className="divide-y divide-border">
            {m.sections.map((s) => (
              <SectionTile key={s.section} machine={m} section={s.section} program={s.program} selected={isPicked(m.id, s.section)} onPick={() => onToggle(m.id, s.section)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Sprint 24 (CR-20) — Resume a held program on idle sections (any machines, like Start). */
function ResumeProgramDialog({ program, onOpenChange }: { program: TfoProgram | null; onOpenChange: (o: boolean) => void }) {
  const board = useTfoBoard();
  const resume = useResumeProgram();
  const [picked, setPicked] = useState<{ machineId: number; section: TfoSection }[]>([]);
  useEffect(() => setPicked([]), [program]);
  if (!program) return null;
  const machines = board.data?.machines ?? [];
  const isPicked = (machineId: number, section: TfoSection) => picked.some((x) => x.machineId === machineId && x.section === section);
  const toggle = (machineId: number, section: TfoSection) =>
    setPicked((xs) => (isPicked(machineId, section) ? xs.filter((x) => !(x.machineId === machineId && x.section === section)) : [...xs, { machineId, section }]));
  const pickedLabel = programSectionsLabel(picked.map((x) => ({ machineNo: machines.find((m) => m.id === x.machineId)?.machineNo ?? 0, section: x.section })));
  const rolls = holdRollsText(program);
  const submit = () => {
    if (!picked.length) return;
    resume.mutate(
      { id: program.id, data: { sections: picked } },
      {
        onSuccess: (p) => {
          toast.success(`${tfoProgramLabel(p.id)} running again on ${programSectionsLabel(p.sections)}`);
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
      title={`Resume ${tfoProgramLabel(program.id)}`}
      description={`${program.rawQuality.name} · ${lotText(program.lot)} · TPM ${program.tpm} · ${TWIST_DIRECTION_LABEL[program.direction]}${rolls ? ` · ${rolls}` : ''}`}
      busy={resume.isPending}
      footer={<DialogButtons onCancel={() => onOpenChange(false)} busy={resume.isPending} label={picked.length ? `Resume on ${pickedLabel}` : 'Pick sections'} disabled={!picked.length} form="tfo-resume-form" />}
    >
      <form
        id="tfo-resume-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <p className="mb-3 text-sm text-slate-600">Tap one or more idle sections (any machines) to run the rolls left.</p>
        <SectionPicker loading={board.isPending} machines={machines} isPicked={isPicked} onToggle={toggle} />
      </form>
    </YarnDialog>
  );
}

/**
 * Sprint 24 (CR-20) — Hold a running program: rolls made (so far) + rolls left (prefilled = started − made, editable;
 * made + left = started), optional reason (3–300 characters). The sections become idle.
 */
function HoldProgramDialog({ program, onOpenChange }: { program: TfoProgram | null; onOpenChange: (o: boolean) => void }) {
  const hold = useHoldProgram(program?.id ?? 0);
  const [made, setMade] = useState('');
  const [left, setLeft] = useState('');
  const [leftTouched, setLeftTouched] = useState(false);
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const [serverErr, setServerErr] = useState<{ field: string; message: string } | null>(null);
  useEffect(() => {
    setMade('');
    setLeft('');
    setLeftTouched(false);
    setReason('');
    setTried(false);
    setServerErr(null);
  }, [program]);
  if (!program) return null;
  const hasRolls = program.rolls !== null;
  const madeN = numOrNull(made);
  const leftN = leftTouched ? numOrNull(left) : madeN !== null && hasRolls ? program.rolls! - madeN : null;
  const rollsErr = !hasRolls
    ? null
    : madeN === null
      ? 'Enter the rolls made'
      : leftN === null
        ? 'Enter the rolls left'
        : checkHoldRolls({ started: program.rolls!, done: program.rollsDone, made: madeN, left: leftN })
          ? HOLD_ROLLS_ERROR_TEXT[checkHoldRolls({ started: program.rolls!, done: program.rollsDone, made: madeN, left: leftN })!]
          : null;
  const reasonErr = reason.trim() && reason.trim().length < REASON_MIN ? `Write at least ${REASON_MIN} characters` : null;
  const label = programSectionsLabel(program.sections);
  const submit = () => {
    setTried(true);
    setServerErr(null);
    if (rollsErr || reasonErr) return;
    hold.mutate(
      { rollsMade: hasRolls ? madeN : null, rollsLeft: hasRolls ? leftN : null, reason: reason.trim() || null },
      {
        onSuccess: (p) => {
          toast.success(`${tfoProgramLabel(p.id)} on hold${holdRollsText(p) ? ` · ${holdRollsText(p)}` : ''} · ${label} free`);
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
      open
      onOpenChange={onOpenChange}
      title={`Hold ${tfoProgramLabel(program.id)} · ${label}`}
      description={`${program.rawQuality.name} · ${formatKg(program.rawG)} issued${program.rolls ? ` · ${program.rolls} rolls started` : ''}. Its sections become free; resume it later on any idle sections.`}
      busy={hold.isPending}
      dirty={!!made || !!reason}
      footer={<DialogButtons onCancel={() => onOpenChange(false)} busy={hold.isPending} label="Put on hold" form="tfo-hold-form" />}
    >
      <form
        id="tfo-hold-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="grid gap-4"
      >
        {hasRolls ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Field label="Rolls made" htmlFor="hold-made" required error={tried && (madeN === null || rollsErr?.includes('made')) ? (rollsErr ?? undefined) : serverErr?.field === 'rollsMade' ? serverErr.message : undefined}>
              <Input id="hold-made" inputMode="numeric" autoFocus autoComplete="off" value={made} onChange={(e) => setMade(cleanDecimal(e.target.value, 0, 6))} invalid={tried && !!rollsErr} className="h-12 text-right text-lg tabular-nums" />
            </Field>
            <Field label="Rolls left" htmlFor="hold-left" required error={tried && rollsErr && !rollsErr.includes('made') ? rollsErr : serverErr?.field === 'rollsLeft' ? serverErr.message : undefined}>
              <Input
                id="hold-left"
                inputMode="numeric"
                autoComplete="off"
                value={leftTouched ? left : leftN !== null ? String(leftN) : ''}
                onChange={(e) => {
                  setLeftTouched(true);
                  setLeft(cleanDecimal(e.target.value, 0, 6));
                }}
                invalid={tried && !!rollsErr}
                className="h-12 text-right text-lg tabular-nums"
              />
            </Field>
            <p className="col-span-2 self-center text-sm text-slate-600 md:col-span-1">
              of <b className="tabular-nums text-slate-900">{program.rolls}</b> rolls started
              {program.rollsDone ? <span className="block text-xs text-slate-500">{program.rollsDone} already in boxes</span> : null}
            </p>
          </div>
        ) : (
          <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">This older program has no rolls — it is put on hold as it is.</p>
        )}
        <Field label="Reason" htmlFor="hold-reason" hint={`Optional · ${REASON_MIN}–${REASON_MAX} characters`} error={tried && reasonErr ? reasonErr : undefined}>
          <Textarea id="hold-reason" rows={2} maxLength={REASON_MAX} value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-[64px]" />
        </Field>
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
      { id: picked, data: { sections: [{ machineId: target.machine.id, section: target.section }] } },
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
                    {lotText(p.lot)} · TPM {p.tpm} · {TWIST_DIRECTION_LABEL[p.direction]}
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

/** Sprint 24 — the actions of a running / held / box-pending program (list rows and the Machine view). */
export type ProgramAction = 'stop' | 'hold' | 'part' | 'resume' | 'boxes';

function RunningRow({ p, now, onAction }: { p: TfoProgram; now: number; onAction: (a: ProgramAction) => void }) {
  return (
    <li className="grid grid-cols-[3.75rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-white p-3 md:grid-cols-[4.5rem_minmax(0,1fr)_9.5rem] xl:grid-cols-[4.5rem_minmax(0,1fr)_9.5rem_auto]">
      <span
        className="flex min-h-12 items-center justify-center rounded-lg px-1 text-center font-extrabold leading-tight tabular-nums"
        style={{ backgroundColor: ACCENT.soft, color: ACCENT.text, fontSize: p.sections.length > 2 ? '0.8rem' : p.sections.length > 1 ? '0.95rem' : '1.25rem' }}
      >
        {programSectionsLabel(p.sections)}
      </span>
      <div className="min-w-0">
        <p className="truncate font-semibold text-slate-900">{p.rawQuality.name}</p>
        <p className="truncate text-sm text-slate-600">
          {lotText(p.lot)} · TPM {p.tpm} · {TWIST_DIRECTION_LABEL[p.direction]}
          {p.rolls && p.windingG ? ` · ${p.rolls} rolls × ${formatKg(p.windingG)}` : ''}
        </p>
      </div>
      <p className="col-start-2 min-w-0 text-sm text-slate-600 md:col-start-auto">
        <Kg g={p.rawG} className="font-semibold text-slate-900" />
        <span className="block truncate text-xs text-slate-500">
          {formatElapsed(p.startedAt, now)} ago{actorText(p.startedBy) ? ` · ${actorText(p.startedBy)}` : ''}
          {p.rollsDone ? ` · ${p.rollsDone} rolls in boxes` : ''}
        </span>
      </p>
      <div className="col-span-2 grid grid-cols-3 gap-2 md:col-span-3 xl:col-span-1 xl:flex">
        <Button variant="secondary" className="min-h-12" onClick={() => onAction('hold')}>
          <Pause /> Hold
        </Button>
        <Button variant="secondary" className="min-h-12" onClick={() => onAction('part')}>
          <PackageCheck /> <span className="truncate">Made part</span>
        </Button>
        <Button className="min-h-12" onClick={() => onAction('stop')}>
          <Square /> Stop
        </Button>
      </div>
    </li>
  );
}

/** Sprint 24 (CR-20) — a program on hold: "6 / 12 rolls made · 6 left", Resume · Complete made part · Stop. */
function OnHoldCard({ p, onAction }: { p: TfoProgram; onAction: (a: ProgramAction) => void }) {
  const rolls = holdRollsText(p);
  const hold = [...p.events].reverse().find((e) => e.kind === 'hold');
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-white p-3">
      <div className="flex items-start gap-3">
        <span className="flex min-h-12 min-w-14 items-center justify-center rounded-lg bg-amber-50 px-2 text-sm font-extrabold tabular-nums text-amber-800">{tfoProgramLabel(p.id)}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-slate-900">{p.rawQuality.name}</p>
          <p className="truncate text-sm text-slate-600">
            {lotText(p.lot)} · TPM {p.tpm} · {TWIST_DIRECTION_LABEL[p.direction]} · <Kg g={p.rawG} /> issued
          </p>
          <p className="truncate text-sm font-semibold text-amber-800">{rolls ?? 'On hold'}</p>
          <p className="truncate text-xs text-slate-500">
            Held {formatDateTime(p.heldAt)}
            {hold?.sections ? ` · was on ${hold.sections}` : ''}
            {hold?.note ? ` · ${hold.note}` : ''}
            {p.rollsDone ? ` · ${p.rollsDone} rolls in boxes` : ''}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Button className="min-h-12" onClick={() => onAction('resume')}>
          <Play /> Resume
        </Button>
        <Button variant="secondary" className="min-h-12" onClick={() => onAction('part')}>
          <PackageCheck /> <span className="truncate">Made part</span>
        </Button>
        <Button variant="secondary" className="min-h-12" onClick={() => onAction('stop')}>
          <Square /> Stop
        </Button>
      </div>
    </li>
  );
}

/** Sprint 24 (CR-21) — stopped, boxes not entered yet: "300 kg issued · boxes pending" → Enter boxes. */
function BoxPendingCard({ p, onAction }: { p: TfoProgram; onAction: (a: ProgramAction) => void }) {
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-sky-200 bg-white p-3">
      <div className="flex items-start gap-3">
        <span className="flex min-h-12 min-w-14 items-center justify-center rounded-lg bg-sky-50 px-2 text-sm font-extrabold tabular-nums text-sky-800">{tfoProgramLabel(p.id)}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-slate-900">{p.rawQuality.name}</p>
          <p className="truncate text-sm font-semibold text-sky-800">
            <Kg g={p.rawG} /> issued · boxes pending
          </p>
          <p className="truncate text-xs text-slate-500">
            Stopped {formatDateTime(p.stoppedAt)}
            {actorText(p.stoppedBy) ? ` by ${actorText(p.stoppedBy)}` : ''} · {lotText(p.lot)} · TPM {p.tpm} · {TWIST_DIRECTION_LABEL[p.direction]}
            {p.rollsDone ? ` · ${p.rollsDone} rolls already in boxes` : ''}
          </p>
        </div>
      </div>
      <Button className="min-h-12" onClick={() => onAction('boxes')}>
        <PackageCheck /> Enter boxes
      </Button>
    </li>
  );
}

/** Opens the dialog of a program action (shared by the lists and the Machine view). */
export function ProgramActionDialogs({ target, onClose }: { target: { program: TfoProgram; action: ProgramAction } | null; onClose: () => void }) {
  const close = (o: boolean) => !o && onClose();
  const p = target?.program ?? null;
  const a = target?.action;
  return (
    <>
      <StopProgramDialog program={a === 'stop' || a === 'part' || a === 'boxes' ? p : null} mode={a === 'part' ? 'part' : a === 'boxes' ? 'boxes' : 'stop'} onOpenChange={close} />
      <HoldProgramDialog program={a === 'hold' ? p : null} onOpenChange={close} />
      <ResumeProgramDialog program={a === 'resume' ? p : null} onOpenChange={close} />
    </>
  );
}

function PendingRow({ p, onStart, onEdit, onCancel }: { p: TfoPendingProgram; onStart: () => void; onEdit: () => void; onCancel: () => void }) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-white p-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <p className="truncate font-semibold text-slate-900">{p.rawQuality.name}</p>
        <p className="truncate text-sm text-slate-600">
          {lotText(p.lot)} · TPM {p.tpm} · {TWIST_DIRECTION_LABEL[p.direction]}
          {p.rolls && p.windingG ? ` · ${p.rolls} rolls × ${formatKg(p.windingG)}` : ''}
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

export type TfoTab = 'running' | 'on_hold' | 'box_pending' | 'pending';

/**
 * The TFO zone's programs (the zone screen's tabs Running · On hold · Box details pending · Pending): Running rows with
 * Hold / Made part / Stop; On hold cards with Resume / Made part / Stop; Box details pending cards with Enter boxes;
 * Pending rows with Start · Edit · Cancel. Cards are 2 columns from 768px.
 */
export function TfoProgramsSection({ tab }: { tab: TfoTab }) {
  const board = useTfoBoard();
  const now = useNow(30_000);
  const [act, setAct] = useState<{ program: TfoProgram; action: ProgramAction } | null>(null);
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
  const onHold = board.data?.onHold ?? [];
  const boxPending = board.data?.boxPending ?? [];
  const onAction = (program: TfoProgram) => (action: ProgramAction) => setAct({ program, action });

  return (
    <div>
      {board.isPending ? (
        <Skeleton className="h-24 w-full rounded-xl" />
      ) : board.isError ? (
        <ErrorState error={board.error} onRetry={() => void board.refetch()} />
      ) : tab === 'running' ? (
        running.length === 0 ? (
          <EmptyState icon={RotateCw} title="Nothing running" description={pending.length ? `${pending.length} program${pending.length === 1 ? '' : 's'} waiting in Pending.` : 'Start a pending program on a machine section.'} className="py-10" />
        ) : (
          <ul className="grid gap-2.5 2xl:grid-cols-2">
            {running.map((p) => (
              <RunningRow key={p.id} p={p} now={now} onAction={onAction(p)} />
            ))}
          </ul>
        )
      ) : tab === 'on_hold' ? (
        onHold.length === 0 ? (
          <EmptyState icon={Pause} title="Nothing on hold" description="Hold a running program to free its sections; resume it later on any idle sections." className="py-10" />
        ) : (
          <ul className="grid gap-2.5 md:grid-cols-2 2xl:grid-cols-3">
            {onHold.map((p) => (
              <OnHoldCard key={p.id} p={p} onAction={onAction(p)} />
            ))}
          </ul>
        )
      ) : tab === 'box_pending' ? (
        boxPending.length === 0 ? (
          <EmptyState icon={PackageCheck} title="No box details pending" description="Programs stopped with “enter boxes later” wait here for their boxes." className="py-10" />
        ) : (
          <ul className="grid gap-2.5 md:grid-cols-2 2xl:grid-cols-3">
            {boxPending.map((p) => (
              <BoxPendingCard key={p.id} p={p} onAction={onAction(p)} />
            ))}
          </ul>
        )
      ) : pending.length === 0 ? (
        <EmptyState
          icon={RotateCw}
          title="No pending programs"
          description="New programs wait here (their raw kg reserved) until someone starts them."
          className="py-8"
        />
      ) : (
        <ul className="grid gap-2.5 2xl:grid-cols-2">
          {pending.map((p) => (
            <PendingRow key={p.id} p={p} onStart={() => setStartFor(p)} onEdit={() => setEditFor(p)} onCancel={() => setCancelFor(p)} />
          ))}
        </ul>
      )}

      <EditPendingDialog program={editFor} onOpenChange={(o) => !o && setEditFor(null)} />
      <StartProgramDialog program={startFor} onOpenChange={(o) => !o && setStartFor(null)} />
      <ProgramActionDialogs target={act} onClose={() => setAct(null)} />
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
    </div>
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
  const [chooseFor, setChooseFor] = useState<TfoProgram | null>(null);
  const [act, setAct] = useState<{ program: TfoProgram; action: ProgramAction } | null>(null);
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
                    <BoardSection key={s.section} machine={m} section={s.section} program={s.program} now={now} onOpen={() => (s.program ? setChooseFor(s.program) : setStartAt({ machine: m, section: s.section }))} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <YarnDialog
        open={!!chooseFor}
        onOpenChange={(o) => !o && setChooseFor(null)}
        title={chooseFor ? `${tfoProgramLabel(chooseFor.id)} · ${programSectionsLabel(chooseFor.sections)}` : ''}
        description={chooseFor ? `${chooseFor.rawQuality.name} · ${lotText(chooseFor.lot)} · ${formatKg(chooseFor.rawG)} issued` : undefined}
      >
        <div className="grid gap-2 sm:grid-cols-3">
          {(
            [
              ['hold', 'Hold', Pause],
              ['part', 'Complete made part', PackageCheck],
              ['stop', 'Stop', Square],
            ] as const
          ).map(([a, text, Icon]) => (
            <Button
              key={a}
              variant={a === 'stop' ? 'primary' : 'secondary'}
              className="min-h-14"
              onClick={() => {
                if (chooseFor) setAct({ program: chooseFor, action: a });
                setChooseFor(null);
              }}
            >
              <Icon /> {text}
            </Button>
          ))}
        </div>
      </YarnDialog>
      <ProgramActionDialogs target={act} onClose={() => setAct(null)} />
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
