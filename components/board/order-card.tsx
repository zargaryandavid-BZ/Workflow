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

function formatValue(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
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

  const visibleFields = customFields
    .map((f) => ({ field: f, display: formatValue(fieldValues[f.id]) }))
    .filter((x) => x.display !== null);

  const designerName =
    typeof order.specs?.designer_name === "string"
      ? order.specs.designer_name
      : null;

  const [copied, setCopied] = useState(false);

  async function copyOrderNumber(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(order.title);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore clipboard failures
    }
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
      <div className="mb-2 grid grid-cols-3 items-start gap-2 border-b border-slate-100 pb-2">
        <button
          type="button"
          onClick={copyOrderNumber}
          onPointerDown={(e) => e.stopPropagation()}
          title="Copy order number"
          className="group/copy flex min-w-0 items-center gap-1 text-left text-sm font-medium leading-snug text-slate-800 hover:text-[var(--primary)]"
        >
          <span className="truncate">{order.title}</span>
          <span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] font-normal text-slate-400 group-hover/copy:text-[var(--primary)]">
            {copied ? (
              "Copied"
            ) : (
              <Copy className="h-3 w-3 opacity-0 transition-opacity group-hover/copy:opacity-100" />
            )}
          </span>
        </button>
        <div className="flex justify-center">
          <Badge className={cn(PRIORITY_STYLES[order.priority], "shrink-0")}>
            {order.priority}
          </Badge>
        </div>
        <div className="min-w-0 text-right text-[11px] leading-snug">
          {order.due_date ? (
            <span
              className="inline-flex max-w-full items-center justify-end gap-1 font-medium text-slate-700"
              title="Due date"
            >
              <CalendarClock className="h-3 w-3 shrink-0 text-slate-400" />
              <span className="truncate">{formatDate(order.due_date)}</span>
            </span>
          ) : (
            <span className="text-slate-300">—</span>
          )}
        </div>
      </div>

      <div className="mb-2 space-y-1 text-[11px] leading-snug">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className="text-slate-400">Assigned:</span>
          <span className="inline-flex items-center gap-1 font-medium text-slate-700">
            <User className="h-3 w-3 text-[var(--primary)]" />
            {designerName ?? "Unassigned"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className="text-slate-400">Owner:</span>
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

      {order.customer ? (
        <div className="mb-2 flex items-center gap-1.5 text-xs text-slate-500">
          <User className="h-3.5 w-3.5" />
          {order.customer.name}
        </div>
      ) : null}

      {visibleFields.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-1">
          {visibleFields.map(({ field, display }) => (
            <span
              key={field.id}
              className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600"
            >
              <span className="font-medium text-slate-500">{field.name}:</span>
              {display}
            </span>
          ))}
        </div>
      ) : null}

      {notificationBadge ? (
        <div className="mt-2 border-t border-slate-100 pt-2">
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
              CARD_BADGE_STYLES[notificationBadge]
            )}
          >
            {CARD_BADGE_LABELS[notificationBadge]}
          </span>
        </div>
      ) : null}
    </div>
  );
}
