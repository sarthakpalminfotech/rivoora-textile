import { AlertTriangle, Loader2, Printer, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { BLOUSE_PRINT_LABEL, jobsheetQrUrl, jobsheetRefShort, ORDER_TYPE_LABEL, type JobsheetPrintItem } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { useRole } from '@/hooks/useRole';
import { ApiError } from '@/lib/api';
import { useJobsheetPrint } from './api';

/*
 * Print layout. A4 = 210 × 297 mm with 10 mm margins → 190 × 277 mm of content per page.
 * Each jobsheet prints as ONE page (the design back page was removed in Sprint 6).
 * Everything is scoped under .jsp and injected only while this route is mounted.
 */
const PAGE_W_MM = 210;
const MM_TO_PX = 96 / 25.4;

/** The live website address the QR codes point to (`${url}/j/${jobsheetNo}`). Falls back to this page's origin. */
const PUBLIC_APP_URL = String(import.meta.env.VITE_PUBLIC_APP_URL ?? '').trim();
const qrBaseUrl = () => PUBLIC_APP_URL || window.location.origin;

const CSS = `
@page { size: A4 portrait; margin: 10mm; }
.jsp { --ink: #000; color: var(--ink); font-family: 'DM Sans', system-ui, sans-serif; }
.jsp * { box-sizing: border-box; }
.jsp-page {
  width: 210mm; height: 297mm; padding: 10mm; background: #fff; overflow: hidden;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.jsp-sheet { position: relative; display: flex; flex-direction: column; width: 190mm; height: 277mm; }
.jsp-b { border: 1.4px solid var(--ink); }
.jsp-lbl { font-weight: 700; text-transform: uppercase; font-size: 10.5pt; letter-spacing: 0.02em; white-space: nowrap; }
.jsp-val { font-weight: 700; font-size: 17pt; line-height: 1.1; }
.jsp-line { flex: 1; border-bottom: 1px solid var(--ink); min-width: 10mm; }

.jsp-om { text-align: center; font-family: 'Noto Sans Devanagari', sans-serif; font-weight: 600; font-size: 15pt; line-height: 1.2; }
/* Order number large, the jobsheet number in brackets beside it, smaller: "ORDER 26 (319)". */
.jsp-no { margin-top: 2.5mm; width: 105mm; height: 20mm; display: flex; align-items: baseline; justify-content: center; gap: 2.5mm;
  padding-top: 2mm; font-size: 34pt; font-weight: 800; letter-spacing: 0.04em; line-height: 1; }
.jsp-no-lbl { font-size: 8pt; font-weight: 700; letter-spacing: 0.12em; align-self: center; }
.jsp-no-js { font-size: 18pt; font-weight: 700; letter-spacing: 0.02em; }

/* QR in the empty space right of the number box (top 0 → ~31 mm; the main box starts at ~32 mm). */
.jsp-qr { position: absolute; top: 0; right: 0; width: 28mm; display: flex; flex-direction: column; align-items: center; }
.jsp-qr-code, .jsp-qr-code svg { display: block; width: 28mm; height: 28mm; }
.jsp-qr-cap { margin-top: 0.4mm; font-size: 6.5pt; font-weight: 600; line-height: 1; letter-spacing: 0.02em; white-space: nowrap; }

.jsp-main { margin-top: 3.5mm; flex: 1; display: flex; flex-direction: column; padding: 3mm; gap: 3mm; min-height: 0; }
.jsp-top { display: grid; grid-template-columns: 1fr 72mm; gap: 4mm; }
.jsp-fields { display: flex; flex-direction: column; justify-content: space-between; gap: 1.2mm; }
.jsp-row { display: flex; align-items: flex-end; gap: 2mm; height: 8mm; }
.jsp-idbox { padding: 3mm; display: flex; flex-direction: column; gap: 3mm; justify-content: center; }
.jsp-idrow { display: flex; flex-direction: column; gap: 1.2mm; }
.jsp-assigned { font-size: 8.5pt; font-weight: 600; line-height: 1; }
.jsp-otype { font-size: 12pt; font-weight: 700; line-height: 1; text-align: center; }
.jsp-blouse { margin-top: 1.2mm; font-size: 13pt; font-weight: 800; letter-spacing: 0.06em; line-height: 1; text-align: center; border: 1.4px solid var(--ink); padding: 1.2mm 2mm; }
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
  .jsp-sheet { height: 276mm; }
  .jsp-page:last-child { break-after: auto; page-break-after: auto; }
}
`;

const FIELD_LABELS = ['Warp:', 'Reed:', 'Total ends:', 'Width:', 'Weft:'];

function FrontPage({ js, qrSvg }: { js: JobsheetPrintItem; qrSvg: string | undefined }) {
  return (
    <div className="jsp-sheet">
      <div className="jsp-om">॥ श्री गणेशाय नमः ॥</div>
      <div className="jsp-no jsp-b" aria-label={`Order ${js.orderNo}, jobsheet ${js.jobsheetNo}`}>
        <span className="jsp-no-lbl">ORDER</span>
        <span>{js.orderNo}</span>
        <span className="jsp-no-js">({js.jobsheetNo})</span>
      </div>
      {qrSvg && (
        <div className="jsp-qr">
          {/* SVG generated locally by the qrcode package from our own URL (still /j/<jobsheetNo>). */}
          <div className="jsp-qr-code" dangerouslySetInnerHTML={{ __html: qrSvg }} />
          <div className="jsp-qr-cap">Scan · {jobsheetRefShort(js.orderNo, js.jobsheetNo).slice(1)}</div>
        </div>
      )}

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
              {/* The assigned looms as a hint; the box stays empty for the loom actually used (written by hand). */}
              <span className="jsp-assigned">{js.machineNos.length ? `Assigned: ${js.machineNos.join(', ')}` : ' '}</span>
              <div className="jsp-vbox jsp-val" />
            </div>
            <div className="jsp-idrow">
              <span className="jsp-lbl">Design no:</span>
              <div className="jsp-vbox jsp-val">{js.designCode ?? ''}</div>
              <span className="jsp-otype">{ORDER_TYPE_LABEL[js.orderType]}</span>
              {js.blouseOption && <span className="jsp-blouse">{BLOUSE_PRINT_LABEL[js.blouseOption]}</span>}
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


/** Makes sure Noto Sans Devanagari (for ॥ श्री गणेशाय नमः ॥; also loaded globally) is ready before printing. */
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

/** QR codes (SVG markup) per jobsheet number, error correction M with a 2-module quiet zone. */
function useQrCodes(items: JobsheetPrintItem[] | undefined) {
  const [codes, setCodes] = useState<Map<number, string> | null>(null);
  useEffect(() => {
    if (!items) return;
    let cancelled = false;
    const base = qrBaseUrl();
    Promise.all(
      items.map(async (js) => {
        const svg = await QRCode.toString(jobsheetQrUrl(base, js.jobsheetNo), { type: 'svg', errorCorrectionLevel: 'M', margin: 2 });
        return [js.jobsheetNo, svg] as const;
      }),
    ).then(
      (list) => !cancelled && setCodes(new Map(list)),
      // Never block printing: pages print without a QR if generation fails.
      () => !cancelled && setCodes(new Map()),
    );
    return () => {
      cancelled = true;
    };
  }, [items]);
  return codes;
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
  const { config: { landing } } = useRole();
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
  const qrCodes = useQrCodes(data);
  const { ref, scale } = usePageScale();

  usePageTitle(
    data
      ? data.length === 1
        ? `Print jobsheet ${jobsheetRefShort(data[0].orderNo, data[0].jobsheetNo)}`
        : `Print ${data.length} jobsheets`
      : 'Print jobsheets',
  );

  // Print waits only for the font and the QR codes (one page per jobsheet, no images).
  const ready = !!data && fontReady && !!qrCodes;
  const pageCount = data?.length ?? 0;

  const goBack = () => {
    if (location.key !== 'default') navigate(-1);
    else navigate(landing);
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
            <X /> Close
          </Button>
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-600">
            {data
              ? `${data.length} jobsheet${data.length === 1 ? '' : 's'} · ${pageCount} A4 page${pageCount === 1 ? '' : 's'}`
              : 'Jobsheets'}
          </p>
          <Button onClick={() => window.print()} disabled={!ready}>
            {ready ? <Printer /> : <Loader2 className="animate-spin" />}
            {ready ? 'Print' : 'Preparing…'}
          </Button>
        </div>
      </header>
      {!PUBLIC_APP_URL && data && (
        <div className="jsp-toolbar border-b border-amber-200 bg-amber-50 px-3 py-2.5 text-amber-900 md:px-4" role="status">
          <p className="mx-auto flex max-w-4xl items-start gap-2 text-sm font-medium">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
            <span>
              QR codes will point to <strong className="break-all">{window.location.origin}</strong>. Set VITE_PUBLIC_APP_URL to the live
              website address before printing jobsheets for the floor.
            </span>
          </p>
        </div>
      )}

      <div className="jsp-pad px-3 py-4 md:px-6 md:py-6">
        {ids.length === 0 ? (
          <div className="mx-auto max-w-md rounded-xl bg-white p-8 text-center shadow-soft">
            <p className="font-semibold text-slate-900">Nothing to print</p>
            <Button asChild variant="secondary" className="mt-4">
              <Link to={landing}>Go back</Link>
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
                {data.map((js) => (
                  <div key={js.id} className="jsp-page">
                    <FrontPage js={js} qrSvg={qrCodes?.get(js.jobsheetNo)} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
