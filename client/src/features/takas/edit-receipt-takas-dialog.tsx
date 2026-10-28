import { Plus, X } from 'lucide-react';
import { useMemo, useRef, useState, useEffect } from 'react';
import { toast } from 'sonner';
import {
  cleanMeters,
  cleanPcs,
  cleanTakaNo,
  cleanWeaverTakaNo,
  damageTypeOptions,
  formatMeters,
  formatPcs,
  METERS_ERROR_TEXT,
  outsideTakaNumber,
  OUTSIDE_ROW_ERROR_TEXT,
  parseMeters,
  parsePcs,
  PCS_ERROR_TEXT,
  receiptLabel,
  TAKA_NO_MAX_LENGTH,
  totalMeters,
  totalPcs,
  validateOutsideRows,
  type OutsideRowError,
  type PcsError,
  type ReceiptKind,
  type Taka,
  type TakaSource,
} from '@rivoora/shared';
import { Button } from '@/components/ui/button';
import { ResponsiveModal } from '@/components/ui/modal';
import { ApiError } from '@/lib/api';
import { formatOrderNo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useEditTakas } from './api';
import { editEntryPayload, entriesOfTaka, entryLabel as entryLabelText, entrySignature, TakaDamageControl, type DamageEntry } from './damage-dialog';
import { useUsedTakaNumbers } from './taka-check';
import { TakaDamageLines } from './taka-chip';

/** A receipt's takas, ready to edit (weaver / our number, pcs, meters, damage) — Jenish / Gaurang. */
export interface EditReceiptTarget {
  jobsheetId: number;
  receiptId: number;
  orderNo: number;
  challanNo: string;
  poNo: number | null;
  partyName: string | null;
  kind: ReceiptKind;
  /** The weaver's short code, or `FG` — the prefix of a taka received without our own number. */
  prefix: string;
  /** Sprint 19: a meter order's receipt rows carry metres, not pcs — pcs is hidden and metres become required. */
  meterOrder: boolean;
  takas: Taka[];
  /** The external jobsheet's note, shared by every receipt of this order — sent back unchanged. */
  note: string | null;
  hasButta: boolean;
  hasMill: boolean;
}

interface Row {
  key: number;
  id?: number;
  weaverNo: string;
  ourNo: string;
  meters: string;
  pcs: string;
  damages: DamageEntry[];
  resolved: Taka['damages'];
  orig?: { weaverNo: string; ourNo: string; meters: string; pcs: string; damages: string };
}

const damagesKey = (list: DamageEntry[]) => list.map(entrySignature).join(',');

let rowKey = 0;
const toRows = (takas: Taka[]): Row[] =>
  takas.map((t) => {
    const row = {
      key: ++rowKey,
      id: t.id,
      weaverNo: t.weaverTakaNo ?? '',
      ourNo: t.hasOwnNumber ? t.takaNo : '',
      meters: t.meters != null ? String(t.meters) : '',
      pcs: t.pcs != null ? String(t.pcs) : '',
      damages: entriesOfTaka(t),
      resolved: t.damages.filter((d) => d.status === 'resolved'),
    };
    return { ...row, orig: { weaverNo: row.weaverNo, ourNo: row.ourNo, meters: row.meters, pcs: row.pcs, damages: damagesKey(row.damages) } };
  });

const isChanged = (r: Row) =>
  !r.orig ||
  r.orig.weaverNo !== r.weaverNo.trim() ||
  r.orig.ourNo !== r.ourNo.trim() ||
  r.orig.meters !== r.meters ||
  r.orig.pcs !== r.pcs ||
  r.orig.damages !== damagesKey(r.damages);

const isUsed = (r: Row) => r.weaverNo.trim() !== '' || r.ourNo.trim() !== '' || r.pcs !== '' || r.meters !== '' || r.damages.length > 0;

function pcsError(r: Row, meterOrder: boolean): PcsError | null {
  if (meterOrder) return null;
  const { error } = parsePcs(r.pcs);
  if (error !== 'required') return error;
  const legacyUntouched = !!r.orig && r.orig.pcs === '' && !isChanged(r);
  return legacyUntouched ? null : 'required';
}

/** Sprint 19: the meter twin of `pcsError` — a meter order's receipt row needs metres. */
function metersRequiredError(r: Row, meterOrder: boolean): 'required' | null {
  if (!meterOrder || parseMeters(r.meters).error) return null;
  if (r.meters.trim() !== '') return null;
  const legacyUntouched = !!r.orig && r.orig.meters === '' && !isChanged(r);
  return legacyUntouched ? null : 'required';
}

/** Full-screen form: edit one receipt's takas (weaver / our number, meters, pcs, damage, remove), add rows. */
export function EditReceiptTakasDialog({ target, onClose }: { target: EditReceiptTarget | null; onClose: () => void }) {
  const open = target !== null;
  const edit = useEditTakas(target?.jobsheetId ?? 0);
  const [rows, setRows] = useState<Row[]>([]);
  const [serverError, setServerError] = useState<{ key: number; field: string; message: string } | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const weaverInputs = useRef(new Map<number, HTMLInputElement>());

  useEffect(() => {
    if (!target) return;
    setRows(toRows(target.takas));
    setServerError(null);
    setShowErrors(false);
    edit.reset();
    // Only when a different receipt opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.receiptId]);

  const prefix = target?.prefix ?? '';
  const meterOrder = target?.meterOrder ?? false;
  const canAdd = true; // the external jobsheet is always "Completed" — new rows can always be added
  const kept = rows.filter((r) => r.id !== undefined || isUsed(r));

  const systemNoOf = (r: Row) => {
    const w = r.weaverNo.trim();
    return w ? outsideTakaNumber(prefix, w, r.ourNo) : '';
  };
  const ownNumbers = useMemo(() => new Set((target?.takas ?? []).map((t) => t.takaNo)), [target]);
  const used = useUsedTakaNumbers(kept.map(systemNoOf), ownNumbers);
  const rowErrors = validateOutsideRows(kept.map((r) => ({ weaverTakaNo: r.weaverNo, ourTakaNo: r.ourNo || null })), prefix, { usedSystemNos: new Set(used.keys()) });
  const errors = new Map<number, OutsideRowError | null>(kept.map((r, i) => [r.key, rowErrors[i]]));
  const meterErrors = new Map(kept.map((r) => [r.key, parseMeters(r.meters).error]));
  const meterRequiredErrors = new Map(kept.map((r) => [r.key, metersRequiredError(r, meterOrder)]));
  const pcsErrors = new Map(kept.map((r) => [r.key, pcsError(r, meterOrder)]));
  const hasErrors =
    [...errors.values()].some(Boolean) ||
    [...meterErrors.values()].some(Boolean) ||
    [...meterRequiredErrors.values()].some(Boolean) ||
    [...pcsErrors.values()].some(Boolean);
  const totalM = totalMeters(kept.map((r) => ({ meters: parseMeters(r.meters).meters })));
  const totalP = totalPcs(kept.map((r) => ({ pcs: parsePcs(r.pcs).pcs })));

  const setRow = (key: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    if (serverError?.key === key) setServerError(null);
  };

  const save = () => {
    if (!target) return;
    setShowErrors(true);
    if (hasErrors) return;
    edit.mutate(
      {
        receiptId: target.receiptId,
        takas: kept.map((r) => ({
          ...(r.id !== undefined ? { id: r.id } : {}),
          takaNo: systemNoOf(r),
          weaverTakaNo: r.weaverNo.trim() || null,
          meters: parseMeters(r.meters).meters,
          pcs: parsePcs(r.pcs).pcs,
          damages: r.damages.map((e) => editEntryPayload(e, meterOrder)),
        })),
        // The note is shared by every receipt of this order — sent back exactly as it was read.
        note: target.note,
      },
      {
        onSuccess: (res) => {
          const parts = [res.added && `${res.added} added`, res.removed && `${res.removed} removed`, res.changed && `${res.changed} changed`].filter(Boolean);
          toast.success(parts.length ? `Takas saved (${parts.join(', ')})` : 'No changes');
          onClose();
        },
        onError: (err) => {
          const m = err instanceof ApiError && err.field ? /^takas\.(\d+)\.(\w+)/.exec(err.field) : null;
          const row = m ? kept[Number(m[1])] : undefined;
          if (row && err instanceof ApiError) setServerError({ key: row.key, field: m![2], message: err.message });
        },
      },
    );
  };

  const field = (invalid: boolean) =>
    cn(
      'h-11 w-full rounded-[10px] border bg-white text-base font-bold tabular-nums placeholder:text-sm placeholder:font-normal focus:outline-none focus:ring-2 disabled:bg-slate-50 disabled:opacity-60',
      invalid ? 'border-destructive focus:ring-destructive/15' : 'border-input focus:border-primary focus:ring-primary/15',
    );

  const damageTypes = target ? damageTypeOptions({ source: (target.kind === 'fg' ? 'fg_purchase' : 'outside_po') as TakaSource, hasButta: target.hasButta, hasMill: target.hasMill }) : undefined;
  const source = target ? ((target.kind === 'fg' ? 'fg_purchase' : 'outside_po') as TakaSource) : undefined;

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(o) => !o && !edit.isPending && onClose()}
      title={target ? `Edit takas · ${formatOrderNo(target.orderNo)} · ${receiptLabel({ challanNo: target.challanNo, poNo: target.poNo, supplierName: target.partyName })}` : 'Edit takas'}
      size="md"
      dismissible={!edit.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={edit.isPending}>
            Cancel
          </Button>
          <Button onClick={save} loading={edit.isPending} disabled={showErrors && hasErrors}>
            Save takas
          </Button>
        </>
      }
    >
      {target && (
        <div className="space-y-5">
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-700">
                Takas <span className="font-normal text-slate-500">({kept.length})</span>
                {totalM !== null && <span className="ml-1.5 font-normal text-slate-500">· {formatMeters(totalM)}</span>}
                {totalP !== null && <span className="ml-1.5 font-normal text-slate-500">· {formatPcs(totalP)}</span>}
              </h3>
            </div>
            {rows.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">No takas. Add a row to enter one.</p>
            ) : (
              <ol className="space-y-2">
                {rows.map((r, i) => {
                  const err = errors.get(r.key) ?? null;
                  const meterErr = meterErrors.get(r.key) ?? null;
                  const meterRequiredErr = showErrors ? (meterRequiredErrors.get(r.key) ?? null) : null;
                  const pErr = showErrors ? (pcsErrors.get(r.key) ?? null) : null;
                  const weaverMsg =
                    serverError?.key === r.key && serverError.field === 'weaverTakaNo'
                      ? serverError.message
                      : showErrors && err && (err.startsWith('weaver') || err === 'system_used')
                        ? OUTSIDE_ROW_ERROR_TEXT[err]
                        : null;
                  const ourMsg =
                    serverError?.key === r.key && serverError.field === 'ourTakaNo'
                      ? serverError.message
                      : showErrors && err && err.startsWith('own')
                        ? OUTSIDE_ROW_ERROR_TEXT[err]
                        : null;
                  const otherMsg = serverError?.key === r.key && serverError.field !== 'weaverTakaNo' && serverError.field !== 'ourTakaNo' ? serverError.message : null;
                  const removeButton = (className: string) => (
                    <button
                      type="button"
                      onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))}
                      className={cn('size-11 shrink-0 items-center justify-center rounded-[10px] text-slate-400 hover:bg-destructive-soft hover:text-destructive', className)}
                      aria-label={`Remove row ${i + 1}`}
                    >
                      <X className="size-5" />
                    </button>
                  );
                  return (
                    <li key={r.key} className={cn('rounded-xl p-1.5', r.damages.length > 0 && 'bg-red-50 ring-1 ring-red-200')}>
                      {/* Flex-wrap, not a breakpoint-gated row: this dialog can be as narrow as a phone sheet or as
                          wide as a desktop modal, so fields reflow onto their own line instead of being squeezed. */}
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="w-5 shrink-0 text-right text-sm font-semibold text-slate-400">{i + 1}</span>
                        <input
                          ref={(el) => {
                            if (el) weaverInputs.current.set(r.key, el);
                            else weaverInputs.current.delete(r.key);
                          }}
                          value={r.weaverNo}
                          onChange={(e) => setRow(r.key, { weaverNo: cleanWeaverTakaNo(e.target.value) })}
                          inputMode="tel"
                          autoComplete="off"
                          aria-label={`Row ${i + 1} weaver taka no`}
                          aria-invalid={!!weaverMsg || undefined}
                          placeholder="Weaver no."
                          className={cn(field(!!weaverMsg), 'min-w-[7rem] flex-1 basis-[7rem] px-3 text-lg')}
                        />
                        <input
                          value={r.ourNo}
                          onChange={(e) => setRow(r.key, { ourNo: cleanTakaNo(e.target.value) })}
                          inputMode="tel"
                          autoComplete="off"
                          maxLength={TAKA_NO_MAX_LENGTH}
                          aria-label={`Row ${i + 1} our taka no`}
                          aria-invalid={!!ourMsg || undefined}
                          placeholder="Our no. (optional)"
                          className={cn(field(!!ourMsg), 'min-w-[7rem] flex-1 basis-[7rem] px-3 text-lg')}
                        />
                        <div className={cn('relative shrink-0', meterOrder ? 'w-24' : 'w-[5.5rem]')}>
                          <input
                            value={r.meters}
                            onChange={(e) => setRow(r.key, { meters: cleanMeters(e.target.value) })}
                            disabled={!isUsed(r)}
                            inputMode="decimal"
                            autoComplete="off"
                            aria-label={`Row ${i + 1} meters`}
                            aria-required={meterOrder || undefined}
                            aria-invalid={!!meterErr || !!meterRequiredErr || undefined}
                            placeholder="Meters"
                            className={cn(field(!!meterErr || !!meterRequiredErr), 'w-full pl-2.5 pr-6')}
                          />
                          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400" aria-hidden>
                            m
                          </span>
                        </div>
                        {!meterOrder && (
                          <div className="relative w-[4.75rem] shrink-0">
                            <input
                              value={r.pcs}
                              onChange={(e) => setRow(r.key, { pcs: cleanPcs(e.target.value) })}
                              disabled={!isUsed(r)}
                              inputMode="numeric"
                              autoComplete="off"
                              aria-label={`Row ${i + 1} pcs`}
                              aria-required
                              aria-invalid={!!pErr || undefined}
                              placeholder="Pcs"
                              className={cn(field(!!pErr), 'w-full pl-2.5 pr-8')}
                            />
                            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400" aria-hidden>
                              pcs
                            </span>
                          </div>
                        )}
                        <div className="shrink-0">
                          <TakaDamageControl
                            entries={r.damages}
                            onChange={(damages) => setRow(r.key, { damages })}
                            takaLabel={`Taka ${r.weaverNo || i + 1}`}
                            takaPcs={parsePcs(r.pcs).pcs}
                            meterOrder={meterOrder}
                            takaMeters={parseMeters(r.meters).meters}
                            disabled={!isUsed(r)}
                            types={damageTypes}
                            source={source}
                            allowImages
                            size="sm"
                          />
                        </div>
                        {removeButton('flex')}
                      </div>
                      {(r.damages.length > 0 || r.resolved.length > 0) && (
                        <div className="ml-8 mt-1.5">
                          <ul className="space-y-0.5">
                            {r.damages.map((d) => (
                              <li key={d.key} className="text-[12px] font-semibold text-red-600">
                                {entryLabelText(d)}
                              </li>
                            ))}
                          </ul>
                          {r.resolved.length > 0 && <TakaDamageLines damages={r.resolved} className="mt-0.5" />}
                        </div>
                      )}
                      {otherMsg && (
                        <p role="alert" className="ml-8 mt-1 text-[13px] font-medium text-destructive">
                          {otherMsg}
                        </p>
                      )}
                      {weaverMsg && (
                        <p role="alert" className="ml-8 mt-1 text-[13px] font-medium text-destructive">
                          {weaverMsg}
                        </p>
                      )}
                      {ourMsg && (
                        <p role="alert" className="ml-8 mt-1 text-[13px] font-medium text-destructive">
                          {ourMsg}
                        </p>
                      )}
                      {meterErr && (
                        <p role="alert" className="ml-8 mt-1 text-[13px] font-medium text-destructive">
                          {METERS_ERROR_TEXT[meterErr].en}
                        </p>
                      )}
                      {!meterErr && meterRequiredErr && (
                        <p role="alert" className="ml-8 mt-1 text-[13px] font-medium text-destructive">
                          Enter the metres
                        </p>
                      )}
                      {pErr && (
                        <p role="alert" className="ml-8 mt-1 text-[13px] font-medium text-destructive">
                          {PCS_ERROR_TEXT[pErr].en}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
            <Button
              variant="secondary"
              className="mt-3 w-full border-dashed"
              disabled={!canAdd}
              onClick={() => setRows((prev) => [...prev, { key: ++rowKey, weaverNo: '', ourNo: '', meters: '', pcs: '', damages: [], resolved: [] }])}
            >
              <Plus /> Add row
            </Button>
          </div>
        </div>
      )}
    </ResponsiveModal>
  );
}
