import { ArrowLeft, ImagePlus, Layers, Pencil, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import type { DesignVariation } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ImageThumb } from '@/components/ui/image-thumb';
import { Skeleton } from '@/components/ui/skeleton';
import { useRole } from '@/hooks/useRole';
import { formatDate } from '@/lib/format';
import { useDeleteDesign, useDeleteVariation, useDesign } from '../api';
import { DesignFormDialog } from './design-form';
import { VariationFormDialog } from './variation-form';

export default function DesignDetailPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const { can } = useRole();
  const canManage = can('canManageMasters');
  const { data: design, isPending, isError, error, refetch } = useDesign(id);
  usePageTitle(design ? `Design ${design.code}` : 'Design');

  const deleteVariation = useDeleteVariation(id);
  const deleteDesign = useDeleteDesign();
  const [editOpen, setEditOpen] = useState(false);
  const [variationOpen, setVariationOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<DesignVariation | null>(null);

  const back = (
    <Link to="/designs" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-primary">
      <ArrowLeft className="size-4" /> All designs
    </Link>
  );

  if (isPending) {
    return (
      <div className="page-container space-y-4 py-5">
        {back}
        <div className="grid gap-5 md:grid-cols-[320px_1fr]">
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
      <section className="grid gap-5 rounded-xl border border-border bg-white p-4 shadow-soft md:grid-cols-[300px_1fr] md:p-5">
        <ImageThumb
          thumbUrl={design.thumbUrl}
          fullUrl={design.imageUrl}
          alt={`Design ${design.code}`}
          className="aspect-square w-full"
          rounded="rounded-xl"
        />
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Design code</p>
              <h2 className="text-2xl font-bold text-slate-900">{design.code}</h2>
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
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div className="col-span-2">
              <dt className="text-muted-foreground">Material / Quality</dt>
              <dd className="font-semibold text-slate-900">{design.material?.name ?? 'Any material'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Variations</dt>
              <dd className="font-semibold text-slate-900">{design.variations.length}</dd>
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

      <section className="rounded-xl border border-border bg-white p-4 shadow-soft md:p-5">
        <div className="mb-4 flex items-center gap-2">
          <Layers className="size-5 text-primary" aria-hidden />
          <h3 className="text-base font-semibold text-slate-900">Variations</h3>
          <span className="text-sm text-muted-foreground">({design.variations.length})</span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {design.variations.map((v) => (
            <div key={v.id} className="relative overflow-hidden rounded-xl border border-border bg-white">
              <ImageThumb thumbUrl={v.thumbUrl} fullUrl={v.imageUrl} alt={v.code} className="aspect-square w-full" rounded="rounded-none" />
              <div className="flex items-center gap-1 px-3 py-2">
                <p className="min-w-0 flex-1 truncate text-sm font-bold text-slate-900">{v.code}</p>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => setRemoveTarget(v)}
                    className="flex size-8 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-destructive-soft hover:text-destructive"
                    aria-label={`Remove variation ${v.code}`}
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
          {canManage && (
            <button
              type="button"
              onClick={() => setVariationOpen(true)}
              className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/60 px-3 text-center transition-colors hover:border-primary/50 hover:bg-primary-soft/50"
            >
              <ImagePlus className="size-6 text-primary" aria-hidden />
              <span className="text-sm font-semibold text-slate-800">Add variation</span>
              <span className="text-xs text-muted-foreground">Image + variation code</span>
            </button>
          )}
        </div>
        {!canManage && design.variations.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">This design has no variations yet.</p>
        )}
      </section>

      <DesignFormDialog open={editOpen} onOpenChange={setEditOpen} design={design} />
      {canManage && <VariationFormDialog open={variationOpen} onOpenChange={setVariationOpen} design={design} />}
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
              navigate('/designs', { replace: true });
            },
            onSettled: () => setConfirmDelete(false),
          })
        }
      />
      <ConfirmDialog
        open={!!removeTarget}
        onOpenChange={(o) => !o && setRemoveTarget(null)}
        title={`Remove variation ${removeTarget?.code ?? ''}?`}
        description="Variations used in orders can't be removed."
        confirmLabel="Remove"
        destructive
        loading={deleteVariation.isPending}
        onConfirm={() =>
          removeTarget &&
          deleteVariation.mutate(removeTarget.id, {
            onSuccess: () => toast.success(`Variation ${removeTarget.code} removed`),
            onSettled: () => setRemoveTarget(null),
          })
        }
      />
    </div>
  );
}
