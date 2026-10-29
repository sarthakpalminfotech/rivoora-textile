import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import type { WarpingQuality } from '@rivoora/shared';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { ResponsiveModal } from '@/components/ui/modal';
import { errorMessage } from '@/lib/api';
import { applyServerFieldError } from '@/lib/form';
import { useSaveWarpingQuality } from '../../yarn/api';

const schema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120, 'Name is too long'),
  notes: z.string().max(1000),
});
type FormValues = z.infer<typeof schema>;

const toValues = (q: WarpingQuality | null): FormValues => ({ name: q?.name ?? '', notes: q?.notes ?? '' });

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  quality?: WarpingQuality | null;
  readOnly?: boolean;
  /** Quick-add from a TFO stop / warping beam picker: the new quality gets selected there. */
  onSaved?: (q: WarpingQuality) => void;
}

/** Sprint 20 — Warping quality form: twisted yarn's identity from the TFO stop onward. */
export function WarpingQualityFormDialog({ open, onOpenChange, quality = null, readOnly = false, onSaved }: Props) {
  const save = useSaveWarpingQuality();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: toValues(quality) });

  useEffect(() => {
    if (open) reset(toValues(quality));
  }, [open, quality, reset]);

  const onSubmit = handleSubmit((data) =>
    save.mutate(
      { id: quality?.id, data },
      {
        onSuccess: (q) => {
          toast.success(quality ? `Quality ${q.name} updated` : `Quality "${q.name}" added`);
          onSaved?.(q);
          onOpenChange(false);
        },
        onError: (err) => {
          if (!applyServerFieldError(err, setError, ['name', 'notes'])) toast.error(errorMessage(err));
        },
      },
    ),
  );

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(o) => !save.isPending && onOpenChange(o)}
      title={readOnly ? 'Warping quality' : quality ? 'Edit warping quality' : 'Add warping quality'}
      size="lg"
      dismissible={!isDirty}
      footer={
        readOnly ? (
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        ) : (
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={save.isPending}>
              Cancel
            </Button>
            <Button type="submit" form="warping-quality-form" loading={save.isPending}>
              {quality ? 'Save changes' : 'Save quality'}
            </Button>
          </div>
        )
      }
    >
      <form id="warping-quality-form" onSubmit={onSubmit} noValidate>
        <fieldset disabled={readOnly} className="grid gap-4 md:grid-cols-2">
          <Field label="Name" htmlFor="wq-name" required error={errors.name?.message} hint="e.g. 2 ply 150D" className="md:col-span-2">
            <Input id="wq-name" autoFocus={!readOnly} autoComplete="off" invalid={!!errors.name} {...register('name')} />
          </Field>
          <Field label="Notes" htmlFor="wq-notes" error={errors.notes?.message} className="md:col-span-2">
            <Textarea id="wq-notes" rows={3} {...register('notes')} />
          </Field>
        </fieldset>
      </form>
    </ResponsiveModal>
  );
}
