import { Plus, Printer, Recycle, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  availableText,
  boxNoWithFy,
  formatKg,
  gramsToKg,
  kgText,
  MAX_PALTI_INPUTS,
  paltiTotals,
  parseKgText,
  YARN_ZONE_CONFIG,
  YARN_ZONES,
  type PaltiInputInput,
  type PaltiRun,
  type YarnZone,
} from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState, LoadMore } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { ApiError, errorMessage } from '@/lib/api';
import { formatDate, toApiDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useBoxStock, useCreatePalti, useNoBoxStock, usePaltiRuns, useYarnZone } from './api';
import { DialogButtons, YarnDialog } from './dialog';
import { actorText, BackLink, cleanDecimal, Kg, KgInput, LotSelect, QualitySelect, Toggle2, WarpingQualitySelect, ZoneChoice, ZoneTag } from './parts';
import { usePrintStickersToast } from './tfo-stop';

/**
 * Sprint 24 (CR-25) — Palti (`/yarn/palti`): leftover yarn re-wound into a new spindle and stored in a new box, by hand.
 * The list of Palti boxes made (date, box no., quality, kg, zone, from what) + New Palti box: inputs from stock in ANY zone
 * (boxes — whole or kg from a box —, No-box twisted kg, remaining rows, raw lot kg) and one output box (automatic number,
 * warping quality, rolls, gross, net — default = the inputs, less = waste —, the zone it is kept in). Floor roles.
 * Tablet / desktop: inputs left, output right; phones: Inputs → Output steps.
 */

const ACCENT = { solid: '#0E7490', soft: '#ECFEFF', text: '#155E75', border: '#A5F3FC' };
type Kind = PaltiInputInput['kind'];
const KIND_OPTIONS: { value: Kind; label: string }[] = [
  { value: 'box', label: 'Box' },
  { value: 'no_box', label: 'No box' },
  { value: 'raw', label: 'Raw' },
];

interface InputRow {
  key: number;
  zone: YarnZone;
  kind: Kind;
  boxId: number | null;
  /** no_box: `q-<yarn quality>` / `w-<warping quality>` */
  noBoxKey: string | null;
  qualityId: number | null;
  /** raw: null = not picked, 0 = No lot */
  lotId: number | null;
  /** What the picked stock has free (from its picker). */
  availableG: number;
  kg: string;
}
let rowKey = 0;
const newRow = (zone: YarnZone = 'warping', kind: Kind = 'box'): InputRow => ({ key: ++rowKey, zone, kind, boxId: null, noBoxKey: null, qualityId: null, lotId: null, availableG: 0, kg: '' });

function rowError(r: InputRow): string | null {
  if (r.kind === 'box' && !r.boxId) return 'Pick the box';
  if (r.kind === 'no_box' && !r.noBoxKey) return 'Select the quality';
  if (r.kind === 'raw' && !r.qualityId) return 'Select the quality';
  if (r.kind === 'raw' && r.lotId === null) return 'Pick the lot (or No lot)';
  const g = parseKgText(r.kg);
  if (g === null || g <= 0) return 'Enter the kg';
  if (g > r.availableG) return `Only ${formatKg(r.availableG)} free`;
  return null;
}

function toInput(r: InputRow): PaltiInputInput {
  const qtyKg = gramsToKg(parseKgText(r.kg)!);
  if (r.kind === 'box') return { kind: 'box', zone: r.zone, boxId: r.boxId!, qtyKg };
  if (r.kind === 'raw') return { kind: 'raw', zone: r.zone, qualityId: r.qualityId!, lotId: r.lotId || null, qtyKg };
  const [t, id] = r.noBoxKey!.split('-');
  return t === 'w' ? { kind: 'no_box', zone: r.zone, warpingQualityId: Number(id), qtyKg } : { kind: 'no_box', zone: r.zone, qualityId: Number(id), qtyKg };
}

/** One input: zone · Box / No box / Raw · what · kg. The stock hooks run per row (each row has its own zone). */
function InputRowEditor({ row, index, set, onRemove, canRemove, showError }: { row: InputRow; index: number; set: (patch: Partial<InputRow>) => void; onRemove: () => void; canRemove: boolean; showError: boolean }) {
  const boxes = useBoxStock(row.zone, row.kind === 'box');
  const noBox = useNoBoxStock(row.zone, row.kind === 'no_box');
  const zoneData = useYarnZone(row.zone, row.kind === 'raw');
  const err = showError ? rowError(row) : null;
  const boxOptions = (boxes.data ?? []).map((b) => {
    const free = Math.max(0, b.remainingG - b.reservedG);
    return {
      value: b.id,
      label: `Box ${boxNoWithFy(b.boxNo, b.fy)}`,
      description: `${b.warpingQuality.name}${b.kind === 'remaining' ? ' · remaining' : b.kind === 'palti' ? ' · palti' : ''} · ${availableText(free, b.reservedG)}`,
      disabled: free <= 0,
      free,
    };
  });
  const noBoxOptions = (noBox.data ?? []).map((n) => ({
    value: n.warpingQualityId ? `w-${n.warpingQualityId}` : `q-${n.qualityId}`,
    label: n.name,
    description: availableText(n.availableG, n.reservedG),
    disabled: n.availableG <= 0,
    free: n.availableG,
  }));
  const rawStock = (zoneData.data?.qualities ?? []).filter((q) => q.rawG > 0).map((q) => ({ id: q.quality.id, name: q.quality.name, availableG: q.rawG }));

  return (
    <li className="grid gap-3 rounded-xl border border-border bg-white p-3">
      <div className="flex items-center gap-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-bold" style={{ backgroundColor: ACCENT.soft, color: ACCENT.text }}>
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <Select
            value={row.zone}
            onChange={(z) => set({ ...newRow(z, row.kind), key: row.key })}
            options={YARN_ZONES.map((z) => ({ value: z, label: YARN_ZONE_CONFIG[z].label }))}
            aria-label={`Input ${index + 1} zone`}
          />
        </div>
        <Button variant="ghost" size="icon" className="text-slate-400 hover:text-destructive" disabled={!canRemove} onClick={onRemove} aria-label={`Remove input ${index + 1}`}>
          <Trash2 />
        </Button>
      </div>
      <Toggle2 value={row.kind} onChange={(kind) => set({ ...newRow(row.zone, kind), key: row.key })} options={KIND_OPTIONS} />
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
        {row.kind === 'box' ? (
          <Select
            value={row.boxId}
            onChange={(id, o) => {
              const free = (o as { free?: number }).free ?? 0;
              set({ boxId: id, availableG: free, kg: kgText(free) });
            }}
            options={boxOptions}
            placeholder={boxOptions.length ? 'Select box' : `No boxes in ${YARN_ZONE_CONFIG[row.zone].label}`}
            searchable
            searchPlaceholder="Search box no…"
            loading={boxes.isPending}
            emptyText="No boxes here"
            invalid={!!err && !row.boxId}
            panelClassName="min-w-[min(320px,calc(100vw-24px))]"
            aria-label="Box"
          />
        ) : row.kind === 'no_box' ? (
          <Select
            value={row.noBoxKey}
            onChange={(v, o) => set({ noBoxKey: v, availableG: (o as { free?: number }).free ?? 0 })}
            options={noBoxOptions}
            placeholder={noBoxOptions.length ? 'Select quality' : 'No “No box” yarn here'}
            searchable
            loading={noBox.isPending}
            emptyText="Nothing here"
            invalid={!!err && !row.noBoxKey}
            panelClassName="min-w-[min(300px,calc(100vw-24px))]"
            aria-label="No box quality"
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <QualitySelect value={row.qualityId} onChange={(id) => set({ qualityId: id, lotId: null, availableG: 0 })} only={rawStock} invalid={!!err && !row.qualityId} placeholder={rawStock.length ? 'Select quality' : 'No raw yarn here'} />
            <LotSelect zone={row.zone} qualityId={row.qualityId} value={row.lotId ?? -1} onChange={(lotId, availableG) => set({ lotId, availableG })} invalid={!!err && !!row.qualityId && row.lotId === null} />
          </div>
        )}
        <KgInput value={row.kg} onValueChange={(kg) => set({ kg })} invalid={!!err} aria-label={`Input ${index + 1} kg`} />
      </div>
      {err && <p className="text-[13px] font-medium text-destructive">{err}</p>}
    </li>
  );
}

/** New Palti box — full screen on phones (Inputs → Output steps), wide dialog with two columns from 768px. */
function NewPaltiDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const create = useCreatePalti();
  const phone = useIsMobile();
  const printToast = usePrintStickersToast();
  const [step, setStep] = useState<'inputs' | 'output'>('inputs');
  const [date, setDate] = useState(toApiDate(new Date()));
  const [rows, setRows] = useState<InputRow[]>(() => [newRow()]);
  const [wqId, setWqId] = useState<number | null>(null);
  const [wqName, setWqName] = useState<string | undefined>();
  const [rolls, setRolls] = useState('');
  const [gross, setGross] = useState('');
  const [net, setNet] = useState('');
  const [netTouched, setNetTouched] = useState(false);
  const [zone, setZone] = useState<YarnZone | null>(null);
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const [serverErr, setServerErr] = useState<{ field: string; message: string } | null>(null);
  useEffect(() => {
    if (!open) return;
    setStep('inputs');
    setDate(toApiDate(new Date()));
    setRows([newRow()]);
    setWqId(null);
    setWqName(undefined);
    setRolls('');
    setGross('');
    setNet('');
    setNetTouched(false);
    setZone(null);
    setNote('');
    setTried(false);
    setServerErr(null);
  }, [open]);

  const inputG = rows.reduce((s, r) => s + (parseKgText(r.kg) ?? 0), 0);
  const netG = netTouched ? parseKgText(net) : inputG;
  const grossG = gross.trim() ? parseKgText(gross) : null;
  const totals = paltiTotals(
    rows.map((r) => parseKgText(r.kg) ?? 0),
    netG ?? 0,
  );
  // Two rows on the same box add up against what it has free.
  const rowErrs = useMemo(() => {
    const used = new Map<number, number>();
    return rows.map((r) => {
      const e = rowError(r);
      if (e || r.kind !== 'box' || !r.boxId) return e;
      const total = (used.get(r.boxId) ?? 0) + (parseKgText(r.kg) ?? 0);
      used.set(r.boxId, total);
      return total > r.availableG ? 'This box is picked twice' : null;
    });
  }, [rows]);
  const inputsInvalid = rowErrs.some(Boolean);
  const outErrs = {
    wq: !wqId ? 'Select the warping quality' : null,
    net: netG === null || netG <= 0 ? 'Enter the net kg' : totals.overG > 0 ? `Net can’t be more than the inputs (${formatKg(inputG)})` : null,
    gross: grossG === null && gross.trim() ? 'Use at most 4 decimals' : grossG !== null && netG !== null && grossG < netG ? 'Gross can’t be less than net' : null,
    zone: !zone ? 'Pick where the box is kept' : null,
  };
  const outputInvalid = Object.values(outErrs).some(Boolean);
  const set = (key: number, patch: Partial<InputRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const submit = () => {
    setTried(true);
    setServerErr(null);
    if (inputsInvalid) {
      setStep('inputs');
      return;
    }
    if (outputInvalid) {
      setStep('output');
      return;
    }
    create.mutate(
      {
        date,
        inputs: rows.map(toInput),
        output: { warpingQualityId: wqId!, rolls: rolls ? Number(rolls) : null, grossKg: grossG !== null ? gramsToKg(grossG) : null, netKg: gramsToKg(netG!), zone: zone! },
        note: note.trim() || null,
      },
      {
        onSuccess: (run) => {
          printToast(
            `Palti box ${run.box ? boxNoWithFy(run.box.boxNo, run.box.fy) : ''} · ${formatKg(run.box?.netG ?? 0)} in ${zone ? YARN_ZONE_CONFIG[zone].label : ''}${run.wasteG ? ` · waste ${formatKg(run.wasteG)}` : ''}`,
            run.box ? [run.box.id] : [],
          );
          onOpenChange(false);
        },
        onError: (err) => {
          if (err instanceof ApiError && err.field) setServerErr({ field: err.field, message: err.message });
          toast.error(errorMessage(err));
        },
      },
    );
  };

  const inputsPanel = (
    <section aria-label="Inputs" className="grid min-w-0 content-start gap-3">
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 text-sm font-bold text-slate-800">Inputs · from any zone</h3>
        {rows.length < MAX_PALTI_INPUTS && (
          <Button variant="secondary" size="sm" onClick={() => setRows((rs) => [...rs, newRow(rs[rs.length - 1]?.zone, rs[rs.length - 1]?.kind)])}>
            <Plus /> Add input
          </Button>
        )}
      </div>
      <ol className="grid gap-3">
        {rows.map((r, i) => (
          <InputRowEditor key={r.key} row={r} index={i} set={(p) => set(r.key, p)} onRemove={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} canRemove={rows.length > 1} showError={tried} />
        ))}
      </ol>
      {tried && rowErrs.some((e) => e === 'This box is picked twice') && <p className="text-[13px] font-medium text-destructive">A box is picked twice — use one row per box.</p>}
      {serverErr?.field.startsWith('inputs') && <p className="text-[13px] font-medium text-destructive">{serverErr.message}</p>}
    </section>
  );

  const outputPanel = (
    <section aria-label="Output box" className="grid min-w-0 content-start gap-4 rounded-xl border p-3 md:p-4" style={{ borderColor: ACCENT.border, backgroundColor: ACCENT.soft }}>
      <h3 className="text-sm font-bold" style={{ color: ACCENT.text }}>
        New box · number given on save
      </h3>
      <Field label="Warping quality" required error={tried ? (outErrs.wq ?? undefined) : undefined}>
        <WarpingQualitySelect value={wqId} selectedLabel={wqName} onChange={(id, name) => { setWqId(id); setWqName(name); }} invalid={tried && !!outErrs.wq} />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Rolls" htmlFor="palti-rolls">
          <Input id="palti-rolls" inputMode="numeric" autoComplete="off" value={rolls} onChange={(e) => setRolls(cleanDecimal(e.target.value, 0, 6))} className="text-right tabular-nums" />
        </Field>
        <Field label="Gross kg" error={tried ? (outErrs.gross ?? undefined) : undefined}>
          <KgInput value={gross} onValueChange={setGross} invalid={tried && !!outErrs.gross} aria-label="Gross kg" />
        </Field>
        <Field label="Net kg" required error={tried ? (outErrs.net ?? (serverErr?.field === 'output.netKg' ? serverErr.message : undefined)) : undefined}>
          <KgInput
            value={netTouched ? net : inputG ? kgText(inputG) : ''}
            onValueChange={(v) => {
              setNetTouched(true);
              setNet(v);
            }}
            invalid={tried && !!outErrs.net}
            aria-label="Net kg"
          />
        </Field>
      </div>
      <p className="text-sm text-slate-700">
        Inputs <Kg g={inputG} className="font-semibold" /> · net <Kg g={netG ?? 0} className="font-semibold" />
        {totals.wasteG > 0 && (
          <>
            {' '}
            · <span className="font-semibold text-amber-800">waste <Kg g={totals.wasteG} /></span>
          </>
        )}
      </p>
      <Field label="Kept in" required error={tried ? (outErrs.zone ?? undefined) : undefined}>
        <ZoneChoice value={zone} onChange={setZone} invalid={tried && !!outErrs.zone} compact aria-label="Zone the box is kept in" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Date" htmlFor="palti-date" required>
          <DatePicker id="palti-date" value={date} onChange={setDate} />
        </Field>
        <Field label="Note" htmlFor="palti-note">
          <Textarea id="palti-note" rows={1} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} className="min-h-11" />
        </Field>
      </div>
    </section>
  );

  return (
    <YarnDialog
      open={open}
      onOpenChange={onOpenChange}
      layout="wide"
      title="New Palti box"
      description="Leftover yarn re-wound into a new box. The inputs leave stock when you save."
      busy={create.isPending}
      dirty={rows.some((r) => r.kg) || !!wqId}
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          <p className="mr-auto text-sm text-slate-600">
            {rows.length} input{rows.length === 1 ? '' : 's'} · <Kg g={inputG} className="font-semibold text-slate-900" />
          </p>
          {phone && step === 'inputs' ? (
            <div className="grid w-full grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  setTried(true);
                  if (!inputsInvalid) {
                    setTried(false);
                    setStep('output');
                  }
                }}
              >
                Next · Output
              </Button>
            </div>
          ) : (
            <DialogButtons onCancel={() => (phone ? setStep('inputs') : onOpenChange(false))} busy={create.isPending} label="Save Palti box" form="palti-form" />
          )}
        </div>
      }
    >
      <form
        id="palti-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {phone ? (
          <div className="grid gap-4">
            <Segmented
              value={step}
              onChange={setStep}
              options={[
                { value: 'inputs', label: '1 · Inputs' },
                { value: 'output', label: '2 · Output' },
              ]}
              aria-label="Step"
            />
            {step === 'inputs' ? inputsPanel : outputPanel}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] md:items-start">
            {inputsPanel}
            <div className="md:sticky md:top-0">{outputPanel}</div>
          </div>
        )}
      </form>
    </YarnDialog>
  );
}

function RunCard({ run }: { run: PaltiRun }) {
  const navigate = useNavigate();
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-border bg-white p-3">
      <div className="flex items-start gap-3">
        <span className="flex min-h-12 min-w-16 flex-col items-center justify-center rounded-lg px-2 text-center" style={{ backgroundColor: ACCENT.soft, color: ACCENT.text }}>
          <span className="text-lg font-extrabold leading-none tabular-nums">{run.box?.boxNo ?? '—'}</span>
          {run.box && <span className="text-[10px] font-semibold">({run.box.fy.slice(2, 4)}-{run.box.fy.slice(5, 7)})</span>}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-slate-900">{run.box?.warpingQuality.name ?? '—'}</p>
          <p className="truncate text-sm text-slate-600">
            <Kg g={run.box?.netG ?? 0} className="font-semibold text-slate-900" /> net
            {run.wasteG > 0 && <span className="text-amber-800"> · waste {formatKg(run.wasteG)}</span>}
            {run.box?.rolls ? ` · ${run.box.rolls} rolls` : ''}
          </p>
          <p className="truncate text-xs text-slate-500">
            {formatDate(run.date)}
            {actorText(run.createdBy) ? ` · ${actorText(run.createdBy)}` : ''}
            {run.note ? ` · ${run.note}` : ''}
          </p>
        </div>
        {run.box && <ZoneTag zone={run.box.zone} short className="shrink-0" />}
      </div>
      <p className="line-clamp-2 text-xs text-slate-600">
        <span className="font-semibold text-slate-500">From: </span>
        {run.inputs.map((i) => `${i.label} (${YARN_ZONE_CONFIG[i.zone].label.split(' ')[0]}) ${formatKg(i.qtyG)}`).join(' · ')}
      </p>
      {run.box && (
        <Button variant="secondary" size="sm" className="self-start" onClick={() => navigate(`/print/yarn-boxes?ids=${run.box!.id}`)}>
          <Printer /> Print sticker
        </Button>
      )}
    </li>
  );
}

export default function YarnPaltiPage() {
  usePageTitle('Palti');
  const runs = usePaltiRuns();
  const [creating, setCreating] = useState(false);
  return (
    <div className="page-container space-y-4 pb-24 pt-3 lg:pb-6">
      <BackLink to="/yarn" label="Yarn inventory" />
      <section className="flex flex-wrap items-center gap-3 rounded-2xl border bg-white p-4 shadow-soft md:p-5" style={{ borderColor: ACCENT.border }}>
        <span className="flex size-12 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: ACCENT.soft, color: ACCENT.solid }}>
          <Recycle className="size-6" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-2xl font-extrabold tracking-tight text-slate-900">Palti</h2>
          <p className="text-sm text-slate-600">Leftover yarn re-wound into a new box — the box works like any TFO box.</p>
        </div>
        <Button className="min-h-12 w-full text-white hover:opacity-90 sm:w-auto" style={{ backgroundColor: ACCENT.solid }} onClick={() => setCreating(true)}>
          <Plus /> New Palti box
        </Button>
      </section>
      <section className="rounded-2xl border border-border bg-white p-4 shadow-soft md:p-5">
        <h3 className="mb-3 text-[15px] font-bold text-slate-800">
          Palti boxes made{runs.total !== undefined ? <span className="ml-1.5 font-semibold text-slate-400">({runs.total})</span> : null}
        </h3>
        {runs.isPending ? (
          <Skeleton className="h-28 w-full rounded-xl" />
        ) : runs.isError ? (
          <ErrorState error={runs.error} onRetry={() => void runs.refetch()} />
        ) : runs.items.length === 0 ? (
          <EmptyState icon={Recycle} title="No Palti boxes yet" description="Re-wind leftover yarn into a new box with New Palti box." className="py-10" />
        ) : (
          <>
            <ul className={cn('grid gap-3 md:grid-cols-2 xl:grid-cols-3')}>
              {runs.items.map((r) => (
                <RunCard key={r.id} run={r} />
              ))}
            </ul>
            <LoadMore hasNextPage={!!runs.hasNextPage} isFetchingNextPage={runs.isFetchingNextPage} fetchNextPage={() => void runs.fetchNextPage()} shown={runs.items.length} total={runs.total} noun="Palti boxes" />
          </>
        )}
      </section>
      <NewPaltiDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}
