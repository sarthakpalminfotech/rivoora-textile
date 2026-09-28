import { ImagePlus, Loader2 } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { UploadResult } from '@rivoora/shared';
import { Button } from '@/components/ui/button';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif';

export function validateImage(file: File): string | null {
  const okType = /^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name);
  if (!okType) return `"${file.name}" is not a supported image. Use JPG, PNG, WebP or HEIC.`;
  if (file.size > MAX_IMAGE_BYTES) return `"${file.name}" is larger than 10 MB.`;
  return null;
}

/** Validates, uploads and returns the stored URLs; shows a toast on failure. */
export async function uploadImage(file: File, folder: 'designs' | 'notes'): Promise<UploadResult | null> {
  const problem = validateImage(file);
  if (problem) {
    toast.error(problem);
    return null;
  }
  try {
    return await api.upload(file, folder);
  } catch (err) {
    toast.error(errorMessage(err));
    return null;
  }
}

interface ImagePickButtonProps {
  folder: 'designs' | 'notes';
  onUploaded: (result: UploadResult) => void;
  children: ReactNode;
  className?: string;
  variant?: 'secondary' | 'ghost' | 'soft';
  size?: 'sm' | 'md' | 'icon' | 'icon-sm';
  'aria-label'?: string;
  multiple?: boolean;
  disabled?: boolean;
}

/** A button that opens the file picker (camera or gallery on phones) and uploads the chosen image(s). */
export function ImagePickButton({
  folder,
  onUploaded,
  children,
  className,
  variant = 'secondary',
  size = 'sm',
  multiple,
  disabled,
  'aria-label': ariaLabel,
}: ImagePickButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const handle = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    for (const file of Array.from(files)) {
      const result = await uploadImage(file, folder);
      if (result) onUploaded(result);
    }
    setBusy(false);
  };

  return (
    <>
      <Button
        variant={variant}
        size={size}
        className={className}
        loading={busy}
        disabled={disabled}
        aria-label={ariaLabel}
        onClick={() => inputRef.current?.click()}
      >
        {!busy && children}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple={multiple}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          void handle(e.target.files);
          e.target.value = '';
        }}
      />
    </>
  );
}

interface ImageDropzoneProps {
  folder: 'designs' | 'notes';
  onUploaded: (result: UploadResult) => void;
  label?: ReactNode;
  hint?: ReactNode;
  className?: string;
  compact?: boolean;
}

/** Click / tap (camera or gallery on phones) or drag an image in. */
export function ImageDropzone({ folder, onUploaded, label = 'Upload image', hint, className, compact }: ImageDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);

  const handle = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    const result = await uploadImage(file, folder);
    setBusy(false);
    if (result) onUploaded(result);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        void handle(e.dataTransfer.files[0]);
      }}
      className={className}
    >
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/60 px-4 text-center transition-colors hover:border-primary/50 hover:bg-primary-soft/50 disabled:cursor-wait',
          compact ? 'py-4' : 'py-7',
          drag && 'border-primary bg-primary-soft',
        )}
      >
        {busy ? (
          <Loader2 className="size-6 animate-spin text-primary" aria-hidden />
        ) : (
          <ImagePlus className="size-6 text-primary" aria-hidden />
        )}
        <span className="text-sm font-semibold text-slate-800">{busy ? 'Uploading…' : label}</span>
        {hint && !busy && <span className="text-xs text-muted-foreground">{hint}</span>}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          void handle(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}
