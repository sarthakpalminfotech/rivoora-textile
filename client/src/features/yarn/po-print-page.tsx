import { ArrowLeft, Loader2, Printer } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { COMPANY, formatKgNumber } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useYarnPoPrint } from './api';
import { money } from './parts';

/** `/print/yarn-po/:id` — the printable Yarn PO (A4 portrait, the same style as the outside PO print). */
const CSS = `
@page { size: A4 portrait; margin: 14mm; }
.ypo { color: #000; font-family: 'DM Sans', system-ui, sans-serif; }
.ypo * { box-sizing: border-box; }
.ypo-sheet { width: 182mm; margin: 0 auto; border: 1.5px solid #000; font-weight: 600; background: #fff; }
.ypo-row { border-bottom: 1.2px solid #000; padding: 2.2mm 4mm; }
.ypo-head { text-align: center; }
.ypo-name { font-size: 20pt; font-weight: 800; letter-spacing: 0.02em; }
.ypo-gst { font-size: 10pt; margin-top: 1mm; }
.ypo-addr { font-size: 9.5pt; font-weight: 500; line-height: 1.3; }
.ypo-mob { font-size: 9.5pt; font-weight: 500; }
.ypo-title { text-align: center; font-size: 13pt; letter-spacing: 0.05em; background: #f1f1f1; }
.ypo-meta { display: grid; grid-template-columns: 1fr 1fr; font-size: 11pt; }
.ypo-party p { margin: 0; font-size: 11pt; line-height: 1.4; }
.ypo-party .ypo-ms { font-size: 13.5pt; text-transform: uppercase; }
.ypo-table { width: 100%; border-collapse: collapse; }
.ypo-table th { font-size: 10pt; text-align: left; padding: 2mm 3mm; border-bottom: 1.2px solid #000; background: #f6f6f6; }
.ypo-table td { padding: 2mm 3mm; font-size: 11pt; border-bottom: 1px solid #ccc; vertical-align: top; }
.ypo-table .n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.ypo-table .sr { width: 11mm; }
.ypo-table tfoot td { border-top: 1.2px solid #000; border-bottom: 1.2px solid #000; font-weight: 800; }
.ypo-remark { white-space: pre-line; font-size: 10.5pt; font-weight: 500; }
.ypo-sign { display: flex; justify-content: space-between; align-items: flex-end; padding: 8mm 4mm 2.5mm; font-size: 10.5pt; }
@media screen { .ypo-sheet { box-shadow: 0 1px 3px rgb(15 23 42 / 0.12), 0 8px 24px rgb(15 23 42 / 0.08); margin-top: 16px; margin-bottom: 40px; } }
@media screen and (max-width: 767px) { .ypo-sheet { width: 100%; } }
@media print { .ypo-toolbar { display: none !important; } .ypo-sheet { box-shadow: none; margin: 0; } .ypo-wrap { padding: 0 !important; } }
`;

export default function YarnPoPrintPage() {
  const id = Number(useParams().id);
  const { data, isPending, isError, error, refetch } = useYarnPoPrint(id);
  usePageTitle(data ? `Print PO ${data.poNo}` : 'Print Yarn PO');

  return (
    <div className="ypo min-h-[100dvh] bg-slate-200/70">
      <style>{CSS}</style>
      <header className="ypo-toolbar sticky top-0 z-30 border-b border-border bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-2 px-2 md:h-16 md:px-4">
          <Button variant="ghost" size="sm" onClick={() => history.back()}>
            <ArrowLeft /> Back
          </Button>
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-600">{data ? `Yarn PO ${data.poNo}` : 'Yarn purchase order'}</p>
          <Button onClick={() => window.print()} disabled={!data}>
            {data ? <Printer /> : <Loader2 className="animate-spin" />}
            Print
          </Button>
        </div>
      </header>

      <div className="ypo-wrap overflow-x-auto px-3 py-4 md:px-6">
        {isPending ? (
          <div className="flex justify-center py-20 text-slate-500">
            <Loader2 className="size-6 animate-spin" aria-label="Loading" />
          </div>
        ) : isError || !data ? (
          <div className="mx-auto max-w-md rounded-xl bg-white shadow-soft">
            {error instanceof ApiError && error.status === 404 ? <p className="p-8 text-center font-semibold text-slate-900">PO not found</p> : <ErrorState error={error} onRetry={() => void refetch()} />}
          </div>
        ) : (
          <div className="ypo-sheet">
            <div className="ypo-row ypo-head">
              <div className="ypo-name">{COMPANY.name}</div>
              <div className="ypo-gst">GSTIN : {COMPANY.gstin}</div>
              <div className="ypo-addr">{COMPANY.address}</div>
              <div className="ypo-mob">Mo : {COMPANY.mobiles.join(', ')}</div>
            </div>
            <div className="ypo-row ypo-title">!! YARN PURCHASE ORDER !!</div>
            <div className="ypo-row ypo-meta">
              <span>PO No : {data.poNo}</span>
              <span style={{ textAlign: 'right' }}>Date : {formatDate(data.poDate)}</span>
            </div>
            <div className="ypo-row ypo-party">
              <p className="ypo-ms">M/s. {data.party.name}</p>
              {data.party.address && <p>{data.party.address}</p>}
              {data.party.mobile && <p>Mo : {data.party.mobile}</p>}
              {data.party.gstin && <p>GSTIN : {data.party.gstin}</p>}
            </div>
            <table className="ypo-table">
              <thead>
                <tr>
                  <th className="sr">Sr</th>
                  <th>Yarn quality</th>
                  <th className="n">Qty (kg)</th>
                  <th className="n">Rate (₹/kg)</th>
                  <th className="n">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.lines.map((l, i) => (
                  <tr key={i}>
                    <td className="sr">{i + 1}</td>
                    <td>{l.quality}</td>
                    <td className="n">{formatKgNumber(l.qtyG)}</td>
                    <td className="n">{(l.ratePaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className="n">{money(l.amountPaise)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td />
                  <td>Total</td>
                  <td className="n">{formatKgNumber(data.totalG)}</td>
                  <td />
                  <td className="n">{money(data.totalPaise)}</td>
                </tr>
              </tfoot>
            </table>
            {data.remark && (
              <div className="ypo-row">
                <span style={{ fontSize: '10pt' }}>Remark :</span> <span className="ypo-remark">{data.remark}</span>
              </div>
            )}
            <div className="ypo-sign">
              <span />
              <span style={{ textAlign: 'right' }}>
                For, {COMPANY.name}
                <br />
                <br />
                <br />
                Authorised Signatory
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
