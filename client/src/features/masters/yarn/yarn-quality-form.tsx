import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { gramsToKg, kgText, parseKgText, type YarnQuality } from '@rivoora/shared';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { ResponsiveModal } from '@/components/ui/modal';
import { errorMessage } from '@/lib/api';
import { applyServerFieldError } from '@/lib/form';
import { useSaveYarnQuality } from '../../yarn/api';
import { KgInput } from '../../yarn/parts';

const schema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120, 'Name is too long'),
  denier: z.string().max(30, 'At most 30 characters'),
  filament: z.string().max(30, 'At most 30 characters'),
  notes: z.string().max(1000),
  /** Sprint 25: optional minimum available kg ('' = none). */
  minKg: z.string().refine((v) => !v.trim() || (parseKgText(v) ?? 0) > 0, 'Enter more than 0 kg, or leave it empty'),
});
type FormValues = z.infer<typeof schema>;

const toValues = (q: YarnQuality | null): FormValues => ({
  name: q?.name ?? '',
  denier: q?.denier ?? '',
  filament: q?.filament ?? '',
  notes: q?.notes ?? '',
  minKg: q?.minG ? kgText(q.minG) : '',
});

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  quality?: YarnQuality | null;
  readOnly?: boolean;
  /** Quick-add from a PO line: the new quality gets selected there. */
  onSaved?: (q: YarnQuality) => void;
}

/** Yarn quality form — used for raw AND twisted yarn. Name · Denier · Filament on one row from 1024px. */
export function YarnQualityFormDialog({ open, onOpenChange, quality = null, readOnly = false, onSaved }: Props) {
  const save = useSaveYarnQuality();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    watch,
    setValue,
    formState: { errors, isDirty },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: toValues(quality) });

  useEffect(() => {
    if (open) reset(toValues(quality));
  }, [open, quality, reset]);

  const onSubmit = handleSubmit(({ minKg, ...rest }) =>
    save.mutate(
      { id: quality?.id, data: { ...rest, minKg: minKg.trim() ? gramsToKg(parseKgText(minKg)!) : null } },
      {
        onSuccess: (q) => {
          toast.success(quality ? `Quality ${q.name} updated` : `Quality "${q.name}" added`);
          onSaved?.(q);
          onOpenChange(false);
        },
        onError: (err) => {
          if (!applyServerFieldError(err, setError, ['name', 'denier', 'filament', 'notes', 'minKg'])) toast.error(errorMessage(err));
        },
      },
    ),
  );

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(o) => !save.isPending && onOpenChange(o)}
      title={readOnly ? 'Yarn quality' : quality ? 'Edit yarn quality' : 'Add yarn quality'}
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
            <Button type="submit" form="yarn-quality-form" loading={save.isPending}>
              {quality ? 'Save changes' : 'Save quality'}
            </Button>
          </div>
        )
      }
    >
      <form id="yarn-quality-form" onSubmit={onSubmit} noValidate>
        <fieldset disabled={readOnly} className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <Field label="Name" htmlFor="yq-name" required error={errors.name?.message} hint="e.g. 75D/36F Semi dull">
            <Input id="yq-name" autoFocus={!readOnly} autoComplete="off" invalid={!!errors.name} {...register('name')} />
          </Field>
          <Field label="Denier" htmlFor="yq-denier" error={errors.denier?.message}>
            <Input id="yq-denier" autoComplete="off" placeholder="e.g. 75" {...register('denier')} />
          </Field>
          <Field label="Filament" htmlFor="yq-filament" error={errors.filament?.message}>
            <Input id="yq-filament" autoComplete="off" placeholder="e.g. 36" {...register('filament')} />
          </Field>
          <Field label="Notes" htmlFor="yq-notes" error={errors.notes?.message} className="md:col-span-2">
            <Textarea id="yq-notes" rows={3} {...register('notes')} />
          </Field>
          {/* Sprint 25: the Low yarn card lists the quality when its available kg drop below this. */}
          <Field label="Minimum kg" error={errors.minKg?.message} hint="Optional · for the Low yarn card">
            <KgInput value={watch('minKg')} onValueChange={(v) => setValue('minKg', v, { shouldDirty: true, shouldValidate: !!errors.minKg })} invalid={!!errors.minKg} aria-label="Minimum kg" />
          </Field>
        </fieldset>
      </form>
    </ResponsiveModal>
  );
}
