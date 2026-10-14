import { Minus, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useSetReceivedCount } from './api';

/**
 * Mill challans: the godown supervisor counts how many takas came back — just the number. Which takas they are is
 * found out at the Mill QC. `compact` = the small version on a challan card.
 */
export function ReceivedCountControl({
  challanId,
  total,
  received,
  minimum = 0,
  compact,
}: {
  challanId: number;
  total: number;
  received: number;
  /** Takas already marked received (at QC): the count can't go below this. */
  minimum?: number;
  compact?: boolean;
}) {
  const save = useSetReceivedCount();
  const [text, setText] = useState(String(received));
  // Follows the saved value (a refetch, or the QC receiving takas meanwhile).
  useEffect(() => setText(String(received)), [received]);
  const value = /^\d+$/.test(text.trim()) ? Number(text.trim()) : null;
  const valid = value !== null && value >= minimum && value <= total;
  const dirty = value !== received;

  const step = (d: number) => setText(String(Math.min(total, Math.max(minimum, (value ?? received) + d))));
  const submit = () => {
    if (!valid || value === null) return;
    save.mutate(
      { id: challanId, count: value },
      {
        onSuccess: () => toast.success(`${value} of ${total} takas counted as received`),
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  };

  const size = compact ? 'size-11' : 'size-12';
  return (
    <div className="space-y-1.5" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <label htmlFor={`rc-${challanId}-${compact ? 'c' : 'd'}`} className="block text-[13px] font-semibold text-slate-600">
        Takas received (count)
      </label>
      <div className="flex items-stretch gap-2">
        <Button variant="secondary" className={cn(size, 'shrink-0 p-0')} onClick={() => step(-1)} disabled={save.isPending || (value ?? received) <= minimum} aria-label="One less">
          <Minus />
        </Button>
        <input
          id={`rc-${challanId}-${compact ? 'c' : 'd'}`}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value.replace(/[^\d]/g, ''))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          aria-invalid={!valid || undefined}
          className={cn(
            'min-w-0 flex-1 rounded-[10px] border bg-white text-center font-bold tabular-nums text-slate-900 focus:outline-none focus:ring-2',
            compact ? 'h-11 text-xl' : 'h-12 text-2xl',
            valid ? 'border-input focus:border-primary focus:ring-primary/15' : 'border-destructive focus:ring-destructive/20',
          )}
        />
        <span className="flex items-center text-base font-semibold text-slate-500">/ {total}</span>
        <Button variant="secondary" className={cn(size, 'shrink-0 p-0')} onClick={() => step(1)} disabled={save.isPending || (value ?? received) >= total} aria-label="One more">
          <Plus />
        </Button>
        <Button className={cn(compact ? 'h-11' : 'h-12', 'shrink-0 bg-green-600 px-4 hover:bg-green-700')} onClick={submit} disabled={!valid || !dirty} loading={save.isPending}>
          Save
        </Button>
      </div>
      {!valid && value !== null && (
        <p role="alert" className="text-sm font-semibold text-destructive">
          {value > total ? `Only ${total} takas on this challan` : `${minimum} takas are already received at QC`}
        </p>
      )}
    </div>
  );
}
