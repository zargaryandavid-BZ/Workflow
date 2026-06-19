"use client";

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Image from "next/image";
import {
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Copy,
  User,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  CARD_BADGE_LABELS,
  CARD_BADGE_STYLES,
  type CardNotificationBadge,
} from "@/lib/card-badges";
import { PRIORITY_STYLES } from "@/lib/constants";
import {
  cardOrderQty,
  cardSkuCount,
  cardSpecFieldsForDisplay,
  findOrderFormField,
} from "@/lib/order-form";
import {
  customerContactFromOrder,
  customerNameFromOrder,
} from "@/lib/notification-messages";
import { cn, formatDate, formatDateShort } from "@/lib/utils";
import type { CustomField, OrderWithRelations } from "@/lib/types";

interface OrderCardProps {
  order: OrderWithRelations;
  /** When false the card can be opened but not dragged. */
  canDrag?: boolean;
  customFields?: CustomField[];
  fieldValues?: Record<string, unknown>;
  /** Signed URL of the first image asset — square preview in compact mode. */
  thumbnail?: string;
  /** Resolved designer display name (from specs or team list). */
  designerName?: string;
  notificationBadge?: CardNotificationBadge;
  ownerName?: string;
  onOpen: (order: OrderWithRelations) => void;
}

export function OrderCard({
  order,
  canDrag = true,
  customFields = [],
  fieldValues = {},
  thumbnail,
  designerName: designerNameProp,
  notificationBadge,
  ownerName,
  onOpen,
}: OrderCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: order.id, disabled: !canDrag });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const specFields = cardSpecFieldsForDisplay(customFields, fieldValues);
  const orderQty = cardOrderQty(customFields, fieldValues, order.specs);
  const skuCount = cardSkuCount(order.specs);
  const customerName = customerNameFromOrder(
    order,
    fieldValues,
    customFields
  );
  const displayCustomerName =
    customerName === "there" ? null : customerName;
  const { email, phone } = customerContactFromOrder(
    order,
    fieldValues,
    customFields
  );

  const productField = findOrderFormField(customFields, "Product");
  const productName = productField
    ? String(fieldValues[productField.id] ?? "").trim()
    : "";

  const designerName =
    designerNameProp?.trim() ||
    (typeof order.specs?.designer_name === "string"
      ? order.specs.designer_name.trim()
      : "") ||
    null;

  const [copied, setCopied] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  async function copyText(e: React.MouseEvent, text: string, key: string) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // ignore clipboard failures
    }
  }

  function toggleExpanded(e: React.MouseEvent) {
    e.stopPropagation();
    setExpanded((v) => !v);
  }

  function CopyableText({
    text,
    copyKey,
    title,
    className,
  }: {
    text: string;
    copyKey: string;
    title: string;
    className?: string;
  }) {
    return (
      <button
        type="button"
        onClick={(e) => copyText(e, text, copyKey)}
        onPointerDown={(e) => e.stopPropagation()}
        title={title}
        className={cn(
          "group/copy flex max-w-full items-center gap-1 text-left text-[11px] font-medium text-slate-700 hover:text-[var(--primary)]",
          className
        )}
      >
        <span className="min-w-0 truncate">
          {copied === copyKey ? "Copied" : text}
        </span>
        <span className="inline-flex shrink-0 items-center text-[10px] font-normal text-slate-400 group-hover/copy:text-[var(--primary)]">
          {copied === copyKey ? null : (
            <Copy className="h-2.5 w-2.5 opacity-0 transition-opacity group-hover/copy:opacity-100" />
          )}
        </span>
      </button>
    );
  }

  const summaryParts = [
    displayCustomerName,
    productName || null,
    orderQty != null ? `qty ${orderQty}` : null,
    skuCount > 0 ? `${skuCount} SKU` : null,
  ].filter(Boolean);

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...(canDrag ? listeners : {})}
      onClick={() => onOpen(order)}
      className={cn(
        "group rounded-md border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md",
        expanded ? "p-2.5" : "p-2",
        canDrag ? "cursor-pointer" : "cursor-default"
      )}
    >
      <div className="flex items-start gap-2">
        {thumbnail ? (
          <Image
            src={thumbnail}
            alt=""
            width={40}
            height={40}
            className="h-10 w-10 shrink-0 rounded object-cover"
            unoptimized
          />
        ) : null}

        <div className="min-w-0 flex-1">
          {/* Compact header — always visible */}
          <div className="flex items-start gap-1">
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-1">
                <button
                  type="button"
                  onClick={(e) => copyText(e, order.title, "order")}
                  onPointerDown={(e) => e.stopPropagation()}
                  title="Copy order number"
                  className="group/copy flex min-w-0 items-center gap-0.5 text-left text-xs font-semibold leading-tight text-slate-800 hover:text-[var(--primary)]"
                >
                  <span className="truncate">{order.title}</span>
                  {copied === "order" ? (
                    <span className="shrink-0 text-[10px] font-normal text-slate-400">
                      Copied
                    </span>
                  ) : (
                    <Copy className="h-2.5 w-2.5 shrink-0 opacity-0 transition-opacity group-hover/copy:opacity-100" />
                  )}
                </button>
                {order.due_date ? (
                  <span
                    className="inline-flex shrink-0 items-center gap-0.5 text-[10px] font-medium text-slate-500"
                    title={`Due ${formatDate(order.due_date)}`}
                  >
                    <CalendarClock className="h-2.5 w-2.5" />
                    {formatDateShort(order.due_date)}
                  </span>
                ) : null}
              </div>

              {summaryParts.length > 0 ? (
                <p className="mt-0.5 truncate text-[11px] leading-tight text-slate-500">
                  {summaryParts.join(" · ")}
                </p>
              ) : null}
            </div>

            <button
              type="button"
              onClick={toggleExpanded}
              onPointerDown={(e) => e.stopPropagation()}
              title={expanded ? "Show less" : "Show more"}
              aria-expanded={expanded}
              className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              {expanded ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </button>
          </div>

          {/* Footer — always visible */}
          <div className="mt-1 flex items-center justify-between gap-1.5">
            <div className="flex min-w-0 items-center gap-1.5 truncate">
              {order.category ? (
                <span
                  className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
                  style={{ backgroundColor: order.category.color }}
                >
                  {order.category.name}
                </span>
              ) : null}
              {notificationBadge ? (
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center rounded-full border px-1.5 py-px text-[10px] font-medium",
                    CARD_BADGE_STYLES[notificationBadge]
                  )}
                >
                  {CARD_BADGE_LABELS[notificationBadge]}
                </span>
              ) : null}
              <span
                className="inline-flex min-w-0 items-center gap-0.5 truncate text-[10px] text-slate-500"
                title="Assigned designer"
              >
                <User className="h-2.5 w-2.5 shrink-0 text-[var(--primary)]" />
                <span className="truncate">{designerName ?? "Unassigned"}</span>
              </span>
            </div>
            <Badge
              className={cn(
                PRIORITY_STYLES[order.priority],
                "h-5 shrink-0 px-1.5 text-[10px]"
              )}
            >
              {order.priority}
            </Badge>
          </div>

          {/* Expanded details */}
          {expanded ? (
            <div
              className="mt-2 space-y-2 border-t border-slate-100 pt-2"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] leading-snug">
                <div className="min-w-0">
                  <span className="text-slate-400">Assigned: </span>
                  <span className="inline-flex items-center gap-0.5 font-medium text-slate-700">
                    <User className="h-2.5 w-2.5 shrink-0 text-[var(--primary)]" />
                    <span className="truncate">
                      {designerName ?? "Unassigned"}
                    </span>
                  </span>
                </div>
                <div className="min-w-0">
                  <span className="text-slate-400">Owner: </span>
                  <span className="font-medium text-slate-700">
                    {ownerName ?? "—"}
                  </span>
                </div>
              </div>

              {displayCustomerName || email || phone ? (
                <div className="space-y-0.5">
                  {displayCustomerName ? (
                    <div className="flex items-center gap-1 text-[11px] font-medium text-slate-700">
                      <User className="h-3 w-3 shrink-0 text-slate-400" />
                      <span className="truncate">{displayCustomerName}</span>
                    </div>
                  ) : null}
                  {email ? (
                    <CopyableText
                      text={email}
                      copyKey="contact-email"
                      title="Copy email"
                      className={displayCustomerName ? "ml-4" : undefined}
                    />
                  ) : null}
                  {phone ? (
                    <CopyableText
                      text={phone}
                      copyKey="contact-phone"
                      title="Copy phone"
                      className={displayCustomerName ? "ml-4" : undefined}
                    />
                  ) : null}
                </div>
              ) : null}

              {specFields.length > 0 || orderQty != null || skuCount > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {specFields.map(({ field, label, display }) => (
                    <span
                      key={field.id}
                      className="inline-flex max-w-full items-center gap-0.5 rounded bg-slate-100 px-1 py-px text-[10px] text-slate-600"
                    >
                      <span className="shrink-0 font-medium text-slate-500">
                        {label}:
                      </span>
                      <span className="truncate">{display}</span>
                    </span>
                  ))}
                  {orderQty != null ? (
                    <span className="inline-flex items-center rounded bg-slate-100 px-1 py-px text-[10px] text-slate-600">
                      qty {orderQty}
                    </span>
                  ) : null}
                  {skuCount > 0 ? (
                    <span className="inline-flex items-center rounded border border-blue-200/80 bg-[#dbeafe] px-1 py-px text-[10px] text-[#1e40af]">
                      SKU: {skuCount}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
