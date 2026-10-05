import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2, FolderOpen, ImagePlus, Mic, Plus, RefreshCw, Trash2, X, XCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Navigate, useBlocker, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  DEFAULT_UNIT,
  ORDER_TYPE_LABEL,
  ORDER_TYPES,
  UNITS,
  normalizeCode,
  type OrderDetail,
  type OrderType,
  type Unit,
  type UploadResult,
} from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DatePicker } from '@/components/ui/date-picker';
import { Field } from '@/components/ui/field';
import { ImageThumb } from '@/components/ui/image-thumb';
import { ImageDropzone, ImagePickButton } from '@/components/ui/image-upload';
import { Input, NumberInput, Textarea } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { Tooltip } from '@/components/ui/tooltip';
import { useDebounce } from '@/hooks/useDebounce';
import { useRole } from '@/hooks/useRole';
import { errorMessage } from '@/lib/api';
import { formatOrderNo, toApiDate } from '@/lib/format';
import { applyServerFieldError } from '@/lib/form';
import { cn, toNumber } from '@/lib/utils';
import { useBrokerLookup, useCustomerLookup, useMaterialLookup } from '../masters/api';
import { CustomerFormDialog } from '../masters/customers/customer-form';
import { BUTTA_OPTIONS, designCodeField, useCodeAvailability, type ButtaChoice } from '../masters/designs/design-form';
import { useCreateOrder, useUpdateOrder } from './api';
import { SavedDesignsDrawer, type SavedDesignPick } from './saved-designs-drawer';

type DesignAttachment =
  | ({ kind: 'saved' } & SavedDesignPick)
  | { kind: 'upload'; imageUrl: string; thumbUrl: string };

const schema = z
  .object({
    customerId: z.number().nullable(),
    brokerId: z.number().nullable(),
    orderType: z.enum(ORDER_TYPES).nullable(),
    materialId: z.number().nullable(),
    design: z.custom<DesignAttachment | null>(),
    newDesignCode: z.string(),
    /** "Goes for butta cutting?" of a design uploaded from this form (required for an upload). */
    newDesignButta: z.enum(['yes', 'no']).nullable(),
    quantity: z.string().trim(),
    unit: z.enum(UNITS),
    rate: z.string().trim(),
    orderDate: z.string().min(1, 'Pick the order date'),
    notes: z.string().max(4000, 'Notes are too long'),
    noteImages: z.array(z.custom<UploadResult>()).max(10, 'At most 10 images'),
  })
  .superRefine((v, ctx) => {
    if (!v.customerId) ctx.addIssue({ code: 'custom', path: ['customerId'], message: 'Select a client' });
    if (!v.orderType) ctx.addIssue({ code: 'custom', path: ['orderType'], message: 'Pick the order type' });
    if (!v.materialId) ctx.addIssue({ code: 'custom', path: ['materialId'], message: 'Select a material' });
    const q = toNumber(v.quantity);
    if (!v.quantity) ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'Enter the quantity' });
    else if (q === undefined || q <= 0) ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'Quantity must be more than 0' });
    if (v.rate) {
      const r = toNumber(v.rate);
      if (r === undefined || r < 0) ctx.addIssue({ code: 'custom', path: ['rate'], message: 'Enter a valid rate' });
    }
    if (v.design?.kind === 'upload') {
      const res = designCodeField.safeParse(v.newDesignCode);
      if (!res.success) ctx.addIssue({ code: 'custom', path: ['newDesignCode'], message: res.error.issues[0].message });
      if (!v.newDesignButta) ctx.addIssue({ code: 'custom', path: ['newDesignButta'], message: 'Choose Yes or No' });
    }
  });
type FormValues = z.infer<typeof schema>;

const defaults = (): FormValues => ({
  customerId: null,
  brokerId: null,
  // Nothing pre-selected on a new order: the type is a required choice.
  orderType: null,
  materialId: null,
  design: null,
  newDesignCode: '',
  newDesignButta: null,
  quantity: '',
  unit: DEFAULT_UNIT,
  rate: '',
  orderDate: toApiDate(new Date()),
  notes: '',
  noteImages: [],
});

/** Form values of an existing order (edit mode). */
const fromOrder = (o: OrderDetail): FormValues => {
  const image = o.variation ?? o.design;
  return {
    customerId: o.customer.id,
    brokerId: o.broker?.id ?? null,
    orderType: o.orderType,
    materialId: o.material.id,
    design: o.design
      ? {
          kind: 'saved',
          designId: o.design.id,
          variationId: o.variation?.id ?? null,
          code: o.variation?.code ?? o.design.code,
          imageUrl: image?.imageUrl ?? null,
          thumbUrl: image?.thumbUrl ?? null,
          material: null,
        }
      : null,
    newDesignCode: '',
    newDesignButta: null,
    quantity: String(o.quantity),
    unit: o.unit,
    rate: o.rate != null ? String(o.rate) : '',
    orderDate: o.orderDate,
    notes: o.notes ?? '',
    noteImages: o.noteImages.map((img) => ({ url: img.imageUrl, thumbUrl: img.thumbUrl })),
  };
};

const unitOptions = UNITS.map((u) => ({ value: u, label: u }));
const orderTypeOptions = ORDER_TYPES.map((t) => ({ value: t, label: ORDER_TYPE_LABEL[t] }));

function SectionCard({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-xl border border-border bg-white p-4 shadow-soft md:p-5', className)}>
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      {children}
    </section>
  );
}

export default function AddOrderPage() {
  return <OrderForm />;
}

/** The order form: a new order, or (with `order`) editing an existing one from its details screen. */
export function OrderForm({ order }: { order?: OrderDetail }) {
  const isEdit = !!order;
  const title = order ? `Edit order ${formatOrderNo(order.orderNo)}` : 'New order';
  usePageTitle(title);
  const navigate = useNavigate();
  const location = useLocation();
  const { can } = useRole();
  const create = useCreateOrder();
  const update = useUpdateOrder(order?.id ?? 0);
  const saving = create.isPending || update.isPending;
  /** The unit can't change once the order has jobsheets (the server enforces the same rule). */
  const unitLocked = !!order && order.jobsheetCount > 0;
  const savedRef = useRef(false);

  const {
    control,
    register,
    handleSubmit,
    setValue,
    getValues,
    setError,
    clearErrors,
    formState: { errors, isDirty },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: order ? fromOrder(order) : defaults() });

  const [customerId, design, noteImages, newDesignCode] = useWatch({
    control,
    name: ['customerId', 'design', 'noteImages', 'newDesignCode'],
  });

  // Dropdown data with server-side search
  const [customerSearch, setCustomerSearch] = useState('');
  const [materialSearch, setMaterialSearch] = useState('');
  const customers = useCustomerLookup(useDebounce(customerSearch.trim(), 300));
  const materials = useMaterialLookup(useDebounce(materialSearch.trim(), 300));
  const [labels, setLabels] = useState<{ customer?: string; material?: string }>(
    order ? { customer: order.customer.name, material: order.material.name } : {},
  );
  /** Design code whose fixed material was pre-selected (cleared when the user changes the material). */
  const [materialFromDesign, setMaterialFromDesign] = useState<string | null>(null);

  const customerOptions = useMemo(
    () => (customers.data ?? []).map((c) => ({ value: c.id, label: c.name, description: c.city })),
    [customers.data],
  );
  // Broker: only the selected client's brokers (the order's own broker stays listed even if it was removed since).
  const brokers = useBrokerLookup(customerId);
  const brokerOptions = useMemo(() => {
    const opts = (brokers.data ?? []).map((b) => ({ value: b.id, label: b.name }));
    if (order?.broker && order.customer.id === customerId && !opts.some((o) => o.value === order.broker!.id)) {
      opts.unshift({ value: order.broker.id, label: order.broker.name });
    }
    return opts;
  }, [brokers.data, order, customerId]);
  const noBrokers = !!customerId && brokers.isSuccess && brokerOptions.length === 0;
  const materialOptions = useMemo(
    () => (materials.data ?? []).map((m) => ({ value: m.id, label: m.name, description: m.code })),
    [materials.data],
  );

  const [customerFormOpen, setCustomerFormOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const codeCheck = useCodeAvailability(newDesignCode, design?.kind === 'upload');

  // Unsaved-changes protection (in-app navigation + tab close)
  const blocker = useBlocker(({ currentLocation, nextLocation }) => isDirty && !savedRef.current && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (savedRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);

  if (!can(isEdit ? 'canEditOrder' : 'canAddOrder')) return <Navigate to={order ? `/orders/${order.id}` : '/orders'} replace />;

  const setDesign = (d: DesignAttachment | null) => {
    setValue('design', d, { shouldDirty: true });
    clearErrors(['newDesignCode', 'newDesignButta']);
  };

  const onSubmit = handleSubmit((v) => {
    if (design?.kind === 'upload' && codeCheck.data?.available === false) {
      setError('newDesignCode', { message: 'This design code is already used' }, { shouldFocus: true });
      return;
    }
    const payload = {
      customerId: v.customerId!,
      brokerId: v.brokerId,
      orderType: v.orderType!,
      materialId: v.materialId!,
      designId: v.design?.kind === 'saved' ? v.design.designId : null,
      variationId: v.design?.kind === 'saved' ? v.design.variationId : null,
      newDesign:
        v.design?.kind === 'upload'
          ? { code: v.newDesignCode, imageUrl: v.design.imageUrl, thumbUrl: v.design.thumbUrl, buttaCutting: v.newDesignButta === 'yes' }
          : null,
      quantity: toNumber(v.quantity)!,
      unit: v.unit,
      rate: can('canSeeRate') ? (toNumber(v.rate) ?? null) : null,
      orderDate: v.orderDate,
      notes: v.notes,
      noteImages: v.noteImages,
    };
    const onError = (err: unknown) => {
      const handled = applyServerFieldError(err, setError, ['customerId', 'brokerId', 'orderType', 'materialId', 'quantity', 'unit', 'rate', 'orderDate', 'newDesignCode', 'newDesignButta', 'notes'], {
        designCode: 'newDesignCode',
        'newDesign.code': 'newDesignCode',
      });
      if (!handled) toast.error(errorMessage(err));
    };
    if (order) {
      update.mutate(payload, {
        onSuccess: () => {
          savedRef.current = true;
          toast.success(`Order ${formatOrderNo(order.orderNo)} updated`);
          close();
        },
        onError,
      });
    } else {
      create.mutate(payload, {
        onSuccess: (res) => {
          savedRef.current = true;
          toast.success(`Order #${res.orderNo} created`);
          navigate('/orders');
        },
        onError,
      });
    }
  });

  function close() {
    if (!order) navigate('/orders');
    // Back to the details screen (keeps its tab); when the edit URL was opened directly, go to the details URL.
    else if (location.key !== 'default') navigate(-1);
    else navigate(`/orders/${order.id}`, { replace: true });
  }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-2 px-2 md:h-16 md:px-4">
          <Button variant="ghost" size="icon" onClick={close} aria-label="Close">
            <X className="!size-5" />
          </Button>
          <h1 className="flex-1 truncate text-lg font-semibold text-slate-900">{title}</h1>
          <Button className="hidden md:inline-flex" onClick={onSubmit} loading={saving}>
            {isEdit ? 'Save changes' : 'Save order'}
          </Button>
        </div>
      </header>

      <form id="order-form" onSubmit={onSubmit} noValidate className="mx-auto w-full max-w-3xl flex-1 space-y-4 px-4 py-4 md:py-6">
        <SectionCard title="Client & material">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Client name" htmlFor="order-customer" required error={errors.customerId?.message}>
              <Controller
                control={control}
                name="customerId"
                render={({ field }) => (
                  <Select
                    id="order-customer"
                    value={field.value}
                    onChange={(id, opt) => {
                      // Brokers belong to a client: a new client clears the broker.
                      if (id !== field.value) setValue('brokerId', null, { shouldDirty: true });
                      field.onChange(id);
                      setLabels((l) => ({ ...l, customer: opt.label }));
                    }}
                    selectedLabel={labels.customer}
                    options={customerOptions}
                    placeholder="Select client"
                    searchable
                    searchPlaceholder="Search clients…"
                    onSearchChange={setCustomerSearch}
                    loading={customers.isFetching}
                    emptyText="No clients found"
                    invalid={!!errors.customerId}
                    action={
                      // Adding a client needs master rights or order creation (Gaurang edits without it).
                      (can('canManageMasters') || can('canAddOrder')) && (
                        <Button
                          variant="secondary"
                          size="icon"
                          className="shrink-0"
                          onClick={() => setCustomerFormOpen(true)}
                          aria-label="Add new customer"
                          title="Add new customer"
                        >
                          <Plus className="!size-5" />
                        </Button>
                      )
                    }
                  />
                )}
              />
            </Field>
            <Field
              label="Broker"
              htmlFor="order-broker"
              error={errors.brokerId?.message}
              hint={
                !customerId
                  ? 'Select a client first'
                  : noBrokers
                    ? 'Add brokers in the customer (Customers → edit the client)'
                    : 'Optional'
              }
            >
              <Controller
                control={control}
                name="brokerId"
                render={({ field }) => (
                  <Select
                    id="order-broker"
                    value={field.value}
                    // 0 = "No broker" (clears the field).
                    onChange={(id) => field.onChange(id || null)}
                    options={field.value ? [{ value: 0, label: 'No broker' }, ...brokerOptions] : brokerOptions}
                    placeholder={!customerId ? 'Select a client first' : noBrokers ? 'No brokers for this client' : 'Select broker'}
                    selectedLabel={field.value ? brokerOptions.find((o) => o.value === field.value)?.label : undefined}
                    loading={brokers.isFetching}
                    disabled={!customerId || noBrokers}
                    emptyText="No brokers for this client"
                    invalid={!!errors.brokerId}
                  />
                )}
              />
            </Field>
            <Field
              label="Material / Quality"
              htmlFor="order-material"
              required
              error={errors.materialId?.message}
              hint={materialFromDesign ? `Pre-selected from design ${materialFromDesign}` : undefined}
            >
              <Controller
                control={control}
                name="materialId"
                render={({ field }) => (
                  <Select
                    id="order-material"
                    value={field.value}
                    onChange={(id, opt) => {
                      field.onChange(id);
                      setLabels((l) => ({ ...l, material: opt.label }));
                      setMaterialFromDesign(null);
                    }}
                    selectedLabel={labels.material}
                    options={materialOptions}
                    placeholder="Select material"
                    searchable
                    searchPlaceholder="Search materials…"
                    onSearchChange={setMaterialSearch}
                    loading={materials.isFetching}
                    emptyText="No materials found"
                    invalid={!!errors.materialId}
                  />
                )}
              />
            </Field>
            <Field label="Order type" htmlFor="order-type" required error={errors.orderType?.message}>
              <Controller
                control={control}
                name="orderType"
                render={({ field }) => (
                  <Segmented<OrderType>
                    id="order-type"
                    aria-label="Order type"
                    options={orderTypeOptions}
                    value={field.value}
                    onChange={(t) => {
                      field.onChange(t);
                      clearErrors('orderType');
                    }}
                    invalid={!!errors.orderType}
                  />
                )}
              />
            </Field>
          </div>
        </SectionCard>

        <SectionCard title="Design">
          {!design ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <ImageDropzone
                folder="designs"
                label="Upload design image"
                hint="Camera or gallery · JPG, PNG, WebP · 10 MB"
                onUploaded={(img) => setDesign({ kind: 'upload', imageUrl: img.url, thumbUrl: img.thumbUrl })}
              />
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-slate-200 bg-white px-4 py-7 text-center transition-colors hover:border-primary/50 hover:bg-primary-soft/50"
              >
                <FolderOpen className="size-6 text-primary" aria-hidden />
                <span className="text-sm font-semibold text-slate-800">View saved designs</span>
                <span className="text-xs text-muted-foreground">Previous orders or design library</span>
              </button>
            </div>
          ) : (
            <div className="flex gap-3 rounded-xl border border-border bg-slate-50/60 p-3 sm:gap-4">
              <ImageThumb
                thumbUrl={design.thumbUrl}
                fullUrl={design.imageUrl}
                alt={design.kind === 'saved' ? design.code : 'Uploaded design'}
                className="size-24 shrink-0 sm:size-36"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-3">
                {design.kind === 'saved' ? (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {design.variationId ? 'Variation' : 'Design'}
                    </p>
                    <p className="text-xl font-bold text-slate-900">{design.code}</p>
                  </div>
                ) : (
                  <Field
                    label="Design code"
                    htmlFor="new-design-code"
                    required
                    error={errors.newDesignCode?.message}
                    hint={
                      codeCheck.data ? (
                        codeCheck.data.available ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700">
                            <CheckCircle2 className="size-3.5" /> {normalizeCode(newDesignCode)} is available — it will be saved to Design Master
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-destructive">
                            <XCircle className="size-3.5" /> This code is already used
                          </span>
                        )
                      ) : (
                        'New designs are saved into Design Master'
                      )
                    }
                  >
                    <Input
                      id="new-design-code"
                      placeholder="e.g. D120"
                      autoComplete="off"
                      className="uppercase"
                      invalid={!!errors.newDesignCode || codeCheck.data?.available === false}
                      {...register('newDesignCode')}
                    />
                  </Field>
                )}
                {design.kind === 'upload' && (
                  <Field
                    label="Goes for butta cutting?"
                    htmlFor="new-design-butta"
                    required
                    error={errors.newDesignButta?.message}
                    hint="Changing this affects takas entered from now on."
                  >
                    <Controller
                      control={control}
                      name="newDesignButta"
                      render={({ field }) => (
                        <Segmented<ButtaChoice>
                          id="new-design-butta"
                          aria-label="Goes for butta cutting"
                          options={[...BUTTA_OPTIONS]}
                          value={field.value}
                          onChange={(v) => {
                            field.onChange(v);
                            clearErrors('newDesignButta');
                          }}
                          invalid={!!errors.newDesignButta}
                        />
                      )}
                    />
                  </Field>
                )}
                <div className="mt-auto flex flex-wrap gap-2">
                  {design.kind === 'saved' ? (
                    <Button variant="secondary" size="sm" onClick={() => setDrawerOpen(true)}>
                      <RefreshCw /> Change
                    </Button>
                  ) : (
                    <ImagePickButton
                      folder="designs"
                      onUploaded={(img) => setDesign({ kind: 'upload', imageUrl: img.url, thumbUrl: img.thumbUrl })}
                    >
                      <RefreshCw /> Change image
                    </ImagePickButton>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    className="text-destructive hover:bg-destructive-soft"
                    onClick={() => {
                      setDesign(null);
                      setValue('newDesignCode', '');
                      setValue('newDesignButta', null);
                      setMaterialFromDesign(null);
                    }}
                  >
                    <Trash2 /> Remove
                  </Button>
                </div>
              </div>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Quantity & pricing">
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label="Quantity"
              htmlFor="order-qty"
              required
              error={errors.quantity?.message ?? errors.unit?.message}
              hint={unitLocked ? 'The unit is fixed once jobsheets exist' : undefined}
              className="md:col-span-2"
            >
              <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-2 sm:grid-cols-[minmax(0,1fr)_150px]">
                <NumberInput id="order-qty" placeholder="0" invalid={!!errors.quantity} {...register('quantity')} />
                <Controller
                  control={control}
                  name="unit"
                  render={({ field }) => (
                    <Select<Unit> value={field.value} onChange={field.onChange} options={unitOptions} aria-label="Unit" disabled={unitLocked} />
                  )}
                />
              </div>
            </Field>
            {can('canSeeRate') && (
              <Field label="Rate" htmlFor="order-rate" error={errors.rate?.message} hint="Optional · per unit">
                <NumberInput
                  id="order-rate"
                  placeholder="0.00"
                  prefix={<span className="text-[15px] font-semibold text-slate-500">₹</span>}
                  invalid={!!errors.rate}
                  {...register('rate')}
                />
              </Field>
            )}
            <Field label="Order date" htmlFor="order-date" required error={errors.orderDate?.message}>
              <Controller
                control={control}
                name="orderDate"
                render={({ field }) => <DatePicker id="order-date" value={field.value} onChange={field.onChange} invalid={!!errors.orderDate} />}
              />
            </Field>
          </div>
        </SectionCard>

        <SectionCard title="Notes">
          <div className="overflow-hidden rounded-[10px] border border-input bg-slate-50/60 focus-within:border-primary focus-within:bg-white focus-within:ring-2 focus-within:ring-primary/15">
            <Textarea
              id="order-notes"
              aria-label="Notes"
              placeholder="Delivery details, colour instructions, packing…"
              className="min-h-[110px] rounded-none border-0 bg-transparent focus:ring-0"
              {...register('notes')}
            />
            <div className="flex items-center gap-1 border-t border-slate-200 px-2 py-1.5">
              <Tooltip content="Voice notes coming soon">
                <button
                  type="button"
                  aria-disabled="true"
                  aria-label="Voice note (coming soon)"
                  className="flex size-9 cursor-not-allowed items-center justify-center rounded-lg text-slate-300"
                >
                  <Mic className="size-5" />
                </button>
              </Tooltip>
              <ImagePickButton
                folder="notes"
                variant="ghost"
                size="icon-sm"
                multiple
                aria-label="Attach images to note"
                disabled={noteImages.length >= 10}
                onUploaded={(img) => {
                  const current = getValues('noteImages');
                  if (current.length >= 10) return;
                  setValue('noteImages', [...current, img], { shouldDirty: true });
                }}
              >
                <ImagePlus className="!size-5 text-slate-600" />
              </ImagePickButton>
              <span className="ml-auto pr-1 text-xs text-muted-foreground">
                {noteImages.length ? `${noteImages.length} image${noteImages.length === 1 ? '' : 's'}` : ''}
              </span>
            </div>
          </div>
          {errors.notes && <p className="mt-1.5 text-[13px] font-medium text-destructive">{errors.notes.message}</p>}
          {noteImages.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {noteImages.map((img, i) => (
                <li key={img.url} className="relative">
                  <ImageThumb thumbUrl={img.thumbUrl} fullUrl={img.url} alt={`Note image ${i + 1}`} className="size-20" />
                  <button
                    type="button"
                    onClick={() =>
                      setValue(
                        'noteImages',
                        noteImages.filter((x) => x.url !== img.url),
                        { shouldDirty: true },
                      )
                    }
                    className="absolute -right-2 -top-2 flex size-6 items-center justify-center rounded-full bg-slate-900 text-white shadow ring-2 ring-white"
                    aria-label={`Remove note image ${i + 1}`}
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
        <div className="h-20 md:h-4" aria-hidden />
      </form>

      {/* Sticky bottom bar */}
      <div className="sticky bottom-0 z-30 border-t border-border bg-white/95 backdrop-blur">
        <div className="mx-auto grid max-w-3xl grid-cols-2 gap-2 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:flex sm:justify-end">
          <Button variant="secondary" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="order-form" loading={saving} className="sm:min-w-36">
            Save
          </Button>
        </div>
      </div>

      <CustomerFormDialog
        open={customerFormOpen}
        onOpenChange={setCustomerFormOpen}
        onSaved={(c) => {
          setLabels((l) => ({ ...l, customer: c.name }));
          setValue('brokerId', null, { shouldDirty: true });
          setValue('customerId', c.id, { shouldDirty: true, shouldValidate: true });
        }}
      />
      <SavedDesignsDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        customerId={customerId}
        customerName={labels.customer}
        current={design?.kind === 'saved' ? { designId: design.designId, variationId: design.variationId } : null}
        onPick={(p) => {
          setDesign({ kind: 'saved', ...p });
          // A design made only in one material pre-selects it (still changeable).
          if (p.material) {
            setValue('materialId', p.material.id, { shouldDirty: true, shouldValidate: true });
            setLabels((l) => ({ ...l, material: p.material!.name }));
            setMaterialFromDesign(p.code);
          } else {
            setMaterialFromDesign(null);
          }
        }}
      />
      <ConfirmDialog
        open={blocker.state === 'blocked'}
        onOpenChange={(o) => !o && blocker.state === 'blocked' && blocker.reset()}
        title={isEdit ? 'Discard your changes?' : 'Discard this order?'}
        description="You have unsaved changes. If you leave now they will be lost."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => blocker.state === 'blocked' && blocker.proceed()}
      />
    </div>
  );
}
