"use client";

import { useEffect, useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Image from "next/image";
import {
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  MoveRight,
  User,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  CARD_BADGE_LABELS,
  CARD_BADGE_STYLES,
  type CardNotificationBadge,
} from "@/lib/card-badges";
import {
  PRIORITY_STYLES,
  UNASSIGNED_DESIGNER_CARD_CLASS,
  UNASSIGNED_DESIGNER_TEXT_CLASS,
} from "@/lib/constants";
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
import { ORDER_TAG_STYLES, orderTagsFromSpecs } from "@/lib/order-tags";
import { getActiveWarning, CARD_WARNING_BORDER_COLORS } from "@/lib/card-warning-rules";
import type { CardWarningRule, CustomField, OrderWithRelations } from "@/lib/types";

interface ColumnOption {
  id: string;
  name: string;
  color: string | null;
}

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
  warningRules?: CardWarningRule[];
  animateWarnings?: boolean;
  /** Column accent color (hex) — used to tint the customer name at 70% opacity. */
  columnColor?: string | null;
  /** Columns the user is allowed to move this card to (pre-filtered by board). */
  availableColumns?: ColumnOption[];
  /** Called when the user selects a column from the right-click menu. */
  onMoveToColumn?: (order: OrderWithRelations, targetColumnId: string) => void;
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
  warningRules = [],
  animateWarnings = true,
  columnColor,
  availableColumns = [],
  onMoveToColumn,
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

  const materialsField = findOrderFormField(customFields, "Materials");
  const materialsName = materialsField
    ? String(fieldValues[materialsField.id] ?? "").trim()
    : "";

  const designerName =
    designerNameProp?.trim() ||
    (typeof order.specs?.designer_name === "string"
      ? order.specs.designer_name.trim()
      : "") ||
    null;

  const orderTags = orderTagsFromSpecs(order.specs);
  const isDesignerUnassigned = !designerName;
  const activeWarning = getActiveWarning(order, warningRules);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    ...(activeWarning && !animateWarnings
      ? { borderColor: CARD_WARNING_BORDER_COLORS[activeWarning.rule.color] }
      : {}),
  };

  // Derive a 70%-opacity version of the column accent colour for the title.
  const titleColor = (() => {
    if (!columnColor) return undefined;
    const hex = columnColor.replace("#", "");
    if (hex.length !== 6) return undefined;
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r},${g},${b},0.7)`;
  })();

  const [copied, setCopied] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  // Right-click context menu
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClose(e: MouseEvent | KeyboardEvent) {
      if (e instanceof KeyboardEvent) {
        if (e.key === "Escape") setMenuOpen(false);
        return;
      }
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClose);
    document.addEventListener("keydown", handleClose);
    return () => {
      document.removeEventListener("mousedown", handleClose);
      document.removeEventListener("keydown", handleClose);
    };
  }, [menuOpen]);

  function handleContextMenu(e: React.MouseEvent) {
    if (!availableColumns.length || !onMoveToColumn) return;
    e.preventDefault();
    e.stopPropagation();
    setMenuPos({ x: e.clientX, y: e.clientY });
    setMenuOpen(true);
  }

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

  const summaryTrailingParts = [
    productName || null,
    materialsName || null,
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
      onContextMenu={handleContextMenu}
      className={cn(
        "group relative shrink-0 overflow-hidden rounded-md border shadow-sm transition-shadow hover:shadow-md",
        isDesignerUnassigned
          ? UNASSIGNED_DESIGNER_CARD_CLASS
          : "border-slate-200 bg-white",
        canDrag ? "cursor-pointer" : "cursor-default",
        activeWarning && animateWarnings ? `warning-${activeWarning.rule.color}` : ""
      )}
    >
      {/* padded content wrapper */}
      <div className={expanded ? "p-2.5" : "p-2"}>
      {activeWarning ? (
        <span
          className={`warning-dot-${activeWarning.rule.color} absolute right-1.5 top-1.5 h-2 w-2 rounded-full`}
          title={`${activeWarning.rule.name}: card hasn't moved in ${activeWarning.daysSinceMoved} working day${activeWarning.daysSinceMoved === 1 ? "" : "s"}`}
        />
      ) : null}
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
              {/* Customer name + short order number on same line */}
              <div className="flex items-center justify-between gap-1">
                <div className="flex min-w-0 items-baseline gap-1.5">
                  {displayCustomerName ? (
                    <button
                      type="button"
                      onClick={(e) => copyText(e, displayCustomerName, "customer-name")}
                      onPointerDown={(e) => e.stopPropagation()}
                      title="Copy customer name"
                      className="group/copy flex min-w-0 items-center gap-0.5 text-left text-sm font-bold leading-tight text-slate-900 hover:text-[var(--primary)]"
                    >
                      <span className="truncate">
                        {copied === "customer-name" ? "Copied!" : displayCustomerName}
                      </span>
                      {copied === "customer-name" ? null : (
                        <Copy className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover/copy:opacity-100" />
                      )}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={(e) => copyText(e, order.title, "order")}
                    onPointerDown={(e) => e.stopPropagation()}
                    title={`Copy order number (${order.title})`}
                      className="group/copy flex shrink-0 items-center gap-0.5 text-left text-sm font-bold leading-tight text-slate-900 hover:text-[var(--primary)]"
                  >
                    <span>
                      {copied === "order"
                        ? "Copied"
                        : order.title.replace(/^ORD-\d{4}-/, "").replace(/^0+(\d)/, "$1")}
                    </span>
                    <Copy className="h-2.5 w-2.5 shrink-0 opacity-0 transition-opacity group-hover/copy:opacity-100" />
                  </button>
                </div>
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

              <p className="mt-0.5 flex min-w-0 items-center gap-1 truncate text-[10px] leading-tight text-slate-400">
                <Clock className="h-2.5 w-2.5 shrink-0" />
                <span className="shrink-0">{formatDateShort(order.created_at)}</span>
                {summaryTrailingParts.length > 0 ? (
                  <span className="truncate text-slate-500">· {summaryTrailingParts.join(" · ")}</span>
                ) : null}
              </p>
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

          {/* Divider */}
          <div className="mt-1.5 border-t border-slate-100" />

          {/* Footer — always visible */}
          <div className="mt-1.5 flex items-center justify-between gap-1.5">
            <div className="flex min-w-0 items-center gap-1.5 truncate">
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
              {orderTags.map((tag) => (
                <span
                  key={tag}
                  className={cn(
                    "inline-flex shrink-0 items-center rounded-full border px-1.5 py-px text-[10px] font-medium",
                    ORDER_TAG_STYLES[tag] ??
                      "border-slate-200 bg-slate-100 text-slate-600"
                  )}
                >
                  {tag}
                </span>
              ))}
              <span
                className={cn(
                  "inline-flex min-w-0 items-center gap-1 truncate rounded-full px-2 py-0.5 text-[11px] font-semibold",
                  isDesignerUnassigned
                    ? UNASSIGNED_DESIGNER_TEXT_CLASS
                    : "bg-[var(--primary)]/10 text-[var(--primary)]"
                )}
                title="Assigned designer"
              >
                <User
                  className={cn(
                    "h-3 w-3 shrink-0",
                    isDesignerUnassigned
                      ? "text-amber-600"
                      : "text-[var(--primary)]"
                  )}
                />
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
                  <span
                    className={cn(
                      "inline-flex items-center gap-0.5 font-medium",
                      isDesignerUnassigned
                        ? UNASSIGNED_DESIGNER_TEXT_CLASS
                        : "text-slate-700"
                    )}
                  >
                    <User
                      className={cn(
                        "h-2.5 w-2.5 shrink-0",
                        isDesignerUnassigned
                          ? "text-amber-600"
                          : "text-[var(--primary)]"
                      )}
                    />
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
                    <div className="flex items-center gap-1">
                      <User className="h-3 w-3 shrink-0 text-slate-400" />
                      <CopyableText
                        text={displayCustomerName}
                        copyKey="customer-name-exp"
                        title="Copy customer name"
                      />
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
      </div>{/* end padded content wrapper */}

      {/* Full-width tag footer bar */}
      {order.tag ? (
        <div
          style={{ backgroundColor: order.tag.color ?? "#e2e8f0" }}
          className="w-full py-1 text-center text-xs font-medium tracking-wide text-white"
        >
          {order.tag.name}
        </div>
      ) : null}

      {/* Right-click move menu — rendered via portal-like fixed positioning */}
      {menuOpen && availableColumns.length > 0 && onMoveToColumn ? (
        <div
          ref={menuRef}
          style={{
            top: menuPos.y,
            left: menuPos.x,
            maxHeight: `calc(100dvh - ${menuPos.y}px - 8px)`,
          }}
          className="fixed z-50 flex min-w-[11rem] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <p className="flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            <MoveRight className="h-3 w-3" />
            Move to
          </p>
          <div className="overflow-y-auto py-1">
            {availableColumns.map((col) => (
              <button
                key={col.id}
                type="button"
                onClick={() => {
                  onMoveToColumn(order, col.id);
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full border border-slate-200"
                  style={{ backgroundColor: col.color ?? "#e2e8f0" }}
                />
                <span className="truncate">{col.name}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
