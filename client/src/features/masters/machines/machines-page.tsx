import { zodResolver } from '@hookform/resolvers/zod';
import { Factory, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import type { Machine } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, NumberInput, Textarea } from '@/components/ui/input';
import { ResponsiveModal } from '@/components/ui/modal';
import { Switch } from '@/components/ui/switch';
import { useDebounce } from '@/hooks/useDebounce';
import { useRole } from '@/hooks/useRole';
import { errorMessage } from '@/lib/api';
import { applyServerFieldError } from '@/lib/form';
import { cn } from '@/lib/utils';
import { useDeleteMachine, useMachines, useSaveMachine } from '../api';
import { MasterList, MasterToolbar, type Column } from '../master-list';
import { useDeleteFlow } from '../use-delete-flow';

const schema = z.object({
  machineNo: z
    .string()
    .trim()
    .min(1, 'Enter the machine number')
    .refine((v) => /^\d+$/.test(v) && Number(v) >= 1, 'Use a whole number of at least 1')
    .refine((v) => Number(v) <= 100_000, 'Must be at most 1,00,000'),
  name: z.string().trim().max(80, 'Name must be at most 80 characters'),
  isActive: z.boolean(),
  notes: z.string().max(1000),
});
type FormValues = z.infer<typeof schema>;

export function MachineStatusPill({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold',
        active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500',
      )}
    >
      <span className={cn('size-1.5 rounded-full', active ? 'bg-emerald-500' : 'bg-slate-400')} aria-hidden />
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

function MachineFormDialog({
  open,
  onOpenChange,
  machine,
  readOnly,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  machine: Machine | null;
  readOnly: boolean;
}) {
  const save = useSaveMachine();
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (open) {
      reset({
        machineNo: machine ? String(machine.machineNo) : '',
        name: machine?.name ?? '',
        isActive: machine?.isActive ?? true,
        notes: machine?.notes ?? '',
      });
    }
  }, [open, machine, reset]);

  const onSubmit = handleSubmit((values) =>
    save.mutate(
      { id: machine?.id, data: { ...values, machineNo: Number(values.machineNo) } },
      {
        onSuccess: (m) => {
          toast.success(machine ? `Machine ${m.machineNo} updated` : `Machine ${m.machineNo} added`);
          onOpenChange(false);
        },
        onError: (err) => {
          if (!applyServerFieldError(err, setError, ['machineNo', 'name', 'notes'])) toast.error(errorMessage(err));
        },
      },
    ),
  );

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(o) => !save.isPending && onOpenChange(o)}
      title={readOnly ? 'Machine details' : machine ? `Edit machine ${machine.machineNo}` : 'Add machine'}
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
            <Button type="submit" form="machine-form" loading={save.isPending}>
              {machine ? 'Save changes' : 'Save machine'}
            </Button>
          </div>
        )
      }
    >
      <form id="machine-form" onSubmit={onSubmit} noValidate>
        <fieldset disabled={readOnly} className="grid gap-4">
          <Field label="Machine number" htmlFor="mc-no" required error={errors.machineNo?.message}>
            <NumberInput
              id="mc-no"
              inputMode="numeric"
              autoFocus={!readOnly}
              placeholder="e.g. 7"
              invalid={!!errors.machineNo}
              {...register('machineNo')}
            />
          </Field>
          <Field label="Name" htmlFor="mc-name" error={errors.name?.message} hint="Optional, e.g. the loom make or location">
            <Input id="mc-name" placeholder="e.g. Rapier – shed 2" {...register('name')} />
          </Field>
          <Controller
            control={control}
            name="isActive"
            render={({ field }) => (
              <div className="flex items-center justify-between gap-4 rounded-[10px] border border-input bg-slate-50/60 px-3.5 py-3">
                <div className="min-w-0">
                  <label htmlFor="mc-active" className="text-sm font-medium text-slate-700">
                    Active
                  </label>
                  <p className="text-[13px] text-muted-foreground">
                    Inactive machines can't be picked for new jobsheets.
                  </p>
                </div>
                <Switch id="mc-active" checked={field.value} onCheckedChange={field.onChange} disabled={readOnly} />
              </div>
            )}
          />
          <Field label="Notes" htmlFor="mc-notes" error={errors.notes?.message}>
            <Textarea id="mc-notes" rows={3} {...register('notes')} />
          </Field>
        </fieldset>
      </form>
    </ResponsiveModal>
  );
}

const columns: Column<Machine>[] = [
  { header: 'Machine No', cell: (m) => <span className="font-semibold text-slate-900">{m.machineNo}</span>, className: 'w-[16%]' },
  { header: 'Name', cell: (m) => m.name ?? '—', className: 'w-[28%]' },
  { header: 'Status', cell: (m) => <MachineStatusPill active={m.isActive} />, className: 'w-[16%]' },
  { header: 'Notes', cell: (m) => <span className="text-slate-500">{m.notes ?? '—'}</span> },
];

export default function MachinesPage() {
  usePageTitle('Machines');
  const { can } = useRole();
  const canManage = can('canManageMachines');
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search.trim(), 300);
  const query = useMachines(debounced);
  const del = useDeleteMachine();
  const { askDelete, dialog } = useDeleteFlow<Machine>(del, (m) => `Machine ${m.machineNo}`, undefined, {
    description: "It will be removed from the list. Machines used on active jobsheets can't be deleted — mark them inactive instead.",
  });
  const [form, setForm] = useState<{ open: boolean; machine: Machine | null }>({ open: false, machine: null });
  const openForm = (machine: Machine | null) => setForm({ open: true, machine });

  return (
    <div className="page-container space-y-4 pb-24 pt-5 lg:pb-5">
      <MasterToolbar
        search={search}
        onSearch={setSearch}
        placeholder="Search by machine number or name…"
        addLabel="Add Machine"
        onAdd={canManage ? () => openForm(null) : undefined}
        fetching={query.isFetching && !query.isPending && !query.isFetchingNextPage}
      />
      <MasterList
        query={query}
        columns={columns}
        noun="machines"
        searching={!!debounced}
        onClearSearch={() => setSearch('')}
        onOpen={openForm}
        onEdit={canManage ? openForm : undefined}
        onDelete={canManage ? askDelete : undefined}
        empty={{
          icon: Factory,
          title: 'No machines yet',
          description: 'Add the looms you weave on, so they can be picked on jobsheets.',
          action: canManage ? (
            <Button onClick={() => openForm(null)}>
              <Plus /> Add Machine
            </Button>
          ) : undefined,
        }}
        card={(m) => (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold text-slate-900">Machine {m.machineNo}</p>
              <MachineStatusPill active={m.isActive} />
            </div>
            {m.name && <p className="mt-1 truncate text-sm text-slate-500">{m.name}</p>}
          </>
        )}
      />
      <MachineFormDialog
        open={form.open}
        onOpenChange={(open) => setForm((f) => ({ ...f, open }))}
        machine={form.machine}
        readOnly={!canManage}
      />
      {dialog}
    </div>
  );
}
