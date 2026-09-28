import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ImageIcon, X, ZoomIn } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

interface ImageThumbProps {
  thumbUrl: string | null | undefined;
  /** Full image, loaded only when the preview opens. */
  fullUrl?: string | null;
  alt: string;
  className?: string;
  /** Allow tapping to open a full-size preview. */
  preview?: boolean;
  rounded?: string;
}

/** Lazy thumbnail with a neutral placeholder and an optional lightbox. */
export function ImageThumb({ thumbUrl, fullUrl, alt, className, preview = true, rounded = 'rounded-lg' }: ImageThumbProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  const img = (
    <span className={cn('relative block overflow-hidden bg-slate-100', rounded, className)}>
      {thumbUrl && !failed ? (
        <img
          ref={(el) => {
            // Cached images can finish before onLoad is attached.
            if (el?.complete && el.naturalWidth > 0 && !loaded) setLoaded(true);
          }}
          src={thumbUrl}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={cn('size-full object-cover transition-opacity duration-300', loaded ? 'opacity-100' : 'opacity-0')}
        />
      ) : (
        <span className="flex size-full items-center justify-center text-slate-300">
          <ImageIcon className="size-1/3 max-h-8 max-w-8" aria-hidden />
        </span>
      )}
      {thumbUrl && !loaded && !failed && <span className="absolute inset-0 animate-pulse bg-slate-200/70" aria-hidden />}
    </span>
  );

  if (!preview || !thumbUrl || failed) return img;

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className={cn('group relative block shrink-0 overflow-hidden focus-visible:ring-2 focus-visible:ring-primary/40', rounded, className)}
        aria-label={`Preview ${alt}`}
      >
        {img}
        <span className="absolute inset-0 flex items-center justify-center bg-slate-900/0 text-white opacity-0 transition group-hover:bg-slate-900/25 group-hover:opacity-100">
          <ZoomIn className="size-5" aria-hidden />
        </span>
      </button>
      <Lightbox open={open} onOpenChange={setOpen} src={fullUrl ?? thumbUrl} alt={alt} />
    </>
  );
}

export function Lightbox({
  open,
  onOpenChange,
  src,
  alt,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  src: string;
  alt: string;
}) {
  const [loaded, setLoaded] = useState(false);
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setLoaded(false);
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[80] bg-slate-950/90 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-[80] flex items-center justify-center p-3 outline-none md:p-10"
          onClick={() => onOpenChange(false)}
        >
          <DialogPrimitive.Title className="sr-only">{alt}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Full size image preview</DialogPrimitive.Description>
          {!loaded && <div className="absolute size-10 animate-spin rounded-full border-2 border-white/30 border-t-white" />}
          <img
            ref={(el) => {
              if (el?.complete && el.naturalWidth > 0 && !loaded) setLoaded(true);
            }}
            src={src}
            alt={alt}
            onLoad={() => setLoaded(true)}
            onClick={(e) => e.stopPropagation()}
            className={cn('max-h-full max-w-full rounded-lg object-contain shadow-2xl transition-opacity', loaded ? 'opacity-100' : 'opacity-0')}
          />
          <p className="absolute bottom-4 left-1/2 max-w-[90vw] -translate-x-1/2 truncate rounded-full bg-black/50 px-3 py-1 text-sm text-white">
            {alt}
          </p>
          <DialogPrimitive.Close
            className="absolute right-3 top-3 flex size-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
            aria-label="Close preview"
          >
            <X className="size-6" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
