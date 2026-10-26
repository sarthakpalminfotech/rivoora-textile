import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { NO_QUALITY_LABEL } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ImageThumb } from '@/components/ui/image-thumb';
import { Skeleton } from '@/components/ui/skeleton';
import { useRole } from '@/hooks/useRole';
import { formatDate } from '@/lib/format';
import { useDeleteDesign, useDesign } from '../api';
import { ButtaTag } from './designs-page';
import { DesignFormDialog } from './design-form';

export default function DesignDetailPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from;
  const { can } = useRole();
  // Sprint 18: Jenish / Gaurang manage designs; Dhruvil sees the library read-only.
  const canManage = can('canManageDesigns');
  const { data: design, isPending, isError, error, refetch } = useDesign(id);
  usePageTitle(design ? `Design ${design.code}` : 'Design');

  const deleteDesign = useDeleteDesign();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const back = (
    <Link to={from ?? '/designs'} className="inline-flex h-10 items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-primary">
      <ArrowLeft className="size-4" /> {from ? 'Back' : 'Design library'}
    </Link>
  );

  if (isPending) {
    return (
      <div className="page-container space-y-4 py-5">
        {back}
        <div className="grid gap-5 md:grid-cols-[300px_1fr]">
          <Skeleton className="aspect-square w-full rounded-xl" />
          <div className="space-y-3">
            <Skeleton className="h-7 w-40" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
      </div>
    );
  }
  if (isError || !design) {
    return (
      <div className="page-container py-5">
        {back}
        <ErrorState error={error} onRetry={() => void refetch()} />
      </div>
    );
  }

  return (
    <div className="page-container space-y-5 py-5">
      {back}
      <section className="grid gap-5 rounded-xl border border-border bg-white p-4 shadow-soft md:grid-cols-[minmax(240px,320px)_1fr] md:p-5">
        <ImageThumb
          thumbUrl={design.thumbUrl}
          fullUrl={design.imageUrl}
          alt={`Design ${design.code}`}
          className="aspect-square w-full max-md:mx-auto max-md:max-w-sm"
          rounded="rounded-xl"
        />
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Design code</p>
              <h2 className="break-words text-2xl font-bold text-slate-900">{design.code}</h2>
              {design.name && <p className="mt-0.5 text-slate-600">{design.name}</p>}
            </div>
            {canManage && (
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)}>
                  <Pencil /> Edit
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="text-destructive hover:bg-destructive-soft"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 /> Delete
                </Button>
              </div>
            )}
          </div>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Qualities</dt>
              <dd className="mt-1 flex flex-wrap gap-1.5">
                {design.qualities.length ? (
                  design.qualities.map((q) => (
                    <Link
                      key={q.id}
                      to={`/designs?quality=${q.id}`}
                      className="inline-flex items-center rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-semibold text-primary hover:bg-primary/15"
                    >
                      {q.name}
                    </Link>
                  ))
                ) : (
                  <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900">
                    {NO_QUALITY_LABEL}
                    {canManage ? ' — edit to add one' : ''}
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Goes for butta cutting</dt>
              <dd className="flex items-center gap-2 font-semibold text-slate-900">
                {design.buttaCutting ? 'Yes' : 'No'}
                {design.buttaCutting && <ButtaTag />}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Added on</dt>
              <dd className="font-semibold text-slate-900">{formatDate(design.createdAt)}</dd>
            </div>
          </dl>
          {design.notes && (
            <div>
              <p className="text-sm text-muted-foreground">Notes</p>
              <p className="whitespace-pre-line text-[15px] text-slate-700">{design.notes}</p>
            </div>
          )}
        </div>
      </section>

      {canManage && <DesignFormDialog open={editOpen} onOpenChange={setEditOpen} design={design} />}
      {canManage && (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={`Delete design ${design.code}?`}
          description="It will be removed from the design library. Designs used in orders can't be deleted."
          confirmLabel="Delete"
          destructive
          loading={deleteDesign.isPending}
          onConfirm={() =>
            deleteDesign.mutate(design.id, {
              onSuccess: () => {
                toast.success(`Design ${design.code} deleted`);
                navigate(from ?? '/designs', { replace: true });
              },
              onSettled: () => setConfirmDelete(false),
            })
          }
        />
      )}
    </div>
  );
}
