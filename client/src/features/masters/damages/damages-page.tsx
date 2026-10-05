import { zodResolver } from '@hookform/resolvers/zod';
import { Bandage, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { DAMAGE_NAME_MAX_LENGTH, type Damage } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { ResponsiveModal } from '@/components/ui/modal';
import { useDebounce } from '@/hooks/useDebounce';
import { useRole } from '@/hooks/useRole';
import { errorMessage } from '@/lib/api';
import { applyServerFieldError } from '@/lib/form';
import { useDamages, useDeleteDamage, useSaveDamage } from '../api';
import { MasterList, MasterToolbar, type Column } from '../master-list';
import { useDeleteFlow } from '../use-delete-flow';

const schema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(DAMAGE_NAME_MAX_LENGTH, 'Name is too long'),
  notes: z.string().max(1000),
});
type FormValues = z.infer<typeof schema>;

function DamageFormDialog({
  open,
  onOpenChange,
  damage,
  readOnly,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  damage: Damage | null;
  readOnly: boolean;
}) {
  const save = useSaveDamage();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (open) reset({ name: damage?.name ?? '', notes: damage?.notes ?? '' });
  }, [open, damage, reset]);

  const onSubmit = handleSubmit((data) =>
    save.mutate(
      { id: damage?.id, data },
      {
        onSuccess: (d) => {
          toast.success(damage ? 'Damage updated' : `Damage "${d.name}" added`);
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
      title={readOnly ? 'Damage details' : damage ? 'Edit damage' : 'Add damage'}
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
            <Button type="submit" form="damage-form" loading={save.isPending}>
              {damage ? 'Save changes' : 'Save damage'}
            </Button>
          </div>
        )
      }
    >
      <form id="damage-form" onSubmit={onSubmit} noValidate>
        <fieldset disabled={readOnly} className="grid gap-4">
          <Field label="Name" htmlFor="d-name" required error={errors.name?.message} hint="What the damage is — shown on damaged takas">
            <Input id="d-name" autoFocus={!readOnly} autoComplete="off" placeholder="e.g. Hole, Oil stain" invalid={!!errors.name} {...register('name')} />
          </Field>
          <Field label="Notes" htmlFor="d-notes" error={errors.notes?.message}>
            <Textarea id="d-notes" rows={3} {...register('notes')} />
          </Field>
        </fieldset>
      </form>
    </ResponsiveModal>
  );
}

const columns: Column<Damage>[] = [
  { header: 'Name', cell: (d) => <span className="font-semibold text-slate-900">{d.name}</span>, className: 'w-[35%]' },
  { header: 'Notes', cell: (d) => <span className="text-slate-500">{d.notes ?? '—'}</span> },
];

/** Damage master: the names used when a taka is marked damaged (Taka entry and Edit takas). */
export default function DamagesPage() {
  usePageTitle('Damage master');
  const { can } = useRole();
  const canManage = can('canManageDamages');
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search.trim(), 300);
  const query = useDamages(debounced);
  const del = useDeleteDamage();
  const { askDelete, dialog } = useDeleteFlow<Damage>(del, (d) => d.name, undefined, {
    description: "This will remove it from the list. Damages used on takas can't be deleted.",
  });
  const [form, setForm] = useState<{ open: boolean; damage: Damage | null }>({ open: false, damage: null });
  const openForm = (damage: Damage | null) => setForm({ open: true, damage });

  return (
    <div className="page-container space-y-4 pb-24 pt-5 md:pb-5">
      <MasterToolbar
        search={search}
        onSearch={setSearch}
        placeholder="Search damages…"
        addLabel="Add Damage"
        onAdd={canManage ? () => openForm(null) : undefined}
        fetching={query.isFetching && !query.isPending && !query.isFetchingNextPage}
      />
      <MasterList
        query={query}
        columns={columns}
        noun="damages"
        searching={!!debounced}
        onClearSearch={() => setSearch('')}
        onOpen={openForm}
        onEdit={canManage ? openForm : undefined}
        onDelete={canManage ? askDelete : undefined}
        empty={{
          icon: Bandage,
          title: 'No damages yet',
          description: 'Add the damage names you use — Hole, Oil stain, Weft break… Names typed as "Other" at taka entry are added here too.',
          action: canManage ? (
            <Button onClick={() => openForm(null)}>
              <Plus /> Add Damage
            </Button>
          ) : undefined,
        }}
        card={(d) => (
          <>
            <p className="truncate font-semibold text-slate-900">{d.name}</p>
            {d.notes && <p className="mt-1 truncate text-sm text-slate-500">{d.notes}</p>}
          </>
        )}
      />
      <DamageFormDialog
        open={form.open}
        onOpenChange={(open) => setForm((f) => ({ ...f, open }))}
        damage={form.damage}
        readOnly={!canManage}
      />
      {dialog}
    </div>
  );
}
