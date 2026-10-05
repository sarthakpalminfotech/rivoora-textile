import { AlertTriangle, CheckCircle2, Undo2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { challanLabel, cleanTakaNo, formatMeters, takaNoError, TAKA_NO_MAX_LENGTH, type ReceiveResult } from '@rivoora/shared';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/api';
import { formatOrderNo, formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { TakaNoKeys } from '../takas/taka-no-keys';
import { useReceive, useUndoReceive } from './api';

interface ReceivedRow {
  key: number;
  result: ReceiveResult;
  undoing: boolean;
}

let rowKey = 0;

/**
 * Receive → Taka number: one big input and a big Received button. Keep typing numbers and pressing Enter — the focus
 * stays in the input. Alerts are red; every received taka lands at the top of "Received now" (with Undo).
 */
export function ReceiveTakaNumber() {
  const receive = useReceive();
  const undo = useUndoReceive();
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [rows, setRows] = useState<ReceivedRow[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    const no = value.trim();
    if (!no) return;
    if (takaNoError(no)) {
      setAlert('Enter a valid taka number (digits, - or / only)');
      inputRef.current?.focus();
      return;
    }
    // Clear + keep focus straight away, so the next number can be typed while this one is saved.
    setValue('');
    inputRef.current?.focus();
    try {
      const res = await receive.mutateAsync({ takaNo: no });
      const r = res.results[0];
      if (r?.ok) {
        setAlert(null);
        setRows((prev) => [{ key: ++rowKey, result: r, undoing: false }, ...prev]);
      } else {
        setAlert(r?.message ?? `Taka ${no} could not be received`);
      }
    } catch (err) {
      setAlert(errorMessage(err));
    }
    inputRef.current?.focus();
  };

  const doUndo = async (row: ReceivedRow) => {
    if (row.result.takaId === null) return;
    setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, undoing: true } : r)));
    try {
      await undo.mutateAsync(row.result.takaId);
      setRows((prev) => prev.filter((r) => r.key !== row.key));
      toast.success(`Taka ${row.result.takaNo} is back at butta cutting`);
    } catch (err) {
      setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, undoing: false } : r)));
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <section className="rounded-2xl border border-border bg-white p-4 shadow-soft md:p-5">
        <label htmlFor="receive-no" className="mb-2 block text-sm font-semibold text-slate-600">
          Taka number
        </label>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            id="receive-no"
            value={value}
            autoFocus
            onChange={(e) => {
              setValue(cleanTakaNo(e.target.value));
              if (alert) setAlert(null);
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void submit();
              }
            }}
            inputMode="numeric"
            autoComplete="off"
            enterKeyHint="done"
            maxLength={TAKA_NO_MAX_LENGTH}
            placeholder="—"
            aria-invalid={!!alert || undefined}
            className={cn(
              'h-16 min-w-0 flex-1 rounded-xl border bg-white px-4 text-3xl font-bold tabular-nums tracking-wide text-slate-900 focus:outline-none focus:ring-2',
              alert ? 'border-destructive focus:ring-destructive/20' : 'border-input focus:border-primary focus:ring-primary/15',
            )}
          />
          <Button
            size="lg"
            className="h-16 shrink-0 bg-green-600 px-6 text-lg hover:bg-green-700"
            onClick={() => void submit()}
            disabled={!value.trim()}
          >
            <CheckCircle2 className="!size-6" /> Received
          </Button>
        </div>
        {focused && <TakaNoKeys className="mt-2" input={() => inputRef.current} onValue={setValue} />}
        {alert && (
          <p role="alert" className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-base font-semibold text-red-700">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
            {alert}
          </p>
        )}
      </section>

      <section aria-label="Received now">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Received now
          {rows.length > 0 && <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-bold text-green-700">{rows.length}</span>}
        </h2>
        {rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            Type a taka number and press Enter. Received takas appear here.
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => {
              const r = row.result;
              return (
                <li
                  key={row.key}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-green-200 bg-green-50 px-4 py-3 animate-in fade-in-0 slide-in-from-top-2"
                >
                  <CheckCircle2 className="size-6 shrink-0 text-green-600" aria-hidden />
                  <span className="text-2xl font-bold tabular-nums text-slate-900">{r.takaNo}</span>
                  <span className="text-[15px] font-semibold text-slate-700">
                    {r.orderNo != null && `Order ${formatOrderNo(r.orderNo)}`}
                    {r.challanNo != null && <span className="ml-2 text-amber-700">{challanLabel(r.challanNo)}</span>}
                  </span>
                  <span className="text-[15px] font-semibold tabular-nums text-slate-600">{r.meters != null ? formatMeters(r.meters) : ''}</span>
                  <span className="ml-auto text-sm text-slate-500">{formatTime(r.receivedAt)}</span>
                  <Button variant="secondary" size="sm" className="h-10" onClick={() => void doUndo(row)} loading={row.undoing}>
                    <Undo2 /> Undo
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
