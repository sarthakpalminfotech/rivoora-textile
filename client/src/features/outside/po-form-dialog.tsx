import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { ORDER_TYPE_LABEL, ORDER_TYPES, PO_UNIT_LABEL, PO_UNITS, type OrderType, type OutsidePoCard, type PoUnit } from '@rivoora/shared';
import { Field } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { NumberInput, Textarea } from '@/components/ui/input';
import { ResponsiveModal } from '@/components/ui/modal';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { useDebounce } from '@/hooks/useDebounce';
import { useRole } from '@/hooks/useRole';
import { errorMessage } from '@/lib/api';
import { applyServerFieldError } from '@/lib/form';
import { toApiDate } from '@/lib/format';
import { toNumber } from '@/lib/utils';
import { useMaterialLookup, useWeaverLookup } from '../masters/api';
import { useCreateOutsidePo, useUpdateOutsidePo } from './api';

const schema = z.object({
  weaverId: z.number().nullable(),
  materialId: z.number().nullable(),
  quantity: z.string().trim(),
  unit: z.enum(PO_UNITS),
  orderType: z.enum(ORDER_TYPES),
  rate: z.string().trim(),
  poDate: z.string().min(1, 'Pick the PO date'),
  notes: z.string().max(1000),
});
type FormValues = z.infer<typeof schema>;

const unitOptions = PO_UNITS.map((u) => ({ value: u, label: PO_UNIT_LABEL[u] }));
const orderTypeOptions = ORDER_TYPES.map((t) => ({ value: t, label: ORDER_TYPE_LABEL[t] }));

export interface PoFormDefaults {
  materialId: number;
  materialName: string;
  orderType: OrderType;
}

/** Create / edit an outside PO (Jenish, Gaurang). Quality + order type default to the order's own. */
export function PoFormDialog({
  open,
  onOpenChange,
  orderId,
  defaults,
  po,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: number;
  defaults: PoFormDefaults;
  /** Editing an existing PO (only while nothing has been received). */
  po: OutsidePoCard | null;
}) {
  const { can } = useRole();
  const create = useCreateOutsidePo(orderId);
  const update = useUpdateOutsidePo(po?.id ?? 0, orderId);
  const saving = create.isPending || update.isPending;
  const [weaverSearch, setWeaverSearch] = useState('');
  const weavers = useWeaverLookup(useDebounce(weaverSearch.trim(), 300), open);
  const [materialSearch, setMaterialSearch] = useState('');
  const materials = useMaterialLookup(useDebounce(materialSearch.trim(), 300));
  const [labels, setLabels] = useState<{ weaver?: string; material?: string }>({});

  const {
    control,
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (!open) return;
    reset(
      po
        ? {
            weaverId: po.weaver.id,
            materialId: po.quality.id,
            quantity: String(po.quantity),
            unit: po.unit,
            orderType: po.orderType,
            rate: po.rate != null ? String(po.rate) : '',
            poDate: po.poDate,
            notes: po.notes ?? '',
          }
        : {
            weaverId: null,
            materialId: defaults.materialId,
            quantity: '',
            unit: 'pcs',
            orderType: defaults.orderType,
            rate: '',
            poDate: toApiDate(new Date()),
            notes: '',
          },
    );
    setLabels({ weaver: po?.weaver.name, material: po?.quality.name ?? defaults.materialName });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, po]);

  const weaverOptions = useMemo(() => (weavers.data ?? []).map((w) => ({ value: w.id, label: w.name, description: w.shortCode })), [weavers.data]);
  const materialOptions = useMemo(() => (materials.data ?? []).map((m) => ({ value: m.id, label: m.name, description: m.code })), [materials.data]);

  const onSubmit = handleSubmit((v) => {
    const quantity = toNumber(v.quantity);
    if (!quantity || quantity <= 0) {
      setError('quantity', { message: 'Enter the quantity' });
      return;
    }
    if (!v.weaverId) {
      setError('weaverId', { message: 'Select the weaver' });
      return;
    }
    if (!v.materialId) {
      setError('materialId', { message: 'Select the quality' });
      return;
    }
    const payload = {
      weaverId: v.weaverId,
      materialId: v.materialId,
      quantity,
      unit: v.unit,
      orderType: v.orderType,
      rate: can('canSeeRate') && v.rate ? toNumber(v.rate) ?? null : null,
      poDate: v.poDate,
      notes: v.notes,
    };
    const onError = (err: unknown) => {
      const handled = applyServerFieldError(err, setError, ['weaverId', 'materialId', 'quantity', 'unit', 'orderType', 'rate', 'poDate', 'notes']);
      if (!handled) toast.error(errorMessage(err));
    };
    if (po) {
      update.mutate(payload, {
        onSuccess: (p) => {
          toast.success(`${p.label} updated`);
          onOpenChange(false);
        },
        onError,
      });
    } else {
      create.mutate(payload, {
        onSuccess: (p) => {
          toast.success(`${p.label} created`);
          onOpenChange(false);
        },
        onError,
      });
    }
  });

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(o) => !saving && onOpenChange(o)}
      title={po ? `Edit ${po.label}` : 'Create a PO'}
      footer={
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="po-form" loading={saving}>
            {po ? 'Save changes' : 'Create PO'}
          </Button>
        </div>
      }
    >
      <form id="po-form" onSubmit={onSubmit} noValidate className="grid gap-4">
        <Field label="Weaver" htmlFor="po-weaver" required error={errors.weaverId?.message}>
          <Controller
            control={control}
            name="weaverId"
            render={({ field }) => (
              <Select
                id="po-weaver"
                value={field.value}
                onChange={(id, opt) => {
                  field.onChange(id);
                  setLabels((l) => ({ ...l, weaver: opt.label }));
                }}
                selectedLabel={labels.weaver}
                options={weaverOptions}
                placeholder="Select weaver"
                searchable
                searchPlaceholder="Search weavers…"
                onSearchChange={setWeaverSearch}
                loading={weavers.isFetching}
                emptyText="No weavers yet — add one in Masters"
                invalid={!!errors.weaverId}
              />
            )}
          />
        </Field>
        <Field label="Quality" htmlFor="po-material" required error={errors.materialId?.message}>
          <Controller
            control={control}
            name="materialId"
            render={({ field }) => (
              <Select
                id="po-material"
                value={field.value}
                onChange={(id, opt) => {
                  field.onChange(id);
                  setLabels((l) => ({ ...l, material: opt.label }));
                }}
                selectedLabel={labels.material}
                options={materialOptions}
                placeholder="Select quality"
                searchable
                searchPlaceholder="Search materials…"
                onSearchChange={setMaterialSearch}
                loading={materials.isFetching}
                invalid={!!errors.materialId}
              />
            )}
          />
        </Field>
        <Field label="Quantity" htmlFor="po-qty" required error={errors.quantity?.message}>
          <div className="grid grid-cols-[minmax(0,1fr)_130px] gap-2">
            <NumberInput id="po-qty" placeholder="0" invalid={!!errors.quantity} {...register('quantity')} />
            <Controller control={control} name="unit" render={({ field }) => <Select<PoUnit> value={field.value} onChange={field.onChange} options={unitOptions} aria-label="Unit" />} />
          </div>
        </Field>
        <Field label="Order type" htmlFor="po-type" required error={errors.orderType?.message}>
          <Controller
            control={control}
            name="orderType"
            render={({ field }) => <Segmented<OrderType> id="po-type" aria-label="Order type" options={orderTypeOptions} value={field.value} onChange={field.onChange} />}
          />
        </Field>
        {can('canSeeRate') && (
          <Field label="Rate" htmlFor="po-rate" error={errors.rate?.message} hint="Optional · per unit">
            <NumberInput id="po-rate" placeholder="0.00" prefix={<span className="text-[15px] font-semibold text-slate-500">₹</span>} invalid={!!errors.rate} {...register('rate')} />
          </Field>
        )}
        <Field label="PO date" htmlFor="po-date" required error={errors.poDate?.message}>
          <Controller control={control} name="poDate" render={({ field }) => <DatePicker id="po-date" value={field.value} onChange={field.onChange} invalid={!!errors.poDate} />} />
        </Field>
        <Field label="Notes" htmlFor="po-notes" error={errors.notes?.message}>
          <Textarea id="po-notes" rows={3} {...register('notes')} />
        </Field>
      </form>
    </ResponsiveModal>
  );
}
