import { ArrowLeft, Ban, Loader2, Printer, X } from 'lucide-react';
import { useLayoutEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  CHALLAN_GROUPS,
  CHALLAN_PAPER,
  CHALLAN_ROWS_PER_GROUP,
  challanLabel,
  challanTotals,
  COMPANY,
  formatChallanDate,
  formatChallanRowMeters,
  formatChallanTotalMeters,
  paginateChallanTakas,
  type ChallanKind,
  type ChallanPrintData,
  type ChallanPrintPage,
} from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { useRole } from '@/hooks/useRole';
import { ApiError } from '@/lib/api';
import { useChallanPrint } from './api';
import { sentListPath } from './kind';

/*
 * Challan print layout — A4 landscape (paper size + orientation: CHALLAN_PAPER in shared/butta.ts).
 * 281 × 194 mm of content per page with 8 mm margins. Black on white, thin borders, bold sans.
 * Everything is scoped under .chp and injected only while this route is mounted.
 */
const MARGIN_MM = 8;
const PAGE_W_MM = 297;
const PAGE_H_MM = 210;
const MM_TO_PX = 96 / 25.4;
const SCREEN_GAP_PX = 16;

const CSS = `
@page { size: ${CHALLAN_PAPER.size} ${CHALLAN_PAPER.orientation}; margin: ${MARGIN_MM}mm; }
.chp { --ink: #000; color: var(--ink); font-family: 'DM Sans', system-ui, sans-serif; }
.chp * { box-sizing: border-box; }
.chp-page { width: ${PAGE_W_MM}mm; height: ${PAGE_H_MM}mm; padding: ${MARGIN_MM}mm; background: #fff; overflow: hidden;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.chp-sheet { position: relative; display: flex; flex-direction: column; width: ${PAGE_W_MM - 2 * MARGIN_MM}mm; height: ${PAGE_H_MM - 2 * MARGIN_MM}mm;
  border: 1.5px solid var(--ink); font-weight: 700; }
.chp-row { border-bottom: 1.2px solid var(--ink); }

.chp-top { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; padding: 1.5mm 3mm; gap: 3mm; }
.chp-gst { font-size: 11pt; }
.chp-name { font-size: 25pt; font-weight: 800; letter-spacing: 0.02em; text-align: center; line-height: 1.05; white-space: nowrap; }
.chp-mo { font-size: 11pt; text-align: right; line-height: 1.25; }
.chp-addr { text-align: center; font-size: 9pt; padding: 1mm 3mm; line-height: 1.25; }
.chp-title { position: relative; text-align: center; font-size: 12.5pt; padding: 1mm 3mm; letter-spacing: 0.04em; }
.chp-page-no { position: absolute; right: 3mm; top: 50%; transform: translateY(-50%); font-size: 7.5pt; font-weight: 600; letter-spacing: 0; }

.chp-party { display: grid; grid-template-columns: 1fr 64mm; }
.chp-pl { padding: 2mm 3mm; font-size: 11pt; line-height: 1.3; border-right: 1.2px solid var(--ink); min-height: 24mm; }
.chp-pl .chp-ms { font-size: 13.5pt; text-transform: uppercase; }
.chp-pl p { margin: 0; }
.chp-pr { display: flex; flex-direction: column; }
.chp-prr { flex: 1; display: grid; grid-template-columns: 22mm 1fr; align-items: center; border-bottom: 1.2px solid var(--ink); font-size: 10.5pt; }
.chp-prr:last-child { border-bottom: 0; }
.chp-prr > span { white-space: nowrap; padding: 0 2.5mm; height: 100%; display: flex; align-items: center; }
.chp-prr > span:last-child { border-left: 1.2px solid var(--ink); }
.chp-prr .chp-chno { background: #d9d9d9; font-size: 15pt; font-weight: 800; justify-content: center; }
.chp-quality { padding: 1.2mm 3mm; font-size: 11pt; }

.chp-tablewrap { border-bottom: 1.2px solid var(--ink); }
.chp-spacer { flex: 1; }
.chp-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.chp-table tr { height: 7.2mm; }
.chp-table th, .chp-table td { border: 1px solid var(--ink); padding: 0 1.5mm; font-size: 10pt; line-height: 1; overflow: hidden; white-space: nowrap; }
.chp-table th { font-size: 9.5pt; text-align: center; }
.chp-table td.no { text-align: center; font-weight: 600; }
.chp-table td.tk { text-align: center; font-weight: 700; font-size: 10.5pt; }
.chp-table td.mt { text-align: right; font-weight: 600; }
.chp-table td.gl, .chp-table th.gl { border-left: 1.8px solid var(--ink); }
.chp-table tr.sub td { font-weight: 800; }

.chp-totals { display: grid; grid-template-columns: 1fr 1fr 1fr; align-items: center; padding: 1.6mm 3mm; font-size: 12pt; }
.chp-totals > :last-child { text-align: right; }
.chp-totals > :nth-child(2) { text-align: center; }
.chp-bottom { display: grid; grid-template-columns: 1fr 1.4fr 1fr; align-items: end; padding: 0 3mm 1.6mm; height: 13mm; font-size: 9.5pt; }
.chp-bottom > :nth-child(2) { text-align: center; font-size: 8.5pt; font-weight: 600; }
.chp-bottom > :last-child { text-align: right; }

@media screen {
  .chp-page { box-shadow: 0 1px 3px rgb(15 23 42 / 0.12), 0 8px 24px rgb(15 23 42 / 0.08); }
}
@media print {
  html, body { background: #fff !important; }
  .chp-toolbar { display: none !important; }
  .chp-screen { background: #fff !important; padding: 0 !important; }
  .chp-scale { transform: none !important; height: auto !important; width: auto !important; }
  .chp-pages { gap: 0 !important; }
  .chp-pad { padding: 0 !important; }
  .chp-fit { max-width: none !important; overflow: visible !important; }
  /* 1 mm of slack so rounding never spills onto an extra sheet. */
  .chp-page { width: ${PAGE_W_MM - 2 * MARGIN_MM}mm; height: ${PAGE_H_MM - 2 * MARGIN_MM - 1}mm; padding: 0; box-shadow: none; break-after: page; page-break-after: always; }
  .chp-sheet { height: ${PAGE_H_MM - 2 * MARGIN_MM - 1}mm; }
  .chp-page:last-child { break-after: auto; page-break-after: auto; }
}
`;

/** The party's address as printed lines. */
const addressLines = (address: string | null) => (address ? address.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : []);

/** One challan page: header, party / challan box, quality, 4 × 12 taka grid. Totals + signatures on the last page only. */
function ChallanSheet({ data, page, total }: { data: ChallanPrintData; page: ChallanPrintPage; total: { count: number; meters: number } }) {
  const rows = Array.from({ length: CHALLAN_ROWS_PER_GROUP }, (_, r) => r);
  const groups = Array.from({ length: CHALLAN_GROUPS }, (_, g) => g);
  const address = addressLines(data.party.address);
  return (
    <div className="chp-sheet">
      <div className="chp-top chp-row">
        <div className="chp-gst">GSTIN :{COMPANY.gstin}</div>
        <div className="chp-name">{COMPANY.name}</div>
        <div className="chp-mo">
          <div>Mo: {COMPANY.mobiles[0]}</div>
          <div>{COMPANY.mobiles[1]}</div>
        </div>
      </div>
      <div className="chp-addr chp-row">{COMPANY.address}</div>
      <div className="chp-title chp-row">
        !! DELIVERY CHALLAN !!
        {page.pages > 1 && (
          <span className="chp-page-no">
            Page {page.page} of {page.pages}
          </span>
        )}
      </div>
      <div className="chp-party chp-row">
        <div className="chp-pl">
          <p className="chp-ms">M/s. {data.party.name}</p>
          {address.map((l, i) => (
            <p key={i}>{l}</p>
          ))}
          {data.party.mobile && <p>Mo : {data.party.mobile}</p>}
          {data.party.gstin && <p>GSTIN : {data.party.gstin}</p>}
        </div>
        <div className="chp-pr">
          <div className="chp-prr">
            <span>Ch. No</span>
            <span className="chp-chno">{challanLabel(data.challanNo, data.kind)}</span>
          </div>
          <div className="chp-prr">
            <span>Date</span>
            <span>{formatChallanDate(data.challanDate)}</span>
          </div>
          <div className="chp-prr">
            <span>Eway No :</span>
            <span>{data.ewayNo ?? ''}</span>
          </div>
        </div>
      </div>
      <div className="chp-quality chp-row">Quality Name : {data.qualities.join(', ')}</div>
      <div className="chp-tablewrap">
        <table className="chp-table">
          <colgroup>
            {groups.map((g) => (
              <FragmentCols key={g} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {groups.map((g) => (
                <GroupHead key={g} first={g === 0} />
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r}>
                {groups.map((g) => {
                  const cell = page.groups[g].rows[r];
                  return (
                    <GroupCells key={g} first={g === 0} no={cell?.no} takaNo={cell?.takaNo} meters={cell ? formatChallanRowMeters(cell.meters) : ''} />
                  );
                })}
              </tr>
            ))}
            <tr className="sub">
              {groups.map((g) => {
                const sub = page.groups[g].subtotal;
                return (
                  <GroupSubtotal key={g} first={g === 0} value={sub === null ? '' : formatChallanRowMeters(sub)} />
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="chp-spacer" />
      {page.isLast ? (
        <>
          <div className="chp-totals chp-row">
            <div>Total Taka : {total.count}</div>
            <div>Total Mtrs : {formatChallanTotalMeters(total.meters)}</div>
            <div>For, {COMPANY.name}</div>
          </div>
          <div className="chp-bottom">
            <div>Receiver's Signature</div>
            <div>Subject to {COMPANY.jurisdiction} Jurisdiction Only. E&amp; O.E.</div>
            <div>Authorised Signatory</div>
          </div>
        </>
      ) : null}
    </div>
  );
}

// The three columns of one group: NO | Taka No | MTRS.
function FragmentCols() {
  return (
    <>
      <col style={{ width: '5%' }} />
      <col style={{ width: '12%' }} />
      <col style={{ width: '8%' }} />
    </>
  );
}
function GroupHead({ first }: { first: boolean }) {
  return (
    <>
      <th className={first ? '' : 'gl'}>NO</th>
      <th>Taka No</th>
      <th>MTRS.</th>
    </>
  );
}
function GroupCells({ first, no, takaNo, meters }: { first: boolean; no?: number; takaNo?: string; meters: string }) {
  return (
    <>
      <td className={`no ${first ? '' : 'gl'}`}>{no ?? ''}</td>
      <td className="tk">{takaNo ?? ''}</td>
      <td className="mt">{meters}</td>
    </>
  );
}
function GroupSubtotal({ first, value }: { first: boolean; value: string }) {
  return (
    <>
      <td colSpan={2} className={`no ${first ? '' : 'gl'}`} />
      <td className="mt">{value}</td>
    </>
  );
}

/** Scales the 297 mm pages down to fit narrow screens (phones, tablets). */
function usePageScale() {
  const [el, ref] = useState<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    if (!el) return;
    const update = () => setScale(Math.min(1, el.clientWidth / (PAGE_W_MM * MM_TO_PX)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return { ref, scale };
}

/**
 * `/print/challan/:id` (butta) and `/print/mill-challan/:id` (mill) — the SAME layout, only the number and party differ. Screen preview + sticky Back / Print toolbar (hidden when printing). A4 landscape, 48 takas
 * per page (4 groups × 12 rows, filled column by column); more takas continue on further pages. The meters are the
 * ones at the time of sending, so the print never changes after QC edits. `?preview=1` = right after creating it.
 */
export default function ChallanPrintPage({ kind }: { kind: ChallanKind }) {
  const id = Number(useParams().id);
  const [params] = useSearchParams();
  const preview = params.get('preview') === '1';
  const navigate = useNavigate();
  const location = useLocation();
  const { config } = useRole();
  const { data, isPending, isError, error, refetch } = useChallanPrint(kind, id);
  const { ref, scale } = usePageScale();
  usePageTitle(data ? `Print challan ${challanLabel(data.challanNo, kind)}` : 'Print challan');

  const pages = useMemo(() => (data ? paginateChallanTakas(data.takas) : []), [data]);
  const totals = useMemo(() => (data ? challanTotals(data.takas) : { count: 0, meters: 0 }), [data]);
  const pagePxW = PAGE_W_MM * MM_TO_PX;
  const pagePxH = PAGE_H_MM * MM_TO_PX;

  const goBack = () => {
    if (preview) navigate(sentListPath(kind), { replace: true });
    else if (location.key !== 'default') navigate(-1);
    else navigate(config.landing);
  };

  return (
    <div className="chp chp-screen min-h-[100dvh] bg-slate-200/70">
      <style>{CSS}</style>
      <header className="chp-toolbar sticky top-0 z-30 border-b border-border bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-2 md:h-16 md:px-4">
          <Button variant="ghost" size="sm" onClick={goBack}>
            {preview ? <X /> : <ArrowLeft />} {preview ? 'Close' : 'Back'}
          </Button>
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-600">
            {data
              ? `${challanLabel(data.challanNo, kind)} · ${totals.count} ${totals.count === 1 ? 'taka' : 'takas'} · ${pages.length} A4 page${pages.length === 1 ? '' : 's'}`
              : 'Challan'}
            {data?.status === 'cancelled' && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-bold text-slate-600">
                <Ban className="size-3" aria-hidden /> Cancelled
              </span>
            )}
          </p>
          <Button onClick={() => window.print()} disabled={!data}>
            {data ? <Printer /> : <Loader2 className="animate-spin" />}
            Print
          </Button>
        </div>
      </header>

      <div className="chp-pad px-3 py-4 md:px-6 md:py-6">
        {isPending ? (
          <div className="flex justify-center py-20 text-slate-500">
            <Loader2 className="size-6 animate-spin" aria-label="Loading" />
          </div>
        ) : isError || !data ? (
          <div className="mx-auto max-w-md rounded-xl bg-white shadow-soft">
            {error instanceof ApiError && error.status === 404 ? (
              <div className="p-8 text-center">
                <p className="font-semibold text-slate-900">Challan not found</p>
                <Button asChild variant="secondary" className="mt-4">
                  <Link to={config.landing}>Go back</Link>
                </Button>
              </div>
            ) : (
              <ErrorState error={error} onRetry={() => void refetch()} />
            )}
          </div>
        ) : (
          <div ref={ref} className="chp-fit mx-auto w-full max-w-[297mm] overflow-hidden">
            <div
              className="chp-scale origin-top-left"
              style={{
                transform: scale < 1 ? `scale(${scale})` : undefined,
                width: pagePxW,
                height: scale < 1 ? pages.length * (pagePxH + SCREEN_GAP_PX) * scale : undefined,
              }}
            >
              <div className="chp-pages flex flex-col" style={{ gap: SCREEN_GAP_PX }}>
                {pages.map((p) => (
                  <div key={p.page} className="chp-page">
                    <ChallanSheet data={data} page={p} total={totals} />
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
