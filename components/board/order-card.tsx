"use client";

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Image from "next/image";
import { CalendarClock, Copy, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  CARD_BADGE_LABELS,
  CARD_BADGE_STYLES,
  type CardNotificationBadge,
} from "@/lib/card-badges";
import { PRIORITY_STYLES } from "@/lib/constants";
import { cardOrderQty, cardSkuCount, cardSpecFieldsForDisplay } from "@/lib/order-form";
import {
  customerContactFromOrder,
  customerNameFromOrder,
} from "@/lib/notification-messages";
import { cn, formatDate } from "@/lib/utils";
import type { CustomField, OrderWithRelations } from "@/lib/types";

interface OrderCardProps {
  order: OrderWithRelations;
  /** When false the card can be opened but not dragged. */
  canDrag?: boolean;
  customFields?: CustomField[];
  fieldValues?: Record<string, unknown>;
  /** Signed URL of the first image asset, shown as a small preview. */
  thumbnail?: string;
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

  const designerName =
    typeof order.specs?.designer_name === "string"
      ? order.specs.designer_name
      : null;

  const [copied, setCopied] = useState<string | null>(null);

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
          "group/copy flex max-w-full items-center gap-1 text-left text-xs font-medium text-slate-800 hover:text-[var(--primary)]",
          className
        )}
      >
        <span className="min-w-0 break-all">{copied === copyKey ? "Copied" : text}</span>
        <span className="inline-flex shrink-0 items-center text-[10px] font-normal text-slate-400 group-hover/copy:text-[var(--primary)]">
          {copied === copyKey ? null : (
            <Copy className="h-3 w-3 opacity-0 transition-opacity group-hover/copy:opacity-100" />
          )}
        </span>
      </button>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...(canDrag ? listeners : {})}
      onClick={() => onOpen(order)}
      className={cn(
        "group rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition-shadow hover:shadow-md",
        canDrag ? "cursor-pointer" : "cursor-default"
      )}
    >
      <div className="mb-2 grid grid-cols-[1fr_auto] items-start gap-2 border-b border-slate-100 pb-2">
        <button
          type="button"
          onClick={(e) => copyText(e, order.title, "order")}
          onPointerDown={(e) => e.stopPropagation()}
          title="Copy order number"
          className="group/copy flex min-w-0 items-start gap-1 text-left text-sm font-medium leading-snug text-slate-800 hover:text-[var(--primary)]"
        >
          <span className="break-all">{order.title}</span>
          <span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] font-normal text-slate-400 group-hover/copy:text-[var(--primary)]">
            {copied === "order" ? (
              "Copied"
            ) : (
              <Copy className="h-3 w-3 opacity-0 transition-opacity group-hover/copy:opacity-100" />
            )}
          </span>
        </button>
        <div className="shrink-0 text-right text-[11px] leading-snug">
          {order.due_date ? (
            <span
              className="inline-flex items-center justify-end gap-1 font-medium text-slate-700"
              title="Due date"
            >
              <CalendarClock className="h-3 w-3 shrink-0 text-slate-400" />
              <span>{formatDate(order.due_date)}</span>
            </span>
          ) : (
            <span className="text-slate-300">—</span>
          )}
        </div>
      </div>

      <div className="mb-2 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px] leading-snug">
        <div className="min-w-0">
          <span className="text-slate-400">Assigned: </span>
          <span className="inline-flex items-center gap-1 font-medium text-slate-700">
            <User className="h-3 w-3 shrink-0 text-[var(--primary)]" />
            <span className="truncate">{designerName ?? "Unassigned"}</span>
          </span>
        </div>
        <div className="min-w-0">
          <span className="text-slate-400">Owner: </span>
          <span className="font-medium text-slate-700">
            {ownerName ?? "—"}
          </span>
        </div>
      </div>

      {thumbnail ? (
        <Image
          src={thumbnail}
          alt=""
          width={288}
          height={112}
          className="mb-2 h-28 w-full rounded-md object-cover"
          unoptimized
        />
      ) : null}

      {displayCustomerName || email || phone ? (
        <div className="mb-2 space-y-0.5">
          {displayCustomerName ? (
            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
              <User className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span className="truncate">{displayCustomerName}</span>
            </div>
          ) : null}
          {email ? (
            <CopyableText
              text={email}
              copyKey="contact-email"
              title="Copy email"
              className={displayCustomerName ? "ml-5" : undefined}
            />
          ) : null}
          {phone ? (
            <CopyableText
              text={phone}
              copyKey="contact-phone"
              title="Copy phone"
              className={displayCustomerName ? "ml-5" : undefined}
            />
          ) : null}
        </div>
      ) : null}

      {specFields.length > 0 || orderQty != null || skuCount > 0 ? (
        <div className="mb-2 flex flex-wrap gap-1">
          {specFields.map(({ field, label, display }) => (
            <span
              key={field.id}
              className="inline-flex max-w-full items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600"
            >
              <span className="shrink-0 font-medium text-slate-500">
                {label}:
              </span>
              <span className="truncate">{display}</span>
            </span>
          ))}
          {orderQty != null ? (
            <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
              qty {orderQty}
            </span>
          ) : null}
          {skuCount > 0 ? (
            <span className="inline-flex items-center rounded border border-blue-200/80 bg-[#dbeafe] px-[7px] py-[2px] text-[11px] text-[#1e40af]">
              SKU: {skuCount}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="mt-2 flex items-end justify-between gap-2 border-t border-slate-100 pt-2">
        <div className="min-w-0">
          {notificationBadge ? (
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
                CARD_BADGE_STYLES[notificationBadge]
              )}
            >
              {CARD_BADGE_LABELS[notificationBadge]}
            </span>
          ) : null}
        </div>
        <Badge className={cn(PRIORITY_STYLES[order.priority], "shrink-0")}>
          {order.priority}
        </Badge>
      </div>
    </div>
  );
}
