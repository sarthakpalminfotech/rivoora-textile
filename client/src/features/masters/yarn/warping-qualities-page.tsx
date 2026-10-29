import { Plus, Spool } from 'lucide-react';
import { useState } from 'react';
import type { WarpingQuality } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { Button } from '@/components/ui/button';
import { useDebounce } from '@/hooks/useDebounce';
import { useRole } from '@/hooks/useRole';
import { useDeleteWarpingQuality, useWarpingQualities } from '../../yarn/api';
import { MasterList, MasterToolbar, type Column } from '../master-list';
import { useDeleteFlow } from '../use-delete-flow';
import { WarpingQualityFormDialog } from './warping-quality-form';

const columns: Column<WarpingQuality>[] = [
  { header: 'Name', cell: (q) => <span className="font-semibold text-slate-900">{q.name}</span>, className: 'w-[30%]' },
  { header: 'Notes', cell: (q) => <span className="text-slate-500">{q.notes?.replace(/\s*\n\s*/g, ' ') ?? '—'}</span> },
];

/** Sprint 20 — Warping qualities master (Jenish, Gaurang): twisted yarn's identity from the TFO stop onward. */
export default function WarpingQualitiesPage() {
  usePageTitle('Warping qualities');
  const { can } = useRole();
  const canManage = can('canManageYarnMasters');
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search.trim(), 300);
  const query = useWarpingQualities(debounced);
  const del = useDeleteWarpingQuality();
  const { askDelete, dialog } = useDeleteFlow<WarpingQuality>(del, (q) => q.name, undefined, {
    description: "This will remove it from the list. A quality used on a box, a beam or in stock can't be deleted.",
  });
  const [form, setForm] = useState<{ open: boolean; quality: WarpingQuality | null }>({ open: false, quality: null });
  const openForm = (quality: WarpingQuality | null) => setForm({ open: true, quality });

  return (
    <div className="page-container space-y-4 pb-24 pt-5 lg:pb-5">
      <MasterToolbar
        search={search}
        onSearch={setSearch}
        placeholder="Search warping qualities…"
        addLabel="Add quality"
        onAdd={canManage ? () => openForm(null) : undefined}
        fetching={query.isFetching && !query.isPending && !query.isFetchingNextPage}
      />
      <MasterList
        query={query}
        columns={columns}
        noun="warping qualities"
        searching={!!debounced}
        onClearSearch={() => setSearch('')}
        onOpen={openForm}
        onEdit={canManage ? openForm : undefined}
        onDelete={canManage ? askDelete : undefined}
        empty={{
          icon: Spool,
          title: 'No warping qualities yet',
          description: "Add the qualities twisted yarn gets at the TFO stop — they're used for boxes and beams from then on.",
          action: canManage ? (
            <Button onClick={() => openForm(null)}>
              <Plus /> Add quality
            </Button>
          ) : undefined,
        }}
        card={(q) => (
          <>
            <p className="truncate font-semibold text-slate-900">{q.name}</p>
            {q.notes && <p className="mt-1 truncate text-sm text-slate-500">{q.notes.replace(/\s*\n\s*/g, ' ')}</p>}
          </>
        )}
      />
      <WarpingQualityFormDialog open={form.open} onOpenChange={(open) => setForm((f) => ({ ...f, open }))} quality={form.quality} readOnly={!canManage} />
      {dialog}
    </div>
  );
}
