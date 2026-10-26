import { blouseBreakdownText, inventoryKey } from '@rivoora/shared';
import { useInventoryItem } from '../inventory/api';

/**
 * Display-only stock of the chosen design, shown beside it on the order form. ALWAYS all stock of the
 * design: the order's With / Without blouse option does not filter it. A quiet blouse breakdown line is shown for
 * information. Free stock (belongs to no order) is included.
 */
export function DesignStockPanel({ designId }: { designId: number }) {
  const { data, isLoading, isError } = useInventoryItem(inventoryKey({ designId }), 'all');

  const tiles = data
    ? [
        { label: 'Free stock available', hint: 'Belongs to no order', value: data.free.total, tone: 'text-indigo-700' },
        { label: 'Ready for order', hint: 'Finished, not yet packed', value: data.pcs.inGodown, tone: 'text-emerald-700' },
        { label: 'Ready for dispatch', hint: 'Packed for orders', value: data.pcs.readyDispatch, tone: 'text-teal-700' },
        { label: 'In making', hint: 'Still in production', value: data.pcs.inMaking, tone: 'text-sky-700' },
      ]
    : [];
  const breakdown = data ? blouseBreakdownText(data.blouseStock) : '';

  return (
    <div className="border-t border-border p-3 sm:w-72 sm:shrink-0 sm:border-l sm:border-t-0 sm:p-4 lg:w-80">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Existing inventory</p>
      {isError ? (
        <p className="mt-2 text-sm text-muted-foreground">Inventory is not available.</p>
      ) : isLoading ? (
        <div className="mt-2 space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-9 animate-pulse rounded-lg bg-slate-200/70" />
          ))}
        </div>
      ) : (
        <>
          <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-1">
            {tiles.map((t) => (
              <li
                key={t.label}
                className="flex min-w-0 flex-col justify-between gap-0.5 rounded-lg border border-border bg-white px-3 py-2 sm:flex-row sm:items-center sm:gap-3"
              >
                <span className="min-w-0 text-xs font-medium leading-tight text-slate-600 sm:text-sm">{t.label}</span>
                <span className={`text-lg font-bold tabular-nums ${t.tone}`}>
                  {t.value} <span className="text-xs font-medium text-muted-foreground">pcs</span>
                </span>
              </li>
            ))}
          </ul>
          {breakdown && <p className="mt-2 text-xs text-slate-500">{breakdown}</p>}
        </>
      )}
    </div>
  );
}
