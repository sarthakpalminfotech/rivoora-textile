import { MapPin, Phone, Plus, Users } from 'lucide-react';
import { useState } from 'react';
import type { Customer } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { Button } from '@/components/ui/button';
import { useDebounce } from '@/hooks/useDebounce';
import { useRole } from '@/hooks/useRole';
import { useCustomers, useDeleteCustomer } from '../api';
import { MasterList, MasterToolbar, type Column } from '../master-list';
import { useDeleteFlow } from '../use-delete-flow';
import { CustomerFormDialog } from './customer-form';

const columns: Column<Customer>[] = [
  { header: 'Name', cell: (c) => <span className="font-semibold text-slate-900">{c.name}</span>, className: 'w-[28%]' },
  { header: 'Phone', cell: (c) => c.phone ?? '—' },
  { header: 'City', cell: (c) => c.city ?? '—' },
  { header: 'GST number', cell: (c) => c.gstNumber ?? '—', className: 'hidden lg:table-cell' },
  { header: 'Email', cell: (c) => c.email ?? '—', className: 'hidden xl:table-cell' },
];

export default function CustomersPage() {
  usePageTitle('Customers');
  const { can } = useRole();
  const canManage = can('canManageMasters');
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search.trim(), 300);
  const query = useCustomers(debounced);
  const del = useDeleteCustomer();
  const { askDelete, dialog } = useDeleteFlow<Customer>(del, (c) => c.name);

  const [form, setForm] = useState<{ open: boolean; customer: Customer | null }>({ open: false, customer: null });
  const openForm = (customer: Customer | null) => setForm({ open: true, customer });

  return (
    <div className="page-container space-y-4 pb-24 pt-5 md:pb-5">
      <MasterToolbar
        search={search}
        onSearch={setSearch}
        placeholder="Search by name, phone or city…"
        addLabel="Add Customer"
        onAdd={canManage ? () => openForm(null) : undefined}
        fetching={query.isFetching && !query.isPending && !query.isFetchingNextPage}
      />
      <MasterList
        query={query}
        columns={columns}
        noun="customers"
        searching={!!debounced}
        onClearSearch={() => setSearch('')}
        onOpen={(c) => openForm(c)}
        onEdit={canManage ? (c) => openForm(c) : undefined}
        onDelete={canManage ? askDelete : undefined}
        empty={{
          icon: Users,
          title: 'No customers yet',
          description: 'Add your clients here so you can pick them while creating orders.',
          action: canManage ? (
            <Button onClick={() => openForm(null)}>
              <Plus /> Add Customer
            </Button>
          ) : undefined,
        }}
        card={(c) => (
          <>
            <p className="truncate font-semibold text-slate-900">{c.name}</p>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-500">
              {c.phone && (
                <span className="inline-flex items-center gap-1.5">
                  <Phone className="size-3.5" aria-hidden /> {c.phone}
                </span>
              )}
              {c.city && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="size-3.5" aria-hidden /> {c.city}
                </span>
              )}
            </div>
          </>
        )}
      />
      <CustomerFormDialog
        open={form.open}
        onOpenChange={(open) => setForm((f) => ({ ...f, open }))}
        customer={form.customer}
        readOnly={!canManage}
      />
      {dialog}
    </div>
  );
}
