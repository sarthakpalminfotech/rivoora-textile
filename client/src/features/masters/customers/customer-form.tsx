import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, UserRound, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { BROKER_NAME_MAX_LENGTH, normalizePhone, PHONE_REGEX, type Customer } from '@rivoora/shared';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { ResponsiveModal } from '@/components/ui/modal';
import { ApiError, errorMessage } from '@/lib/api';
import { applyServerFieldError } from '@/lib/form';
import { useSaveCustomer } from '../api';

const optionalPhone = z
  .string()
  .trim()
  .refine((v) => !v || PHONE_REGEX.test(normalizePhone(v) ?? ''), 'Enter a valid 10-digit mobile number');

const brokerName = z.string().trim().max(BROKER_NAME_MAX_LENGTH, `At most ${BROKER_NAME_MAX_LENGTH} characters`);

const schema = z
  .object({
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
    /** `brokerId` = an existing broker (renamed when the name changed); none = new. */
    brokers: z.array(z.object({ brokerId: z.number().optional(), name: brokerName })),
  })
  .superRefine((v, ctx) => {
    // Duplicates within the customer are blocked inline (empty rows are ignored).
    const seen = new Set<string>();
    v.brokers.forEach((b, i) => {
      const key = b.name.trim().toLowerCase();
      if (!key) return;
      if (seen.has(key)) ctx.addIssue({ code: 'custom', path: ['brokers', i, 'name'], message: 'This broker is already added' });
      seen.add(key);
    });
  });
type FormValues = z.infer<typeof schema>;
const FIELDS = ['name', 'phone', 'alternatePhone', 'email', 'address', 'city', 'gstNumber', 'notes'];

const toValues = (c?: Customer | null): FormValues => ({
  name: c?.name ?? '',
  phone: c?.phone ?? '',
  alternatePhone: c?.alternatePhone ?? '',
  email: c?.email ?? '',
  address: c?.address ?? '',
  city: c?.city ?? '',
  gstNumber: c?.gstNumber ?? '',
  notes: c?.notes ?? '',
  brokers: (c?.brokers ?? []).map((b) => ({ brokerId: b.id, name: b.name })),
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

/** Add / edit customer (incl. its brokers). Reused by the Customer Master and by the ➕ on the Add Order screen. */
export function CustomerFormDialog({ open, onOpenChange, customer, readOnly, onSaved }: CustomerFormDialogProps) {
  const save = useSaveCustomer();
  const {
    control,
    register,
    handleSubmit,
    reset,
    setError,
    getValues,
    formState: { errors, isDirty },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: toValues(customer) });
  const brokers = useFieldArray({ control, name: 'brokers', keyName: 'key' });
  const [newBroker, setNewBroker] = useState('');
  const [newBrokerError, setNewBrokerError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      reset(toValues(customer));
      setNewBroker('');
      setNewBrokerError(null);
    }
  }, [open, customer, reset]);

  const addBroker = () => {
    const name = newBroker.trim();
    if (!name) return;
    if (name.length > BROKER_NAME_MAX_LENGTH) {
      setNewBrokerError(`At most ${BROKER_NAME_MAX_LENGTH} characters`);
      return;
    }
    if (getValues('brokers').some((b) => b.name.trim().toLowerCase() === name.toLowerCase())) {
      setNewBrokerError('This broker is already added');
      return;
    }
    brokers.append({ name });
    setNewBroker('');
    setNewBrokerError(null);
  };

  const onSubmit = handleSubmit((values) => {
    // A name still in the "add" box counts too (so it isn't lost by forgetting to tap Add broker).
    const pending = newBroker.trim();
    const list = [...values.brokers.map((b) => ({ id: b.brokerId, name: b.name.trim() })), ...(pending ? [{ name: pending }] : [])];
    if (pending && values.brokers.some((b) => b.name.trim().toLowerCase() === pending.toLowerCase())) {
      setNewBrokerError('This broker is already added');
      return;
    }
    const { brokers: _b, ...rest } = values;
    save.mutate(
      { id: customer?.id, data: { ...rest, brokers: list.filter((b) => b.name) } },
      {
        onSuccess: (saved) => {
          toast.success(customer ? 'Customer updated' : `Customer "${saved.name}" added`);
          onOpenChange(false);
          onSaved?.(saved);
        },
        onError: (err) => {
          // Broker errors come back as `brokers.<i>.name`.
          if (err instanceof ApiError && err.field?.startsWith('brokers.')) {
            const i = Number(err.field.split('.')[1]);
            if (i < values.brokers.length) setError(`brokers.${i}.name`, { type: 'server', message: err.message });
            else setNewBrokerError(err.message);
            return;
          }
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
      dismissible={!isDirty && !newBroker.trim()}
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

          {/* Brokers: just names. Renaming a row renames that broker; removing one keeps it on old orders. */}
          <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
            <span className="text-sm font-medium text-slate-700" id="c-brokers-label">
              Brokers
            </span>
            {brokers.fields.length > 0 && (
              <ul className="space-y-2" aria-labelledby="c-brokers-label">
                {brokers.fields.map((f, i) => {
                  const err = errors.brokers?.[i]?.name?.message;
                  return (
                    <li key={f.key}>
                      <div className="flex items-center gap-2">
                        <Input
                          aria-label={`Broker ${i + 1}`}
                          wrapperClassName="min-w-0 flex-1"
                          prefix={<UserRound className="size-4 text-slate-400" aria-hidden />}
                          invalid={!!err}
                          autoComplete="off"
                          {...register(`brokers.${i}.name`)}
                        />
                        {!readOnly && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="shrink-0 text-slate-500 hover:bg-destructive-soft hover:text-destructive"
                            onClick={() => brokers.remove(i)}
                            aria-label={`Remove broker ${f.name || i + 1}`}
                          >
                            <X className="!size-5" />
                          </Button>
                        )}
                      </div>
                      {err && (
                        <p role="alert" className="mt-1 text-[13px] font-medium text-destructive">
                          {err}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {readOnly ? (
              brokers.fields.length === 0 && <p className="text-sm text-muted-foreground">No brokers.</p>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <Input
                    id="c-new-broker"
                    aria-label="New broker name"
                    placeholder="Broker name"
                    autoComplete="off"
                    value={newBroker}
                    invalid={!!newBrokerError}
                    onChange={(e) => {
                      setNewBroker(e.target.value);
                      setNewBrokerError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addBroker();
                      }
                    }}
                  />
                  <Button variant="secondary" className="shrink-0" onClick={addBroker} disabled={!newBroker.trim()}>
                    <Plus /> Add broker
                  </Button>
                </div>
                {newBrokerError ? (
                  <p role="alert" className="text-[13px] font-medium text-destructive">
                    {newBrokerError}
                  </p>
                ) : (
                  <p className="text-[13px] text-muted-foreground">Optional · a customer can have several brokers.</p>
                )}
              </>
            )}
          </div>

          <Field label="Notes" htmlFor="c-notes" error={errors.notes?.message} className="sm:col-span-2">
            <Textarea id="c-notes" rows={3} {...register('notes')} />
          </Field>
        </fieldset>
      </form>
    </ResponsiveModal>
  );
}
