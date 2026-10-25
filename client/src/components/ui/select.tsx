import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Check, ChevronDown, Loader2, Search } from 'lucide-react';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';

export interface SelectOption<V extends string | number = string> {
  value: V;
  label: string;
  /** Secondary text shown under the label (e.g. city, code). */
  description?: string | null;
  disabled?: boolean;
}

interface BaseProps<V extends string | number> {
  options: SelectOption<V>[];
  placeholder?: string;
  /** Shows a search box at the top of the panel (combobox variant). */
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Server-side search: gets the typed text; the parent debounces and refreshes `options`. */
  onSearchChange?: (text: string) => void;
  loading?: boolean;
  emptyText?: string;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  className?: string;
  triggerClassName?: string;
  /** Rendered beside the trigger, e.g. a ➕ button. */
  action?: ReactNode;
  /** Extra classes for the dropdown panel (e.g. a min width wider than a narrow trigger). */
  panelClassName?: string;
  'aria-label'?: string;
}

export interface SelectProps<V extends string | number> extends BaseProps<V> {
  value: V | null | undefined;
  onChange: (value: V, option: SelectOption<V>) => void;
  /** Label to show when the selected value isn't in the current (searched) options. */
  selectedLabel?: string;
}

export interface MultiSelectProps<V extends string | number> extends BaseProps<V> {
  value: V[];
  onChange: (value: V[]) => void;
}

interface CoreProps<V extends string | number> extends BaseProps<V> {
  triggerText: string | null;
  isSelected: (v: V) => boolean;
  onPick: (option: SelectOption<V>) => void;
  closeOnPick: boolean;
  multiple: boolean;
}

/** Touch screens (tablet / phone): opening a dropdown must not pop the on-screen keyboard; the user taps Search for that. */
const isTouchDevice = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

/**
 * Height of the on-screen keyboard while it covers the page (0 otherwise). Browsers that keep the layout viewport
 * fixed (iPad Safari, newer Chrome) only shrink the *visual* viewport, so the popover has to be told about it.
 */
function useKeyboardHeight(active: boolean) {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!active || !vv) {
      setHeight(0);
      return;
    }
    const update = () => {
      const covered = window.innerHeight - vv.height - vv.offsetTop;
      setHeight(covered > 120 ? Math.round(covered) : 0);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [active]);
  return height;
}

function DropdownCore<V extends string | number>({
  options,
  placeholder = 'Select',
  searchable,
  searchPlaceholder = 'Search…',
  onSearchChange,
  loading,
  emptyText = 'No results',
  disabled,
  invalid,
  id,
  className,
  triggerClassName,
  action,
  panelClassName,
  triggerText,
  isSelected,
  onPick,
  closeOnPick,
  multiple,
  'aria-label': ariaLabel,
}: CoreProps<V>) {
  const autoId = useId();
  const triggerId = id ?? `${autoId}-trigger`;
  const listId = `${autoId}-list`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const keyboardHeight = useKeyboardHeight(open && !!searchable);

  const visible = useMemo(() => {
    if (!searchable || onSearchChange || !query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || (o.description ?? '').toLowerCase().includes(q),
    );
  }, [options, query, searchable, onSearchChange]);

  // Highlight the selected option (or the first) whenever the panel opens / results change.
  useEffect(() => {
    if (!open) return;
    const selectedIdx = visible.findIndex((o) => isSelected(o.value));
    setActive(selectedIdx >= 0 ? selectedIdx : visible.findIndex((o) => !o.disabled));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, visible]);

  useEffect(() => {
    if (!open || active < 0) return;
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open, listId]);

  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next && query) {
      setQuery('');
      onSearchChange?.('');
    }
  };

  const pick = (option: SelectOption<V> | undefined) => {
    if (!option || option.disabled) return;
    onPick(option);
    if (closeOnPick) changeOpen(false);
  };

  const move = (delta: number) => {
    if (!visible.length) return;
    let i = active;
    for (let step = 0; step < visible.length; step++) {
      i = (i + delta + visible.length) % visible.length;
      if (!visible[i].disabled) break;
    }
    setActive(i);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        move(-1);
        break;
      case 'Home':
        if (!searchable) {
          e.preventDefault();
          setActive(0);
        }
        break;
      case 'End':
        if (!searchable) {
          e.preventDefault();
          setActive(visible.length - 1);
        }
        break;
      case 'Enter':
        e.preventDefault();
        pick(visible[active]);
        break;
      case ' ':
        if (!searchable) {
          e.preventDefault();
          pick(visible[active]);
        }
        break;
      case 'Tab':
        changeOpen(false);
        break;
    }
  };

  return (
    <div className={cn('flex min-w-0 items-stretch gap-2', className)}>
      {/* modal: the list takes over the page scroll lock, so it scrolls with wheel and touch even inside a dialog. */}
      <PopoverPrimitive.Root modal open={open} onOpenChange={changeOpen}>
        <PopoverPrimitive.Trigger asChild disabled={disabled}>
          <button
            id={triggerId}
            type="button"
            role="combobox"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-invalid={invalid || undefined}
            aria-label={ariaLabel}
            onKeyDown={(e) => {
              if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                e.preventDefault();
                changeOpen(true);
              }
            }}
            className={cn(
              'flex h-11 min-w-0 flex-1 items-center justify-between gap-2 rounded-[10px] border border-input bg-slate-50/60 px-3.5 text-left text-[15px] transition-colors hover:border-slate-300 focus:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/15 disabled:cursor-not-allowed disabled:opacity-60',
              open && 'border-primary bg-white ring-2 ring-primary/15',
              invalid && !open && 'border-destructive',
              triggerClassName,
            )}
          >
            <span className={cn('truncate', triggerText ? 'font-medium text-slate-900' : 'text-slate-400')}>
              {triggerText ?? placeholder}
            </span>
            <ChevronDown
              className={cn('size-4 shrink-0 text-slate-500 transition-transform duration-200', open && 'rotate-180 text-primary')}
              aria-hidden
            />
          </button>
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            align="start"
            sideOffset={6}
            // With the keyboard up, keep the whole panel above it (also shrinks its max height).
            collisionPadding={{ top: 12, left: 12, right: 12, bottom: 12 + keyboardHeight }}
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              // Touch: focus the list, not the search box, so no keyboard opens until Search is tapped.
              (searchable && !isTouchDevice() ? searchRef.current : listRef.current)?.focus({ preventScroll: true });
            }}
            onKeyDown={onKeyDown}
            className={cn(
              'z-[60] flex w-[var(--radix-popover-trigger-width)] min-w-[200px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-[10px] border border-slate-200 bg-white shadow-pop outline-none animate-in fade-in-0 zoom-in-[0.98]',
              panelClassName,
            )}
            style={{ maxHeight: 'min(340px, var(--radix-popover-content-available-height))' }}
          >
            {searchable && (
              <div className="shrink-0 border-b border-slate-100 p-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
                  <input
                    ref={searchRef}
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      onSearchChange?.(e.target.value);
                    }}
                    placeholder={searchPlaceholder}
                    aria-label={searchPlaceholder}
                    aria-controls={listId}
                    aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
                    autoComplete="off"
                    className="h-10 w-full rounded-lg bg-slate-50 pl-9 pr-3 text-[15px] placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/15"
                  />
                  {loading && (
                    <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-slate-400" aria-hidden />
                  )}
                </div>
              </div>
            )}
            <ul
              ref={listRef}
              id={listId}
              role="listbox"
              tabIndex={-1}
              aria-multiselectable={multiple || undefined}
              aria-activedescendant={!searchable && active >= 0 ? `${listId}-${active}` : undefined}
              className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain py-1.5 outline-none [-webkit-overflow-scrolling:touch]"
            >
              {visible.length === 0 ? (
                <li className="px-4 py-6 text-center text-sm text-muted-foreground">
                  {loading ? 'Loading…' : emptyText}
                </li>
              ) : (
                visible.map((option, i) => {
                  const selected = isSelected(option.value);
                  return (
                    <li
                      key={String(option.value)}
                      id={`${listId}-${i}`}
                      role="option"
                      aria-selected={selected}
                      aria-disabled={option.disabled || undefined}
                      onMouseMove={() => active !== i && setActive(i)}
                      onClick={() => pick(option)}
                      className={cn(
                        'mx-1.5 flex cursor-pointer select-none items-center gap-3 rounded-lg px-3.5 py-3 text-[15px] font-medium text-slate-800',
                        i === active && 'bg-slate-100',
                        selected && 'bg-primary-soft text-primary',
                        selected && i === active && 'bg-primary/10',
                        option.disabled && 'cursor-not-allowed opacity-50',
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{option.label}</span>
                        {option.description && (
                          <span className={cn('block truncate text-[13px] font-normal', selected ? 'text-primary/70' : 'text-slate-500')}>
                            {option.description}
                          </span>
                        )}
                      </span>
                      <Check className={cn('size-4 shrink-0', selected ? 'opacity-100' : 'opacity-0')} strokeWidth={2.5} aria-hidden />
                    </li>
                  );
                })
              )}
            </ul>
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
      {action}
    </div>
  );
}

/** The standard single-value dropdown. Add `searchable` for the combobox variant. */
export function Select<V extends string | number>({ value, onChange, selectedLabel, options, ...rest }: SelectProps<V>) {
  const current = options.find((o) => o.value === value);
  const text = current?.label ?? (value !== null && value !== undefined ? (selectedLabel ?? null) : null);
  return (
    <DropdownCore
      {...rest}
      options={options}
      triggerText={text}
      isSelected={(v) => v === value}
      onPick={(o) => onChange(o.value, o)}
      closeOnPick
      multiple={false}
    />
  );
}

/** Multi-select variant of the standard dropdown (stays open while picking). */
export function MultiSelect<V extends string | number>({ value, onChange, options, ...rest }: MultiSelectProps<V>) {
  const selectedLabels = options.filter((o) => value.includes(o.value)).map((o) => o.label);
  const text =
    value.length === 0
      ? null
      : selectedLabels.length === value.length && value.length <= 2
        ? selectedLabels.join(', ')
        : `${value.length} selected`;
  return (
    <DropdownCore
      {...rest}
      options={options}
      triggerText={text}
      isSelected={(v) => value.includes(v)}
      onPick={(o) => onChange(value.includes(o.value) ? value.filter((v) => v !== o.value) : [...value, o.value])}
      closeOnPick={false}
      multiple
    />
  );
}
