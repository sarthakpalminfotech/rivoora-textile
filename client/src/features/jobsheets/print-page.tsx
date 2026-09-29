import { ArrowLeft, Loader2, Printer } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import type { JobsheetPrintItem } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { useJobsheetPrint } from './api';

/*
 * Print layout. A4 = 210 × 297 mm with 10 mm margins → 190 × 277 mm of content per page.
 * Each jobsheet prints as 2 pages (front + design back) so double-sided pairs never shift.
 * Everything is scoped under .jsp and injected only while this route is mounted.
 */
const PAGE_W_MM = 210;
const MM_TO_PX = 96 / 25.4;

const CSS = `
@page { size: A4 portrait; margin: 10mm; }
.jsp { --ink: #000; color: var(--ink); font-family: 'DM Sans', system-ui, sans-serif; }
.jsp * { box-sizing: border-box; }
.jsp-page {
  width: 210mm; height: 297mm; padding: 10mm; background: #fff; overflow: hidden;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.jsp-sheet { display: flex; flex-direction: column; width: 190mm; height: 277mm; }
.jsp-b { border: 1.4px solid var(--ink); }
.jsp-lbl { font-weight: 700; text-transform: uppercase; font-size: 10.5pt; letter-spacing: 0.02em; white-space: nowrap; }
.jsp-val { font-weight: 700; font-size: 17pt; line-height: 1.1; }
.jsp-line { flex: 1; border-bottom: 1px solid var(--ink); min-width: 10mm; }

.jsp-om { text-align: center; font-family: 'Noto Sans Devanagari', sans-serif; font-weight: 600; font-size: 15pt; line-height: 1.2; }
.jsp-no { margin-top: 2.5mm; width: 105mm; height: 20mm; display: flex; align-items: center; justify-content: center;
  font-size: 34pt; font-weight: 800; letter-spacing: 0.04em; }

.jsp-main { margin-top: 3.5mm; flex: 1; display: flex; flex-direction: column; padding: 3mm; gap: 3mm; min-height: 0; }
.jsp-top { display: grid; grid-template-columns: 1fr 72mm; gap: 4mm; }
.jsp-fields { display: flex; flex-direction: column; justify-content: space-between; gap: 1.2mm; }
.jsp-row { display: flex; align-items: flex-end; gap: 2mm; height: 8mm; }
.jsp-idbox { padding: 3mm; display: flex; flex-direction: column; gap: 3mm; justify-content: center; }
.jsp-idrow { display: flex; flex-direction: column; gap: 1.2mm; }
.jsp-vbox { border: 1.4px solid var(--ink); min-height: 14mm; padding: 1.5mm 3mm; display: flex; align-items: center;
  word-break: break-word; }

.jsp-bottom { flex: 1; display: grid; grid-template-columns: 1fr 58mm; gap: 4mm; min-height: 0; }
.jsp-table { width: 100%; height: 100%; border-collapse: collapse; table-layout: fixed; }
.jsp-table th, .jsp-table td { border: 1px solid var(--ink); padding: 0 1.5mm; font-size: 10pt; }
.jsp-table th { font-weight: 700; text-transform: uppercase; height: 8mm; text-align: center; }
.jsp-table td:first-child { font-weight: 700; }
.jsp-side { display: flex; flex-direction: column; gap: 3mm; min-height: 0; }
.jsp-pf { padding: 3mm; display: flex; flex-direction: column; gap: 2.5mm; }
.jsp-pfrow { display: grid; grid-template-columns: 17mm 1fr; align-items: center; gap: 2mm; }
.jsp-qty { text-align: right; font-weight: 700; font-size: 13pt; }
.jsp-ops { flex: 1; padding: 3mm; display: flex; flex-direction: column; justify-content: space-evenly; gap: 3mm; }
.jsp-oprow { display: flex; flex-direction: column; gap: 5mm; }

.jsp-foot { margin-top: 3.5mm; height: 58mm; display: grid; grid-template-columns: 1fr 92mm; gap: 4mm; padding: 3mm; }
.jsp-taka { display: flex; flex-direction: column; gap: 1mm; }
.jsp-taka .jsp-row { height: 9mm; }
.jsp-damage { padding: 2.5mm 3mm; display: flex; flex-direction: column; }
.jsp-damage h3 { margin: 0 0 1mm; text-align: center; font-weight: 800; font-size: 12pt; letter-spacing: 0.08em; }
.jsp-damage .jsp-row { flex: 1; height: auto; }

.jsp-back { position: relative; display: flex; flex-direction: column; align-items: center; width: 190mm; height: 277mm; }
.jsp-back-code { font-size: 32pt; font-weight: 800; letter-spacing: 0.03em; margin: 2mm 0 5mm; text-align: center; }
.jsp-back-img { flex: 1; min-height: 0; width: 100%; display: flex; align-items: center; justify-content: center; }
.jsp-back-img img { max-width: 100%; max-height: 100%; object-fit: contain; }
.jsp-back-tag { position: absolute; top: 0; right: 0; font-size: 9pt; font-weight: 600; color: #444; }
.jsp-back-empty { color: #888; font-size: 10pt; }

@media screen {
  .jsp-page { box-shadow: 0 1px 3px rgb(15 23 42 / 0.12), 0 8px 24px rgb(15 23 42 / 0.08); }
}
@media print {
  html, body { background: #fff !important; }
  .jsp-toolbar { display: none !important; }
  .jsp-screen { background: #fff !important; padding: 0 !important; }
  .jsp-scale { transform: none !important; height: auto !important; width: auto !important; }
  .jsp-pages { gap: 0 !important; }
  .jsp-pad { padding: 0 !important; }
  .jsp-fit { max-width: none !important; overflow: visible !important; }
  /* 1 mm of slack so rounding never spills onto an extra sheet. */
  .jsp-page { width: 190mm; height: 276mm; padding: 0; box-shadow: none; break-after: page; page-break-after: always; }
  .jsp-sheet, .jsp-back { height: 276mm; }
  .jsp-page:last-child { break-after: auto; page-break-after: auto; }
}
`;

const FIELD_LABELS = ['Warp:', 'Reed:', 'Total ends:', 'Width:', 'Weft:'];

function FrontPage({ js }: { js: JobsheetPrintItem }) {
  return (
    <div className="jsp-sheet">
      <div className="jsp-om">॥ श्री गणेशाय नमः ॥</div>
      <div className="jsp-no jsp-b">{js.jobsheetNo}</div>

      <div className="jsp-main jsp-b">
        <div className="jsp-top">
          <div className="jsp-fields">
            {FIELD_LABELS.map((l) => (
              <div key={l} className="jsp-row">
                <span className="jsp-lbl">{l}</span>
                <span className="jsp-line" />
              </div>
            ))}
            {[0, 1, 2].map((i) => (
              <div key={i} className="jsp-row">
                <span className="jsp-line" />
              </div>
            ))}
          </div>
          <div className="jsp-idbox jsp-b">
            <div className="jsp-idrow">
              <span className="jsp-lbl">Loom no:</span>
              <div className="jsp-vbox jsp-val">{js.machineNos.join(', ')}</div>
            </div>
            <div className="jsp-idrow">
              <span className="jsp-lbl">Design no:</span>
              <div className="jsp-vbox jsp-val">{js.designCode ?? ''}</div>
            </div>
          </div>
        </div>

        <div className="jsp-bottom">
          <table className="jsp-table">
            <colgroup>
              <col style={{ width: '24%' }} />
              <col style={{ width: '46%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '15%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>Pre-winder</th>
                <th>Yarn</th>
                <th />
                <th />
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 12 }, (_, i) => (
                <tr key={i}>
                  <td>{i + 1})</td>
                  <td />
                  <td />
                  <td />
                </tr>
              ))}
            </tbody>
          </table>

          <div className="jsp-side">
            <div className="jsp-pf jsp-b">
              <div className="jsp-pfrow">
                <span className="jsp-lbl">Picks:</span>
                <div className="jsp-vbox jsp-val">{js.picks ?? ''}</div>
              </div>
              <div className="jsp-pfrow">
                <span className="jsp-lbl">Frame:</span>
                <div className="jsp-vbox jsp-val">{js.frames}</div>
              </div>
              <div className="jsp-qty">{js.jobsheetPieces} pcs</div>
            </div>
            <div className="jsp-ops jsp-b">
              <div className="jsp-oprow">
                <span className="jsp-lbl">Head operator:</span>
                <span className="jsp-line" style={{ flex: 'none', height: '6mm' }} />
              </div>
              <div className="jsp-oprow">
                <span className="jsp-lbl">Operator name:</span>
                <span className="jsp-line" style={{ flex: 'none', height: '6mm' }} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="jsp-foot jsp-b">
        <div className="jsp-taka">
          <span className="jsp-lbl">Taka:</span>
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="jsp-row">
              <span className="jsp-lbl">{n})</span>
              <span className="jsp-line" />
            </div>
          ))}
        </div>
        <div className="jsp-damage jsp-b">
          <h3>DAMAGE</h3>
          {['Machine damage:', 'Buttacutting damage:', 'Mill damage:'].map((l) => (
            <div key={l} className="jsp-row">
              <span className="jsp-lbl">{l}</span>
              <span className="jsp-line" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function BackPage({ js, onImageDone }: { js: JobsheetPrintItem; onImageDone: () => void }) {
  return (
    <div className="jsp-back">
      <span className="jsp-back-tag">Jobsheet {js.jobsheetNo}</span>
      {js.designCode && <div className="jsp-back-code">{js.designCode}</div>}
      <div className="jsp-back-img">
        {js.imageUrl ? (
          <img
            src={js.imageUrl}
            alt={`Design ${js.designCode ?? ''}`}
            loading="eager"
            decoding="sync"
            ref={(el) => {
              // Already-cached images may be complete before React attaches onLoad.
              if (el?.complete && el.dataset.done !== '1') {
                el.dataset.done = '1';
                onImageDone();
              }
            }}
            onLoad={(e) => {
              if (e.currentTarget.dataset.done !== '1') {
                e.currentTarget.dataset.done = '1';
                onImageDone();
              }
            }}
            onError={(e) => {
              if (e.currentTarget.dataset.done !== '1') {
                e.currentTarget.dataset.done = '1';
                onImageDone();
              }
            }}
          />
        ) : (
          <span className="jsp-back-empty">No design attached</span>
        )}
      </div>
    </div>
  );
}

/** Loads Noto Sans Devanagari (for ॥ श्री गणेशाय नमः ॥) only while the print route is open. */
function useDevanagariFont() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@600&display=block';
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        setReady(true);
      }
    };
    link.onload = () => {
      document.fonts
        .load('600 16px "Noto Sans Devanagari"', 'श्री')
        .then(finish, finish);
    };
    link.onerror = finish;
    document.head.appendChild(link);
    // Never block printing for long on a slow or offline font request.
    const t = window.setTimeout(finish, 4000);
    return () => {
      window.clearTimeout(t);
      link.remove();
    };
  }, []);
  return ready;
}

/** Scales the 210 mm pages down to fit narrow screens (phones). */
function usePageScale() {
  // Callback ref: the container only appears once the data has loaded.
  const [el, ref] = useState<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    if (!el) return;
    const update = () => {
      const pagePx = PAGE_W_MM * MM_TO_PX;
      setScale(Math.min(1, el.clientWidth / pagePx));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return { ref, scale };
}

export default function JobsheetPrintPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const ids = useMemo(
    () =>
      (params.get('ids') ?? '')
        .split(',')
        .map(Number)
        .filter((n) => Number.isInteger(n) && n > 0),
    [params],
  );
  const { data, isPending, isError, error, refetch } = useJobsheetPrint(ids);
  const fontReady = useDevanagariFont();
  const { ref, scale } = usePageScale();
  const [loadedImages, setLoadedImages] = useState(0);
  const onImageDone = useCallback(() => setLoadedImages((n) => n + 1), []);

  usePageTitle(
    data ? (data.length === 1 ? `Print jobsheet ${data[0].jobsheetNo}` : `Print ${data.length} jobsheets`) : 'Print jobsheets',
  );

  const imageCount = data?.filter((j) => j.imageUrl).length ?? 0;
  const ready = !!data && fontReady && loadedImages >= imageCount;
  const pageCount = (data?.length ?? 0) * 2;

  const goBack = () => {
    if (location.key !== 'default') navigate(-1);
    else navigate('/orders');
  };

  const pagePxH = 297 * MM_TO_PX;
  const pagePxW = PAGE_W_MM * MM_TO_PX;
  const gapPx = 16;

  return (
    <div className="jsp jsp-screen min-h-[100dvh] bg-slate-200/70">
      <style>{CSS}</style>
      <header className="jsp-toolbar sticky top-0 z-30 border-b border-border bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-4xl items-center gap-2 px-2 md:h-16 md:px-4">
          <Button variant="ghost" size="sm" onClick={goBack}>
            <ArrowLeft /> Back
          </Button>
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-600">
            {data
              ? `${data.length} jobsheet${data.length === 1 ? '' : 's'} · ${pageCount} A4 pages (front + design)`
              : 'Jobsheets'}
          </p>
          <Button onClick={() => window.print()} disabled={!ready}>
            {ready ? <Printer /> : <Loader2 className="animate-spin" />}
            {ready ? 'Print' : 'Preparing…'}
          </Button>
        </div>
      </header>

      <div className="jsp-pad px-3 py-4 md:px-6 md:py-6">
        {ids.length === 0 ? (
          <div className="mx-auto max-w-md rounded-xl bg-white p-8 text-center shadow-soft">
            <p className="font-semibold text-slate-900">Nothing to print</p>
            <Button asChild variant="secondary" className="mt-4">
              <Link to="/orders">Go to orders</Link>
            </Button>
          </div>
        ) : isPending ? (
          <div className="flex justify-center py-20 text-slate-500">
            <Loader2 className="size-6 animate-spin" aria-label="Loading" />
          </div>
        ) : isError || !data ? (
          <div className="mx-auto max-w-md rounded-xl bg-white shadow-soft">
            {error instanceof ApiError && error.status === 404 ? (
              <div className="p-8 text-center">
                <p className="font-semibold text-slate-900">Jobsheets not found</p>
                <p className="mt-1 text-sm text-muted-foreground">They may have been deleted or aren't visible for your role.</p>
              </div>
            ) : (
              <ErrorState error={error} onRetry={() => void refetch()} />
            )}
          </div>
        ) : (
          <div ref={ref} className="jsp-fit mx-auto w-full max-w-[210mm] overflow-hidden">
            <div
              className="jsp-scale origin-top-left"
              style={{
                transform: scale < 1 ? `scale(${scale})` : undefined,
                width: pagePxW,
                height: scale < 1 ? pageCount * (pagePxH + gapPx) * scale : undefined,
              }}
            >
              <div className="jsp-pages flex flex-col" style={{ gap: gapPx }}>
                {data.flatMap((js) => [
                  <div key={`${js.id}-f`} className="jsp-page">
                    <FrontPage js={js} />
                  </div>,
                  <div key={`${js.id}-b`} className="jsp-page">
                    <BackPage js={js} onImageDone={onImageDone} />
                  </div>,
                ])}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
