import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Store } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { BUTTA_PARTY_NAME_MAX_LENGTH, type ButtaParty } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { ResponsiveModal } from '@/components/ui/modal';
import { useDebounce } from '@/hooks/useDebounce';
import { useRole } from '@/hooks/useRole';
import { errorMessage } from '@/lib/api';
import { applyServerFieldError } from '@/lib/form';
import { useButtaParties, useDeleteButtaParty, useSaveButtaParty } from '../api';
import { MasterList, MasterToolbar, type Column } from '../master-list';
import { useDeleteFlow } from '../use-delete-flow';

const schema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(BUTTA_PARTY_NAME_MAX_LENGTH, 'Name is too long'),
  address: z.string().max(500, 'Address is too long'),
  mobile: z.string().max(20, 'Mobile is too long'),
  gstin: z.string().max(20, 'GSTIN is too long'),
  notes: z.string().max(1000),
});
type FormValues = z.infer<typeof schema>;

function PartyFormDialog({
  open,
  onOpenChange,
  party,
  readOnly,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  party: ButtaParty | null;
  readOnly: boolean;
}) {
  const save = useSaveButtaParty();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (open) {
      reset({
        name: party?.name ?? '',
        address: party?.address ?? '',
        mobile: party?.mobile ?? '',
        gstin: party?.gstin ?? '',
        notes: party?.notes ?? '',
      });
    }
  }, [open, party, reset]);

  const onSubmit = handleSubmit((data) =>
    save.mutate(
      { id: party?.id, data },
      {
        onSuccess: (p) => {
          toast.success(party ? 'Butta party updated' : `Butta party "${p.name}" added`);
          onOpenChange(false);
        },
        onError: (err) => {
          if (!applyServerFieldError(err, setError, ['name', 'address', 'mobile', 'gstin', 'notes'])) toast.error(errorMessage(err));
        },
      },
    ),
  );

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(o) => !save.isPending && onOpenChange(o)}
      title={readOnly ? 'Butta party details' : party ? 'Edit butta party' : 'Add butta party'}
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
            <Button type="submit" form="butta-party-form" loading={save.isPending}>
              {party ? 'Save changes' : 'Save party'}
            </Button>
          </div>
        )
      }
    >
      <form id="butta-party-form" onSubmit={onSubmit} noValidate>
        <fieldset disabled={readOnly} className="grid gap-4">
          <Field label="Name" htmlFor="bp-name" required error={errors.name?.message} hint='Printed as "M/s. …" on the challan'>
            <Input id="bp-name" autoFocus={!readOnly} autoComplete="off" invalid={!!errors.name} {...register('name')} />
          </Field>
          <Field label="Address" htmlFor="bp-address" error={errors.address?.message} hint="Printed line by line on the challan">
            <Textarea id="bp-address" rows={3} {...register('address')} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Mobile" htmlFor="bp-mobile" error={errors.mobile?.message}>
              <Input id="bp-mobile" inputMode="tel" autoComplete="off" {...register('mobile')} />
            </Field>
            <Field label="GSTIN" htmlFor="bp-gstin" error={errors.gstin?.message}>
              <Input id="bp-gstin" autoComplete="off" className="uppercase" {...register('gstin')} />
            </Field>
          </div>
          <Field label="Notes" htmlFor="bp-notes" error={errors.notes?.message}>
            <Textarea id="bp-notes" rows={3} {...register('notes')} />
          </Field>
        </fieldset>
      </form>
    </ResponsiveModal>
  );
}

const columns: Column<ButtaParty>[] = [
  { header: 'Name', cell: (p) => <span className="font-semibold text-slate-900">{p.name}</span>, className: 'w-[28%]' },
  { header: 'Mobile', cell: (p) => <span className="text-slate-600">{p.mobile ?? '—'}</span>, className: 'w-[16%]' },
  { header: 'GSTIN', cell: (p) => <span className="text-slate-600">{p.gstin ?? '—'}</span>, className: 'w-[20%]' },
  { header: 'Address', cell: (p) => <span className="text-slate-500">{p.address?.replace(/\s*\n\s*/g, ', ') ?? '—'}</span> },
];

/** Butta parties master: who the takas are sent to for butta cutting (printed on the challan). */
export default function ButtaPartiesPage() {
  usePageTitle('Butta parties');
  const { can } = useRole();
  const canManage = can('canManageButtaParties');
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search.trim(), 300);
  const query = useButtaParties(debounced);
  const del = useDeleteButtaParty();
  const { askDelete, dialog } = useDeleteFlow<ButtaParty>(del, (p) => p.name, undefined, {
    description: "This will remove it from the list. Parties used on a challan can't be deleted.",
  });
  const [form, setForm] = useState<{ open: boolean; party: ButtaParty | null }>({ open: false, party: null });
  const openForm = (party: ButtaParty | null) => setForm({ open: true, party });

  return (
    <div className="page-container space-y-4 pb-24 pt-5 md:pb-5">
      <MasterToolbar
        search={search}
        onSearch={setSearch}
        placeholder="Search butta parties…"
        addLabel="Add Butta party"
        onAdd={canManage ? () => openForm(null) : undefined}
        fetching={query.isFetching && !query.isPending && !query.isFetchingNextPage}
      />
      <MasterList
        query={query}
        columns={columns}
        noun="butta parties"
        searching={!!debounced}
        onClearSearch={() => setSearch('')}
        onOpen={openForm}
        onEdit={canManage ? openForm : undefined}
        onDelete={canManage ? askDelete : undefined}
        empty={{
          icon: Store,
          title: 'No butta parties yet',
          description: 'Add the parties your takas go to for butta cutting. Pick one when you create a challan.',
          action: canManage ? (
            <Button onClick={() => openForm(null)}>
              <Plus /> Add Butta party
            </Button>
          ) : undefined,
        }}
        card={(p) => (
          <>
            <p className="truncate font-semibold text-slate-900">{p.name}</p>
            {(p.mobile || p.gstin) && <p className="mt-1 truncate text-sm text-slate-500">{[p.mobile, p.gstin].filter(Boolean).join(' · ')}</p>}
            {p.address && <p className="mt-0.5 truncate text-sm text-slate-400">{p.address.replace(/\s*\n\s*/g, ', ')}</p>}
          </>
        )}
      />
      <PartyFormDialog open={form.open} onOpenChange={(open) => setForm((f) => ({ ...f, open }))} party={form.party} readOnly={!canManage} />
      {dialog}
    </div>
  );
}
