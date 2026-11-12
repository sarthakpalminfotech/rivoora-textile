import { Loader2, Printer, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { formatKgNumber, fyShort, type YarnBoxSticker } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { useRole } from '@/hooks/useRole';
import { formatDate } from '@/lib/format';
import { useBoxStickers, useYarnBox } from './api';

/*
 * Sprint 24 (CR-18) — box stickers for TFO / Palti / remaining boxes (`/print/yarn-boxes?ids=1,2&size=label|a4`).
 * - `label` (default): 50 × 25 mm thermal labels, one sticker per page.
 * - `a4`: a fallback sheet of 3 × 8 labels (70 × 37.125 mm cells) per A4 page.
 * Content: box no. with the FY in brackets ("15 (26-27)") big and bold, quality, lot, gross / net kg, rolls, date, program
 * ("P-12") or "Palti", and a QR code that opens the box in its zone's stock screen (`/yarn/box/<id>`). The CSS is injected
 * only while this route is mounted (like the jobsheet print).
 */

const PUBLIC_APP_URL = String(import.meta.env.VITE_PUBLIC_APP_URL ?? '').trim();
const qrBase = () => PUBLIC_APP_URL || window.location.origin;
const PER_SHEET = 24;

type Size = 'label' | 'a4';

const CSS = (size: Size) => `
@page { size: ${size === 'label' ? '50mm 25mm' : 'A4 portrait'}; margin: 0; }
.ybs { color: #000; font-family: 'DM Sans', system-ui, sans-serif; }
.ybs * { box-sizing: border-box; }
.ybs-pages { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.ybs-label { width: 50mm; height: 25mm; padding: 1.2mm 1.5mm; background: #fff; overflow: hidden; display: grid;
  grid-template-columns: 1fr 15mm; gap: 1mm; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.ybs-sheet { width: 210mm; height: 297mm; background: #fff; display: grid; grid-template-columns: repeat(3, 70mm);
  grid-template-rows: repeat(8, 37.125mm); }
.ybs-cell { padding: 2.5mm 3mm; overflow: hidden; display: grid; grid-template-columns: 1fr 21mm; gap: 1.5mm; border: 0.2mm dashed #cbd5e1; }
.ybs-no { font-weight: 800; line-height: 1; letter-spacing: 0.01em; white-space: nowrap; }
.ybs-label .ybs-no { font-size: 15pt; }
.ybs-cell .ybs-no { font-size: 20pt; }
.ybs-fy { font-weight: 700; }
.ybs-label .ybs-fy { font-size: 8pt; }
.ybs-cell .ybs-fy { font-size: 11pt; }
.ybs-q { font-weight: 700; line-height: 1.1; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.ybs-label .ybs-q { font-size: 6pt; margin-top: 0.6mm; }
.ybs-cell .ybs-q { font-size: 8.5pt; margin-top: 1mm; }
.ybs-kg { font-weight: 800; white-space: nowrap; }
.ybs-label .ybs-kg { font-size: 7.5pt; margin-top: 0.5mm; }
.ybs-cell .ybs-kg { font-size: 10.5pt; margin-top: 1mm; }
.ybs-meta { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ybs-label .ybs-meta { font-size: 5.5pt; }
.ybs-cell .ybs-meta { font-size: 7.5pt; }
.ybs-qr { display: flex; flex-direction: column; align-items: center; justify-content: center; }
.ybs-qr svg { display: block; width: 100%; height: auto; }
@media screen {
  .ybs-label, .ybs-sheet { box-shadow: 0 1px 3px rgb(15 23 42 / 0.15), 0 6px 18px rgb(15 23 42 / 0.08); }
  .ybs-label { transform: scale(1.6); transform-origin: top center; margin-bottom: calc(25mm * 0.6); }
}
@media print {
  html, body { background: #fff !important; }
  .ybs-toolbar { display: none !important; }
  .ybs-screen { background: #fff !important; padding: 0 !important; }
  .ybs-pages { gap: 0 !important; display: block !important; }
  .ybs-label, .ybs-sheet { box-shadow: none; break-after: page; page-break-after: always; transform: none; margin: 0; }
  .ybs-cell { border: none; }
}
`;

function Sticker({ s, qr, cls }: { s: YarnBoxSticker; qr: string | undefined; cls: string }) {
  return (
    <div className={cls}>
      <div className="min-w-0">
        <p className="ybs-no">
          {s.boxNo} <span className="ybs-fy">({fyShort(s.fy)})</span>
        </p>
        <p className="ybs-q">{s.quality}</p>
        <p className="ybs-kg">
          G {formatKgNumber(s.grossG)} · N {formatKgNumber(s.netG)} kg
        </p>
        <p className="ybs-meta">
          {s.lot ? `Lot ${s.lot} · ` : ''}
          {s.rolls ? `${s.rolls} rolls · ` : ''}
          {formatDate(s.date)}
        </p>
        <p className="ybs-meta" style={{ fontWeight: 700 }}>
          {s.source}
        </p>
      </div>
      {/* SVG generated locally by the qrcode package from our own URL. */}
      <div className="ybs-qr" dangerouslySetInnerHTML={{ __html: qr ?? '' }} />
    </div>
  );
}

export default function BoxStickerPrintPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { config } = useRole();
  const ids = useMemo(
    () =>
      (params.get('ids') ?? '')
        .split(',')
        .map(Number)
        .filter((n) => Number.isInteger(n) && n > 0),
    [params],
  );
  const size: Size = params.get('size') === 'a4' ? 'a4' : 'label';
  const { data, isPending, isError, error, refetch } = useBoxStickers(ids);
  const [qrs, setQrs] = useState<Map<number, string> | null>(null);
  usePageTitle(data ? `Print ${data.length} box sticker${data.length === 1 ? '' : 's'}` : 'Box stickers');
  useEffect(() => {
    if (!data) return;
    let alive = true;
    void Promise.all(data.map(async (s) => [s.id, await QRCode.toString(`${qrBase()}/yarn/box/${s.id}`, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 })] as const)).then(
      (pairs) => alive && setQrs(new Map(pairs)),
    );
    return () => {
      alive = false;
    };
  }, [data]);
  const ready = !!data && !!qrs;
  const goBack = () => (location.key !== 'default' ? navigate(-1) : navigate(config.landing));
  const sheets = data ? Array.from({ length: Math.ceil(data.length / PER_SHEET) }, (_, i) => data.slice(i * PER_SHEET, (i + 1) * PER_SHEET)) : [];

  return (
    <div className="ybs ybs-screen min-h-[100dvh] bg-slate-200/70">
      <style>{CSS(size)}</style>
      <header className="ybs-toolbar sticky top-0 z-30 border-b border-border bg-white/95 backdrop-blur">
        <div className="mx-auto flex min-h-14 max-w-4xl flex-wrap items-center gap-2 px-2 py-2 md:px-4">
          <Button variant="ghost" size="sm" onClick={goBack}>
            <X /> Close
          </Button>
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-600">
            {data ? `${data.length} sticker${data.length === 1 ? '' : 's'} · ${size === 'label' ? `${data.length} label${data.length === 1 ? '' : 's'} 50 × 25 mm` : `${sheets.length} A4 sheet${sheets.length === 1 ? '' : 's'}`}` : 'Box stickers'}
          </p>
          <Segmented
            value={size}
            onChange={(v) =>
              setParams(
                (p) => {
                  const n = new URLSearchParams(p);
                  if (v === 'label') n.delete('size');
                  else n.set('size', v);
                  return n;
                },
                { replace: true },
              )
            }
            options={[
              { value: 'label', label: '50 × 25 mm' },
              { value: 'a4', label: 'A4 sheet' },
            ]}
            aria-label="Sticker size"
            className="order-last w-full sm:order-none sm:w-auto sm:min-w-[14rem]"
          />
          <Button onClick={() => window.print()} disabled={!ready}>
            {ready ? <Printer /> : <Loader2 className="animate-spin" />}
            {ready ? 'Print' : 'Preparing…'}
          </Button>
        </div>
      </header>
      <div className="px-3 py-6 md:px-6">
        {ids.length === 0 ? (
          <p className="mx-auto max-w-md rounded-xl bg-white p-8 text-center font-semibold text-slate-900 shadow-soft">Nothing to print</p>
        ) : isPending ? (
          <Skeleton className="mx-auto h-40 max-w-md rounded-xl" />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : (
          <div className="ybs-pages overflow-x-auto">
            {size === 'label'
              ? data.map((s) => <Sticker key={s.id} s={s} qr={qrs?.get(s.id)} cls="ybs-label" />)
              : sheets.map((sheet, i) => (
                  <div key={i} className="ybs-sheet">
                    {sheet.map((s) => (
                      <Sticker key={s.id} s={s} qr={qrs?.get(s.id)} cls="ybs-cell" />
                    ))}
                  </div>
                ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** `/yarn/box/:id` — the sticker QR target: opens the box in its zone's stock screen (searched by its number). */
export function YarnBoxRedirectPage() {
  const id = Number(useParams().id);
  const { data, isError, error, refetch } = useYarnBox(Number.isInteger(id) ? id : 0);
  usePageTitle('Box');
  if (data) return <Navigate to={`/yarn/${data.zone}/stock?type=twisted&q=${encodeURIComponent(`box ${data.boxNo}`)}`} replace />;
  return <div className="page-container pt-5">{isError ? <ErrorState error={error} onRetry={() => void refetch()} /> : <Skeleton className="h-24 w-full rounded-2xl" />}</div>;
}
