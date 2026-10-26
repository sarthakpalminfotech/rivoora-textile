import { AlertCircle, CheckCircle2, ImagePlus, Loader2, RotateCw, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  bulkRowProblems,
  DESIGN_CODE_MAX_LENGTH,
  DESIGN_CODE_REGEX,
  MAX_BULK_DESIGNS,
  normalizeCode,
  parseQualityParam,
  type DesignQuality,
  type UploadResult,
} from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { IMAGE_ACCEPT, validateImage } from '@/components/ui/image-upload';
import { Segmented } from '@/components/ui/segmented';
import { useDebounce } from '@/hooks/useDebounce';
import { api, ApiError, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { FormHeader } from '../../yarn/parts';
import { useCreateDesignsBulk, useDesignQualityGroups, useTakenDesignCodes } from '../api';
import { BUTTA_OPTIONS, type ButtaChoice } from './design-form';
import { QualitiesSelect } from './qualities-select';

/** Uploads running at once (the rest wait in the queue). */
const PARALLEL_UPLOADS = 3;

type UploadStatus = 'queued' | 'uploading' | 'done' | 'failed';

interface Row {
  key: string;
  file: File;
  /** Local preview while the upload runs (revoked when the row goes). */
  preview: string;
  status: UploadStatus;
  uploadError?: string;
  image?: UploadResult;
  code: string;
  name: string;
  qualities: DesignQuality[];
  butta: ButtaChoice | null;
  /** A problem the server reported for this row on Add all. */
  serverError?: { code?: string; materialIds?: string };
}

let nextKey = 1;

/** A code suggested from the file name ("D 201.jpg" → "D201") when it is a valid code; else empty. */
function codeFromFileName(name: string): string {
  const c = normalizeCode(name.replace(/\.[^.]+$/, ''));
  return c.length <= DESIGN_CODE_MAX_LENGTH && DESIGN_CODE_REGEX.test(c) ? c : '';
}

/**
 * Sprint 18 — Upload many (`/designs/upload`, Jenish / Gaurang): pick many images (or drop them on desktop), they upload
 * in the background (client shrink + the normal upload API, a few at a time, retry per tile); review every tile (code
 * with a live uniqueness check incl. the other tiles, qualities, optional name, butta cutting) with "Apply to all"
 * helpers; Add all saves every design in ONE request / transaction and opens the quality view.
 */
export default function UploadManyDesignsPage() {
  usePageTitle('Upload many designs');
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const startQuality = parseQualityParam(params.get('quality'));
  const groups = useDesignQualityGroups({ designs: 0 });
  const save = useCreateDesignsBulk();
  const [rows, setRows] = useState<Row[]>([]);
  const [allQualities, setAllQualities] = useState<DesignQuality[]>([]);
  const [allButta, setAllButta] = useState<ButtaChoice | null>(null);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const savedRef = useRef(false);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  // Opened from a quality page: "Apply quality to all" starts with that quality.
  const presetDone = useRef(false);
  useEffect(() => {
    if (presetDone.current || typeof startQuality !== 'number' || !groups.data) return;
    const g = groups.data.find((x) => x.materialId === startQuality);
    if (g) setAllQualities([{ id: startQuality, name: g.name }]);
    presetDone.current = true;
  }, [groups.data, startQuality]);

  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  // The upload queue: a few at a time, in the order picked.
  useEffect(() => {
    const running = rows.filter((r) => r.status === 'uploading').length;
    const next = rows.filter((r) => r.status === 'queued').slice(0, Math.max(0, PARALLEL_UPLOADS - running));
    for (const r of next) {
      update(r.key, { status: 'uploading', uploadError: undefined });
      api
        .upload(r.file, 'designs')
        .then((image) => update(r.key, { status: 'done', image }))
        .catch((err) => update(r.key, { status: 'failed', uploadError: errorMessage(err) }));
    }
  }, [rows]);

  // Previews are local object URLs: free them when the page goes.
  useEffect(() => () => rowsRef.current.forEach((r) => URL.revokeObjectURL(r.preview)), []);

  const addFiles = (files: FileList | File[] | null) => {
    if (!files?.length) return;
    const list = Array.from(files);
    const room = MAX_BULK_DESIGNS - rows.length;
    if (room <= 0) {
      toast.error(`At most ${MAX_BULK_DESIGNS} designs at once.`);
      return;
    }
    const added: Row[] = [];
    for (const file of list.slice(0, room)) {
      const problem = validateImage(file);
      if (problem) {
        toast.error(problem);
        continue;
      }
      added.push({
        key: `r${nextKey++}`,
        file,
        preview: URL.createObjectURL(file),
        status: 'queued',
        code: codeFromFileName(file.name),
        name: '',
        qualities: allQualities,
        butta: allButta,
      });
    }
    if (list.length > room) toast.warning(`Only the first ${room} images were added (at most ${MAX_BULK_DESIGNS} at once).`);
    setRows((rs) => [...rs, ...added]);
  };

  const remove = (key: string) =>
    setRows((rs) => {
      const r = rs.find((x) => x.key === key);
      if (r) URL.revokeObjectURL(r.preview);
      return rs.filter((x) => x.key !== key);
    });

  // Live uniqueness: codes already used in the Design master (debounced), and codes repeated on this page.
  // (a joined string: an array would be a new value on every render and never settle)
  const codes = useDebounce(rows.map((r) => normalizeCode(r.code)).filter(Boolean).join(','), 400);
  const taken = useTakenDesignCodes(codes ? codes.split(',') : []);
  const takenSet = useMemo(() => new Set(taken.data?.taken ?? []), [taken.data]);
  const problems = useMemo(
    () =>
      bulkRowProblems(
        rows.map((r) => ({ key: r.key, code: r.code, materialIds: r.qualities.map((q) => q.id), buttaCutting: r.butta === null ? null : r.butta === 'yes', uploaded: r.status === 'done' })),
        takenSet,
      ),
    [rows, takenSet],
  );

  const uploaded = rows.filter((r) => r.status === 'done').length;
  const failed = rows.filter((r) => r.status === 'failed').length;
  const busy = rows.some((r) => r.status === 'queued' || r.status === 'uploading');
  const invalid = rows.filter((r) => problems.has(r.key) || r.serverError).length;
  const canSave = rows.length > 0 && invalid === 0 && !save.isPending;

  const applyQualities = () => {
    if (!allQualities.length) return;
    setRows((rs) => rs.map((r) => ({ ...r, qualities: allQualities, serverError: r.serverError?.code ? { code: r.serverError.code } : undefined })));
    toast.success(`Qualities applied to ${rows.length} design${rows.length === 1 ? '' : 's'}`);
  };
  const applyButta = (v: ButtaChoice) => {
    setAllButta(v);
    setRows((rs) => rs.map((r) => ({ ...r, butta: v })));
  };

  const addAll = () => {
    if (!canSave) return;
    save.mutate(
      {
        designs: rows.map((r) => ({
          code: r.code,
          name: r.name,
          imageUrl: r.image!.url,
          thumbUrl: r.image!.thumbUrl,
          materialIds: r.qualities.map((q) => q.id),
          buttaCutting: r.butta === 'yes',
        })),
      },
      {
        onSuccess: (res) => {
          savedRef.current = true;
          toast.success(`${res.created.length} design${res.created.length === 1 ? '' : 's'} added`);
          // Every design in the same single quality → that quality's page; otherwise the library.
          const ids = new Set(rows.flatMap((r) => r.qualities.map((q) => q.id)));
          const one = ids.size === 1 && rows.every((r) => r.qualities.length === 1) ? [...ids][0] : null;
          navigate(one ? `/designs?quality=${one}` : '/designs', { replace: true });
        },
        onError: (err) => {
          // `designs.<i>.code` / `designs.<i>.materialIds` → that tile.
          const m = err instanceof ApiError && err.field ? /^designs\.(\d+)\.(code|materialIds)$/.exec(err.field) : null;
          const row = m ? rows[Number(m[1])] : undefined;
          if (m && row) {
            update(row.key, { serverError: { [m[2]]: err.message } });
            document.getElementById(`tile-${row.key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
          toast.error(errorMessage(err));
        },
      },
    );
  };

  // Leaving with tiles on the page asks first (the uploaded images would be lost).
  const dirty = rows.length > 0 && !savedRef.current;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !savedRef.current && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const close = () => (location.key !== 'default' ? navigate(-1) : navigate('/designs'));
  const pick = () => inputRef.current?.click();

  return (
    <div
      className="flex min-h-[100dvh] flex-col bg-background"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDrag(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDrag(false);
        addFiles(e.dataTransfer.files);
      }}
    >
      <FormHeader
        title="Upload many designs"
        onClose={close}
        action={
          rows.length > 0 ? (
            <Button variant="secondary" onClick={pick} disabled={rows.length >= MAX_BULK_DESIGNS}>
              <ImagePlus /> <span className="hidden sm:inline">Add images</span>
            </Button>
          ) : undefined
        }
      />
      <input
        ref={inputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        multiple
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = '';
        }}
      />

      <div className="mx-auto w-full max-w-[1600px] flex-1 space-y-4 px-4 py-4 md:py-6">
        {rows.length === 0 ? (
          <button
            type="button"
            onClick={pick}
            className={cn(
              'flex min-h-72 w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-slate-300 bg-white px-6 text-center transition-colors hover:border-primary/50 hover:bg-primary-soft/40',
              drag && 'border-primary bg-primary-soft',
            )}
          >
            <ImagePlus className="size-9 text-primary" aria-hidden />
            <span className="text-lg font-semibold text-slate-900">Pick design images</span>
            <span className="max-w-md text-sm text-muted-foreground">
              Choose many at once (or drag them here on a computer). They upload while you fill in each design's code and
              qualities. Up to {MAX_BULK_DESIGNS} at a time · JPG, PNG, WebP or HEIC · 10 MB each.
            </span>
          </button>
        ) : (
          <>
            {/* Helpers: apply qualities / butta cutting to every tile; upload progress. */}
            <section className="grid gap-4 rounded-xl border border-border bg-white p-4 shadow-soft md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
              <div className="space-y-1.5">
                <p className="text-sm font-semibold text-slate-800">Apply quality to all</p>
                <div className="flex items-start gap-2">
                  <QualitiesSelect className="min-w-0 flex-1" value={allQualities} onChange={setAllQualities} placeholder="Pick qualities" />
                  <Button variant="secondary" onClick={applyQualities} disabled={!allQualities.length}>
                    Apply
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Fills every tile; each tile can still be changed. New images get it too.</p>
              </div>
              <div className="space-y-1.5">
                <p className="text-sm font-semibold text-slate-800">Goes for butta cutting? (all)</p>
                <Segmented<ButtaChoice> aria-label="Butta cutting for all designs" options={[...BUTTA_OPTIONS]} value={allButta} onChange={applyButta} />
              </div>
              <div className="space-y-1.5 md:col-span-2 lg:col-span-1">
                <p className="flex items-center justify-between text-sm font-semibold text-slate-800">
                  <span>Uploaded</span>
                  <span className="tabular-nums text-slate-600">
                    {uploaded} / {rows.length}
                  </span>
                </p>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={uploaded} aria-valuemax={rows.length} aria-label="Upload progress">
                  <div className="h-full rounded-full bg-emerald-500 transition-[width]" style={{ width: `${rows.length ? (uploaded / rows.length) * 100 : 0}%` }} />
                </div>
                {failed > 0 && <p className="text-xs font-medium text-destructive">{failed} failed — tap Retry on the tile.</p>}
              </div>
            </section>

            <ul className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
              {rows.map((r, i) => (
                <ReviewTile
                  key={r.key}
                  row={r}
                  index={i}
                  problems={problems.get(r.key)}
                  onChange={(patch) => update(r.key, { ...patch, serverError: undefined })}
                  onRemove={() => remove(r.key)}
                  onRetry={() => update(r.key, { status: 'queued' })}
                />
              ))}
              {rows.length < MAX_BULK_DESIGNS && (
                <li>
                  <button
                    type="button"
                    onClick={pick}
                    className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-white/60 text-sm font-semibold text-slate-700 hover:border-primary/50 hover:bg-primary-soft/40"
                  >
                    <ImagePlus className="size-6 text-primary" aria-hidden /> Add more images
                  </button>
                </li>
              )}
            </ul>
          </>
        )}
      </div>

      {rows.length > 0 && (
        <div className="kb-bar sticky bottom-0 z-30 border-t border-border bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            <p className="min-w-0 flex-1 text-sm text-slate-600">
              <span className="font-semibold text-slate-900">{rows.length}</span> design{rows.length === 1 ? '' : 's'}
              {invalid > 0 ? (
                <span className="ml-2 font-medium text-amber-700">· {invalid} need{invalid === 1 ? 's' : ''} attention</span>
              ) : busy ? (
                <span className="ml-2 text-slate-500">· uploading…</span>
              ) : (
                <span className="ml-2 inline-flex items-center gap-1 font-medium text-emerald-700">
                  · <CheckCircle2 className="size-4" /> ready
                </span>
              )}
            </p>
            <Button size="lg" onClick={addAll} disabled={!canSave} loading={save.isPending} className="min-w-40">
              Add all ({rows.length})
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={blocker.state === 'blocked'}
        onOpenChange={(o) => !o && blocker.state === 'blocked' && blocker.reset()}
        title="Discard these designs?"
        description="Nothing is saved until you tap Add all. If you leave now the tiles are lost."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => blocker.state === 'blocked' && blocker.proceed()}
      />
    </div>
  );
}

function ReviewTile({
  row,
  index,
  problems,
  onChange,
  onRemove,
  onRetry,
}: {
  row: Row;
  index: number;
  problems?: { code?: string; materialIds?: string; buttaCutting?: string; image?: string };
  onChange: (patch: Partial<Row>) => void;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const codeError = row.serverError?.code ?? problems?.code;
  const qualityError = row.serverError?.materialIds ?? problems?.materialIds;
  const label = `Design ${index + 1}`;
  return (
    <li id={`tile-${row.key}`} className={cn('flex flex-col overflow-hidden rounded-xl border bg-white shadow-soft', codeError || qualityError || problems?.buttaCutting ? 'border-amber-300' : 'border-border')}>
      <div className="relative">
        <img src={row.image?.thumbUrl ?? row.preview} alt={row.code || label} className="aspect-square w-full bg-slate-100 object-cover" />
        {row.status !== 'done' && (
          <div className={cn('absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 text-center', row.status === 'failed' ? 'bg-white/85' : 'bg-white/55')}>
            {row.status === 'failed' ? (
              <>
                <AlertCircle className="size-6 text-destructive" aria-hidden />
                <p className="line-clamp-2 text-xs font-medium text-destructive">{row.uploadError ?? 'Upload failed'}</p>
                <Button size="sm" variant="secondary" onClick={onRetry}>
                  <RotateCw /> Retry
                </Button>
              </>
            ) : (
              <>
                <Loader2 className="size-6 animate-spin text-primary" aria-hidden />
                <p className="text-xs font-semibold text-slate-700">{row.status === 'queued' ? 'Waiting…' : 'Uploading…'}</p>
              </>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={onRemove}
          className="absolute right-2 top-2 flex size-8 items-center justify-center rounded-full bg-slate-900/75 text-white shadow hover:bg-slate-900"
          aria-label={`Remove ${row.code || label}`}
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="grid gap-2.5 p-3">
        <div>
          <label htmlFor={`code-${row.key}`} className="mb-1 block text-xs font-semibold text-slate-700">
            Design code <span className="text-destructive">*</span>
          </label>
          <Input
            id={`code-${row.key}`}
            value={row.code}
            onChange={(e) => onChange({ code: e.target.value })}
            placeholder="e.g. D201"
            autoComplete="off"
            className="h-10 uppercase"
            invalid={!!codeError}
          />
          {codeError && <p className="mt-1 text-xs font-medium text-destructive">{codeError}</p>}
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold text-slate-700">
            Qualities <span className="text-destructive">*</span>
          </p>
          <QualitiesSelect compact value={row.qualities} onChange={(qualities) => onChange({ qualities })} invalid={!!qualityError} placeholder="Pick qualities" />
          {qualityError && <p className="mt-1 text-xs font-medium text-destructive">{qualityError}</p>}
        </div>
        <div>
          <label htmlFor={`name-${row.key}`} className="mb-1 block text-xs font-semibold text-slate-700">
            Name
          </label>
          <Input id={`name-${row.key}`} value={row.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="Optional" className="h-10" maxLength={120} />
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold text-slate-700">
            Butta cutting <span className="text-destructive">*</span>
          </p>
          <Segmented<ButtaChoice>
            aria-label={`Butta cutting for ${row.code || label}`}
            options={[...BUTTA_OPTIONS]}
            value={row.butta}
            onChange={(butta) => onChange({ butta })}
            invalid={!!problems?.buttaCutting}
          />
        </div>
      </div>
    </li>
  );
}
