import { Camera, ImagePlus, Loader2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { MAX_DAMAGE_IMAGES, type DamageImageInput } from '@rivoora/shared';
import { api, errorMessage } from '@/lib/api';
import { Bi } from '@/lib/bilingual';
import { cn } from '@/lib/utils';
import { validateImage } from '@/components/ui/image-upload';

interface Item {
  id: number;
  preview: string;
  status: 'uploading' | 'done' | 'error';
  error?: string;
  image?: DamageImageInput;
}

let itemId = 0;

/**
 * Photos of a NEW damage (Butta QC only): a Camera button (opens the back camera) and an Attach image button (picks
 * from the device, several at once). Images are optional, max 10; each shows a thumbnail with a remove ✕ and an
 * upload state. `onBusyChange(true)` while an upload runs, so the popup can disable Save.
 */
export function DamageImagePicker({
  value,
  onChange,
  onBusyChange,
}: {
  value: DamageImageInput[];
  onChange: (images: DamageImageInput[]) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [items, setItems] = useState<Item[]>(() => value.map((image) => ({ id: ++itemId, preview: image.thumbUrl, status: 'done', image })));
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const live = useRef(items);
  live.current = items;

  const sync = (next: Item[]) => {
    setItems(next);
    onChange(next.flatMap((i) => (i.image ? [i.image] : [])));
    onBusyChange(next.some((i) => i.status === 'uploading'));
  };
  const patch = (id: number, p: Partial<Item>) => sync(live.current.map((i) => (i.id === id ? { ...i, ...p } : i)));

  useEffect(
    () => () => {
      for (const i of live.current) if (i.preview.startsWith('blob:')) URL.revokeObjectURL(i.preview);
    },
    [],
  );

  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    const room = MAX_DAMAGE_IMAGES - live.current.length;
    const picked = Array.from(files).slice(0, Math.max(0, room));
    const fresh: Item[] = picked.map((f) => {
      const problem = validateImage(f);
      return { id: ++itemId, preview: URL.createObjectURL(f), status: problem ? 'error' : 'uploading', error: problem ?? undefined };
    });
    sync([...live.current, ...fresh]);
    await Promise.all(
      picked.map(async (file, n) => {
        const item = fresh[n];
        if (item.status === 'error') return;
        try {
          const res = await api.upload(file, 'damages');
          patch(item.id, { status: 'done', image: { url: res.url, thumbUrl: res.thumbUrl } });
        } catch (err) {
          patch(item.id, { status: 'error', error: errorMessage(err) });
        }
      }),
    );
  };

  const full = items.length >= MAX_DAMAGE_IMAGES;
  const button = 'flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border-2 border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 transition-colors hover:border-primary/40 hover:bg-primary-soft/30 disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <div>
      <div className="flex gap-2">
        <button type="button" className={button} disabled={full} onClick={() => camera.current?.click()}>
          <Camera className="size-5 shrink-0" aria-hidden />
          <Bi en="Camera" hi="कैमरा" layout="inline" />
        </button>
        <button type="button" className={button} disabled={full} onClick={() => gallery.current?.click()}>
          <ImagePlus className="size-5 shrink-0" aria-hidden />
          <Bi en="Attach image" hi="फोटो जोड़ें" layout="inline" />
        </button>
        <input
          ref={camera}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            void add(e.target.files);
            e.target.value = '';
          }}
        />
        <input
          ref={gallery}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            void add(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      {items.length > 0 && (
        <ul className="mt-3 grid grid-cols-4 gap-2" aria-label="Damage photos">
          {items.map((i) => (
            <li key={i.id} className={cn('relative aspect-square overflow-hidden rounded-lg border bg-slate-100', i.status === 'error' ? 'border-destructive' : 'border-border')}>
              <img src={i.preview} alt="" className={cn('size-full object-cover', i.status !== 'done' && 'opacity-50')} />
              {i.status === 'uploading' && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className="size-6 animate-spin text-primary" aria-label="Uploading" />
                </span>
              )}
              {i.status === 'error' && (
                <span className="absolute inset-x-0 bottom-0 bg-destructive/90 px-1 py-0.5 text-center text-[10px] font-semibold leading-tight text-white" title={i.error}>
                  Failed
                </span>
              )}
              <button
                type="button"
                onClick={() => sync(items.filter((x) => x.id !== i.id))}
                className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                aria-label="Remove photo"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
