import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, RotateCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import type { TfoMachine } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, NumberInput } from '@/components/ui/input';
import { ResponsiveModal } from '@/components/ui/modal';
import { Switch } from '@/components/ui/switch';
import { useDebounce } from '@/hooks/useDebounce';
import { useRole } from '@/hooks/useRole';
import { errorMessage } from '@/lib/api';
import { applyServerFieldError } from '@/lib/form';
import { useDeleteTfoMachine, useSaveTfoMachine, useTfoMachines } from '../../yarn/api';
import { MachineStatusPill } from '../machines/machines-page';
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
});
type FormValues = z.infer<typeof schema>;

function TfoMachineFormDialog({ open, onOpenChange, machine, readOnly }: { open: boolean; onOpenChange: (o: boolean) => void; machine: TfoMachine | null; readOnly: boolean }) {
  const save = useSaveTfoMachine();
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (open) reset({ machineNo: machine ? String(machine.machineNo) : '', name: machine?.name ?? '', isActive: machine?.isActive ?? true });
  }, [open, machine, reset]);

  const onSubmit = handleSubmit((v) =>
    save.mutate(
      { id: machine?.id, data: { machineNo: Number(v.machineNo), name: v.name, isActive: v.isActive } },
      {
        onSuccess: (m) => {
          toast.success(machine ? `TFO machine ${m.machineNo} updated` : `TFO machine ${m.machineNo} added`);
          onOpenChange(false);
        },
        onError: (err) => {
          if (!applyServerFieldError(err, setError, ['machineNo', 'name', 'isActive'])) toast.error(errorMessage(err));
        },
      },
    ),
  );

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(o) => !save.isPending && onOpenChange(o)}
      title={readOnly ? 'TFO machine' : machine ? `Edit TFO machine ${machine.machineNo}` : 'Add TFO machine'}
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
            <Button type="submit" form="tfo-machine-form" loading={save.isPending}>
              {machine ? 'Save changes' : 'Save machine'}
            </Button>
          </div>
        )
      }
    >
      <form id="tfo-machine-form" onSubmit={onSubmit} noValidate>
        <fieldset disabled={readOnly} className="grid gap-4 md:grid-cols-[10rem_minmax(0,1fr)]">
          <Field label="Machine no." htmlFor="tfo-no" required error={errors.machineNo?.message}>
            <NumberInput id="tfo-no" inputMode="numeric" autoFocus={!readOnly} placeholder="e.g. 3" invalid={!!errors.machineNo} {...register('machineNo')} />
          </Field>
          <Field label="Name" htmlFor="tfo-name" error={errors.name?.message} hint="Optional, e.g. the make or location">
            <Input id="tfo-name" autoComplete="off" {...register('name')} />
          </Field>
          <Controller
            control={control}
            name="isActive"
            render={({ field }) => (
              <div className="flex items-center justify-between gap-4 rounded-[10px] border border-input bg-slate-50/60 px-3.5 py-3 md:col-span-2">
                <div className="min-w-0">
                  <label htmlFor="tfo-active" className="text-sm font-medium text-slate-700">
                    Active
                  </label>
                  <p className="text-[13px] text-muted-foreground">Inactive machines are hidden from the TFO board.</p>
                  {errors.isActive?.message && <p className="mt-1 text-[13px] font-medium text-destructive">{errors.isActive.message}</p>}
                </div>
                <Switch id="tfo-active" checked={field.value} onCheckedChange={field.onChange} disabled={readOnly} />
              </div>
            )}
          />
          <p className="text-[13px] text-muted-foreground md:col-span-2">Every TFO machine has two sections: A (top) and B (bottom), shown as 1A / 1B on the board.</p>
        </fieldset>
      </form>
    </ResponsiveModal>
  );
}

const columns: Column<TfoMachine>[] = [
  { header: 'Machine', cell: (m) => <span className="text-base font-bold tabular-nums text-slate-900">{m.machineNo}</span>, className: 'w-[14%]' },
  { header: 'Name', cell: (m) => <span className="text-slate-600">{m.name ?? '—'}</span>, className: 'w-[30%]' },
  { header: 'Status', cell: (m) => <MachineStatusPill active={m.isActive} />, className: 'w-[16%]' },
  {
    header: 'Running',
    cell: (m) =>
      m.runningSections.length ? (
        <span className="font-semibold text-violet-700">{m.runningSections.map((s) => `${m.machineNo}${s}`).join(' · ')}</span>
      ) : (
        <span className="text-slate-400">Idle</span>
      ),
  },
];

/** Sprint 17 — TFO machines master (Jenish, Gaurang). */
export default function TfoMachinesPage() {
  usePageTitle('TFO machines');
  const { can } = useRole();
  const canManage = can('canManageYarnMasters');
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search.trim(), 300);
  const query = useTfoMachines(debounced);
  const del = useDeleteTfoMachine();
  const { askDelete, dialog } = useDeleteFlow<TfoMachine>(del, (m) => `TFO machine ${m.machineNo}`, undefined, {
    description: "This removes it from the board. A machine with a running program can't be deleted — stop the program first.",
  });
  const [form, setForm] = useState<{ open: boolean; machine: TfoMachine | null }>({ open: false, machine: null });
  const openForm = (machine: TfoMachine | null) => setForm({ open: true, machine });

  return (
    <div className="page-container space-y-4 pb-24 pt-5 lg:pb-5">
      <MasterToolbar
        search={search}
        onSearch={setSearch}
        placeholder="Search TFO machines…"
        addLabel="Add machine"
        onAdd={canManage ? () => openForm(null) : undefined}
        fetching={query.isFetching && !query.isPending && !query.isFetchingNextPage}
      />
      <MasterList
        query={query}
        columns={columns}
        noun="TFO machines"
        searching={!!debounced}
        onClearSearch={() => setSearch('')}
        onOpen={openForm}
        onEdit={canManage ? openForm : undefined}
        onDelete={canManage ? askDelete : undefined}
        empty={{
          icon: RotateCw,
          title: 'No TFO machines yet',
          description: 'Add the TFO machines. Each one has two sections (A top, B bottom) on the board.',
          action: canManage ? (
            <Button onClick={() => openForm(null)}>
              <Plus /> Add machine
            </Button>
          ) : undefined,
        }}
        card={(m) => (
          <div className="flex items-center gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-lg font-bold tabular-nums text-violet-700">{m.machineNo}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-slate-900">{m.name ?? `TFO machine ${m.machineNo}`}</p>
              <p className="mt-0.5 text-sm text-slate-500">{m.runningSections.length ? `Running: ${m.runningSections.map((s) => `${m.machineNo}${s}`).join(', ')}` : 'Idle'}</p>
            </div>
            <MachineStatusPill active={m.isActive} />
          </div>
        )}
      />
      <TfoMachineFormDialog open={form.open} onOpenChange={(open) => setForm((f) => ({ ...f, open }))} machine={form.machine} readOnly={!canManage} />
      {dialog}
    </div>
  );
}
