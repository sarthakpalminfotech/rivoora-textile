import { ArrowRight, ChevronUp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Drawer } from '@rivoora/shared';
import { Modal } from '@/components/ui/modal';
import { cn } from '@/lib/utils';
import type { DashboardMode } from './layout-mode';

/**
 * Sprint 25 — the short filtered list a figure opens (top 20 rows + "Open full list →"), without leaving the dashboard.
 * Desktop: a right-side drawer (Esc closes). Tablet / phone: a bottom sheet, half height, dragged (or tapped) up to full.
 */
export function DetailSheet({ drawer, mode, onClose, go }: { drawer: Drawer | null; mode: DashboardMode; onClose: () => void; go: (href: string) => void }) {
  const [full, setFull] = useState(false);
  const startY = useRef<number | null>(null);
  useEffect(() => setFull(false), [drawer]);
  const sheet = mode !== 'desktop';
  const rows = drawer?.rows ?? [];
  return (
    <Modal
      open={!!drawer}
      onOpenChange={(o) => !o && onClose()}
      variant={sheet ? 'bottom' : 'right'}
      title={drawer?.title ?? ''}
      description={rows.length ? `${rows.length + (drawer?.more ?? 0)} item${rows.length + (drawer?.more ?? 0) === 1 ? '' : 's'}` : undefined}
      className={cn(sheet && 'transition-[max-height] duration-200', sheet && (full ? 'max-h-[92dvh]' : 'max-h-[55dvh]'))}
      bodyClassName="px-4 md:px-5"
      footer={
        drawer?.href ? (
          <button type="button" onClick={() => go(drawer.href!)} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
            Open full list <ArrowRight className="size-4" aria-hidden />
          </button>
        ) : undefined
      }
    >
      {sheet && !full && (
        <button
          type="button"
          onClick={() => setFull(true)}
          onTouchStart={(e) => (startY.current = e.touches[0].clientY)}
          onTouchMove={(e) => startY.current !== null && startY.current - e.touches[0].clientY > 40 && setFull(true)}
          className="mb-2 flex w-full items-center justify-center gap-1 rounded-lg py-1 text-xs font-medium text-slate-500 hover:bg-slate-50"
        >
          <ChevronUp className="size-4" aria-hidden /> Drag up for the full list
        </button>
      )}
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">Nothing to list.</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r, i) => {
            const inner = (
              <>
                <span className="min-w-0 flex-1">
                  <span className={cn('block truncate font-medium', r.tone === 'red' ? 'text-rose-700' : 'text-slate-900')}>{r.label}</span>
                  {r.sub && <span className="block truncate text-xs text-slate-500">{r.sub}</span>}
                </span>
                {r.value && <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-800">{r.value}</span>}
                {r.href && <ArrowRight className="size-4 shrink-0 text-slate-300" aria-hidden />}
              </>
            );
            return (
              <li key={i}>
                {r.href ? (
                  <button type="button" onClick={() => go(r.href!)} className="flex min-h-12 w-full items-center gap-3 py-2 text-left hover:bg-slate-50">
                    {inner}
                  </button>
                ) : (
                  <div className="flex min-h-12 items-center gap-3 py-2">{inner}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {(drawer?.more ?? 0) > 0 && <p className="pt-3 text-xs text-slate-500">+ {drawer!.more} more in the full list</p>}
    </Modal>
  );
}
