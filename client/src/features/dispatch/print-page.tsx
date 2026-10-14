import { ArrowLeft, Loader2, Printer, X } from 'lucide-react';
import { useLayoutEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  CHALLAN_GROUPS,
  CHALLAN_PAPER,
  CHALLAN_ROWS_PER_GROUP,
  COMPANY,
  dispatchTotals,
  formatChallanDate,
  formatChallanRowMeters,
  formatChallanTotalMeters,
  paginateChallanTakas,
  type ChallanPrintPage,
  type DispatchChallanDetail,
} from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { useRole } from '@/hooks/useRole';
import { ApiError } from '@/lib/api';
import { useDispatchChallan } from './api';

/*
 * Dispatch (delivery) challan print — A4 landscape, the same engine and look as the GSM / MIL challans, for the CLIENT.
 * Lump orders: 4 groups × 12 rows of NO | Taka No | MTRS | PCS (multi-page). Pcs-to-pcs orders: no taka numbers, a
 * simple Sr | Quality | Design | Pcs table. No rate or amount. Everything is scoped under .chp.
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
.chp-page { position: relative; width: ${PAGE_W_MM}mm; height: ${PAGE_H_MM}mm; padding: ${MARGIN_MM}mm; background: #fff; overflow: hidden;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.chp-sheet { position: relative; display: flex; flex-direction: column; width: ${PAGE_W_MM - 2 * MARGIN_MM}mm; height: ${PAGE_H_MM - 2 * MARGIN_MM}mm;
  border: 1.5px solid var(--ink); font-weight: 700; }
.chp-row { border-bottom: 1.2px solid var(--ink); }
.chp-watermark { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; z-index: 2;
  font-size: 110pt; font-weight: 800; letter-spacing: 0.08em; color: rgb(0 0 0 / 0.07); transform: rotate(-24deg); }

.chp-top { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; padding: 1.5mm 3mm; gap: 3mm; }
.chp-gst { font-size: 11pt; }
.chp-name { font-size: 25pt; font-weight: 800; letter-spacing: 0.02em; text-align: center; line-height: 1.05; white-space: nowrap; }
.chp-mo { font-size: 11pt; text-align: right; line-height: 1.25; }
.chp-addr { text-align: center; font-size: 9pt; padding: 1mm 3mm; line-height: 1.25; }
.chp-title { position: relative; text-align: center; font-size: 12.5pt; padding: 1mm 3mm; letter-spacing: 0.04em; }
.chp-page-no { position: absolute; right: 3mm; top: 50%; transform: translateY(-50%); font-size: 7.5pt; font-weight: 600; letter-spacing: 0; }

.chp-party { display: grid; grid-template-columns: 1fr 70mm; }
.chp-pl { padding: 2mm 3mm; font-size: 11pt; line-height: 1.3; border-right: 1.2px solid var(--ink); min-height: 30mm; }
.chp-pl .chp-ms { font-size: 13.5pt; text-transform: uppercase; }
.chp-pl p { margin: 0; }
.chp-pr { display: flex; flex-direction: column; }
.chp-prr { flex: 1; display: grid; grid-template-columns: 24mm 1fr; align-items: center; border-bottom: 1.2px solid var(--ink); font-size: 10.5pt; }
.chp-prr:last-child { border-bottom: 0; }
.chp-prr > span { white-space: nowrap; padding: 0 2.5mm; height: 100%; display: flex; align-items: center; }
.chp-prr > span:last-child { border-left: 1.2px solid var(--ink); }
.chp-prr .chp-chno { background: #d9d9d9; font-size: 15pt; font-weight: 800; justify-content: center; }
.chp-rev { font-size: 7.5pt; font-weight: 600; line-height: 1.2; padding: 0.6mm 2.5mm; border-bottom: 1.2px solid var(--ink); }
.chp-quality { display: flex; gap: 10mm; padding: 1.2mm 3mm; font-size: 11pt; }

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
.chp-lines td, .chp-lines th { font-size: 11pt; }
.chp-lines td.tx { text-align: left; }

.chp-totals { display: grid; grid-template-columns: 1fr 1fr 1fr; align-items: center; padding: 1.6mm 3mm; font-size: 12pt; }
.chp-totals > :last-child { text-align: right; }
.chp-totals > :nth-child(2) { text-align: center; }
.chp-for { text-align: right; padding: 1mm 3mm 0; font-size: 11pt; }
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
  .chp-page { width: ${PAGE_W_MM - 2 * MARGIN_MM}mm; height: ${PAGE_H_MM - 2 * MARGIN_MM - 1}mm; padding: 0; box-shadow: none; break-after: page; page-break-after: always; }
  .chp-sheet { height: ${PAGE_H_MM - 2 * MARGIN_MM - 1}mm; }
  .chp-page:last-child { break-after: auto; page-break-after: auto; }
}
`;

const addressLines = (address: string | null) => (address ? address.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : []);

type PcsOf = Map<string, number | null>;

/** The common top of every sheet: company header, party + challan box, quality + design. */
function SheetTop({ data, pageLabel }: { data: DispatchChallanDetail; pageLabel: string | null }) {
  const address = addressLines(data.customer.address);
  return (
    <>
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
        {pageLabel && <span className="chp-page-no">{pageLabel}</span>}
      </div>
      <div className="chp-party chp-row">
        <div className="chp-pl">
          <p className="chp-ms">M/s. {data.customer.name}</p>
          {address.map((l, i) => (
            <p key={i}>{l}</p>
          ))}
          {data.customer.phone && <p>Mo : {data.customer.phone}</p>}
          {data.customer.gstin && <p>GSTIN : {data.customer.gstin}</p>}
          {data.brokerName && <p>Broker : {data.brokerName}</p>}
        </div>
        <div className="chp-pr">
          <div className="chp-prr">
            <span>Ch. No</span>
            <span className="chp-chno">{data.label}</span>
          </div>
          {data.replacesLabel && (
            <div className="chp-rev">
              Revision {data.revision} · replaces {data.replacesLabel}
            </div>
          )}
          <div className="chp-prr">
            <span>Date</span>
            <span>{formatChallanDate(data.challanDate)}</span>
          </div>
          <div className="chp-prr">
            <span>Eway No :</span>
            <span>{data.ewayNo ?? ''}</span>
          </div>
          <div className="chp-prr">
            <span>Transport</span>
            <span>{data.transport ?? ''}</span>
          </div>
          <div className="chp-prr">
            <span>LR No :</span>
            <span>{data.lrNo ?? ''}</span>
          </div>
        </div>
      </div>
      <div className="chp-quality chp-row">
        <span>Quality Name : {data.order.quality ?? ''}</span>
        <span>Design : {data.order.designCode ?? ''}</span>
      </div>
    </>
  );
}

function SheetBottom({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="chp-spacer" />
      {children}
      <div className="chp-for">For, {COMPANY.name}</div>
      <div className="chp-bottom">
        <div>Receiver&apos;s Signature</div>
        <div>Subject to {COMPANY.jurisdiction} Jurisdiction Only. E&amp; O.E.</div>
        <div>Authorised Signatory</div>
      </div>
    </>
  );
}

/** Lump order: one page of the taka grid. Totals + signatures on the last page only. */
function LumpSheet({ data, page, pcsOf, totals }: { data: DispatchChallanDetail; page: ChallanPrintPage; pcsOf: PcsOf; totals: { takas: number; pcs: number; meters: number } }) {
  const rows = Array.from({ length: CHALLAN_ROWS_PER_GROUP }, (_, r) => r);
  const groups = Array.from({ length: CHALLAN_GROUPS }, (_, g) => g);
  const groupPcs = groups.map((g) => page.groups[g].rows.reduce((n, c) => n + (c ? pcsOf.get(c.takaNo) ?? 0 : 0), 0));
  return (
    <div className="chp-sheet">
      <SheetTop data={data} pageLabel={page.pages > 1 ? `Page ${page.page} of ${page.pages}` : null} />
      <div className="chp-tablewrap">
        <table className="chp-table">
          <colgroup>
            {groups.map((g) => (
              <ColSet key={g} />
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
                  return <GroupCells key={g} first={g === 0} no={cell?.no} takaNo={cell?.takaNo} meters={cell ? formatChallanRowMeters(cell.meters) : ''} pcs={cell ? pcsOf.get(cell.takaNo) ?? null : null} />;
                })}
              </tr>
            ))}
            <tr className="sub">
              {groups.map((g) => {
                const sub = page.groups[g].subtotal;
                return <GroupSubtotal key={g} first={g === 0} meters={sub === null ? '' : formatChallanRowMeters(sub)} pcs={sub === null ? '' : String(groupPcs[g])} />;
              })}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="chp-spacer" />
      {page.isLast ? (
        <SheetBottom>
          <div className="chp-totals chp-row" style={{ borderTop: '1.2px solid #000' }}>
            <div>Total Taka : {totals.takas}</div>
            <div>Total Mtrs : {formatChallanTotalMeters(totals.meters)}</div>
            <div>Total Pcs : {totals.pcs}</div>
          </div>
        </SheetBottom>
      ) : null}
    </div>
  );
}

// The four columns of one group: NO | Taka No | MTRS | PCS.
function ColSet() {
  return (
    <>
      <col style={{ width: '4%' }} />
      <col style={{ width: '9%' }} />
      <col style={{ width: '8%' }} />
      <col style={{ width: '4%' }} />
    </>
  );
}
function GroupHead({ first }: { first: boolean }) {
  return (
    <>
      <th className={first ? '' : 'gl'}>NO</th>
      <th>Taka No</th>
      <th>MTRS.</th>
      <th>PCS</th>
    </>
  );
}
function GroupCells({ first, no, takaNo, meters, pcs }: { first: boolean; no?: number; takaNo?: string; meters: string; pcs: number | null }) {
  return (
    <>
      <td className={`no ${first ? '' : 'gl'}`}>{no ?? ''}</td>
      <td className="tk">{takaNo ?? ''}</td>
      <td className="mt">{meters}</td>
      <td className="mt">{pcs ?? ''}</td>
    </>
  );
}
function GroupSubtotal({ first, meters, pcs }: { first: boolean; meters: string; pcs: string }) {
  return (
    <>
      <td colSpan={2} className={`no ${first ? '' : 'gl'}`} />
      <td className="mt">{meters}</td>
      <td className="mt">{pcs}</td>
    </>
  );
}

/** Pcs-to-pcs order: no taka numbers — Sr | Quality | Design | Pcs and the total pcs. */
function PcsSheet({ data }: { data: DispatchChallanDetail }) {
  const filler = Math.max(0, 8 - data.lines.length);
  return (
    <div className="chp-sheet">
      <SheetTop data={data} pageLabel={null} />
      <div className="chp-tablewrap">
        <table className="chp-table chp-lines">
          <colgroup>
            <col style={{ width: '8%' }} />
            <col style={{ width: '38%' }} />
            <col style={{ width: '38%' }} />
            <col style={{ width: '16%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>Sr</th>
              <th>Quality</th>
              <th>Design</th>
              <th>Pcs</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((l, i) => (
              <tr key={i}>
                <td className="no">{i + 1}</td>
                <td className="tx">{l.quality}</td>
                <td className="tx">{l.design}</td>
                <td className="mt">{l.pcs}</td>
              </tr>
            ))}
            {Array.from({ length: filler }, (_, i) => (
              <tr key={`f${i}`}>
                <td />
                <td />
                <td />
                <td />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <SheetBottom>
        <div className="chp-totals chp-row" style={{ borderTop: '1.2px solid #000' }}>
          <div />
          <div />
          <div>Total Pcs : {data.totals.pcs}</div>
        </div>
      </SheetBottom>
    </div>
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
 * `/print/dispatch-challan/:id` — the delivery challan of a dispatch (any revision). Screen preview + a sticky
 * Close / Back / Print toolbar. `?preview=1` = right after creating it. Revised challans carry a REVISED watermark.
 */
export default function DispatchPrintPage() {
  const id = Number(useParams().id);
  const [params] = useSearchParams();
  const preview = params.get('preview') === '1';
  const navigate = useNavigate();
  const location = useLocation();
  const { config } = useRole();
  const { data, isPending, isError, error, refetch } = useDispatchChallan(id);
  const { ref, scale } = usePageScale();
  usePageTitle(data ? `Print challan ${data.label}` : 'Print challan');

  const lump = data?.order.orderType === 'lump';
  const pages = useMemo(() => (data && lump ? paginateChallanTakas(data.takas) : []), [data, lump]);
  const pcsOf = useMemo<PcsOf>(() => new Map((data?.takas ?? []).map((t) => [t.takaNo, t.pcs])), [data]);
  const totals = useMemo(() => (data ? dispatchTotals(data.takas) : { takas: 0, pcs: 0, meters: 0 }), [data]);
  const pageCount = lump ? pages.length : 1;
  const pagePxW = PAGE_W_MM * MM_TO_PX;
  const pagePxH = PAGE_H_MM * MM_TO_PX;

  const goBack = () => {
    if (preview && data) navigate(`/godown/orders/${data.order.orderId}`, { replace: true });
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
            {data ? `${data.label} · ${lump ? `${totals.takas} ${totals.takas === 1 ? 'taka' : 'takas'}` : `${totals.pcs} pcs`} · ${pageCount} A4 page${pageCount === 1 ? '' : 's'}` : 'Challan'}
            {data?.status === 'revised' && <span className="ml-2 inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 text-xs font-bold text-slate-600">Revised</span>}
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
                height: scale < 1 ? pageCount * (pagePxH + SCREEN_GAP_PX) * scale : undefined,
              }}
            >
              <div className="chp-pages flex flex-col" style={{ gap: SCREEN_GAP_PX }}>
                {lump ? (
                  pages.map((p) => (
                    <div key={p.page} className="chp-page">
                      <LumpSheet data={data} page={p} pcsOf={pcsOf} totals={totals} />
                      {data.status === 'revised' && <div className="chp-watermark">REVISED</div>}
                    </div>
                  ))
                ) : (
                  <div className="chp-page">
                    <PcsSheet data={data} />
                    {data.status === 'revised' && <div className="chp-watermark">REVISED</div>}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
