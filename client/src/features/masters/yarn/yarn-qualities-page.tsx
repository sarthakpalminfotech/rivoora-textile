import { Plus, Spool } from 'lucide-react';
import { useState } from 'react';
import type { YarnQuality } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { Button } from '@/components/ui/button';
import { useDebounce } from '@/hooks/useDebounce';
import { useRole } from '@/hooks/useRole';
import { useDeleteYarnQuality, useYarnQualities } from '../../yarn/api';
import { MasterList, MasterToolbar, type Column } from '../master-list';
import { useDeleteFlow } from '../use-delete-flow';
import { YarnQualityFormDialog } from './yarn-quality-form';

const columns: Column<YarnQuality>[] = [
  { header: 'Name', cell: (q) => <span className="font-semibold text-slate-900">{q.name}</span>, className: 'w-[30%]' },
  { header: 'Denier', cell: (q) => <span className="tabular-nums text-slate-600">{q.denier ?? '—'}</span>, className: 'w-[14%]' },
  { header: 'Filament', cell: (q) => <span className="tabular-nums text-slate-600">{q.filament ?? '—'}</span>, className: 'w-[14%]' },
  { header: 'Notes', cell: (q) => <span className="text-slate-500">{q.notes?.replace(/\s*\n\s*/g, ' ') ?? '—'}</span> },
];

/** Sprint 17 — Yarn qualities master (Jenish, Gaurang): used for raw and twisted yarn. */
export default function YarnQualitiesPage() {
  usePageTitle('Yarn qualities');
  const { can } = useRole();
  const canManage = can('canManageYarnMasters');
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search.trim(), 300);
  const query = useYarnQualities(debounced);
  const del = useDeleteYarnQuality();
  const { askDelete, dialog } = useDeleteFlow<YarnQuality>(del, (q) => q.name, undefined, {
    description: "This will remove it from the list. A quality used on a PO, in stock or on a beam can't be deleted.",
  });
  const [form, setForm] = useState<{ open: boolean; quality: YarnQuality | null }>({ open: false, quality: null });
  const openForm = (quality: YarnQuality | null) => setForm({ open: true, quality });

  return (
    <div className="page-container space-y-4 pb-24 pt-5 lg:pb-5">
      <MasterToolbar
        search={search}
        onSearch={setSearch}
        placeholder="Search yarn qualities…"
        addLabel="Add quality"
        onAdd={canManage ? () => openForm(null) : undefined}
        fetching={query.isFetching && !query.isPending && !query.isFetchingNextPage}
      />
      <MasterList
        query={query}
        columns={columns}
        noun="yarn qualities"
        searching={!!debounced}
        onClearSearch={() => setSearch('')}
        onOpen={openForm}
        onEdit={canManage ? openForm : undefined}
        onDelete={canManage ? askDelete : undefined}
        empty={{
          icon: Spool,
          title: 'No yarn qualities yet',
          description: 'Add the yarn qualities you buy and twist. The same list is used for raw and twisted yarn.',
          action: canManage ? (
            <Button onClick={() => openForm(null)}>
              <Plus /> Add quality
            </Button>
          ) : undefined,
        }}
        card={(q) => (
          <>
            <p className="truncate font-semibold text-slate-900">{q.name}</p>
            {(q.denier || q.filament) && (
              <p className="mt-1 truncate text-sm text-slate-500">{[q.denier && `Denier ${q.denier}`, q.filament && `Filament ${q.filament}`].filter(Boolean).join(' · ')}</p>
            )}
          </>
        )}
      />
      <YarnQualityFormDialog open={form.open} onOpenChange={(open) => setForm((f) => ({ ...f, open }))} quality={form.quality} readOnly={!canManage} />
      {dialog}
    </div>
  );
}
