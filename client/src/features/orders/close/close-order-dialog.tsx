import { AlertTriangle, Ban, Info, Minus, Plus, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { completedFramesNote, planHold, type ClosePreview, type HoldJobsheetEntry } from '@rivoora/shared';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { ResponsiveModal } from '@/components/ui/modal';
import { errorMessage } from '@/lib/api';
import { formatOrderNo } from '@/lib/format';
import { useCloseOrder, useClosePreview } from './api';

/** "Frames completed" for one jobsheet on the loom (same rule as Hold order). */
function FramesDone({ jobsheetNo, frames, value, onChange, disabled }: { jobsheetNo: number; frames: number; value: string; onChange: (text: string) => void; disabled: boolean }) {
  const n = /^\d+$/.test(value.trim()) ? Number(value.trim()) : null;
  const step = (d: number) => onChange(String(Math.min(frames, Math.max(0, (n ?? 0) + d))));
  return (
    <div className="flex items-stretch gap-2">
      <Button variant="secondary" className="size-11 shrink-0 p-0 [&_svg]:size-5" onClick={() => step(-1)} disabled={disabled || n === 0} aria-label="One frame less">
        <Minus />
      </Button>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ''))}
        disabled={disabled}
        aria-label={`Frames completed on jobsheet ${jobsheetNo}`}
        className="h-11 min-w-0 flex-1 rounded-[10px] border border-input bg-slate-50/60 text-center text-lg font-bold tabular-nums text-slate-900 focus:border-primary focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/15"
      />
      <Button variant="secondary" className="size-11 shrink-0 p-0 [&_svg]:size-5" onClick={() => step(1)} disabled={disabled || (n ?? 0) >= frames} aria-label="One frame more">
        <Plus />
      </Button>
    </div>
  );
}

function SummaryLine({ preview }: { preview: ClosePreview }) {
  const parts: string[] = [];
  if (preview.pendingJobsheets) parts.push(`${preview.pendingJobsheets} pending jobsheet${preview.pendingJobsheets === 1 ? '' : 's'} cancelled`);
  if (preview.openPos) parts.push(`${preview.openPos} outside PO${preview.openPos === 1 ? '' : 's'} closed`);
  if (preview.freeTakas) parts.push(`${preview.freeTakas} taka${preview.freeTakas === 1 ? '' : 's'} (${preview.freePcs} pcs) → free stock`);
  if (preview.outTakas) parts.push(`${preview.outTakas} taka${preview.outTakas === 1 ? '' : 's'} still at butta cutting / the mill`);
  if (preview.dispatchedTakas) parts.push(`${preview.dispatchedTakas} taka${preview.dispatchedTakas === 1 ? '' : 's'} already dispatched (unaffected)`);
  if (!parts.length) return <p className="text-sm text-slate-500">Nothing is in progress — the order will simply be marked Closed.</p>;
  return (
    <ul className="space-y-1.5 text-sm text-slate-700">
      {parts.map((p, i) => (
        <li key={i} className="flex items-start gap-2">
          <Info className="mt-0.5 size-4 shrink-0 text-slate-400" aria-hidden />
          {p}
        </li>
      ))}
    </ul>
  );
}

/** Close order (Jenish, Gaurang): any order, any time. Completes jobsheets on the loom, cancels the rest, frees stock. */
export function CloseOrderDialog({ orderId, orderNo, open, onOpenChange }: { orderId: number; orderNo: number; open: boolean; onOpenChange: (open: boolean) => void }) {
  const preview = useClosePreview(orderId, open);
  const close = useCloseOrder(orderId);
  const [note, setNote] = useState('');
  const [texts, setTexts] = useState<Record<number, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setNote('');
    setTexts({});
    setServerError(null);
  }, [open]);

  const ongoing = preview.data?.ongoing ?? [];
  const entries: HoldJobsheetEntry[] = ongoing.flatMap((j) => {
    const t = (texts[j.id] ?? '').trim();
    return /^\d+$/.test(t) ? [{ jobsheetId: j.id, completedFrames: Number(t) }] : [];
  });
  const plan = planHold(ongoing, entries);
  const ready = !preview.isPending && !preview.isError && plan.errors.length === 0;

  const submit = () => {
    setServerError(null);
    close.mutate(
      { note: note.trim() || null, ongoing: entries },
      {
        onSuccess: (res) => {
          toast.success(
            `Order ${formatOrderNo(orderNo)} is closed` +
              (res.freeTakas > 0 ? ` · ${res.freeTakas} taka${res.freeTakas === 1 ? '' : 's'} to free stock` : ''),
          );
          onOpenChange(false);
        },
        onError: (err) => setServerError(errorMessage(err)),
      },
    );
  };

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(o) => !close.isPending && onOpenChange(o)}
      title={`Close order ${formatOrderNo(orderNo)}?`}
      size="sm"
      footer={
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
          <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)} disabled={close.isPending}>
            Cancel
          </Button>
          <Button variant="destructive" size="lg" onClick={submit} disabled={!ready} loading={close.isPending}>
            <Ban /> Close order
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <p className="rounded-[10px] bg-slate-50 px-3.5 py-3 text-[15px] leading-relaxed text-slate-700">
          This closes the order for good. It is hidden from production, QC, godown and dispatch (besides what was already dispatched) — there is no reopening it.
        </p>

        {preview.isPending ? (
          <p className="text-sm text-muted-foreground">Checking what's in progress…</p>
        ) : preview.isError ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {errorMessage(preview.error)}
          </p>
        ) : (
          <>
            {ongoing.length > 0 && (
              <section className="space-y-4 rounded-xl border border-amber-300 bg-amber-50 p-4" aria-label="Jobsheets on the loom">
                <p className="flex items-start gap-2 text-[15px] font-semibold text-amber-950">
                  <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden />
                  {ongoing.length === 1 ? '1 jobsheet is on the loom.' : `${ongoing.length} jobsheets are on the loom.`} Enter the frames completed — each is completed now; no new jobsheet is created for the rest.
                </p>
                <ul className="space-y-4">
                  {ongoing.map((j) => {
                    const text = texts[j.id] ?? '';
                    const n = /^\d+$/.test(text.trim()) ? Number(text.trim()) : null;
                    const err = plan.errors.find((e) => e.jobsheetId === j.id);
                    const note2 = n !== null && n <= j.frames ? completedFramesNote(j.frames, n) : null;
                    return (
                      <li key={j.id} className="space-y-2 rounded-lg bg-white p-3 shadow-soft">
                        <p className="text-[15px] font-bold text-slate-900">Jobsheet {j.jobsheetNo}</p>
                        <p className="text-sm text-slate-600">
                          {j.machineNo ? `Machine ${j.machineNo}` : 'Machine —'} · {j.frames} frame{j.frames === 1 ? '' : 's'} assigned
                        </p>
                        <Field label="Frames completed" required error={text !== '' && err ? err.message : undefined}>
                          <FramesDone jobsheetNo={j.jobsheetNo} frames={j.frames} value={text} onChange={(t) => setTexts((prev) => ({ ...prev, [j.id]: t }))} disabled={close.isPending} />
                        </Field>
                        {note2 && (
                          <p className="flex items-start gap-2 text-sm text-slate-600" role="status">
                            <Info className="mt-0.5 size-4 shrink-0 text-slate-400" aria-hidden />
                            {note2}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            <div className="rounded-xl border border-border p-3.5">
              <p className="mb-2 text-sm font-semibold text-slate-700">On close:</p>
              <SummaryLine preview={preview.data!} />
            </div>
          </>
        )}

        <Field label="Note (optional)" htmlFor="close-note" hint="Shown on the order and in its History.">
          <textarea
            id="close-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={300}
            rows={3}
            disabled={close.isPending}
            className="w-full resize-none rounded-[10px] border border-input bg-white px-3 py-2.5 text-[15px] text-slate-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15"
          />
        </Field>

        {serverError && (
          <p role="alert" className="flex items-start gap-2 rounded-lg bg-destructive-soft px-3 py-2 text-sm font-medium text-destructive">
            <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {serverError}
          </p>
        )}
      </div>
    </ResponsiveModal>
  );
}
