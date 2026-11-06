import { Lock, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  cleanMeters,
  cleanPcs,
  formatMeters,
  formatPcs,
  jobsheetRef,
  METERS_ERROR_TEXT,
  parseMeters,
  parsePcs,
  PCS_ERROR_TEXT,
  totalMeters,
  totalPcs,
  type Taka,
} from '@rivoora/shared';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ResponsiveModal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, errorMessage } from '@/lib/api';
import { Bi, bi } from '@/lib/bilingual';
import { cn } from '@/lib/utils';
import { useEditOwnTakas, useOwnEditData } from './api';
import { editEntryPayload, entriesOfTaka, entryLabel as entryLabelText, entrySignature, TakaDamageControl, type DamageEntry } from './damage-dialog';

interface Row {
  key: number;
  id?: number;
  /** The saved number (read-only) — new rows get theirs from the server. */
  takaNo: string | null;
  meters: string;
  pcs: string;
  damages: DamageEntry[];
  editable: boolean;
  /** Why a locked row is locked (the stage it went to). */
  stage: Taka['stage'] | null;
  orig?: { meters: string; pcs: string; damages: string };
}

const damagesKey = (list: DamageEntry[]) => list.map(entrySignature).join(',');
let rowKey = 0;

const isChanged = (r: Row) => !r.orig || r.orig.meters !== r.meters || r.orig.pcs !== r.pcs || r.orig.damages !== damagesKey(r.damages);

/** Where a locked taka went — "Gone to butta / बट्टा में गया". */
function lockedLabel(stage: Taka['stage'] | null): string {
  if (stage === 'at_mill' || stage === 'mill_qc') return bi('Gone to mill', 'मिल में गया');
  if (stage === 'final' || stage === 'refinish' || stage === 'ready_dispatch' || stage === 'dispatched') return bi('Gone past the mill', 'मिल से आगे गया');
  if (stage === 'waiting_mill') return bi('Butta QC done', 'बट्टा क्यूसी हो गया');
  return bi('Gone to butta', 'बट्टा में गया');
}

/**
 * Sprint 21 (CR-06) — the Taka entry person edits his own takas: pcs, meters, damage, delete a row, add rows. Numbers are
 * shown, never edited. A taka that has moved on is greyed out. Phone: one row per taka · tablet: two rows side by side.
 */
export function OwnEditTakasDialog({ jobsheetId, onClose }: { jobsheetId: number | null; onClose: () => void }) {
  const open = jobsheetId !== null;
  const data = useOwnEditData(jobsheetId ?? 0, open);
  const edit = useEditOwnTakas(jobsheetId ?? 0);
  const [rows, setRows] = useState<Row[]>([]);
  const [serverError, setServerError] = useState<{ key: number; message: string } | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const loadedFor = useRef<number | null>(null);

  const d = data.data;
  useEffect(() => {
    if (!d || loadedFor.current === d.jobsheetId) return;
    loadedFor.current = d.jobsheetId;
    setRows(
      d.takas.map((t) => {
        const damages = entriesOfTaka(t);
        const row: Row = {
          key: ++rowKey,
          id: t.id,
          takaNo: t.takaNo,
          meters: t.meters != null ? String(t.meters) : '',
          pcs: t.pcs != null ? String(t.pcs) : '',
          damages,
          editable: t.editable,
          stage: t.stage,
        };
        return { ...row, orig: { meters: row.meters, pcs: row.pcs, damages: damagesKey(damages) } };
      }),
    );
    setServerError(null);
    setShowErrors(false);
  }, [d]);
  useEffect(() => {
    if (!open) {
      loadedFor.current = null;
      setRows([]);
      setConfirmOpen(false);
    }
  }, [open]);

  const meterOrder = d?.meterOrder ?? false;
  const setRow = (key: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    if (serverError?.key === key) setServerError(null);
  };
  const isUsed = (r: Row) => r.pcs !== '' || r.meters !== '' || r.damages.length > 0;
  // A NEW row counts once something is typed; an emptied existing row is an error (use ✕ to delete it).
  const kept = rows.filter((r) => r.id !== undefined || isUsed(r));
  const errorOf = (r: Row): string | null => {
    const m = parseMeters(r.meters).error;
    if (m) return `${METERS_ERROR_TEXT[m].en} / ${METERS_ERROR_TEXT[m].hi}`;
    if (!r.editable) return null;
    if (meterOrder) {
      return r.meters.trim() === '' ? `${bi('Enter the metres', 'मीटर लिखें')}` : null;
    }
    const p = parsePcs(r.pcs).error;
    if (p && !(r.id !== undefined && r.orig?.pcs === '' && !isChanged(r))) return `${PCS_ERROR_TEXT[p].en} / ${PCS_ERROR_TEXT[p].hi}`;
    return null;
  };
  const hasErrors = kept.some((r) => errorOf(r));
  const removedCount = d ? d.takas.filter((t) => !rows.some((r) => r.id === t.id)).length : 0;
  const changedCount = kept.filter((r) => r.id !== undefined && r.editable && isChanged(r)).length;
  const addedCount = kept.filter((r) => r.id === undefined).length;
  const totalM = totalMeters(kept.map((r) => ({ meters: parseMeters(r.meters).meters })));
  const totalP = totalPcs(kept.map((r) => ({ pcs: parsePcs(r.pcs).pcs })));

  const trySave = () => {
    setShowErrors(true);
    if (hasErrors) return;
    if (!removedCount && !changedCount && !addedCount) {
      toast.message(bi('No changes', 'कोई बदलाव नहीं'));
      onClose();
      return;
    }
    setConfirmOpen(true);
  };

  const save = () => {
    edit.mutate(
      {
        takas: kept.map((r) => ({
          ...(r.id !== undefined ? { id: r.id } : {}),
          meters: parseMeters(r.meters).meters,
          pcs: parsePcs(r.pcs).pcs,
          damages: r.damages.map((e) => editEntryPayload(e, meterOrder)),
        })),
        note: d?.takaNote ?? null,
      },
      {
        onSuccess: () => {
          setConfirmOpen(false);
          toast.success(bi('Saved', 'सेव हो गया'));
          onClose();
        },
        onError: (err) => {
          setConfirmOpen(false);
          const m = err instanceof ApiError && err.field ? /^takas\.(\d+)\./.exec(err.field) : null;
          const row = m ? kept[Number(m[1])] : undefined;
          if (row && err instanceof ApiError) setServerError({ key: row.key, message: err.message });
          else toast.error(errorMessage(err));
        },
      },
    );
  };

  const field = (invalid: boolean) =>
    cn(
      'h-12 w-full rounded-[10px] border bg-white text-lg font-bold tabular-nums placeholder:text-sm placeholder:font-normal focus:outline-none focus:ring-2 disabled:bg-slate-100 disabled:text-slate-400',
      invalid ? 'border-destructive focus:ring-destructive/15' : 'border-input focus:border-primary focus:ring-primary/15',
    );

  const summary = [
    changedCount && `${changedCount} ${bi('changed', 'बदले')}`,
    removedCount && `${removedCount} ${bi('deleted', 'हटाए')}`,
    addedCount && `${addedCount} ${bi('added', 'जोड़े')}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <ResponsiveModal
        open={open}
        onOpenChange={(o) => !o && !edit.isPending && onClose()}
        title={d ? bi(`Edit takas · ${jobsheetRef(d.orderNo, d.jobsheetNo)}`, `टाका बदलें · ऑर्डर #${d.orderNo} (${d.jobsheetNo})`) : bi('Edit takas', 'टाका बदलें')}
        size="lg"
        dismissible={!edit.isPending}
        footer={
          <div className="kb-bar grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
            <Button variant="secondary" size="lg" className="h-14" onClick={onClose} disabled={edit.isPending}>
              <Bi en="Cancel" hi="रद्द करें" className="items-center" />
            </Button>
            <Button size="lg" className="h-14" onClick={trySave} loading={edit.isPending} disabled={!d || (showErrors && hasErrors)}>
              <Bi en="Save" hi="सेव करें" className="items-center" />
            </Button>
          </div>
        }
      >
        {data.isPending ? (
          <div className="space-y-3">
            <Skeleton className="h-20 rounded-xl" />
            <Skeleton className="h-20 rounded-xl" />
          </div>
        ) : data.isError ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {errorMessage(data.error)}
          </p>
        ) : (
          <div className="space-y-4">
            <p className="text-sm font-semibold text-slate-600">
              <Bi en="Takas" hi="टाका" layout="inline" /> ({kept.length})
              {totalM !== null && <span className="ml-1.5 font-normal text-slate-500">· {formatMeters(totalM)}</span>}
              {totalP !== null && <span className="ml-1.5 font-normal text-slate-500">· {formatPcs(totalP)}</span>}
            </p>
            {/* phone: one column · tablet: two takas side by side · desktop: one wide row each */}
            <ol className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-1">
              {rows.map((r) => {
                const err = (showErrors && errorOf(r)) || (serverError?.key === r.key ? serverError.message : null);
                const locked = !r.editable;
                return (
                  <li key={r.key} className={cn('rounded-xl border p-3', locked ? 'border-slate-200 bg-slate-50' : r.damages.length ? 'border-red-200 bg-red-50' : 'border-border bg-white')}>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-xl font-bold tabular-nums text-slate-900">{r.takaNo ?? bi('New', 'नया')}</span>
                      {locked ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500">
                          <Lock className="size-3.5" aria-hidden /> {lockedLabel(r.stage)}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))}
                          className="flex size-11 items-center justify-center rounded-[10px] text-slate-400 hover:bg-destructive-soft hover:text-destructive"
                          aria-label={bi(`Delete taka ${r.takaNo ?? ''}`, `टाका ${r.takaNo ?? ''} हटाएं`)}
                        >
                          <X className="size-5" />
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {!meterOrder && (
                        <div className="relative w-24 shrink-0">
                          <input
                            value={r.pcs}
                            onChange={(e) => setRow(r.key, { pcs: cleanPcs(e.target.value) })}
                            disabled={locked}
                            inputMode="numeric"
                            autoComplete="off"
                            aria-label={bi('Pcs', 'पीस')}
                            placeholder={bi('Pcs', 'पीस')}
                            className={cn(field(!!err && !!errorOf(r) && !parsePcs(r.pcs).pcs), 'pl-2.5 pr-2')}
                          />
                        </div>
                      )}
                      <div className="relative w-28 shrink-0">
                        <input
                          value={r.meters}
                          onChange={(e) => setRow(r.key, { meters: cleanMeters(e.target.value) })}
                          disabled={locked}
                          inputMode="decimal"
                          autoComplete="off"
                          aria-label={bi('Meters', 'मीटर')}
                          placeholder={bi('Meters', 'मीटर')}
                          className={cn(field(meterOrder && !!err && r.meters.trim() === ''), 'pl-2.5 pr-6')}
                        />
                        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400" aria-hidden>
                          m
                        </span>
                      </div>
                      <TakaDamageControl
                        entries={r.damages}
                        onChange={(damages) => setRow(r.key, { damages })}
                        takaLabel={bi(`Taka ${r.takaNo ?? ''}`, `टाका ${r.takaNo ?? ''}`)}
                        takaPcs={parsePcs(r.pcs).pcs}
                        meterOrder={meterOrder}
                        takaMeters={parseMeters(r.meters).meters}
                        disabled={locked}
                        size="sm"
                        className="min-w-0 flex-1"
                      />
                    </div>
                    {r.damages.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5">
                        {r.damages.map((x) => (
                          <li key={x.key} className="text-[12px] font-semibold text-red-600">
                            {entryLabelText(x)}
                          </li>
                        ))}
                      </ul>
                    )}
                    {err && (
                      <p role="alert" className="mt-1 text-[13px] font-semibold text-destructive">
                        {err}
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
            <Button
              variant="secondary"
              size="lg"
              className="h-14 w-full border-dashed text-base"
              disabled={!d?.canAdd}
              onClick={() => setRows((prev) => [...prev, { key: ++rowKey, takaNo: null, meters: '', pcs: '', damages: [], editable: true, stage: null }])}
            >
              <Plus className="!size-5" />
              <Bi en="Add more" hi="और जोड़ें" layout="inline" />
            </Button>
            {d && !d.canAdd && (
              <p className="text-[13px] text-muted-foreground">
                {bi('New takas can be added only while every taka is still editable.', 'नए टाका तभी जुड़ सकते हैं जब सभी टाका बदले जा सकते हों।')}
              </p>
            )}
          </div>
        )}
      </ResponsiveModal>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(o) => !edit.isPending && setConfirmOpen(o)}
        title={bi('Save these changes?', 'ये बदलाव सेव करें?')}
        description={summary}
        confirmLabel={bi('Save', 'सेव करें')}
        cancelLabel={bi('Cancel', 'रद्द करें')}
        onConfirm={save}
        loading={edit.isPending}
      />
    </>
  );
}
