import { Plus, Store } from 'lucide-react';
import { useState } from 'react';
import type { YarnParty } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { Button } from '@/components/ui/button';
import { useDebounce } from '@/hooks/useDebounce';
import { useRole } from '@/hooks/useRole';
import { useDeleteYarnParty, useYarnParties } from '../../yarn/api';
import { MasterList, MasterToolbar, type Column } from '../master-list';
import { useDeleteFlow } from '../use-delete-flow';
import { YarnPartyFormDialog } from './yarn-party-form';

const columns: Column<YarnParty>[] = [
  { header: 'Name', cell: (p) => <span className="font-semibold text-slate-900">{p.name}</span>, className: 'w-[28%]' },
  { header: 'Mobile', cell: (p) => <span className="text-slate-600">{p.mobile ?? '—'}</span>, className: 'w-[16%]' },
  { header: 'GSTIN', cell: (p) => <span className="text-slate-600">{p.gstin ?? '—'}</span>, className: 'w-[20%]' },
  { header: 'Address', cell: (p) => <span className="text-slate-500">{p.address?.replace(/\s*\n\s*/g, ', ') ?? '—'}</span> },
];

/** Sprint 17 — Yarn parties master (Jenish, Gaurang): the parties yarn is bought from. */
export default function YarnPartiesPage() {
  usePageTitle('Yarn parties');
  const { can } = useRole();
  const canManage = can('canManageYarnMasters');
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search.trim(), 300);
  const query = useYarnParties(debounced);
  const del = useDeleteYarnParty();
  const { askDelete, dialog } = useDeleteFlow<YarnParty>(del, (p) => p.name, undefined, {
    description: "This will remove it from the list. A party used on a Yarn PO can't be deleted.",
  });
  const [form, setForm] = useState<{ open: boolean; party: YarnParty | null }>({ open: false, party: null });
  const openForm = (party: YarnParty | null) => setForm({ open: true, party });

  return (
    <div className="page-container space-y-4 pb-24 pt-5 lg:pb-5">
      <MasterToolbar
        search={search}
        onSearch={setSearch}
        placeholder="Search yarn parties…"
        addLabel="Add party"
        onAdd={canManage ? () => openForm(null) : undefined}
        fetching={query.isFetching && !query.isPending && !query.isFetchingNextPage}
      />
      <MasterList
        query={query}
        columns={columns}
        noun="yarn parties"
        searching={!!debounced}
        onClearSearch={() => setSearch('')}
        onOpen={openForm}
        onEdit={canManage ? openForm : undefined}
        onDelete={canManage ? askDelete : undefined}
        empty={{
          icon: Store,
          title: 'No yarn parties yet',
          description: 'Add the parties you buy yarn from. Pick one when you raise a Yarn PO.',
          action: canManage ? (
            <Button onClick={() => openForm(null)}>
              <Plus /> Add party
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
      <YarnPartyFormDialog open={form.open} onOpenChange={(open) => setForm((f) => ({ ...f, open }))} party={form.party} readOnly={!canManage} />
      {dialog}
    </div>
  );
}
