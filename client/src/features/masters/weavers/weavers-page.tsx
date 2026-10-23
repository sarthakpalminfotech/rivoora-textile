import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Store } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { cleanWeaverCode, weaverCodeError, WEAVER_CODE_ERROR_TEXT, type Weaver } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { ResponsiveModal } from '@/components/ui/modal';
import { useDebounce } from '@/hooks/useDebounce';
import { useRole } from '@/hooks/useRole';
import { errorMessage } from '@/lib/api';
import { applyServerFieldError } from '@/lib/form';
import { useDeleteWeaver, useSaveWeaver, useSuggestWeaverCode, useWeavers } from '../api';
import { MasterList, MasterToolbar, type Column } from '../master-list';
import { useDeleteFlow } from '../use-delete-flow';

const schema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120, 'Name is too long'),
  shortCode: z.string().trim(),
  mobile: z.string().max(20, 'Mobile is too long'),
  address: z.string().max(500, 'Address is too long'),
  gstin: z.string().max(20, 'GSTIN is too long'),
  notes: z.string().max(1000),
});
type FormValues = z.infer<typeof schema>;

function WeaverFormDialog({
  open,
  onOpenChange,
  weaver,
  readOnly,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  weaver: Weaver | null;
  readOnly: boolean;
}) {
  const save = useSaveWeaver();
  const [codeTouched, setCodeTouched] = useState(!!weaver);
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    setError,
    formState: { errors, isDirty },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });
  const name = watch('name');
  const shortCode = watch('shortCode');
  const suggestion = useSuggestWeaverCode(useDebounce(name?.trim() ?? '', 300), open && !weaver && !codeTouched);

  useEffect(() => {
    if (open) {
      reset({
        name: weaver?.name ?? '',
        shortCode: weaver?.shortCode ?? '',
        mobile: weaver?.mobile ?? '',
        address: weaver?.address ?? '',
        gstin: weaver?.gstin ?? '',
        notes: weaver?.notes ?? '',
      });
      setCodeTouched(!!weaver);
    }
  }, [open, weaver, reset]);

  useEffect(() => {
    if (!codeTouched && suggestion.data?.code) setValue('shortCode', suggestion.data.code);
  }, [suggestion.data, codeTouched, setValue]);

  const codeErr = shortCode ? weaverCodeError(shortCode) : null;

  const onSubmit = handleSubmit((data) =>
    save.mutate(
      { id: weaver?.id, data: { ...data, shortCode: cleanWeaverCode(data.shortCode) } },
      {
        onSuccess: (w) => {
          toast.success(weaver ? `Weaver ${w.name} updated` : `Weaver "${w.name}" added`);
          onOpenChange(false);
        },
        onError: (err) => {
          if (!applyServerFieldError(err, setError, ['name', 'shortCode', 'mobile', 'address', 'gstin', 'notes'])) toast.error(errorMessage(err));
        },
      },
    ),
  );

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(o) => !save.isPending && onOpenChange(o)}
      title={readOnly ? 'Weaver details' : weaver ? 'Edit weaver' : 'Add weaver'}
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
            <Button type="submit" form="weaver-form" loading={save.isPending}>
              {weaver ? 'Save changes' : 'Save weaver'}
            </Button>
          </div>
        )
      }
    >
      <form id="weaver-form" onSubmit={onSubmit} noValidate>
        <fieldset disabled={readOnly} className="grid gap-4">
          <Field label="Name" htmlFor="w-name" required error={errors.name?.message}>
            <Input id="w-name" autoFocus={!readOnly} autoComplete="off" invalid={!!errors.name} {...register('name')} />
          </Field>
          <Field
            label="Short code"
            htmlFor="w-code"
            required
            error={errors.shortCode?.message ?? (codeErr ? WEAVER_CODE_ERROR_TEXT[codeErr] : undefined)}
            hint="1–4 letters, used in taka numbers (e.g. Shree Textiles → S). Suggested from the name, editable."
          >
            <Input
              id="w-code"
              autoComplete="off"
              className="w-28 uppercase"
              maxLength={4}
              invalid={!!errors.shortCode || !!codeErr}
              value={shortCode ?? ''}
              onChange={(e) => {
                setCodeTouched(true);
                setValue('shortCode', cleanWeaverCode(e.target.value), { shouldDirty: true });
              }}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Mobile" htmlFor="w-mobile" error={errors.mobile?.message}>
              <Input id="w-mobile" inputMode="tel" autoComplete="off" {...register('mobile')} />
            </Field>
            <Field label="GSTIN" htmlFor="w-gstin" error={errors.gstin?.message}>
              <Input id="w-gstin" autoComplete="off" className="uppercase" {...register('gstin')} />
            </Field>
          </div>
          <Field label="Address" htmlFor="w-address" error={errors.address?.message}>
            <Textarea id="w-address" rows={3} {...register('address')} />
          </Field>
          <Field label="Notes" htmlFor="w-notes" error={errors.notes?.message}>
            <Textarea id="w-notes" rows={3} {...register('notes')} />
          </Field>
        </fieldset>
      </form>
    </ResponsiveModal>
  );
}

const columns: Column<Weaver>[] = [
  { header: 'Name', cell: (w) => <span className="font-semibold text-slate-900">{w.name}</span>, className: 'w-[26%]' },
  { header: 'Code', cell: (w) => <span className="font-bold tabular-nums text-slate-700">{w.shortCode}</span>, className: 'w-[12%]' },
  { header: 'Mobile', cell: (w) => <span className="text-slate-600">{w.mobile ?? '—'}</span>, className: 'w-[16%]' },
  { header: 'GSTIN', cell: (w) => <span className="text-slate-600">{w.gstin ?? '—'}</span>, className: 'w-[18%]' },
  { header: 'Address', cell: (w) => <span className="text-slate-500">{w.address?.replace(/\s*\n\s*/g, ', ') ?? '—'}</span> },
];

/** Weaver master (Jenish, Gaurang): outside weavers — name, short code (taka number prefix), contact details. */
export default function WeaversPage() {
  usePageTitle('Weavers');
  const { can } = useRole();
  const canManage = can('canManageWeavers');
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search.trim(), 300);
  const query = useWeavers(debounced);
  const del = useDeleteWeaver();
  const { askDelete, dialog } = useDeleteFlow<Weaver>(del, (w) => w.name, undefined, {
    description: "This will remove it from the list. A weaver used on a PO can't be deleted.",
  });
  const [form, setForm] = useState<{ open: boolean; weaver: Weaver | null }>({ open: false, weaver: null });
  const openForm = (weaver: Weaver | null) => setForm({ open: true, weaver });

  return (
    <div className="page-container space-y-4 pb-24 pt-5 lg:pb-5">
      <MasterToolbar
        search={search}
        onSearch={setSearch}
        placeholder="Search weavers…"
        addLabel="Add weaver"
        onAdd={canManage ? () => openForm(null) : undefined}
        fetching={query.isFetching && !query.isPending && !query.isFetchingNextPage}
      />
      <MasterList
        query={query}
        columns={columns}
        noun="weavers"
        searching={!!debounced}
        onClearSearch={() => setSearch('')}
        onOpen={openForm}
        onEdit={canManage ? openForm : undefined}
        onDelete={canManage ? askDelete : undefined}
        empty={{
          icon: Store,
          title: 'No weavers yet',
          description: 'Add the outside weavers you give part of production to. Pick one when you create a PO.',
          action: canManage ? (
            <Button onClick={() => openForm(null)}>
              <Plus /> Add weaver
            </Button>
          ) : undefined,
        }}
        card={(w) => (
          <>
            <p className="truncate font-semibold text-slate-900">
              {w.name} <span className="ml-1 text-sm font-bold text-slate-500">{w.shortCode}</span>
            </p>
            {(w.mobile || w.gstin) && <p className="mt-1 truncate text-sm text-slate-500">{[w.mobile, w.gstin].filter(Boolean).join(' · ')}</p>}
            {w.address && <p className="mt-0.5 truncate text-sm text-slate-400">{w.address.replace(/\s*\n\s*/g, ', ')}</p>}
          </>
        )}
      />
      <WeaverFormDialog open={form.open} onOpenChange={(open) => setForm((f) => ({ ...f, open }))} weaver={form.weaver} readOnly={!canManage} />
      {dialog}
    </div>
  );
}
