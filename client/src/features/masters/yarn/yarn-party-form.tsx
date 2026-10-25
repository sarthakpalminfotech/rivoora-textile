import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import type { YarnParty } from '@rivoora/shared';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { ResponsiveModal } from '@/components/ui/modal';
import { errorMessage } from '@/lib/api';
import { applyServerFieldError } from '@/lib/form';
import { useSaveYarnParty } from '../../yarn/api';

const schema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120, 'Name is too long'),
  mobile: z.string().max(20, 'Mobile is too long'),
  address: z.string().max(500, 'Address is too long'),
  gstin: z.string().max(20, 'GSTIN is too long'),
  notes: z.string().max(1000),
});
type FormValues = z.infer<typeof schema>;

const toValues = (p: YarnParty | null): FormValues => ({
  name: p?.name ?? '',
  mobile: p?.mobile ?? '',
  address: p?.address ?? '',
  gstin: p?.gstin ?? '',
  notes: p?.notes ?? '',
});

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  party?: YarnParty | null;
  readOnly?: boolean;
  /** Quick-add from the Yarn PO form: the new party gets selected there. */
  onSaved?: (p: YarnParty) => void;
}

/**
 * Yarn party form (Yarn parties master + the ➕ beside Party on the Yarn PO form). Tablet / desktop: Name · Mobile ·
 * GSTIN share rows (2 columns on tablet portrait, 3 from 1024px); only the textareas span the full row.
 */
export function YarnPartyFormDialog({ open, onOpenChange, party = null, readOnly = false, onSaved }: Props) {
  const save = useSaveYarnParty();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: toValues(party) });

  useEffect(() => {
    if (open) reset(toValues(party));
  }, [open, party, reset]);

  const onSubmit = handleSubmit((data) =>
    save.mutate(
      { id: party?.id, data },
      {
        onSuccess: (p) => {
          toast.success(party ? `Party ${p.name} updated` : `Party "${p.name}" added`);
          onSaved?.(p);
          onOpenChange(false);
        },
        onError: (err) => {
          if (!applyServerFieldError(err, setError, ['name', 'mobile', 'address', 'gstin', 'notes'])) toast.error(errorMessage(err));
        },
      },
    ),
  );

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(o) => !save.isPending && onOpenChange(o)}
      title={readOnly ? 'Yarn party' : party ? 'Edit yarn party' : 'Add yarn party'}
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
            <Button type="submit" form="yarn-party-form" loading={save.isPending}>
              {party ? 'Save changes' : 'Save party'}
            </Button>
          </div>
        )
      }
    >
      <form id="yarn-party-form" onSubmit={onSubmit} noValidate>
        <fieldset disabled={readOnly} className="grid gap-4 md:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <Field label="Name" htmlFor="yp-name" required error={errors.name?.message} className="md:col-span-2 lg:col-span-1">
            <Input id="yp-name" autoFocus={!readOnly} autoComplete="off" invalid={!!errors.name} {...register('name')} />
          </Field>
          <Field label="Mobile" htmlFor="yp-mobile" error={errors.mobile?.message}>
            <Input id="yp-mobile" inputMode="tel" autoComplete="off" {...register('mobile')} />
          </Field>
          <Field label="GSTIN" htmlFor="yp-gstin" error={errors.gstin?.message}>
            <Input id="yp-gstin" autoComplete="off" className="uppercase" {...register('gstin')} />
          </Field>
          <Field label="Address" htmlFor="yp-address" error={errors.address?.message} className="md:col-span-2 lg:col-span-3">
            <Textarea id="yp-address" rows={3} {...register('address')} />
          </Field>
          <Field label="Notes" htmlFor="yp-notes" error={errors.notes?.message} className="md:col-span-2 lg:col-span-3">
            <Textarea id="yp-notes" rows={3} {...register('notes')} />
          </Field>
        </fieldset>
      </form>
    </ResponsiveModal>
  );
}
