import { AlertTriangle, CheckCircle2, Loader2, Plus, Trash2, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  BOX_DESTINATION_LABEL,
  BOX_DESTINATIONS,
  BOX_NO_MAX_LENGTH,
  boxesStayText,
  formatKg,
  MAX_BOXES_PER_STOP,
  NO_LOT_LABEL,
  parseKgText,
  PROGRAM_STOP_ERROR_TEXT,
  STOP_BOX_ERROR_TEXT,
  stopTotals,
  TFO_SECTION_LABEL,
  tfoSectionLabel,
  TWIST_DIRECTION_LABEL,
  validateProgramStop,
  validateStopBox,
  YARN_ZONE_CONFIG,
  type BoxDestination,
  type StopBoxError,
  type TfoProgram,
} from '@rivoora/shared';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useDebounce } from '@/hooks/useDebounce';
import { useNow } from '@/hooks/useNow';
import { ApiError, errorMessage } from '@/lib/api';
import { formatDateTime, formatElapsed } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useCheckBoxNo, useStopProgram } from './api';
import { DialogButtons, YarnDialog } from './dialog';
import { actorText, cleanDecimal, Kg, KgInput, numOrNull, WarpingQualitySelect } from './parts';

/**
 * Sprint 20 — Stop a running program: the output is recorded as BOXES (box no · rolls · gross · net · avg kg ·
 * destination) under one warping quality; TFO output = total net wt. A table-like grid from 768px (big inputs),
 * cards on phones; the totals sit in the always-visible footer. Raw returned goes back with the program's lot.
 */

const ACCENT = YARN_ZONE_CONFIG.tfo.accent;
/** Short labels fit the narrow "Goes to" column on portrait tablets; the full name is the option's description. */
const DEST_SHORT: Record<BoxDestination, string> = { tfo: 'TFO', warping: 'Warping', direct: 'Direct' };
const DEST_OPTIONS = BOX_DESTINATIONS.map((d) => ({ value: d, label: DEST_SHORT[d], description: BOX_DESTINATION_LABEL[d] }));
const GRID = 'md:grid md:grid-cols-[minmax(0,1.3fr)_4.75rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)_2.75rem] md:items-start md:gap-2';

interface BoxRow {
  key: number;
  boxNo: string;
  rolls: string;
  gross: string;
  net: string;
  avg: string;
  zone: BoxDestination;
}
let boxKey = 0;
const newBox = (zone: BoxDestination = 'tfo'): BoxRow => ({ key: ++boxKey, boxNo: '', rolls: '', gross: '', net: '', avg: '', zone });
const parsed = (b: BoxRow) => ({
  boxNo: b.boxNo,
  rolls: b.rolls ? Number(b.rolls) : NaN,
  grossG: parseKgText(b.gross) ?? 0,
  netG: parseKgText(b.net) ?? 0,
  avgG: parseKgText(b.avg) ?? 0,
  zone: b.zone,
});
const ERR_FIELD: Record<StopBoxError, keyof BoxRow> = { box_no: 'boxNo', box_no_repeat: 'boxNo', rolls: 'rolls', gross: 'gross', net: 'net', net_over_gross: 'net', avg: 'avg' };

/** The live "box no. is free" mark beside the field. */
function BoxNoStatus({ boxNo, onTaken }: { boxNo: string; onTaken: (taken: boolean) => void }) {
  const debounced = useDebounce(boxNo.trim(), 300);
  const check = useCheckBoxNo(debounced, debounced.length > 0);
  const taken = debounced === boxNo.trim() && check.data?.available === false;
  useEffect(() => onTaken(taken), [taken, onTaken]);
  if (!boxNo.trim()) return null;
  if (check.isFetching || debounced !== boxNo.trim()) return <Loader2 className="size-4 animate-spin text-slate-400" aria-label="Checking" />;
  if (check.data?.available === false) return <XCircle className="size-4 text-rose-600" aria-label="Box no. already used" />;
  if (check.data?.available) return <CheckCircle2 className="size-4 text-emerald-600" aria-label="Box no. is free" />;
  return null;
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <div className="mt-0.5 truncate text-[15px] font-medium text-slate-800">{children}</div>
    </div>
  );
}

export function StopProgramDialog({ program, onOpenChange }: { program: TfoProgram | null; onOpenChange: (o: boolean) => void }) {
  const open = !!program;
  const stop = useStopProgram(program?.id ?? 0);
  const now = useNow(30_000);
  const [wqId, setWqId] = useState<number | null>(null);
  const [wqName, setWqName] = useState<string | undefined>();
  const [boxes, setBoxes] = useState<BoxRow[]>(() => [newBox()]);
  const [taken, setTaken] = useState<Record<number, boolean>>({});
  const [returned, setReturned] = useState('');
  const [meters, setMeters] = useState('');
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [serverErr, setServerErr] = useState<{ field: string; message: string } | null>(null);
  useEffect(() => {
    if (open) {
      setWqId(null);
      setWqName(undefined);
      setBoxes([newBox()]);
      setTaken({});
      setReturned('');
      setMeters('');
      setNote('');
      setTried(false);
      setConfirm(false);
      setServerErr(null);
    }
  }, [open, program?.id]);

  if (!program) return null;
  const label = tfoSectionLabel(program.machineNo, program.section);
  const rows = boxes.map(parsed);
  const totals = stopTotals(rows);
  const boxErrors = rows.map((b, i) => {
    const err = validateStopBox(b, rows.slice(0, i).map((x) => x.boxNo));
    if (err) return { field: ERR_FIELD[err], message: STOP_BOX_ERROR_TEXT[err] };
    if (taken[boxes[i].key]) return { field: 'boxNo' as const, message: 'This box no. is already used' };
    return null;
  });
  const returnedG = returned.trim() ? parseKgText(returned) : 0;
  const stopErr = returnedG === null ? 'Use at most 3 decimals' : validateProgramStop({ rawG: program.rawG, twistedG: totals.netG, returnedG });
  const returnedErr = stopErr === 'returned_too_much' ? `${PROGRAM_STOP_ERROR_TEXT.returned_too_much} (${formatKg(program.rawG)})` : stopErr === 'Use at most 3 decimals' ? stopErr : undefined;
  const set = (key: number, patch: Partial<BoxRow>) => setBoxes((bs) => bs.map((b) => (b.key === key ? { ...b, ...patch } : b)));
  const stayText = boxesStayText(totals.stayInTfo);
  const serverBoxErr = (i: number, f: string) => (serverErr?.field === `boxes.${i}.${f}` ? serverErr.message : undefined);

  const valid = () => !!wqId && !boxErrors.some(Boolean) && !returnedErr && (boxes.length > 0 || (returnedG ?? 0) > 0);
  const submit = () => {
    setTried(true);
    setServerErr(null);
    if (!valid()) return;
    setConfirm(true);
  };
  const save = () =>
    stop.mutate(
      {
        warpingQualityId: wqId!,
        boxes: rows.map((b) => ({ boxNo: b.boxNo.trim(), rolls: b.rolls, grossKg: b.grossG / 1000, netKg: b.netG / 1000, avgKg: b.avgG / 1000, zone: b.zone })),
        twistedMeters: numOrNull(meters),
        returnedRawKg: (returnedG ?? 0) / 1000,
        note: note.trim() || null,
      },
      {
        onSuccess: (p) => {
          toast.success(`${label} stopped · ${p.boxes.length} box${p.boxes.length === 1 ? '' : 'es'} · ${formatKg(p.twistedG ?? 0)} twisted`);
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

  return (
    <YarnDialog
      open={open}
      onOpenChange={onOpenChange}
      layout="wide"
      title={`Stop program · ${label}`}
      description={`Running for ${formatElapsed(program.startedAt, now)} · started ${formatDateTime(program.startedAt)}${actorText(program.startedBy) ? ` by ${actorText(program.startedBy)}` : ''}`}
      busy={stop.isPending}
      dirty={boxes.some((b) => b.boxNo || b.net) || !!returned}
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
          <Fact label="Machine / section">
            {label} <span className="text-sm text-slate-500">· {TFO_SECTION_LABEL[program.section]}</span>
          </Fact>
          <Fact label="Raw quality">{program.rawQuality.name}</Fact>
          <Fact label="Lot">{program.lot ? program.lot.lotNo : NO_LOT_LABEL}</Fact>
          <Fact label="Raw issued">
            <Kg g={program.rawG} />
          </Fact>
          <Fact label="Output quality">{program.outputQuality.name}</Fact>
          <Fact label="TPM · direction">
            {program.tpm} · {TWIST_DIRECTION_LABEL[program.direction]}
          </Fact>
          <Fact label="Winding meter">{program.windingMeter?.toLocaleString('en-IN') ?? '—'}</Fact>
          <Fact label="Denier / Filament">{program.denierFilament ?? '—'}</Fact>
        </div>

        <Field label="Stop quality (warping quality)" required error={tried && !wqId ? 'Select the stop quality' : serverErr?.field === 'warpingQualityId' ? serverErr.message : undefined} className="md:max-w-md">
          <WarpingQualitySelect
            value={wqId}
            selectedLabel={wqName}
            onChange={(id, name) => {
              setWqId(id);
              setWqName(name);
            }}
            invalid={tried && !wqId}
          />
        </Field>

        <section aria-label="Boxes" className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="mr-auto text-sm font-bold text-slate-800">Boxes</h3>
            <span className="text-xs font-medium text-slate-500">Move all to</span>
            {BOX_DESTINATIONS.map((d) => (
              <Button key={d} variant="secondary" size="sm" onClick={() => setBoxes((bs) => bs.map((b) => ({ ...b, zone: d })))}>
                {DEST_SHORT[d]}
              </Button>
            ))}
          </div>
          {tried && serverErr?.field === 'boxes' && <p className="text-[13px] font-medium text-destructive">{serverErr.message}</p>}
          <div className={cn('hidden px-1 text-xs font-semibold uppercase tracking-wide text-slate-500', GRID)} aria-hidden>
            <span>Box no.</span>
            <span className="text-right">Rolls</span>
            <span className="text-right">Gross kg</span>
            <span className="text-right">Net kg</span>
            <span className="text-right">Avg kg</span>
            <span>Goes to</span>
            <span />
          </div>
          <ul className="grid gap-2">
            {boxes.map((b, i) => {
              const e = tried ? boxErrors[i] : null;
              const errFor = (f: keyof BoxRow) => (e?.field === f ? e.message : undefined) ?? serverBoxErr(i, f === 'gross' ? 'grossKg' : f === 'net' ? 'netKg' : f === 'avg' ? 'avgKg' : f);
              return (
                <li key={b.key} className={cn('grid grid-cols-2 gap-x-3 gap-y-3 rounded-xl border border-border p-3 md:rounded-none md:border-0 md:border-b md:p-1 md:pb-2', GRID)}>
                  <Field label={`Box ${i + 1} no.`} required error={errFor('boxNo')} className="col-span-2 md:col-span-1 [&>label]:md:sr-only">
                    <Input
                      value={b.boxNo}
                      maxLength={BOX_NO_MAX_LENGTH}
                      autoComplete="off"
                      onChange={(ev) => set(b.key, { boxNo: ev.target.value })}
                      invalid={!!errFor('boxNo')}
                      suffix={<BoxNoStatus boxNo={b.boxNo} onTaken={(t) => setTaken((m) => (m[b.key] === t ? m : { ...m, [b.key]: t }))} />}
                      aria-label={`Box ${i + 1} no.`}
                    />
                  </Field>
                  <Field label="Rolls" required error={errFor('rolls')} className="[&>label]:md:sr-only">
                    <Input inputMode="numeric" autoComplete="off" value={b.rolls} onChange={(ev) => set(b.key, { rolls: cleanDecimal(ev.target.value, 0, 6) })} invalid={!!errFor('rolls')} className="text-right tabular-nums" aria-label={`Box ${i + 1} rolls`} />
                  </Field>
                  <Field label="Gross kg" required error={errFor('gross')} className="[&>label]:md:sr-only">
                    <KgInput value={b.gross} onValueChange={(v) => set(b.key, { gross: v })} invalid={!!errFor('gross')} aria-label={`Box ${i + 1} gross kg`} />
                  </Field>
                  <Field label="Net kg" required error={errFor('net')} className="[&>label]:md:sr-only">
                    <KgInput value={b.net} onValueChange={(v) => set(b.key, { net: v })} invalid={!!errFor('net')} aria-label={`Box ${i + 1} net kg`} />
                  </Field>
                  <Field label="Avg kg" required error={errFor('avg')} className="[&>label]:md:sr-only">
                    <KgInput value={b.avg} onValueChange={(v) => set(b.key, { avg: v })} invalid={!!errFor('avg')} aria-label={`Box ${i + 1} avg kg`} />
                  </Field>
                  <Field label="Goes to" className="col-span-2 md:col-span-1 [&>label]:md:sr-only">
                    <Select value={b.zone} onChange={(z) => set(b.key, { zone: z })} options={DEST_OPTIONS} aria-label={`Box ${i + 1} goes to`} />
                  </Field>
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
            <Button variant="secondary" className="justify-self-start" onClick={() => setBoxes((bs) => [...bs, newBox(bs[bs.length - 1]?.zone ?? 'tfo')])}>
              <Plus /> Add box
            </Button>
          )}
          {stayText && (
            <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {stayText}
            </p>
          )}
        </section>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <Field label="Raw yarn returned" error={tried ? (returnedErr ?? (serverErr?.field === 'returnedRawKg' ? serverErr.message : undefined)) : undefined} hint={`Back to TFO raw stock · ${program.lot ? `lot ${program.lot.lotNo}` : NO_LOT_LABEL}`}>
            <KgInput value={returned} onValueChange={setReturned} invalid={tried && !!returnedErr} />
          </Field>
          <Field label="Twisted meters" htmlFor="tfo-m">
            <Input id="tfo-m" inputMode="decimal" autoComplete="off" value={meters} onChange={(e) => setMeters(cleanDecimal(e.target.value, 2, 9))} className="text-right tabular-nums" />
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
          `${totals.boxes} box${totals.boxes === 1 ? '' : 'es'} · ${formatKg(totals.netG)} net as ${wqName ?? 'the stop quality'}.`,
          (returnedG ?? 0) > 0 ? `${formatKg(returnedG ?? 0)} raw back to TFO.` : null,
          stayText,
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
