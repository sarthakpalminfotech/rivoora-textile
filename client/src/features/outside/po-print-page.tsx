import { ArrowLeft, Loader2, Printer } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { COMPANY, ORDER_TYPE_LABEL, PO_STATUS_CONFIG } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { formatDate, formatMoney, formatOrderNo } from '@/lib/format';
import { useOutsidePoPrint } from './api';

/** `/print/outside-po/:id` — the printable PO (A4 portrait), Jenish / Gaurang / Dhruvil / the godown supervisor. */
const CSS = `
@page { size: A4 portrait; margin: 16mm; }
.pop { color: #000; font-family: 'DM Sans', system-ui, sans-serif; }
.pop * { box-sizing: border-box; }
.pop-sheet { width: 178mm; margin: 0 auto; border: 1.5px solid #000; font-weight: 600; }
.pop-row { border-bottom: 1.2px solid #000; padding: 2.2mm 4mm; }
.pop-row:last-child { border-bottom: 0; }
.pop-head { text-align: center; }
.pop-name { font-size: 20pt; font-weight: 800; letter-spacing: 0.02em; }
.pop-gst { font-size: 10pt; font-weight: 600; margin-top: 1mm; }
.pop-addr { font-size: 9.5pt; font-weight: 500; line-height: 1.3; }
.pop-title { text-align: center; font-size: 13pt; letter-spacing: 0.05em; background: #f1f1f1; }
.pop-meta { display: grid; grid-template-columns: 1fr 1fr; font-size: 11pt; }
.pop-party p { margin: 0; font-size: 11.5pt; line-height: 1.4; }
.pop-party .pop-ms { font-size: 13.5pt; text-transform: uppercase; }
.pop-table { width: 100%; border-collapse: collapse; }
.pop-table td { padding: 2mm 4mm; font-size: 11.5pt; border-bottom: 1px solid #ddd; }
.pop-table td.k { width: 42mm; color: #555; font-weight: 600; }
.pop-notes { white-space: pre-line; font-size: 11pt; font-weight: 500; }
.pop-sign { display: flex; justify-content: space-between; align-items: flex-end; padding: 6mm 4mm 2mm; font-size: 10.5pt; }
@media screen { .pop-sheet { box-shadow: 0 1px 3px rgb(15 23 42 / 0.12), 0 8px 24px rgb(15 23 42 / 0.08); margin-top: 16px; margin-bottom: 40px; } }
@media print { .pop-toolbar { display: none !important; } .pop-sheet { box-shadow: none; margin: 0; } }
`;

export default function PoPrintPage() {
  const id = Number(useParams().id);
  const { data, isPending, isError, error, refetch } = useOutsidePoPrint(id);
  usePageTitle(data ? `Print ${data.label}` : 'Print PO');

  return (
    <div className="pop min-h-[100dvh] bg-slate-200/70">
      <style>{CSS}</style>
      <header className="pop-toolbar sticky top-0 z-30 border-b border-border bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-2 px-2 md:h-16 md:px-4">
          <Button variant="ghost" size="sm" onClick={() => history.back()}>
            <ArrowLeft /> Back
          </Button>
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-600">{data ? data.label : 'Purchase order'}</p>
          <Button onClick={() => window.print()} disabled={!data}>
            {data ? <Printer /> : <Loader2 className="animate-spin" />}
            Print
          </Button>
        </div>
      </header>

      <div className="px-3 py-4 md:px-6">
        {isPending ? (
          <div className="flex justify-center py-20 text-slate-500">
            <Loader2 className="size-6 animate-spin" aria-label="Loading" />
          </div>
        ) : isError || !data ? (
          <div className="mx-auto max-w-md rounded-xl bg-white shadow-soft">
            {error instanceof ApiError && error.status === 404 ? (
              <p className="p-8 text-center font-semibold text-slate-900">PO not found</p>
            ) : (
              <ErrorState error={error} onRetry={() => void refetch()} />
            )}
          </div>
        ) : (
          <div className="pop-sheet">
            <div className="pop-row pop-head">
              <div className="pop-name">{COMPANY.name}</div>
              <div className="pop-gst">GSTIN : {COMPANY.gstin}</div>
              <div className="pop-addr">{COMPANY.address}</div>
            </div>
            <div className="pop-row pop-title">!! PURCHASE ORDER !!</div>
            <div className="pop-row pop-meta">
              <span>PO No : {data.label}</span>
              <span style={{ textAlign: 'right' }}>Date : {formatDate(data.poDate)}</span>
            </div>
            <div className="pop-row pop-party">
              <p className="pop-ms">M/s. {data.weaver.name}</p>
              {data.weaver.address && <p>{data.weaver.address}</p>}
              {data.weaver.mobile && <p>Mo : {data.weaver.mobile}</p>}
              {data.weaver.gstin && <p>GSTIN : {data.weaver.gstin}</p>}
            </div>
            <table className="pop-table">
              <tbody>
                <tr>
                  <td className="k">Order</td>
                  <td>
                    {formatOrderNo(data.orderNo)}
                    {data.designCode ? ` · Design ${data.designCode}` : ''}
                  </td>
                </tr>
                <tr>
                  <td className="k">Quality</td>
                  <td>{data.quality}</td>
                </tr>
                <tr>
                  <td className="k">Quantity</td>
                  <td>
                    {data.quantity.toLocaleString('en-IN')} {data.unit === 'meters' ? 'meters' : 'pcs'}
                  </td>
                </tr>
                <tr>
                  <td className="k">Order type</td>
                  <td>{ORDER_TYPE_LABEL[data.orderType]}</td>
                </tr>
                {data.rate != null && (
                  <tr>
                    <td className="k">Rate</td>
                    <td>{formatMoney(data.rate)}</td>
                  </tr>
                )}
                <tr>
                  <td className="k">Status</td>
                  <td>{PO_STATUS_CONFIG[data.status].label}</td>
                </tr>
                {data.notes && (
                  <tr>
                    <td className="k">Notes</td>
                    <td className="pop-notes">{data.notes}</td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="pop-sign">
              <span />
              <span style={{ textAlign: 'right' }}>
                For, {COMPANY.name}
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
