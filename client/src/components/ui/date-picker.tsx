import * as PopoverPrimitive from '@radix-ui/react-popover';
import { parseISO } from 'date-fns';
import { CalendarDays, ChevronDown, X } from 'lucide-react';
import { useState } from 'react';
import { DayPicker, type DateRange } from 'react-day-picker';
import 'react-day-picker/style.css';
import { formatDate, toApiDate } from '@/lib/format';
import { cn } from '@/lib/utils';

const triggerClass =
  'flex h-11 w-full min-w-0 items-center gap-2.5 rounded-[10px] border border-input bg-slate-50/60 px-3.5 text-left text-[15px] transition-colors hover:border-slate-300 focus:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/15';

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align="start"
        sideOffset={6}
        collisionPadding={12}
        className="z-[60] max-w-[calc(100vw-24px)] rounded-xl border border-slate-200 bg-white p-3 shadow-pop animate-in fade-in-0 zoom-in-[0.98]"
      >
        {children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}

interface DatePickerProps {
  /** yyyy-MM-dd */
  value: string | null | undefined;
  onChange: (value: string) => void;
  id?: string;
  invalid?: boolean;
  placeholder?: string;
}

export function DatePicker({ value, onChange, id, invalid, placeholder = 'Pick a date' }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const selected = value ? parseISO(value) : undefined;
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          id={id}
          type="button"
          aria-invalid={invalid || undefined}
          className={cn(triggerClass, open && 'border-primary bg-white ring-2 ring-primary/15', invalid && 'border-destructive')}
        >
          <CalendarDays className="size-4 shrink-0 text-slate-500" aria-hidden />
          <span className={cn('flex-1 truncate', value ? 'font-medium text-slate-900' : 'text-slate-400')}>
            {value ? formatDate(value) : placeholder}
          </span>
          <ChevronDown className={cn('size-4 text-slate-500 transition-transform', open && 'rotate-180 text-primary')} aria-hidden />
        </button>
      </PopoverPrimitive.Trigger>
      <Panel>
        <DayPicker
          mode="single"
          selected={selected}
          defaultMonth={selected}
          weekStartsOn={1}
          onSelect={(d) => {
            if (d) {
              onChange(toApiDate(d));
              setOpen(false);
            }
          }}
        />
      </Panel>
    </PopoverPrimitive.Root>
  );
}

export interface DateRangeValue {
  from?: string;
  to?: string;
}

interface DateRangePickerProps {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  id?: string;
}

export function DateRangePicker({ value, onChange, id }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const range: DateRange | undefined = value.from
    ? { from: parseISO(value.from), to: value.to ? parseISO(value.to) : undefined }
    : undefined;
  const text = value.from
    ? `${formatDate(value.from)} – ${value.to ? formatDate(value.to) : '…'}`
    : null;
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <div className="relative">
        <PopoverPrimitive.Trigger asChild>
          <button
            id={id}
            type="button"
            className={cn(triggerClass, 'pr-10', open && 'border-primary bg-white ring-2 ring-primary/15')}
          >
            <CalendarDays className="size-4 shrink-0 text-slate-500" aria-hidden />
            <span className={cn('flex-1 truncate', text ? 'font-medium text-slate-900' : 'text-slate-400')}>
              {text ?? 'From – To'}
            </span>
          </button>
        </PopoverPrimitive.Trigger>
        {value.from ? (
          <button
            type="button"
            onClick={() => onChange({})}
            aria-label="Clear dates"
            className="absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 hover:bg-muted"
          >
            <X className="size-4" />
          </button>
        ) : (
          <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-500" aria-hidden />
        )}
      </div>
      <Panel>
        <DayPicker
          mode="range"
          selected={range}
          defaultMonth={range?.from}
          weekStartsOn={1}
          onSelect={(r) => {
            onChange({ from: r?.from ? toApiDate(r.from) : undefined, to: r?.to ? toApiDate(r.to) : undefined });
          }}
        />
        <div className="flex justify-end border-t border-slate-100 pt-2">
          <button
            type="button"
            className="rounded-lg px-3 py-2 text-sm font-semibold text-primary hover:bg-primary-soft"
            onClick={() => setOpen(false)}
          >
            Done
          </button>
        </div>
      </Panel>
    </PopoverPrimitive.Root>
  );
}
