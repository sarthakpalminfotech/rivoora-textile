import { AlertTriangle, Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { cleanTakaNo, JOBSHEET_STATUS, TAKA_ERROR_TEXT, validateTakaNumbers, type JobsheetStatusKey, type Taka } from '@rivoora/shared';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/input';
import { ResponsiveModal } from '@/components/ui/modal';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useEditTakas } from './api';

export interface EditTakasTarget {
  jobsheetId: number;
  jobsheetNo: number;
  status: JobsheetStatusKey;
  takas: Taka[];
  note: string | null;
}

interface Row {
  key: number;
  id?: number;
  value: string;
  damaged: boolean;
}

let rowKey = 0;
const toRows = (takas: Taka[]): Row[] => takas.map((t) => ({ key: ++rowKey, id: t.id, value: t.takaNo, damaged: t.isDamaged }));

/** Full-screen form: edit every taka of one jobsheet (number, damage, remove), add rows, edit the note. */
export function EditTakasDialog({ target, onClose }: { target: EditTakasTarget | null; onClose: () => void }) {
  const open = target !== null;
  const edit = useEditTakas(target?.jobsheetId ?? 0);
  const [rows, setRows] = useState<Row[]>([]);
  const [note, setNote] = useState('');
  const [serverError, setServerError] = useState<{ key: number; message: string } | null>(null);
  const [showErrors, setShowErrors] = useState(false);

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
  const errorList = validateTakaNumbers(kept.map((r) => r.value));
  const errors = new Map(kept.map((r, i) => [r.key, errorList[i]]));
  const hasErrors = [...errors.values()].some(Boolean);

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
        takas: kept.map((r) => ({ ...(r.id !== undefined ? { id: r.id } : {}), takaNo: r.value.trim(), isDamaged: r.damaged })),
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
          toast.success(parts.length ? `Takas of jobsheet ${target.jobsheetNo} saved (${parts.join(', ')})` : 'No changes');
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

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(o) => !o && !edit.isPending && onClose()}
      title={target ? `Edit takas · Jobsheet ${target.jobsheetNo}` : 'Edit takas'}
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
                  const message = serverError?.key === r.key ? serverError.message : showErrors && err ? TAKA_ERROR_TEXT[err].en : null;
                  const id = `edit-taka-${r.key}`;
                  return (
                    <li key={r.key} className={cn('rounded-xl p-1.5', r.damaged && 'bg-red-50 ring-1 ring-red-200')}>
                      <div className="flex items-center gap-2">
                        <span className="w-6 shrink-0 text-right text-sm font-semibold text-slate-400">{i + 1}</span>
                        <input
                          id={id}
                          value={r.value}
                          onChange={(e) => {
                            const value = cleanTakaNo(e.target.value);
                            setRow(r.key, value ? { value } : { value, damaged: false });
                          }}
                          inputMode="numeric"
                          pattern="[0-9]*"
                          autoComplete="off"
                          maxLength={10}
                          aria-label={`Taka ${i + 1} number`}
                          aria-invalid={!!message || undefined}
                          placeholder="Taka no."
                          className={cn(
                            'h-11 min-w-0 flex-1 rounded-[10px] border bg-white px-3 text-lg font-bold tabular-nums focus:outline-none focus:ring-2',
                            message ? 'border-destructive focus:ring-destructive/15' : 'border-input focus:border-primary focus:ring-primary/15',
                          )}
                        />
                        <button
                          type="button"
                          onClick={() => setRow(r.key, { damaged: !r.damaged })}
                          disabled={!r.value}
                          aria-pressed={r.damaged}
                          className={cn(
                            'inline-flex h-11 shrink-0 items-center gap-1.5 rounded-[10px] border px-2.5 text-[13px] font-semibold transition-colors disabled:opacity-40',
                            r.damaged ? 'border-red-600 bg-red-600 text-white' : 'border-input bg-white text-slate-600 hover:text-red-600',
                          )}
                        >
                          <AlertTriangle className="size-4" aria-hidden />
                          <span className="hidden sm:inline">Machine damage</span>
                          <span className="sm:hidden">Damage</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))}
                          className="flex size-11 shrink-0 items-center justify-center rounded-[10px] text-slate-400 hover:bg-destructive-soft hover:text-destructive"
                          aria-label={`Remove taka ${r.value || i + 1}`}
                        >
                          <X className="size-5" />
                        </button>
                      </div>
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
              onClick={() => setRows((prev) => [...prev, { key: ++rowKey, value: '', damaged: false }])}
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
