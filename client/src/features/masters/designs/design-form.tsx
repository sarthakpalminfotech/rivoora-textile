import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { normalizeCode, type Design, type DesignQuality, type UploadResult } from '@rivoora/shared';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { ImageThumb } from '@/components/ui/image-thumb';
import { ImageDropzone, ImagePickButton } from '@/components/ui/image-upload';
import { Input, Textarea } from '@/components/ui/input';
import { ResponsiveModal } from '@/components/ui/modal';
import { Segmented } from '@/components/ui/segmented';
import { useDebounce } from '@/hooks/useDebounce';
import { api, errorMessage } from '@/lib/api';
import { applyServerFieldError } from '@/lib/form';
import { useSaveDesign } from '../api';
import { QualitiesSelect } from './qualities-select';

export const designCodeField = z
  .string()
  .trim()
  .min(1, 'Design code is required')
  .max(30, 'Code must be at most 30 characters')
  .regex(/^[A-Za-z0-9_\-/.\s]+$/, 'Use only letters, numbers and - / _ .');


/** Live "is this code free?" check (design codes are unique among active designs). */
export function useCodeAvailability(code: string, enabled: boolean) {
  const debounced = useDebounce(normalizeCode(code), 400);
  const valid = designCodeField.safeParse(debounced).success;
  return useQuery({
    queryKey: ['designs', 'check-code', debounced],
    queryFn: ({ signal }) => api.get<{ available: boolean }>('/designs/check-code', { code: debounced }, signal),
    enabled: enabled && valid && debounced.length > 0,
    staleTime: 10_000,
  });
}

/** "Goes for butta cutting?" — a required Yes / No choice (nothing pre-selected on a new design). */
export const BUTTA_OPTIONS = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
] as const;
export type ButtaChoice = (typeof BUTTA_OPTIONS)[number]['value'];

const schema = z.object({
  code: designCodeField,
  name: z.string().max(120),
  notes: z.string().max(1000),
  /** Sprint 18: one or more qualities (required). */
  qualities: z.array(z.custom<DesignQuality>()).min(1, 'Pick at least one quality'),
  buttaCutting: z
    .enum(['yes', 'no'])
    .nullable()
    .refine((v): boolean => v !== null, 'Choose Yes or No'),
});
type FormValues = z.infer<typeof schema>;

interface DesignFormDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  design?: Design | null;
  onSaved?: (design: Design) => void;
  /** Sprint 18: a new design opened from a quality page starts in that quality. */
  initialQualities?: DesignQuality[];
}

export function DesignFormDialog({ open, onOpenChange, design, onSaved, initialQualities }: DesignFormDialogProps) {
  const save = useSaveDesign();
  const [image, setImage] = useState<UploadResult | null>(null);
  const {
    control,
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (!open) return;
    reset({
      code: design?.code ?? '',
      name: design?.name ?? '',
      notes: design?.notes ?? '',
      qualities: design?.qualities ?? initialQualities ?? [],
      buttaCutting: design ? (design.buttaCutting ? 'yes' : 'no') : null,
    });
    setImage(design?.imageUrl && design.thumbUrl ? { url: design.imageUrl, thumbUrl: design.thumbUrl } : null);
    // initialQualities is read only when the dialog opens (a new array on every parent render must not reset the form).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, design, reset]);

  const onSubmit = handleSubmit((values) =>
    save.mutate(
      {
        id: design?.id,
        data: {
          code: values.code,
          name: values.name,
          notes: values.notes,
          materialIds: values.qualities.map((q) => q.id),
          buttaCutting: values.buttaCutting === 'yes',
          imageUrl: image?.url ?? null,
          thumbUrl: image?.thumbUrl ?? null,
        },
      },
      {
        onSuccess: (saved) => {
          toast.success(design ? 'Design updated' : `Design ${saved.code} added`);
          onOpenChange(false);
          onSaved?.(saved);
        },
        onError: (err) => {
          if (!applyServerFieldError(err, setError, ['code', 'name', 'notes', 'buttaCutting', 'qualities'], { materialIds: 'qualities' })) toast.error(errorMessage(err));
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
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Design code" htmlFor="d-code" required error={errors.code?.message} hint="Must be unique, e.g. D107">
              <Input id="d-code" autoFocus className="uppercase" autoComplete="off" invalid={!!errors.code} {...register('code')} />
            </Field>
            <Field label="Name" htmlFor="d-name" error={errors.name?.message}>
              <Input id="d-name" placeholder="Optional" {...register('name')} />
            </Field>
          </div>
          <Field
            label="Qualities"
            htmlFor="d-qualities"
            required
            error={errors.qualities?.message}
            hint="The design shows under each of these qualities. Picking it on an order fills in the quality (or asks, if there are several)."
          >
            <Controller
              control={control}
              name="qualities"
              render={({ field }) => (
                <QualitiesSelect id="d-qualities" value={field.value ?? []} onChange={field.onChange} invalid={!!errors.qualities} />
              )}
            />
          </Field>
          <Field
            label="Goes for butta cutting?"
            htmlFor="d-butta"
            required
            error={errors.buttaCutting?.message}
            hint="Changing this affects takas entered from now on."
          >
            <Controller
              control={control}
              name="buttaCutting"
              render={({ field }) => (
                <Segmented<ButtaChoice>
                  id="d-butta"
                  aria-label="Goes for butta cutting"
                  options={[...BUTTA_OPTIONS]}
                  value={field.value}
                  onChange={field.onChange}
                  invalid={!!errors.buttaCutting}
                />
              )}
            />
          </Field>
          <Field label="Notes" htmlFor="d-notes" error={errors.notes?.message}>
            <Textarea id="d-notes" rows={3} {...register('notes')} />
          </Field>
        </div>
      </form>
    </ResponsiveModal>
  );
}
