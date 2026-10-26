import { useRole } from "@/hooks/useRole";
import { Ban, ChevronDown, ImageOff, Pencil, Phone, Undo2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { OrderDetail } from "@rivoora/shared";
import { Button } from "@/components/ui/button";
import { ImageThumb, Lightbox } from "@/components/ui/image-thumb";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  formatDate,
  formatMoney,
  formatOrderNo,
  formatQuantity,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { OrderStepsTag } from "../order-steps-tag";
import { OutsideOrderTag } from "../outside-order-tag";
import { OrderTypeTag } from "../order-type-tag";
import { BlouseTag } from '../../free-stock/blouse';
import { HoldButtons, ON_HOLD_HINT, OnHoldBadge } from '../hold/hold-order';

function HeaderItem({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-[12px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-[15px] font-semibold text-slate-900">
        {children}
      </dd>
    </div>
  );
}

/** Design thumbnail: opens the full image in the Lightbox; a neutral, non-clickable placeholder without a design. */
function DesignThumb({ order }: { order: OrderDetail }) {
  const [open, setOpen] = useState(false);
  const image = order.design;
  const code = order.design?.code;
  const size = "size-16 md:size-[88px]";

  if (!image?.thumbUrl) {
    return (
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-300",
          size,
        )}
        aria-label={image ? `Design ${code} has no image` : "No design"}
        role="img"
      >
        <ImageOff className="size-6" aria-hidden />
      </span>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="View design image"
        className={cn(
          "shrink-0 overflow-hidden rounded-xl outline-none ring-offset-2 transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary",
          size,
        )}
      >
        <ImageThumb
          thumbUrl={image.thumbUrl}
          alt={`Design ${code}`}
          preview={false}
          rounded="rounded-xl"
          className="size-full"
        />
      </button>
      <Lightbox
        open={open}
        onOpenChange={setOpen}
        src={image.imageUrl ?? image.thumbUrl}
        alt={`Design ${code}`}
      />
    </>
  );
}

/**
 * Order header card (always visible): design thumbnail, order number + status, Undo send for production, and a
 * compact detail grid. Phones show the first four details with a "More details" toggle. `onEdit` adds the edit (pencil) button.
 */
export function OrderHeader({
  order,
  onUndo,
  onEdit,
  onHold,
  onRelease,
  onClose,
}: {
  order: OrderDetail;
  onUndo?: () => void;
  onEdit?: () => void;
  /** Sprint 15 (Jenish): Hold order / Release hold. */
  onHold?: () => void;
  onRelease?: () => void;
  /** Sprint 16 (Jenish, Gaurang): Close order — hidden once it is already closed. */
  onClose?: () => void;
}) {
  const [more, setMore] = useState(false);
  const { can } = useRole();
  const seesClient = can("canSeeClient");
  const code = order.design?.code;

  const items: { label: string; value: ReactNode }[] = [
    ...(seesClient
      ? [
          {
            label: "Client",
            value: (
              <>
                {order.customer.name}
                {order.customer.city && (
                  <span className="font-normal text-slate-500">
                    {" "}
                    · {order.customer.city}
                  </span>
                )}
              </>
            ),
          },
          {
            label: "Broker",
            value: order.broker ? (
              order.broker.name
            ) : (
              <span className="font-normal text-slate-400">—</span>
            ),
          },
        ]
      : []),
    {
      label: "Design",
      value: code ? (
        <>{code}</>
      ) : (
        <span className="font-normal text-slate-400">—</span>
      ),
    },
    {
      label: "Order quantity",
      value: formatQuantity(order.quantity, order.unit),
    },
    {
      label: "Material / Quality",
      value: (
        <>
          {order.material.name}
          {order.material.code && (
            <span className="font-normal text-slate-500">
              {" "}
              {order.material.code}
            </span>
          )}
        </>
      ),
    },
    // Sprint 15: the godown supervisor's Orders start at butta cutting — no production fields.
    // Sprint 16: no jobsheets at all for an order without the Production step.
    ...(order.unit === "pcs" && order.hasProduction && !can("canViewGodownOrders")
      ? [
          {
            label: "Jobsheet quantity",
            value:
              order.jobsheetCount > 0 ? (
                `${order.jobsheetPieces.toLocaleString("en-IN")} pcs`
              ) : (
                <span className="font-normal text-slate-400">—</span>
              ),
          },
        ]
      : []),
    ...(seesClient
      ? [
          {
            label: "Phone",
            value: order.customer.phone ? (
              <a
                href={`tel:${order.customer.phone}`}
                className="inline-flex items-center gap-1.5 text-primary hover:underline"
              >
                <Phone className="size-3.5" aria-hidden />{" "}
                {order.customer.phone}
              </a>
            ) : (
              <span className="font-normal text-slate-400">—</span>
            ),
          },
        ]
      : []),
    { label: "Order date", value: formatDate(order.orderDate) },
    ...("rate" in order
      ? [{ label: "Rate", value: formatMoney(order.rate) }]
      : []),
  ];
  const PHONE_VISIBLE = 4;

  return (
    <section
      className="rounded-xl border border-border bg-white p-4 shadow-soft md:p-5"
      aria-label={`Order ${formatOrderNo(order.orderNo)}`}
    >
      {/* Phones: thumbnail + title on one row, the details full width below. md+: details beside the thumbnail. */}
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3.5 md:gap-x-5">
        <div className="md:row-span-2">
          <DesignThumb order={order} />
        </div>
        {/* Title + tags and the action buttons are two separate flex-wrap rows (never mixed) — each wraps cleanly on
            its own at tablet widths instead of tags and buttons tangling together on one line. */}
        <div className="flex min-w-0 flex-col gap-2.5 self-center md:self-start">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
            <h2 className="text-2xl font-bold leading-tight text-slate-900 md:text-[28px]">
              Order {formatOrderNo(order.orderNo)}
            </h2>
            <OrderTypeTag type={order.orderType} className="text-xs" />
            <BlouseTag option={order.blouseOption} />
            <OrderStepsTag steps={order} />
            <OutsideOrderTag order={order} />
            <StatusBadge status={order.status} />
            {order.isOnHold && <OnHoldBadge />}
          </div>
          {(onUndo || onEdit || onHold || onRelease || onClose) && (
            <div className="flex flex-wrap items-center gap-2 md:justify-end">
              <HoldButtons held={order.isOnHold} canHold={!!(onHold && onRelease)} onHold={() => onHold?.()} onRelease={() => onRelease?.()} />
              {onUndo && (
                <Button variant="secondary" size="sm" onClick={onUndo} disabled={order.isOnHold} title={order.isOnHold ? ON_HOLD_HINT : undefined}>
                  <Undo2 /> Undo send for production
                </Button>
              )}
              {onEdit && (
                <Button
                  variant="secondary"
                  size="icon-sm"
                  onClick={onEdit}
                  disabled={order.isOnHold}
                  aria-label="Edit order"
                  title={order.isOnHold ? ON_HOLD_HINT : 'Edit order'}
                >
                  <Pencil />
                </Button>
              )}
              {onClose && !order.isClosed && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onClose}
                  disabled={order.isOnHold}
                  className="text-destructive hover:bg-destructive-soft"
                  title={order.isOnHold ? ON_HOLD_HINT : 'Close order'}
                >
                  <Ban /> Close order
                </Button>
              )}
            </div>
          )}
        </div>
        <div className="col-span-2 min-w-0 md:col-span-1 md:col-start-2">
          <dl className="mt-3.5 grid grid-cols-2 gap-x-4 gap-y-3 md:mt-4 md:grid-cols-4 md:gap-x-6 xl:grid-cols-6 xl:gap-x-8">
            {items.map((it, i) => (
              <HeaderItem
                key={it.label}
                label={it.label}
                className={cn(i >= PHONE_VISIBLE && !more && "hidden md:block")}
              >
                {it.value}
              </HeaderItem>
            ))}
          </dl>
          {items.length > PHONE_VISIBLE && (
            <button
              type="button"
              onClick={() => setMore((m) => !m)}
              aria-expanded={more}
              className="mt-2 inline-flex min-h-9 items-center gap-1 rounded-md text-sm font-semibold text-primary md:hidden"
            >
              {more ? "Fewer details" : "More details"}
              <ChevronDown
                className={cn(
                  "size-4 transition-transform",
                  more && "rotate-180",
                )}
                aria-hidden
              />
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
