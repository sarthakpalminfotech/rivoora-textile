import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ChevronLeft, ChevronRight, ImageIcon, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ChallanDesign } from '@rivoora/shared';
import { formatOrderNo } from '@/lib/format';
import { cn } from '@/lib/utils';

const MAX_THUMBS = 3;

/** Rounded square design thumbnail (lazy; a neutral placeholder when the design has no image). */
function Thumb({ design, className }: { design: ChallanDesign; className?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={cn('block size-10 shrink-0 overflow-hidden rounded-lg border-2 border-white bg-slate-100 shadow-soft', className)}>
      {design.thumbUrl && !failed ? (
        <img src={design.thumbUrl} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} className="size-full object-cover" />
      ) : (
        <span className="flex size-full items-center justify-center text-slate-300">
          <ImageIcon className="size-4" aria-hidden />
        </span>
      )}
    </span>
  );
}

/**
 * The designs of a challan as small thumbnails: one design → one thumbnail; several → up to 3 overlapping thumbnails
 * and a "+N" chip. Tapping opens the design preview (never the challan itself).
 */
export function ChallanDesigns({ designs, className }: { designs: ChallanDesign[]; className?: string }) {
  const [start, setStart] = useState<number | null>(null);
  if (designs.length === 0) return null;
  const shown = designs.slice(0, MAX_THUMBS);
  const extra = designs.length - shown.length;
  // The card is a button itself: pointer and key events must not reach it.
  const stop = { onClick: (e: React.MouseEvent) => e.stopPropagation(), onKeyDown: (e: React.KeyboardEvent) => e.stopPropagation() };
  return (
    <div className={cn('flex shrink-0 items-center', className)} {...stop}>
      {shown.map((d, i) => (
        <button
          key={`${d.orderNo}-${d.designCode}`}
          type="button"
          onClick={() => setStart(i)}
          aria-label={`Preview design ${d.designCode} of ${formatOrderNo(d.orderNo)}`}
          className={cn('rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary/40', i > 0 && '-ml-4')}
        >
          <Thumb design={d} />
        </button>
      ))}
      {extra > 0 && (
        <button
          type="button"
          onClick={() => setStart(MAX_THUMBS)}
          aria-label={`${extra} more ${extra === 1 ? 'design' : 'designs'}`}
          className="-ml-3 flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-white bg-slate-800 px-1.5 text-[11px] font-bold text-white shadow-soft outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          +{extra}
        </button>
      )}
      <DesignPreview designs={designs} start={start} onClose={() => setStart(null)} />
    </div>
  );
}

/**
 * Design preview: one design at a time with a large image, "Order #26" + the design code on top, previous / next
 * buttons, swipe on touch, arrow keys, a "2 / 3" counter. Full screen on phones, a large centred modal from md up.
 * Full images load only here.
 */
export function DesignPreview({ designs, start, onClose }: { designs: ChallanDesign[]; start: number | null; onClose: () => void }) {
  const open = start !== null;
  const [index, setIndex] = useState(0);
  const touchX = useRef<number | null>(null);
  const last = designs.length - 1;

  useEffect(() => {
    if (start !== null) setIndex(Math.min(start, last));
  }, [start, last]);

  const go = (delta: number) => setIndex((i) => Math.min(last, Math.max(0, i + delta)));
  const at = Math.min(index, last);
  const design = designs[at];
  if (!design) return null;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[70] bg-slate-950/70 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'ArrowLeft') go(-1);
            else if (e.key === 'ArrowRight') go(1);
          }}
          className="fixed inset-0 z-[70] flex flex-col bg-white outline-none md:inset-auto md:left-1/2 md:top-1/2 md:h-[min(46rem,calc(100dvh-3rem))] md:w-[min(52rem,calc(100vw-3rem))] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl md:shadow-pop"
        >
          <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="truncate text-lg font-bold text-slate-900">
                {formatOrderNo(design.orderNo)}
                <span className="ml-2 font-semibold text-slate-500">{design.designCode}</span>
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="sr-only">Design preview</DialogPrimitive.Description>
            </div>
            <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-sm font-semibold tabular-nums text-slate-600" aria-live="polite">
              {at + 1} / {designs.length}
            </span>
            <DialogPrimitive.Close
              className="flex size-10 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-muted"
              aria-label="Close preview"
            >
              <X className="size-5" />
            </DialogPrimitive.Close>
          </div>

          <div
            className="relative flex min-h-0 flex-1 touch-pan-y items-center justify-center bg-slate-50 p-3 md:p-6"
            onTouchStart={(e) => {
              touchX.current = e.touches[0].clientX;
            }}
            onTouchEnd={(e) => {
              if (touchX.current === null) return;
              const dx = e.changedTouches[0].clientX - touchX.current;
              touchX.current = null;
              if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
            }}
          >
            <PreviewImage key={`${design.orderNo}-${design.designCode}`} design={design} />
            <ArrowButton side="left" disabled={at <= 0} onClick={() => go(-1)} />
            <ArrowButton side="right" disabled={at >= last} onClick={() => go(1)} />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function PreviewImage({ design }: { design: ChallanDesign }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const src = design.imageUrl ?? design.thumbUrl;
  if (!src || failed) {
    return (
      <div className="flex flex-col items-center gap-2 text-slate-400">
        <ImageIcon className="size-14" aria-hidden />
        <p className="text-sm font-medium">No image for this design</p>
      </div>
    );
  }
  return (
    <>
      {!loaded && <div className="absolute size-10 animate-spin rounded-full border-2 border-slate-300 border-t-primary" aria-hidden />}
      <img
        ref={(el) => {
          if (el?.complete && el.naturalWidth > 0 && !loaded) setLoaded(true);
        }}
        src={src}
        alt={`Design ${design.designCode}`}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        draggable={false}
        className={cn('max-h-full max-w-full select-none rounded-lg object-contain transition-opacity', loaded ? 'opacity-100' : 'opacity-0')}
      />
    </>
  );
}

function ArrowButton({ side, disabled, onClick }: { side: 'left' | 'right'; disabled: boolean; onClick: () => void }) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={side === 'left' ? 'Previous design' : 'Next design'}
      className={cn(
        'absolute top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow-pop outline-none transition hover:bg-white focus-visible:ring-2 focus-visible:ring-primary/40 disabled:pointer-events-none disabled:opacity-30',
        side === 'left' ? 'left-2 md:left-4' : 'right-2 md:right-4',
      )}
    >
      <Icon className="size-6" aria-hidden />
    </button>
  );
}
