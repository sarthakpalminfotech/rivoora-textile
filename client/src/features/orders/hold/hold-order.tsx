import { AlertTriangle, Info, Minus, PauseCircle, Plus, PlayCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  completedFramesNote,
  completedMetersNote,
  formatQty,
  jobsheetRef,
  planHold,
  planHoldMeters,
  type HoldJobsheetEntry,
  type HoldMetersJobsheetEntry,
  type JobsheetListItem,
} from '@rivoora/shared';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field } from '@/components/ui/field';
import { JobsheetRef } from '@/components/ui/jobsheet-ref';
import { ResponsiveModal } from '@/components/ui/modal';
import { useNow } from '@/hooks/useNow';
import { errorMessage } from '@/lib/api';
import { formatElapsed, formatOrderNo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useOrderJobsheets } from '../../jobsheets/api';
import { useHoldOrder, useReleaseOrder } from './api';

/** Tooltip / hint of every action that is disabled because the order is on hold. */
export const ON_HOLD_HINT = 'Order is on hold';

/** The small amber "On hold" badge (order cards, header, Dispatched, inventory order rows). */
export function OnHoldBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[12px] font-bold text-amber-900',
        className,
      )}
    >
      <PauseCircle className="size-3.5 shrink-0" aria-hidden />
      On hold
    </span>
  );
}

/** Banner on the order details page while the order is on hold. */
export function OnHoldBanner({ note, canRelease }: { note: string | null; canRelease: boolean }) {
  return (
    <div role="status" className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950">
      <PauseCircle className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden />
      <div className="min-w-0 text-[14px] leading-snug">
        <p className="font-bold">This order is on hold</p>
        <p className="text-amber-900/90">
          Work has stopped and it is hidden from production, QC, godown and dispatch.{' '}
          {canRelease ? 'Release it to continue.' : 'Only Jenish can release it.'}
        </p>
        {note && <p className="mt-1 font-medium">Note: {note}</p>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Hold dialog                                                          */
/* ------------------------------------------------------------------ */

function FramesDone({
  js,
  value,
  onChange,
  disabled,
}: {
  js: JobsheetListItem;
  value: string;
  onChange: (text: string) => void;
  disabled: boolean;
}) {
  const n = /^\d+$/.test(value.trim()) ? Number(value.trim()) : null;
  const step = (d: number) => onChange(String(Math.min(js.frames, Math.max(0, (n ?? 0) + d))));
  const id = `hold-frames-${js.id}`;
  return (
    <div className="flex items-stretch gap-2">
      <Button variant="secondary" className="size-12 shrink-0 p-0 [&_svg]:size-5" onClick={() => step(-1)} disabled={disabled || n === 0} aria-label="One frame less">
        <Minus />
      </Button>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ''))}
        disabled={disabled}
        aria-label={`Frames completed on ${jobsheetRef(js.orderNo, js.jobsheetNo)}`}
        className="h-12 min-w-0 flex-1 rounded-[10px] border border-input bg-slate-50/60 text-center text-xl font-bold tabular-nums text-slate-900 focus:border-primary focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/15"
      />
      <Button variant="secondary" className="size-12 shrink-0 p-0 [&_svg]:size-5" onClick={() => step(1)} disabled={disabled || (n ?? 0) >= js.frames} aria-label="One frame more">
        <Plus />
      </Button>
    </div>
  );
}

/** Sprint 19: the meter twin of `FramesDone` — a plain decimal field (metres can't be stepped one at a time). */
function MetersDone({
  js,
  value,
  onChange,
  disabled,
}: {
  js: JobsheetListItem;
  value: string;
  onChange: (text: string) => void;
  disabled: boolean;
}) {
  const id = `hold-meters-${js.id}`;
  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))}
      disabled={disabled}
      aria-label={`Metres completed on ${jobsheetRef(js.orderNo, js.jobsheetNo)}`}
      className="h-12 w-full rounded-[10px] border border-input bg-slate-50/60 px-3 text-center text-xl font-bold tabular-nums text-slate-900 focus:border-primary focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/15"
    />
  );
}

export function HoldOrderDialog({
  orderId,
  orderNo,
  open,
  onOpenChange,
}: {
  orderId: number;
  orderNo: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const jobsheets = useOrderJobsheets(orderId, open);
  const hold = useHoldOrder(orderId);
  const now = useNow();
  const ongoing = useMemo(() => (jobsheets.data?.jobsheets ?? []).filter((j) => j.status === 'ongoing'), [jobsheets.data]);
  const [note, setNote] = useState('');
  const [texts, setTexts] = useState<Record<number, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setNote('');
    setTexts({});
    setServerError(null);
    // Only when the dialog opens.
  }, [open]);

  const meterOrder = jobsheets.data?.unit === 'meters';
  const framesEntries: HoldJobsheetEntry[] = ongoing.flatMap((j) => {
    const t = (texts[j.id] ?? '').trim();
    return /^\d+$/.test(t) ? [{ jobsheetId: j.id, completedFrames: Number(t) }] : [];
  });
  const metersEntries: HoldMetersJobsheetEntry[] = ongoing.flatMap((j) => {
    const t = (texts[j.id] ?? '').trim();
    return /^\d+(\.\d{1,2})?$/.test(t) ? [{ jobsheetId: j.id, completedMeters: Number(t) }] : [];
  });
  const plan = meterOrder
    ? planHoldMeters(ongoing.map((j) => ({ id: j.id, meters: j.meters ?? 0 })), metersEntries)
    : planHold(ongoing, framesEntries);
  const ready = !jobsheets.isPending && !jobsheets.isError && plan.errors.length === 0;

  const submit = () => {
    setServerError(null);
    hold.mutate(
      { note: note.trim() || null, ongoing: meterOrder ? metersEntries : framesEntries },
      {
        onSuccess: (res) => {
          toast.success(
            res.completed > 0
              ? `Order ${formatOrderNo(orderNo)} is on hold · ${res.completed} jobsheet${res.completed === 1 ? '' : 's'} completed${res.created.length ? `, ${res.created.length} new pending` : ''}`
              : `Order ${formatOrderNo(orderNo)} is on hold`,
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
      onOpenChange={(o) => !hold.isPending && onOpenChange(o)}
      title={`Hold order ${formatOrderNo(orderNo)}`}
      size="sm"
      footer={
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
          <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)} disabled={hold.isPending}>
            Cancel
          </Button>
          <Button size="lg" onClick={submit} disabled={!ready} loading={hold.isPending}>
            <PauseCircle /> Put on hold
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <p className="rounded-[10px] bg-slate-50 px-3.5 py-3 text-[15px] leading-relaxed text-slate-700">
          Work on this order will stop and it will be hidden from production, QC, godown and dispatch until you release it.
        </p>

        {jobsheets.isPending ? (
          <p className="text-sm text-muted-foreground">Checking the jobsheets on the loom…</p>
        ) : jobsheets.isError ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {errorMessage(jobsheets.error)}
          </p>
        ) : ongoing.length > 0 ? (
          <section className="space-y-4 rounded-xl border border-amber-300 bg-amber-50 p-4" aria-label="Jobsheets on the loom">
            <p className="flex items-start gap-2 text-[15px] font-semibold text-amber-950">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden />
              {ongoing.length === 1 ? '1 jobsheet is on the loom.' : `${ongoing.length} jobsheets are on the loom.`} Enter the frames completed so far. Each is
              completed now; the frames that remain become a new Pending jobsheet.
            </p>
            <ul className="space-y-4">
              {ongoing.map((j) => {
                const text = texts[j.id] ?? '';
                const err = plan.errors.find((e) => e.jobsheetId === j.id);
                const running = formatElapsed(j.startedAt, now);
                if (meterOrder) {
                  const assigned = j.meters ?? 0;
                  const n = /^\d+(\.\d{1,2})?$/.test(text.trim()) ? Number(text.trim()) : null;
                  const note2 = n !== null && n <= assigned ? completedMetersNote(assigned, n) : null;
                  const left = n !== null ? Math.round((assigned - n) * 100) / 100 : null;
                  return (
                    <li key={j.id} className="space-y-2 rounded-lg bg-white p-3 shadow-soft">
                      <p className="text-[15px] font-bold text-slate-900">
                        <JobsheetRef orderNo={j.orderNo} jobsheetNo={j.jobsheetNo} />
                      </p>
                      <p className="text-sm text-slate-600">
                        {j.runningMachine ? `Machine ${j.runningMachine.machineNo}` : 'Machine —'} · {formatQty(assigned, 'meters')} assigned
                        {running ? ` · running ${running}` : ''}
                      </p>
                      <Field label="Metres completed" htmlFor={`hold-meters-${j.id}`} required error={text !== '' && err ? err.message : undefined}>
                        <MetersDone js={j} value={text} onChange={(t) => setTexts((prev) => ({ ...prev, [j.id]: t }))} disabled={hold.isPending} />
                      </Field>
                      {left !== null && n !== null && n <= assigned && (
                        <p className="flex items-start gap-2 text-sm text-slate-600" role="status">
                          <Info className="mt-0.5 size-4 shrink-0 text-slate-400" aria-hidden />
                          {left > 0 ? `${formatQty(left, 'meters')} left → a new Pending jobsheet with the same machines.` : 'All metres done — no new jobsheet.'}
                          {note2 ? ` ${note2}` : ''}
                        </p>
                      )}
                    </li>
                  );
                }
                const n = /^\d+$/.test(text.trim()) ? Number(text.trim()) : null;
                const note2 = n !== null && n <= j.frames ? completedFramesNote(j.frames, n) : null;
                return (
                  <li key={j.id} className="space-y-2 rounded-lg bg-white p-3 shadow-soft">
                    <p className="text-[15px] font-bold text-slate-900">
                      <JobsheetRef orderNo={j.orderNo} jobsheetNo={j.jobsheetNo} />
                    </p>
                    <p className="text-sm text-slate-600">
                      {j.runningMachine ? `Machine ${j.runningMachine.machineNo}` : 'Machine —'} · {j.frames} frame{j.frames === 1 ? '' : 's'} assigned
                      {running ? ` · running ${running}` : ''}
                    </p>
                    <Field label="Frames completed" htmlFor={`hold-frames-${j.id}`} required error={text !== '' && err ? err.message : undefined}>
                      <FramesDone js={j} value={text} onChange={(t) => setTexts((prev) => ({ ...prev, [j.id]: t }))} disabled={hold.isPending} />
                    </Field>
                    {n !== null && n <= j.frames && (
                      <p className="flex items-start gap-2 text-sm text-slate-600" role="status">
                        <Info className="mt-0.5 size-4 shrink-0 text-slate-400" aria-hidden />
                        {j.frames - n > 0
                          ? `${j.frames - n} frame${j.frames - n === 1 ? '' : 's'} left → a new Pending jobsheet with the same machines.`
                          : 'All frames done — no new jobsheet.'}
                        {note2 ? ` ${note2}` : ''}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <Field label="Note (optional)" htmlFor="hold-note" hint="Shown on the order and in its History.">
          <textarea
            id="hold-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={300}
            rows={3}
            disabled={hold.isPending}
            className="w-full resize-none rounded-[10px] border border-input bg-white px-3 py-2.5 text-[15px] text-slate-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15"
          />
        </Field>

        {serverError && (
          <p role="alert" className="rounded-lg bg-destructive-soft px-3 py-2 text-sm font-medium text-destructive">
            {serverError}
          </p>
        )}
      </div>
    </ResponsiveModal>
  );
}

/* ------------------------------------------------------------------ */
/* Release                                                              */
/* ------------------------------------------------------------------ */

export function ReleaseHoldDialog({
  orderId,
  orderNo,
  open,
  onOpenChange,
}: {
  orderId: number;
  orderNo: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const release = useReleaseOrder(orderId);
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Release order ${formatOrderNo(orderNo)} from hold?`}
      description="It becomes visible to production, QC, godown and dispatch again. Pending jobsheets created when it was put on hold can be sent to the supervisor as usual."
      confirmLabel="Release"
      loading={release.isPending}
      onConfirm={() =>
        release.mutate(undefined, {
          onSuccess: () => {
            toast.success(`Order ${formatOrderNo(orderNo)} released from hold`);
            onOpenChange(false);
          },
          onError: (err) => {
            toast.error(errorMessage(err));
            onOpenChange(false);
          },
        })
      }
    />
  );
}

/** Buttons for the order header: Hold order (Jenish) / Release hold. */
export function HoldButtons({ held, canHold, onHold, onRelease }: { held: boolean; canHold: boolean; onHold: () => void; onRelease: () => void }) {
  if (!canHold) return null;
  return held ? (
    <Button variant="secondary" size="sm" onClick={onRelease}>
      <PlayCircle /> Release hold
    </Button>
  ) : (
    <Button variant="secondary" size="sm" onClick={onHold}>
      <PauseCircle /> Hold order
    </Button>
  );
}
