import { zodResolver } from '@hookform/resolvers/zod';
import { RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import type { Design, UploadResult } from '@rivoora/shared';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { ImageThumb } from '@/components/ui/image-thumb';
import { ImageDropzone, ImagePickButton } from '@/components/ui/image-upload';
import { Input, Textarea } from '@/components/ui/input';
import { ResponsiveModal } from '@/components/ui/modal';
import { errorMessage } from '@/lib/api';
import { applyServerFieldError } from '@/lib/form';
import { useSaveDesign } from '../api';

export const designCodeField = z
  .string()
  .trim()
  .min(1, 'Design code is required')
  .max(30, 'Code must be at most 30 characters')
  .regex(/^[A-Za-z0-9_\-/.\s]+$/, 'Use only letters, numbers and - / _ .');

const schema = z.object({
  code: designCodeField,
  name: z.string().max(120),
  notes: z.string().max(1000),
});
type FormValues = z.infer<typeof schema>;

interface DesignFormDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  design?: Design | null;
  onSaved?: (design: Design) => void;
}

export function DesignFormDialog({ open, onOpenChange, design, onSaved }: DesignFormDialogProps) {
  const save = useSaveDesign();
  const [image, setImage] = useState<UploadResult | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (!open) return;
    reset({ code: design?.code ?? '', name: design?.name ?? '', notes: design?.notes ?? '' });
    setImage(design?.imageUrl && design.thumbUrl ? { url: design.imageUrl, thumbUrl: design.thumbUrl } : null);
  }, [open, design, reset]);

  const onSubmit = handleSubmit((values) =>
    save.mutate(
      { id: design?.id, data: { ...values, imageUrl: image?.url ?? null, thumbUrl: image?.thumbUrl ?? null } },
      {
        onSuccess: (saved) => {
          toast.success(design ? 'Design updated' : `Design ${saved.code} added`);
          onOpenChange(false);
          onSaved?.(saved);
        },
        onError: (err) => {
          if (!applyServerFieldError(err, setError, ['code', 'name', 'notes'])) toast.error(errorMessage(err));
        },
      },
    ),
  );

  const imageChanged = (image?.url ?? null) !== (design?.imageUrl ?? null);

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(o) => !save.isPending && onOpenChange(o)}
      title={design ? `Edit design ${design.code}` : 'Add design'}
      size="lg"
      mobileVariant="fullscreen"
      dismissible={!isDirty && !imageChanged}
      footer={
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="design-form" loading={save.isPending}>
            {design ? 'Save changes' : 'Save design'}
          </Button>
        </div>
      }
    >
      <form id="design-form" onSubmit={onSubmit} noValidate className="grid gap-5 sm:grid-cols-[220px_1fr]">
        <Field label="Design image">
          {image ? (
            <div className="space-y-2">
              <ImageThumb thumbUrl={image.thumbUrl} fullUrl={image.url} alt="Design image" className="aspect-square w-full" rounded="rounded-xl" />
              <div className="grid grid-cols-2 gap-2">
                <ImagePickButton folder="designs" onUploaded={setImage}>
                  <RefreshCw /> Change
                </ImagePickButton>
                <Button variant="secondary" size="sm" onClick={() => setImage(null)}>
                  <Trash2 /> Remove
                </Button>
              </div>
            </div>
          ) : (
            <ImageDropzone folder="designs" onUploaded={setImage} hint="JPG, PNG or WebP · up to 10 MB" className="[&_button]:aspect-square" />
          )}
        </Field>
        <div className="grid content-start gap-4">
          <Field label="Design code" htmlFor="d-code" required error={errors.code?.message} hint="Must be unique, e.g. D107">
            <Input id="d-code" autoFocus className="uppercase" autoComplete="off" invalid={!!errors.code} {...register('code')} />
          </Field>
          <Field label="Name" htmlFor="d-name" error={errors.name?.message}>
            <Input id="d-name" placeholder="Optional" {...register('name')} />
          </Field>
          <Field label="Notes" htmlFor="d-notes" error={errors.notes?.message}>
            <Textarea id="d-notes" rows={3} {...register('notes')} />
          </Field>
          {design && design.variations.length > 0 && (
            <p className="rounded-lg bg-accent-soft px-3 py-2 text-[13px] text-accent-foreground">
              Changing the code also renames its {design.variations.length} variation code
              {design.variations.length === 1 ? '' : 's'}.
            </p>
          )}
        </div>
      </form>
    </ResponsiveModal>
  );
}
