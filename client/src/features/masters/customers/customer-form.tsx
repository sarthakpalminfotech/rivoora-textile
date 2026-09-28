import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { normalizePhone, PHONE_REGEX, type Customer } from '@rivoora/shared';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { ResponsiveModal } from '@/components/ui/modal';
import { errorMessage } from '@/lib/api';
import { applyServerFieldError } from '@/lib/form';
import { useSaveCustomer } from '../api';

const optionalPhone = z
  .string()
  .trim()
  .refine((v) => !v || PHONE_REGEX.test(normalizePhone(v) ?? ''), 'Enter a valid 10-digit mobile number');

const schema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120, 'Name is too long'),
  phone: optionalPhone,
  alternatePhone: optionalPhone,
  email: z
    .string()
    .trim()
    .refine((v) => !v || z.string().email().safeParse(v).success, 'Enter a valid email address'),
  address: z.string().max(500),
  city: z.string().max(80),
  gstNumber: z.string().max(20),
  notes: z.string().max(1000),
});
type FormValues = z.infer<typeof schema>;
const FIELDS = Object.keys(schema.shape);

const toValues = (c?: Customer | null): FormValues => ({
  name: c?.name ?? '',
  phone: c?.phone ?? '',
  alternatePhone: c?.alternatePhone ?? '',
  email: c?.email ?? '',
  address: c?.address ?? '',
  city: c?.city ?? '',
  gstNumber: c?.gstNumber ?? '',
  notes: c?.notes ?? '',
});

interface CustomerFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit this customer; omit to add a new one. */
  customer?: Customer | null;
  readOnly?: boolean;
  /** Called with the saved customer (used by Add Order to auto-select it). */
  onSaved?: (customer: Customer) => void;
}

/** Add / edit customer. Reused by the Customer Master and by the ➕ on the Add Order screen. */
export function CustomerFormDialog({ open, onOpenChange, customer, readOnly, onSaved }: CustomerFormDialogProps) {
  const save = useSaveCustomer();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: toValues(customer) });

  useEffect(() => {
    if (open) reset(toValues(customer));
  }, [open, customer, reset]);

  const onSubmit = handleSubmit((values) => {
    save.mutate(
      { id: customer?.id, data: values },
      {
        onSuccess: (saved) => {
          toast.success(customer ? 'Customer updated' : `Customer "${saved.name}" added`);
          onOpenChange(false);
          onSaved?.(saved);
        },
        onError: (err) => {
          if (!applyServerFieldError(err, setError, FIELDS)) toast.error(errorMessage(err));
        },
      },
    );
  });

  const title = readOnly ? 'Customer details' : customer ? 'Edit customer' : 'Add customer';
  const formId = 'customer-form';

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(o) => !save.isPending && onOpenChange(o)}
      title={title}
      size="lg"
      mobileVariant="fullscreen"
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
            <Button type="submit" form={formId} loading={save.isPending}>
              {customer ? 'Save changes' : 'Save customer'}
            </Button>
          </div>
        )
      }
    >
      <form id={formId} onSubmit={onSubmit} noValidate>
        <fieldset disabled={readOnly} className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="c-name" required error={errors.name?.message} className="sm:col-span-2">
            <Input id="c-name" autoFocus={!readOnly} autoComplete="off" invalid={!!errors.name} {...register('name')} />
          </Field>
          <Field label="Phone" htmlFor="c-phone" error={errors.phone?.message}>
            <Input id="c-phone" type="tel" inputMode="tel" placeholder="10-digit mobile" invalid={!!errors.phone} {...register('phone')} />
          </Field>
          <Field label="Alternate phone" htmlFor="c-alt" error={errors.alternatePhone?.message}>
            <Input id="c-alt" type="tel" inputMode="tel" invalid={!!errors.alternatePhone} {...register('alternatePhone')} />
          </Field>
          <Field label="Email" htmlFor="c-email" error={errors.email?.message}>
            <Input id="c-email" type="email" inputMode="email" invalid={!!errors.email} {...register('email')} />
          </Field>
          <Field label="City" htmlFor="c-city" error={errors.city?.message}>
            <Input id="c-city" {...register('city')} />
          </Field>
          <Field label="Address" htmlFor="c-address" error={errors.address?.message} className="sm:col-span-2">
            <Textarea id="c-address" rows={2} className="min-h-[72px]" {...register('address')} />
          </Field>
          <Field label="GST number" htmlFor="c-gst" error={errors.gstNumber?.message}>
            <Input id="c-gst" className="uppercase" {...register('gstNumber')} />
          </Field>
          <Field label="Notes" htmlFor="c-notes" error={errors.notes?.message} className="sm:col-span-2">
            <Textarea id="c-notes" rows={3} {...register('notes')} />
          </Field>
        </fieldset>
      </form>
    </ResponsiveModal>
  );
}
