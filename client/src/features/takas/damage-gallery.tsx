import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ChevronLeft, ChevronRight, Loader2, Share2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { DamageImage } from '@rivoora/shared';
import { useBilingual } from '@/lib/bilingual';
import { shareImage } from '@/lib/share-image';
import { cn } from '@/lib/utils';

/** Share button (Sprint 15): the photo + "Damage: … | Taka … | Order #…" via the share sheet, or WhatsApp + download. */
export function ShareDamageButton({ url, text, className, label = 'Share' }: { url: string; text: string; className?: string; label?: string }) {
  const [busy, setBusy] = useState(false);
  const bilingual = useBilingual();
  const onShare = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setBusy(true);
    try {
      const outcome = await shareImage(url, text);
      if (outcome === 'fallback') {
        toast.message(bilingual ? 'WhatsApp opened. The photo was downloaded — attach it. / फोटो डाउनलोड हो गया, उसे जोड़ें।' : 'WhatsApp opened with the message. The photo was downloaded — attach it by hand.');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not share the photo');
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      onClick={onShare}
      disabled={busy}
      className={cn('inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60', className)}
    >
      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Share2 className="size-4" aria-hidden />}
      {label}
      {bilingual && <span lang="hi" className="font-medium opacity-80">/ शेयर</span>}
    </button>
  );
}

/**
 * Photos of a damage: thumbnails (tap → a lightbox with previous / next; arrow keys work). Nothing is rendered when
 * the damage has no photos. Shown only in the taka details drawer and the damage details screen — never on lists.
 */
export function DamageGallery({ images, alt, thumbClassName, shareText }: { images: DamageImage[] | undefined; alt: string; thumbClassName?: string; shareText?: string }) {
  const [index, setIndex] = useState<number | null>(null);
  const list = images ?? [];
  const open = index !== null;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setIndex((i) => (i === null ? i : (i + 1) % list.length));
      if (e.key === 'ArrowLeft') setIndex((i) => (i === null ? i : (i + list.length - 1) % list.length));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, list.length]);

  if (list.length === 0) return null;
  const step = (d: number) => setIndex((i) => (i === null ? i : (i + d + list.length) % list.length));

  return (
    <>
      <ul className="flex flex-wrap gap-2" aria-label={`Photos of ${alt}`}>
        {list.map((img, i) => (
          <li key={img.id}>
            <button
              type="button"
              onClick={() => setIndex(i)}
              className={cn(
                'block size-16 overflow-hidden rounded-lg border border-border bg-slate-100 transition duration-150 hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/40',
                thumbClassName,
              )}
              aria-label={`Open photo ${i + 1} of ${list.length}`}
            >
              <img src={img.thumbUrl} alt="" loading="lazy" className="size-full object-cover" />
            </button>
          </li>
        ))}
      </ul>
      {shareText && list.length > 0 && <ShareDamageButton url={list[0].url} text={shareText} label={list.length > 1 ? 'Share first photo' : 'Share photo'} className="mt-2" />}
      <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && setIndex(null)}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-[80] bg-slate-950/90 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content className="fixed inset-0 z-[80] flex items-center justify-center p-3 outline-none md:p-10" onClick={() => setIndex(null)}>
            <DialogPrimitive.Title className="sr-only">{alt}</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">Damage photo preview</DialogPrimitive.Description>
            {index !== null && list[index] && (
              <img
                key={list[index].id}
                src={list[index].url}
                alt={alt}
                onClick={(e) => e.stopPropagation()}
                className="max-h-full max-w-full rounded-lg object-contain shadow-2xl animate-in fade-in-0"
              />
            )}
            {list.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    step(-1);
                  }}
                  className="absolute left-2 top-1/2 flex size-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
                  aria-label="Previous photo"
                >
                  <ChevronLeft className="size-7" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    step(1);
                  }}
                  className="absolute right-2 top-1/2 flex size-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
                  aria-label="Next photo"
                >
                  <ChevronRight className="size-7" />
                </button>
              </>
            )}
            <p className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-sm text-white">
              {index !== null ? index + 1 : 0} / {list.length}
            </p>
            {shareText && index !== null && list[index] && (
              <div className="absolute bottom-3 right-3" onClick={(e) => e.stopPropagation()}>
                <ShareDamageButton url={list[index].url} text={shareText} />
              </div>
            )}
            <DialogPrimitive.Close
              className="absolute right-3 top-3 flex size-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
              aria-label="Close preview"
            >
              <X className="size-6" />
            </DialogPrimitive.Close>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}
