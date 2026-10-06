import { Plus, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  cleanMeters,
  cleanPcs,
  cleanTakaNo,
  formatMeters,
  formatPcs,
  JOBSHEET_STATUS,
  jobsheetRef,
  jobsheetRefShort,
  METERS_ERROR_TEXT,
  parseMeters,
  parsePcs,
  PCS_ERROR_TEXT,
  TAKA_NO_MAX_LENGTH,
  totalMeters,
  totalPcs,
  validateTakaNumbers,
  type JobsheetStatusKey,
  type PcsError,
  type Taka,
} from '@rivoora/shared';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/input';
import { ResponsiveModal } from '@/components/ui/modal';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useEditTakas } from './api';
import { editEntryPayload, entriesOfTaka, entryLabel as entryLabelText, entrySignature, TakaDamageControl, type DamageEntry } from './damage-dialog';
import { takaErrorText, useUsedTakaNumbers } from './taka-check';
import { TakaDamageLines } from './taka-chip';

export interface EditTakasTarget {
  jobsheetId: number;
  jobsheetNo: number;
  orderNo: number;
  status: JobsheetStatusKey;
  takas: Taka[];
  note: string | null;
}

interface Row {
  key: number;
  id?: number;
  value: string;
  /** Meters as typed (optional). */
  meters: string;
  /** Pcs as typed (required on new / changed takas). */
  pcs: string;
  /** The OPEN damages (editable); resolved ones are read-only and shown below the row. */
  damages: DamageEntry[];
  resolved: Taka['damages'];
  /** The saved values of an existing taka (to tell whether it was changed). */
  orig?: { value: string; meters: string; pcs: string; damages: string };
}

const damagesKey = (list: DamageEntry[]) => list.map(entrySignature).join(',');

let rowKey = 0;
const toRows = (takas: Taka[]): Row[] =>
  takas.map((t) => {
    const row = {
      key: ++rowKey,
      id: t.id,
      value: t.takaNo,
      meters: t.meters != null ? String(t.meters) : '',
      pcs: t.pcs != null ? String(t.pcs) : '',
      damages: entriesOfTaka(t),
      resolved: t.damages.filter((d) => d.status === 'resolved'),
    };
    return { ...row, orig: { value: row.value, meters: row.meters, pcs: row.pcs, damages: damagesKey(row.damages) } };
  });

const isChanged = (r: Row) =>
  !r.orig || r.orig.value !== r.value.trim() || r.orig.meters !== r.meters || r.orig.pcs !== r.pcs || r.orig.damages !== damagesKey(r.damages);

/**
 * Pcs rule (the server checks the same): new and changed takas need pcs; an older taka that never had pcs may stay
 * without as long as it is not changed.
 */
function pcsError(r: Row): PcsError | null {
  const { error } = parsePcs(r.pcs);
  if (error !== 'required') return error;
  const legacyUntouched = !!r.orig && r.orig.pcs === '' && !isChanged(r);
  return legacyUntouched ? null : 'required';
}

/** Full-screen form: edit every taka of one jobsheet (number, meters, pcs, damage, remove), add rows, edit the note. */
export function EditTakasDialog({ target, onClose }: { target: EditTakasTarget | null; onClose: () => void }) {
  const open = target !== null;
  const edit = useEditTakas(target?.jobsheetId ?? 0);
  const [rows, setRows] = useState<Row[]>([]);
  const [note, setNote] = useState('');
  const [serverError, setServerError] = useState<{ key: number; message: string } | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const inputs = useRef(new Map<number, HTMLInputElement>());

  useEffect(() => {
    if (!target) return;
    setRows(toRows(target.takas));
    setNote(target.note ?? '');
    setServerError(null);
    setShowErrors(false);
    edit.reset();
    // Only when a different jobsheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.jobsheetId]);

  const canAdd = target?.status === JOBSHEET_STATUS.COMPLETED;
  // New empty rows are ignored on save; an emptied existing row is an error (remove it with ✕ instead).
  const kept = rows.filter((r) => r.id !== undefined || r.value.trim() !== '');
  // Taka numbers are unique across the whole system (live check; this jobsheet's own saved numbers are ignored).
  const used = useUsedTakaNumbers(
    rows.map((r) => r.value),
    useMemo(() => new Set((target?.takas ?? []).map((t) => t.takaNo)), [target]),
  );
  const errorList = validateTakaNumbers(kept.map((r) => r.value), [], { used });
  const errors = new Map(kept.map((r, i) => [r.key, errorList[i]]));
  const meterErrors = new Map(kept.map((r) => [r.key, parseMeters(r.meters).error]));
  const pcsErrors = new Map(kept.map((r) => [r.key, pcsError(r)]));
  const hasErrors =
    [...errors.values()].some(Boolean) || [...meterErrors.values()].some(Boolean) || [...pcsErrors.values()].some(Boolean);
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
        takas: kept.map((r) => ({
          ...(r.id !== undefined ? { id: r.id } : {}),
          takaNo: r.value.trim(),
          meters: parseMeters(r.meters).meters,
          pcs: parsePcs(r.pcs).pcs,
          damages: r.damages.map(editEntryPayload),
        })),
        note: note.trim() || null,
      },
      {
        onSuccess: (res) => {
          const parts = [
            res.added && `${res.added} added`,
            res.removed && `${res.removed} removed`,
            res.changed && `${res.changed} changed`,
            res.noteChanged && 'note updated',
          ].filter(Boolean);
          toast.success(
            parts.length ? `Takas of ${jobsheetRefShort(target.orderNo, target.jobsheetNo)} saved (${parts.join(', ')})` : 'No changes',
          );
          onClose();
        },
        onError: (err) => {
          const m = err instanceof ApiError && err.field ? /^takas\.(\d+)\./.exec(err.field) : null;
          const row = m ? kept[Number(m[1])] : undefined;
          if (row && err instanceof ApiError) setServerError({ key: row.key, message: err.message });
        },
      },
    );
  };

  const field = (invalid: boolean) =>
    cn(
      'h-11 w-full rounded-[10px] border bg-white text-base font-bold tabular-nums placeholder:text-sm placeholder:font-normal focus:outline-none focus:ring-2 disabled:bg-slate-50 disabled:opacity-60',
      invalid ? 'border-destructive focus:ring-destructive/15' : 'border-input focus:border-primary focus:ring-primary/15',
    );

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(o) => !o && !edit.isPending && onClose()}
      title={target ? `Edit takas · ${jobsheetRef(target.orderNo, target.jobsheetNo)}` : 'Edit takas'}
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
              <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                No takas. {canAdd ? 'Add a row to enter one.' : ''}
              </p>
            ) : (
              <ol className="space-y-2">
                {rows.map((r, i) => {
                  const err = errors.get(r.key) ?? null;
                  const meterErr = meterErrors.get(r.key) ?? null;
                  const pErr = showErrors ? (pcsErrors.get(r.key) ?? null) : null;
                  const message =
                    serverError?.key === r.key
                      ? serverError.message
                      : showErrors && err
                        ? takaErrorText(err, r.value, used).en
                        : meterErr
                          ? METERS_ERROR_TEXT[meterErr].en
                          : pErr
                            ? PCS_ERROR_TEXT[pErr].en
                            : null;
                  const numberInvalid = (showErrors && !!err) || serverError?.key === r.key;
                  const removeButton = (className: string) => (
                    <button
                      type="button"
                      onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))}
                      className={cn(
                        'size-11 shrink-0 items-center justify-center rounded-[10px] text-slate-400 hover:bg-destructive-soft hover:text-destructive',
                        className,
                      )}
                      aria-label={`Remove taka ${r.value || i + 1}`}
                    >
                      <X className="size-5" />
                    </button>
                  );
                  return (
                    <li key={r.key} className={cn('rounded-xl p-1.5', r.damages.length > 0 && 'bg-red-50 ring-1 ring-red-200')}>
                      {/* Phones: number (+ remove) on one line, meters · pcs · damage on the next. md+: one row. */}
                      <div className="flex flex-col gap-2 md:flex-row md:items-center">
                        <div className="flex min-w-0 items-center gap-2 md:flex-1">
                          <span className="w-6 shrink-0 text-right text-sm font-semibold text-slate-400">{i + 1}</span>
                          <input
                            ref={(el) => {
                              if (el) inputs.current.set(r.key, el);
                              else inputs.current.delete(r.key);
                            }}
                            value={r.value}
                            onChange={(e) => {
                              const value = cleanTakaNo(e.target.value);
                              setRow(r.key, value ? { value } : { value, meters: '', pcs: '', damages: [] });
                            }}
                            inputMode="tel"
                            autoComplete="off"
                            maxLength={TAKA_NO_MAX_LENGTH}
                            aria-label={`Taka ${i + 1} number`}
                            aria-invalid={numberInvalid || undefined}
                            placeholder="Taka no."
                            className={cn(field(numberInvalid), 'min-w-0 flex-1 px-3 text-lg')}
                          />
                          {removeButton('flex md:hidden')}
                        </div>
                        <div className="flex items-center gap-2 pl-8 md:pl-0">
                          <div className="relative w-[5.5rem] shrink-0 sm:w-24">
                            <input
                              value={r.meters}
                              onChange={(e) => setRow(r.key, { meters: cleanMeters(e.target.value) })}
                              disabled={!r.value}
                              inputMode="decimal"
                              autoComplete="off"
                              aria-label={`Taka ${i + 1} meters`}
                              aria-invalid={!!meterErr || undefined}
                              placeholder="Meters"
                              className={cn(field(!!meterErr), 'pl-2.5 pr-6')}
                            />
                            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400" aria-hidden>
                              m
                            </span>
                          </div>
                          <div className="relative w-[4.75rem] shrink-0 sm:w-20">
                            <input
                              value={r.pcs}
                              onChange={(e) => setRow(r.key, { pcs: cleanPcs(e.target.value) })}
                              disabled={!r.value}
                              inputMode="numeric"
                              autoComplete="off"
                              aria-label={`Taka ${i + 1} pcs`}
                              aria-required
                              aria-invalid={!!pErr || undefined}
                              placeholder="Pcs"
                              className={cn(field(!!pErr), 'pl-2.5 pr-8')}
                            />
                            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400" aria-hidden>
                              pcs
                            </span>
                          </div>
                          <TakaDamageControl
                            entries={r.damages}
                            onChange={(damages) => setRow(r.key, { damages })}
                            takaLabel={`Taka ${r.value || i + 1}`}
                            takaPcs={parsePcs(r.pcs).pcs}
                            disabled={!r.value}
                            size="sm"
                            className="min-w-0 flex-1 md:max-w-44 md:flex-none"
                          />
                          {removeButton('hidden md:flex')}
                        </div>
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
                      {message && (
                        <p role="alert" className="ml-8 mt-1 text-[13px] font-medium text-destructive">
                          {message}
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
              onClick={() => setRows((prev) => [...prev, { key: ++rowKey, value: '', meters: '', pcs: '', damages: [], resolved: [] }])}
            >
              <Plus /> Add row
            </Button>
            {!canAdd && (
              <p className="mt-1.5 text-[13px] text-muted-foreground">Takas can be added once the jobsheet is completed.</p>
            )}
          </div>

          <Field label="Taka note" htmlFor="edit-taka-note">
            <Textarea id="edit-taka-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder="No note" />
          </Field>
        </div>
      )}
    </ResponsiveModal>
  );
}
