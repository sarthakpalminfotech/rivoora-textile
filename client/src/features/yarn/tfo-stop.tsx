import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  boxNetG,
  formatKg,
  gramsToKg,
  MAX_BOXES_PER_STOP,
  NO_LOT_LABEL,
  parseKgText,
  PROGRAM_STOP_ERROR_TEXT,
  programSectionsLabel,
  STOP_BOX_ERROR_TEXT,
  stopTotals,
  tfoOutputQualityName,
  TWIST_DIRECTION_LABEL,
  validateProgramStop,
  validateStopBox,
  YARN_ZONE_CONFIG,
  type StopBoxError,
  type TfoProgram,
} from '@rivoora/shared';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { useNow } from '@/hooks/useNow';
import { ApiError, errorMessage } from '@/lib/api';
import { formatDateTime, formatElapsed } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useStopProgram } from './api';
import { DialogButtons, YarnDialog } from './dialog';
import { actorText, cleanDecimal, Kg, KgInput, numOrNull, Toggle2 } from './parts';

/**
 * Sprint 20b — Stop a running program. One roll weight for the stop; per box: rolls, gross kg, (optional) avg kg and —
 * for S + Z programs — S or Z. Net = gross − roll weight × rolls (calculated); box numbers and the output quality
 * ("75/36 Poly 75D-600-S") are given by the system; every box stays in TFO. A table-like grid from 768px, cards on
 * phones; the totals sit in the always-visible footer. Raw returned goes back with the program's lot.
 */

const ACCENT = YARN_ZONE_CONFIG.tfo.accent;
const SZ_OPTIONS = [
  { value: 'S' as const, label: 'S' },
  { value: 'Z' as const, label: 'Z' },
];

interface BoxRow {
  key: number;
  rolls: string;
  gross: string;
  avg: string;
  direction: 'S' | 'Z' | null;
}
let boxKey = 0;
const newBox = (direction: 'S' | 'Z' | null = null): BoxRow => ({ key: ++boxKey, rolls: '', gross: '', avg: '', direction });
const ERR_FIELD: Record<StopBoxError, keyof BoxRow> = { rolls: 'rolls', gross: 'gross', net: 'gross', direction: 'direction' };

function Fact({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <div className="mt-0.5 truncate text-[15px] font-medium text-slate-800">{children}</div>
    </div>
  );
}

export function StopProgramDialog({ program, onOpenChange }: { program: TfoProgram | null; onOpenChange: (o: boolean) => void }) {
  const open = !!program;
  const stop = useStopProgram(program?.id ?? 0);
  const now = useNow(30_000);
  const [rollWeight, setRollWeight] = useState('');
  const [boxes, setBoxes] = useState<BoxRow[]>(() => [newBox()]);
  const [returned, setReturned] = useState('');
  const [meters, setMeters] = useState('');
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [serverErr, setServerErr] = useState<{ field: string; message: string } | null>(null);
  useEffect(() => {
    if (open) {
      setRollWeight('');
      setBoxes([newBox()]);
      setReturned('');
      setMeters('');
      setNote('');
      setTried(false);
      setConfirm(false);
      setServerErr(null);
    }
  }, [open, program?.id]);

  if (!program) return null;
  const label = programSectionsLabel(program.sections);
  const sz = program.direction === 'SZ';
  const rollWeightG = parseKgText(rollWeight);
  const rw = rollWeightG ?? 0;
  const rows = boxes.map((b) => ({ rolls: b.rolls ? Number(b.rolls) : NaN, grossG: parseKgText(b.gross) ?? 0, avgG: parseKgText(b.avg), direction: sz ? b.direction : program.direction }));
  const totals = stopTotals(rows, rw);
  const boxErrors = rows.map((b, i) => {
    const err = validateStopBox(b, rw, sz);
    if (err) return { field: ERR_FIELD[err], message: STOP_BOX_ERROR_TEXT[err] };
    if (b.avgG === null && boxes[i].avg.trim()) return { field: 'avg' as const, message: 'Use at most 4 decimals' };
    return null;
  });
  const returnedG = returned.trim() ? parseKgText(returned) : 0;
  const stopErr = returnedG === null ? 'Use at most 4 decimals' : validateProgramStop({ rawG: program.rawG, twistedG: totals.netG, returnedG });
  const returnedErr = stopErr === 'returned_too_much' ? `${PROGRAM_STOP_ERROR_TEXT.returned_too_much} (${formatKg(program.rawG)})` : stopErr === 'Use at most 4 decimals' ? stopErr : undefined;
  const rollWeightErr = rollWeightG === null ? 'Enter the roll weight' : undefined;
  const set = (key: number, patch: Partial<BoxRow>) => setBoxes((bs) => bs.map((b) => (b.key === key ? { ...b, ...patch } : b)));
  const serverBoxErr = (i: number, f: string) => (serverErr?.field === `boxes.${i}.${f}` ? serverErr.message : undefined);
  // The output qualities the boxes get (one per direction).
  const qualityOf = (dir: 'S' | 'Z') => tfoOutputQualityName({ denierFilament: program.denierFilament, rawQualityName: program.rawQuality.name, tpm: program.tpm, direction: dir });
  const directions = [...new Set(rows.map((r) => r.direction).filter((d): d is 'S' | 'Z' => d === 'S' || d === 'Z'))];

  const valid = () => !rollWeightErr && !boxErrors.some(Boolean) && !returnedErr && (boxes.length > 0 || (returnedG ?? 0) > 0);
  const submit = () => {
    setTried(true);
    setServerErr(null);
    if (!valid()) return;
    setConfirm(true);
  };
  const save = () =>
    stop.mutate(
      {
        rollWeightKg: gramsToKg(rw),
        boxes: rows.map((b) => ({ rolls: b.rolls, grossKg: gramsToKg(b.grossG), avgKg: b.avgG ? gramsToKg(b.avgG) : null, direction: sz ? (b.direction as 'S' | 'Z') : null })),
        twistedMeters: numOrNull(meters),
        returnedRawKg: gramsToKg(returnedG ?? 0),
        note: note.trim() || null,
      },
      {
        onSuccess: (p) => {
          toast.success(`${label} stopped · ${p.boxes.length} box${p.boxes.length === 1 ? '' : 'es'} · ${formatKg(p.twistedG ?? 0)} twisted in TFO`);
          setConfirm(false);
          onOpenChange(false);
        },
        onError: (err) => {
          setConfirm(false);
          if (err instanceof ApiError && err.field) setServerErr({ field: err.field, message: err.message });
          toast.error(errorMessage(err));
        },
      },
    );

  const GRID = sz
    ? 'md:grid md:grid-cols-[3.25rem_5rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_6.5rem_2.75rem] md:items-start md:gap-2'
    : 'md:grid md:grid-cols-[3.25rem_5rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_2.75rem] md:items-start md:gap-2';

  return (
    <YarnDialog
      open={open}
      onOpenChange={onOpenChange}
      layout="wide"
      title={`Stop program · ${label}`}
      description={`Running for ${formatElapsed(program.startedAt, now)} · started ${formatDateTime(program.startedAt)}${actorText(program.startedBy) ? ` by ${actorText(program.startedBy)}` : ''}`}
      busy={stop.isPending}
      dirty={boxes.some((b) => b.gross || b.rolls) || !!returned || !!rollWeight}
      footer={
        <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-2">
          <dl className="mr-auto flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-slate-600" aria-label="Totals">
            <div>
              <dt className="inline">Boxes </dt>
              <dd className="inline font-semibold tabular-nums text-slate-900">{totals.boxes}</dd>
            </div>
            <div>
              <dt className="inline">Rolls </dt>
              <dd className="inline font-semibold tabular-nums text-slate-900">{totals.rolls || 0}</dd>
            </div>
            <div>
              <dt className="inline">Gross </dt>
              <dd className="inline font-semibold text-slate-900">
                <Kg g={totals.grossG} />
              </dd>
            </div>
            <div>
              <dt className="inline">Net </dt>
              <dd className="inline font-bold" style={{ color: ACCENT.text }}>
                <Kg g={totals.netG} />
              </dd>
            </div>
          </dl>
          <DialogButtons onCancel={() => onOpenChange(false)} busy={stop.isPending} label="Stop program" form="tfo-stop-form" />
        </div>
      }
    >
      <form
        id="tfo-stop-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="grid gap-5"
      >
        <div className="grid grid-cols-2 gap-4 rounded-xl p-4 md:grid-cols-4" style={{ backgroundColor: ACCENT.soft }}>
          <Fact label="Machine / sections">{label}</Fact>
          <Fact label="Raw quality">{program.rawQuality.name}</Fact>
          <Fact label="Lot">{program.lot ? program.lot.lotNo : NO_LOT_LABEL}</Fact>
          <Fact label="Raw issued">
            <Kg g={program.rawG} />
          </Fact>
          <Fact label="Rolls × winding">{program.rolls && program.windingG ? `${program.rolls} × ${formatKg(program.windingG)}` : '—'}</Fact>
          <Fact label="TPM · direction">
            {program.tpm} · {TWIST_DIRECTION_LABEL[program.direction]}
          </Fact>
          <Fact label="Denier / Filament">{program.denierFilament ?? '—'}</Fact>
          <Fact label="Output quality" className="col-span-2 md:col-span-1">
            <span className="whitespace-normal text-sm">{directions.length ? directions.map(qualityOf).join(' · ') : sz ? 'Pick S / Z per box' : qualityOf(program.direction as 'S' | 'Z')}</span>
          </Fact>
        </div>

        <Field
          label="Roll weight"
          required
          error={tried ? (rollWeightErr ?? (serverErr?.field === 'rollWeightKg' ? serverErr.message : undefined)) : undefined}
          hint="Same for every box · net = gross − roll weight × rolls"
          className="md:max-w-xs"
        >
          <KgInput value={rollWeight} onValueChange={setRollWeight} invalid={tried && !!rollWeightErr} aria-label="Roll weight" />
        </Field>

        <section aria-label="Boxes" className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="mr-auto text-sm font-bold text-slate-800">Boxes</h3>
            <span className="text-xs text-slate-500">Box numbers are given on save · all boxes stay in TFO</span>
          </div>
          {tried && serverErr?.field === 'boxes' && <p className="text-[13px] font-medium text-destructive">{serverErr.message}</p>}
          <div className={cn('hidden px-1 text-xs font-semibold uppercase tracking-wide text-slate-500', GRID)} aria-hidden>
            <span>Box</span>
            <span className="text-right">Rolls *</span>
            <span className="text-right">Gross kg *</span>
            <span className="text-right">Net kg</span>
            <span className="text-right">Avg kg</span>
            {sz && <span>Direction *</span>}
            <span />
          </div>
          <ul className="grid gap-2">
            {boxes.map((b, i) => {
              const e = tried ? boxErrors[i] : null;
              const errFor = (f: keyof BoxRow) => (e?.field === f ? e.message : undefined) ?? serverBoxErr(i, f === 'gross' ? 'grossKg' : f === 'avg' ? 'avgKg' : f);
              const r = rows[i];
              const net = Number.isFinite(r.rolls) && r.grossG > 0 ? boxNetG(r.grossG, rw, r.rolls) : null;
              return (
                <li key={b.key} className={cn('grid grid-cols-2 gap-x-3 gap-y-3 rounded-xl border border-border p-3 md:rounded-none md:border-0 md:border-b md:p-1 md:pb-2', GRID)}>
                  <p className="col-span-2 flex items-center gap-2 md:col-span-1 md:h-11">
                    <span className="flex size-8 items-center justify-center rounded-full text-sm font-bold tabular-nums" style={{ backgroundColor: ACCENT.soft, color: ACCENT.text }}>
                      {i + 1}
                    </span>
                    <span className="text-sm font-semibold text-slate-700 md:sr-only">Box {i + 1}</span>
                  </p>
                  <Field label="Rolls" required error={errFor('rolls')} className="[&>label]:md:sr-only">
                    <Input inputMode="numeric" autoComplete="off" value={b.rolls} onChange={(ev) => set(b.key, { rolls: cleanDecimal(ev.target.value, 0, 6) })} invalid={!!errFor('rolls')} className="text-right tabular-nums" aria-label={`Box ${i + 1} rolls`} />
                  </Field>
                  <Field label="Gross kg" required error={errFor('gross')} className="[&>label]:md:sr-only">
                    <KgInput value={b.gross} onValueChange={(v) => set(b.key, { gross: v })} invalid={!!errFor('gross')} aria-label={`Box ${i + 1} gross kg`} />
                  </Field>
                  <Field label="Net kg" className="[&>label]:md:sr-only">
                    <div className={cn('flex h-11 items-center justify-end rounded-[10px] border border-input bg-slate-50 px-3 font-semibold tabular-nums', net !== null && net <= 0 ? 'text-destructive' : 'text-slate-900')} aria-label={`Box ${i + 1} net kg (calculated)`}>
                      {net !== null ? (net > 0 ? formatKg(net) : '—') : <span className="font-normal text-slate-400">—</span>}
                    </div>
                  </Field>
                  <Field label="Avg kg" error={errFor('avg')} className="[&>label]:md:sr-only">
                    <KgInput value={b.avg} onValueChange={(v) => set(b.key, { avg: v })} invalid={!!errFor('avg')} aria-label={`Box ${i + 1} avg kg`} />
                  </Field>
                  {sz && (
                    <Field label="Direction" required error={errFor('direction')} className="[&>label]:md:sr-only">
                      <Toggle2 value={b.direction} onChange={(d) => set(b.key, { direction: d })} options={SZ_OPTIONS} invalid={!!errFor('direction')} />
                    </Field>
                  )}
                  <div className="col-span-2 flex justify-end md:col-span-1 md:pt-0.5">
                    <Button variant="ghost" size="icon" disabled={boxes.length === 1} onClick={() => setBoxes((bs) => bs.filter((x) => x.key !== b.key))} aria-label={`Remove box ${i + 1}`} className="text-slate-500">
                      <Trash2 className="!size-4" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
          {boxes.length < MAX_BOXES_PER_STOP && (
            <Button variant="secondary" className="justify-self-start" onClick={() => setBoxes((bs) => [...bs, newBox(sz ? (bs[bs.length - 1]?.direction ?? null) : null)])}>
              <Plus /> Add box
            </Button>
          )}
        </section>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <Field label="Raw yarn returned" error={tried ? (returnedErr ?? (serverErr?.field === 'returnedRawKg' ? serverErr.message : undefined)) : undefined} hint={`Back to TFO raw stock · ${program.lot ? `lot ${program.lot.lotNo}` : NO_LOT_LABEL}`}>
            <KgInput value={returned} onValueChange={setReturned} invalid={tried && !!returnedErr} />
          </Field>
          <Field label="Twisted meters" htmlFor="tfo-m">
            <Input id="tfo-m" inputMode="decimal" autoComplete="off" value={meters} onChange={(e) => setMeters(cleanDecimal(e.target.value, 4, 9))} className="text-right tabular-nums" />
          </Field>
          <Field label="Note" htmlFor="tfo-stop-note" className="col-span-2 md:col-span-1">
            <Textarea id="tfo-stop-note" rows={1} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} className="min-h-11" />
          </Field>
        </div>
      </form>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Stop ${label}?`}
        description={[
          `${totals.boxes} box${totals.boxes === 1 ? '' : 'es'} · ${formatKg(totals.netG)} net into TFO as ${directions.map(qualityOf).join(' and ') || '—'}.`,
          (returnedG ?? 0) > 0 ? `${formatKg(returnedG ?? 0)} raw back to TFO.` : null,
        ]
          .filter(Boolean)
          .join(' ')}
        confirmLabel="Stop program"
        loading={stop.isPending}
        onConfirm={save}
      />
    </YarnDialog>
  );
}
