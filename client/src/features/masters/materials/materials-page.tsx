import { zodResolver } from '@hookform/resolvers/zod';
import { Layers, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import type { Material } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { ResponsiveModal } from '@/components/ui/modal';
import { useDebounce } from '@/hooks/useDebounce';
import { useRole } from '@/hooks/useRole';
import { errorMessage } from '@/lib/api';
import { applyServerFieldError } from '@/lib/form';
import { useDeleteMaterial, useMaterials, useSaveMaterial } from '../api';
import { MasterList, MasterToolbar, type Column } from '../master-list';
import { useDeleteFlow } from '../use-delete-flow';

const schema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80, 'Name is too long'),
  code: z.string().trim().max(30, 'Code must be at most 30 characters'),
  notes: z.string().max(1000),
});
type FormValues = z.infer<typeof schema>;

function MaterialFormDialog({
  open,
  onOpenChange,
  material,
  readOnly,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  material: Material | null;
  readOnly: boolean;
}) {
  const save = useSaveMaterial();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (open) reset({ name: material?.name ?? '', code: material?.code ?? '', notes: material?.notes ?? '' });
  }, [open, material, reset]);

  const onSubmit = handleSubmit((data) =>
    save.mutate(
      { id: material?.id, data },
      {
        onSuccess: (m) => {
          toast.success(material ? 'Material updated' : `Material "${m.name}" added`);
          onOpenChange(false);
        },
        onError: (err) => {
          if (!applyServerFieldError(err, setError, ['name', 'code', 'notes'])) toast.error(errorMessage(err));
        },
      },
    ),
  );

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(o) => !save.isPending && onOpenChange(o)}
      title={readOnly ? 'Material details' : material ? 'Edit material' : 'Add material'}
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
            <Button type="submit" form="material-form" loading={save.isPending}>
              {material ? 'Save changes' : 'Save material'}
            </Button>
          </div>
        )
      }
    >
      <form id="material-form" onSubmit={onSubmit} noValidate>
        <fieldset disabled={readOnly} className="grid gap-4">
          <Field label="Name (quality)" htmlFor="m-name" required error={errors.name?.message}>
            <Input id="m-name" autoFocus={!readOnly} placeholder="e.g. Georgette" invalid={!!errors.name} {...register('name')} />
          </Field>
          <Field label="Code" htmlFor="m-code" error={errors.code?.message} hint="Optional short code">
            <Input id="m-code" placeholder="e.g. GEO" {...register('code')} />
          </Field>
          <Field label="Notes" htmlFor="m-notes" error={errors.notes?.message}>
            <Textarea id="m-notes" rows={3} {...register('notes')} />
          </Field>
        </fieldset>
      </form>
    </ResponsiveModal>
  );
}

const columns: Column<Material>[] = [
  { header: 'Name', cell: (m) => <span className="font-semibold text-slate-900">{m.name}</span>, className: 'w-[30%]' },
  { header: 'Code', cell: (m) => m.code ?? '—', className: 'w-[20%]' },
  { header: 'Notes', cell: (m) => <span className="text-slate-500">{m.notes ?? '—'}</span> },
];

export default function MaterialsPage() {
  usePageTitle('Materials');
  const { can } = useRole();
  const canManage = can('canManageMasters');
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search.trim(), 300);
  const query = useMaterials(debounced);
  const del = useDeleteMaterial();
  const { askDelete, dialog } = useDeleteFlow<Material>(del, (m) => m.name);
  const [form, setForm] = useState<{ open: boolean; material: Material | null }>({ open: false, material: null });
  const openForm = (material: Material | null) => setForm({ open: true, material });

  return (
    <div className="page-container space-y-4 pb-24 pt-5 md:pb-5">
      <MasterToolbar
        search={search}
        onSearch={setSearch}
        placeholder="Search materials…"
        addLabel="Add Material"
        onAdd={canManage ? () => openForm(null) : undefined}
        fetching={query.isFetching && !query.isPending && !query.isFetchingNextPage}
      />
      <MasterList
        query={query}
        columns={columns}
        noun="materials"
        searching={!!debounced}
        onClearSearch={() => setSearch('')}
        onOpen={openForm}
        onEdit={canManage ? openForm : undefined}
        onDelete={canManage ? askDelete : undefined}
        empty={{
          icon: Layers,
          title: 'No materials yet',
          description: 'Materials are the qualities you weave — Georgette, Silk, Cotton…',
          action: canManage ? (
            <Button onClick={() => openForm(null)}>
              <Plus /> Add Material
            </Button>
          ) : undefined,
        }}
        card={(m) => (
          <>
            <p className="truncate font-semibold text-slate-900">
              {m.name}
              {m.code && <span className="ml-2 text-sm font-medium text-slate-400">{m.code}</span>}
            </p>
            {m.notes && <p className="mt-1 truncate text-sm text-slate-500">{m.notes}</p>}
          </>
        )}
      />
      <MaterialFormDialog
        open={form.open}
        onOpenChange={(open) => setForm((f) => ({ ...f, open }))}
        material={form.material}
        readOnly={!canManage}
      />
      {dialog}
    </div>
  );
}
