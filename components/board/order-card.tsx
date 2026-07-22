"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Image from "next/image";
import {
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  CreditCard,
  Car,
  MapPin,
  MoveRight,
  Timer,
  Truck,
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
  UNASSIGNED_OWNER_TEXT_CLASS,
} from "@/lib/constants";
import { dueDateBadgeClass, dueDateStatus } from "@/lib/board-due-date";
import type { ColumnKind } from "@/lib/types";
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
import {
  getActiveWarning,
  formatTimeInColumn,
  CARD_WARNING_BORDER_COLORS,
} from "@/lib/card-warning-rules";
import type {
  ButtonAutomation,
  CardWarningRule,
  CustomField,
  OrderWithRelations,
} from "@/lib/types";
import type { BoardShippingSign } from "@/lib/board-shipping";
import {
  shippingCardBorderColor,
  shippingTagClass,
} from "@/lib/board-shipping";
import type { WebhookSourceStyles } from "@/lib/webhook-source-styles";
import { WebhookSourceLabel } from "./webhook-source-label";
import { sharedOrderTitle } from "@/lib/group-orders";
import { OrderBillingGlobe } from "./order-billing-globe";
import { billingFromSpecs, hasBillingInfo } from "@/lib/order-billing";
import { ActionButton, type ActionButtonResult } from "./action-button";

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
  /** Signed URLs of all image assets — shown as a gallery in compact mode. */
  thumbnails?: string[];
  /** Resolved designer display name (from specs or team list). */
  designerName?: string;
  notificationBadge?: CardNotificationBadge;
  ownerName?: string;
  /** ISO timestamp when the customer last approved artwork. */
  approvalDate?: string | null;
  /** Client shipping choice after they responded on the portal. */
  shippingSign?: BoardShippingSign;
  groupSize?: number;
  warningRules?: CardWarningRule[];
  animateWarnings?: boolean;
  warningWorkingDays?: number[];
  webhookSourceStyles?: WebhookSourceStyles;
  /** Column accent color (hex) — used to tint the customer name at 70% opacity. */
  columnColor?: string | null;
  /** Used to skip overdue badges in terminal (done) columns. */
  columnKind?: ColumnKind | null;
  /** Columns the user is allowed to move this card to (pre-filtered by board). */
  availableColumns?: ColumnOption[];
  /** Called when the user selects a column from the right-click menu. */
  onMoveToColumn?: (order: OrderWithRelations, targetColumnId: string) => void;
  /** Admin-only automations visible for this card's column (shown by name). */
  actionButtons?: ButtonAutomation[];
  appUrl?: string;
  onActionComplete?: (
    order: OrderWithRelations,
    result: ActionButtonResult
  ) => void;
  onActionError?: (message: string) => void;
  onOpen: (order: OrderWithRelations) => void;
}

export function OrderCard({
  order,
  canDrag = true,
  customFields = [],
  fieldValues = {},
  thumbnails,
  designerName: designerNameProp,
  notificationBadge,
  ownerName,
  approvalDate = null,
  shippingSign,
  groupSize,
  warningRules = [],
  animateWarnings = true,
  warningWorkingDays = [1, 2, 3, 4, 5],
  webhookSourceStyles,
  columnColor,
  columnKind = null,
  availableColumns = [],
  onMoveToColumn,
  actionButtons = [],
  appUrl = "",
  onActionComplete,
  onActionError,
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

  const isOwnerUnassigned = !order.created_by;
  const dueStatus = dueDateStatus(order.due_date, {
    inDoneColumn: columnKind === "done",
  });

  const orderTags = orderTagsFromSpecs(order.specs);
  const isDesignerUnassigned = !designerName;
  const activeWarning = getActiveWarning(order, warningRules, warningWorkingDays);
  const timeHere = formatTimeInColumn(
    order.last_moved_at,
    Date.now(),
    warningWorkingDays
  );
  const shippingBorderColor =
    !activeWarning ? shippingCardBorderColor(shippingSign) : null;

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    // Animated warnings set border-color in keyframes; avoid an inline color fighting them.
    ...(activeWarning && !animateWarnings
      ? { borderColor: CARD_WARNING_BORDER_COLORS[activeWarning.rule.color] }
      : !activeWarning && shippingBorderColor
        ? { borderColor: shippingBorderColor }
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

  const hasMoveMenu =
    availableColumns.length > 0 && Boolean(onMoveToColumn);
  const hasActionMenu = actionButtons.length > 0;
  const hasContextMenu = hasMoveMenu || hasActionMenu;

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

  // Keep the menu fully on-screen (flip up / shift left when near edges).
  useLayoutEffect(() => {
    if (!menuOpen || !menuRef.current) return;
    const el = menuRef.current;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let x = menuPos.x;
    let y = menuPos.y;
    if (x + rect.width > window.innerWidth - pad) {
      x = Math.max(pad, window.innerWidth - rect.width - pad);
    }
    if (y + rect.height > window.innerHeight - pad) {
      y = Math.max(pad, window.innerHeight - rect.height - pad);
    }
    if (x !== menuPos.x || y !== menuPos.y) {
      setMenuPos({ x, y });
    }
  }, [
    menuOpen,
    menuPos.x,
    menuPos.y,
    hasActionMenu,
    hasMoveMenu,
    actionButtons.length,
    availableColumns.length,
  ]);

  function handleContextMenu(e: React.MouseEvent) {
    if (!hasContextMenu) return;
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
          "group/copy inline-flex max-w-full items-center gap-1 text-left text-[13px] font-medium text-slate-700 hover:text-[var(--primary)]",
          className
        )}
      >
        <span className="min-w-0 truncate">
          {copied === copyKey ? "Copied" : text}
        </span>
        <span className="inline-flex shrink-0 items-center text-[11px] font-normal text-slate-400 group-hover/copy:text-[var(--primary)]">
          {copied === copyKey ? null : (
            <Copy className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover/copy:opacity-100" />
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
        "group relative @container shrink-0 overflow-hidden rounded-md border-2",
        activeWarning && animateWarnings
          ? ""
          : "shadow-sm transition-shadow hover:shadow-md",
        isDesignerUnassigned
          ? UNASSIGNED_DESIGNER_CARD_CLASS
          : "bg-white",
        !shippingBorderColor && !activeWarning ? "border-slate-200" : "",
        canDrag ? "cursor-pointer" : "cursor-default",
        activeWarning && animateWarnings ? `warning-${activeWarning.rule.color}` : ""
      )}
      data-order-card=""
      data-order-id={order.id}
    >
      {/* padded content wrapper */}
      <div className={expanded ? "px-3.5 py-4" : "px-3 py-3.5"}>
      {activeWarning ? (
        <span
          className={`warning-dot-${activeWarning.rule.color} absolute right-9 top-2 z-10 h-2.5 w-2.5 rounded-full`}
          title={`${activeWarning.rule.name}: card hasn't moved in ${activeWarning.daysSinceMoved} working day${activeWarning.daysSinceMoved === 1 ? "" : "s"}`}
        />
      ) : null}
      {/* Top row: thumbnail + header info */}
      <div className="flex items-start gap-2.5">
        {thumbnails && thumbnails.length > 0 ? (
          <Image
            src={thumbnails[0]}
            alt=""
            width={80}
            height={80}
            className="h-20 w-20 shrink-0 rounded object-cover"
            unoptimized
          />
        ) : null}

        <div className="min-w-0 flex-1">
          {/* Compact header — always visible */}
          <div className="flex items-start gap-1.5">
            <div className="min-w-0 flex-1">
              {/* Customer name on first line, order number on second — each truncates with … */}
              <div className="min-w-0 flex-1">
                <WebhookSourceLabel
                  webhookSource={order.webhook_source}
                  sourceStyles={webhookSourceStyles}
                  orderTitle={sharedOrderTitle(order)}
                />
                {displayCustomerName ? (
                  <button
                    type="button"
                    onClick={(e) => copyText(e, displayCustomerName, "customer-name")}
                    onPointerDown={(e) => e.stopPropagation()}
                    title="Copy customer name"
                    className="group/copy inline-flex max-w-full items-center gap-0.5 text-left text-[15px] font-bold leading-snug text-slate-900 hover:text-[var(--primary)]"
                  >
                    <span className="min-w-0 truncate">
                      {copied === "customer-name" ? "Copied!" : displayCustomerName}
                    </span>
                    {copied === "customer-name" ? null : (
                      <Copy className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover/copy:opacity-100" />
                    )}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={(e) => copyText(e, order.title, "order")}
                  onPointerDown={(e) => e.stopPropagation()}
                  title={`Copy order number (${order.title})`}
                  className="group/copy inline-flex max-w-full items-center gap-0.5 text-left text-[15px] font-bold leading-snug text-slate-900 hover:text-[var(--primary)]"
                >
                  <span className="min-w-0 truncate">
                    {copied === "order" ? (
                      "Copied!"
                    ) : (
                      <>
                        {order.title
                          .replace(/^ORD-\d{4}-/, "")
                          .replace(/^0+(\d)/, "$1")}
                        {groupSize != null && groupSize >= 2 ? (
                          <span className="font-normal text-slate-400">
                            {" "}
                            ({groupSize})
                          </span>
                        ) : null}
                      </>
                    )}
                  </span>
                  {copied === "order" ? null : (
                    <Copy className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover/copy:opacity-100" />
                  )}
                </button>
                {summaryTrailingParts.length > 0 ||
                hasBillingInfo(billingFromSpecs(order.specs)) ? (
                  <p
                    lang="en"
                    className="mt-1 w-full pr-1 text-[11px] leading-snug text-slate-500 [hyphens:auto] [overflow-wrap:break-word] [word-break:normal]"
                  >
                    {summaryTrailingParts.length > 0 ? (
                      <span>
                        · {summaryTrailingParts.join(" · ")}
                        {hasBillingInfo(billingFromSpecs(order.specs)) ? (
                          <>
                            {" "}
                            <OrderBillingGlobe
                              specs={order.specs}
                              className="inline-flex align-middle"
                            />
                          </>
                        ) : null}
                      </span>
                    ) : (
                      <OrderBillingGlobe
                        specs={order.specs}
                        className="inline-flex align-middle"
                      />
                    )}
                  </p>
                ) : null}
              </div>

              {shippingSign ? (
              <div className="mt-1.5 flex items-center gap-2">
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                    shippingTagClass(shippingSign)
                  )}
                  title={shippingSign.title}
                >
                  {shippingSign.kind === "awaiting" ? (
                    <Clock className="h-3 w-3" />
                  ) : shippingSign.kind === "payment_pending" ? (
                    <CreditCard className="h-3 w-3" />
                  ) : shippingSign.kind === "pickup" ? (
                    <MapPin className="h-3 w-3" />
                  ) : shippingSign.kind === "uber" ||
                    shippingSign.kind === "curri" ? (
                    <Car className="h-3 w-3" />
                  ) : (
                    <Truck className="h-3 w-3" />
                  )}
                  {shippingSign.label}
                </span>
              </div>
              ) : null}
            </div>

            <button
              type="button"
              onClick={toggleExpanded}
              onPointerDown={(e) => e.stopPropagation()}
              title={expanded ? "Show less" : "Show more"}
              aria-expanded={expanded}
              className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              {expanded ? (
                <ChevronUp className="h-5 w-5" />
              ) : (
                <ChevronDown className="h-5 w-5" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Divider — full card width */}
      <div className="mt-2.5 border-t border-slate-100" />

      {/* Dates + priority — below separator, above footer tags */}
      <div className="mt-2 flex w-full items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] leading-none text-slate-500">
          <span
            className="inline-flex items-center gap-0.5"
            title={`Created ${formatDate(order.created_at)}`}
          >
            <Clock className="h-3 w-3 shrink-0 text-slate-400" />
            {formatDateShort(order.created_at)}
          </span>
          {order.due_date ? (
            <span
              className="inline-flex items-center gap-0.5 font-medium text-slate-600"
              title={`Due ${formatDate(order.due_date)}`}
            >
              <CalendarClock className="h-3 w-3 shrink-0" />
              {formatDateShort(order.due_date)}
            </span>
          ) : (
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-1.5 py-px text-[10px] font-medium",
                dueDateBadgeClass(dueStatus)
              )}
            >
              {dueStatus.label}
            </span>
          )}
          {dueStatus.kind === "late" ||
          dueStatus.kind === "today" ||
          dueStatus.kind === "soon" ? (
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-1.5 py-px text-[10px] font-semibold",
                dueDateBadgeClass(dueStatus)
              )}
              title={
                order.due_date ? `Due ${formatDate(order.due_date)}` : undefined
              }
            >
              {dueStatus.label}
            </span>
          ) : null}
          {timeHere ? (
            <span
              className="inline-flex items-center gap-0.5"
              title={timeHere.title}
            >
              <Timer className="h-3 w-3 shrink-0 text-slate-400" />
              {timeHere.label}
            </span>
          ) : null}
          {approvalDate ? (
            <span
              className="inline-flex items-center gap-0.5 text-green-700"
              title={`Approved ${formatDate(approvalDate)}`}
            >
              <CheckCircle2 className="h-3 w-3 shrink-0" />
              {formatDateShort(approvalDate)}
            </span>
          ) : null}
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
            PRIORITY_STYLES[order.priority]
          )}
        >
          {order.priority}
        </span>
      </div>

      {/* Footer — full-width row; each chip gets flex-1 so all chips together = 100% card width */}
      <div className="mt-2 flex w-full items-stretch overflow-hidden rounded-full text-[clamp(9px,3.1cqi,11px)]">
        {notificationBadge && orderTags.length === 0 ? (
          <span
            className={cn(
              "flex flex-1 min-w-0 items-center justify-center px-1.5 py-0.5 font-medium",
              CARD_BADGE_STYLES[notificationBadge]
            )}
          >
            <span className="truncate">{CARD_BADGE_LABELS[notificationBadge]}</span>
          </span>
        ) : null}
        {orderTags.map((tag) => (
          <span
            key={tag}
            className={cn(
              "flex flex-1 min-w-0 items-center justify-center px-1.5 py-0.5 font-medium",
              ORDER_TAG_STYLES[tag] ??
                "bg-slate-100 text-slate-600"
            )}
          >
            <span className="truncate">{tag}</span>
          </span>
        ))}
        <span
          className={cn(
            "flex flex-1 min-w-0 items-center justify-center gap-0.5 px-1.5 py-0.5 font-semibold",
            isDesignerUnassigned
              ? UNASSIGNED_DESIGNER_TEXT_CLASS
              : "bg-[var(--primary)]/10 text-[var(--primary)]"
          )}
          title="Assigned designer"
        >
          <User
            className={cn(
              "h-[1em] w-[1em] shrink-0",
              isDesignerUnassigned ? "text-amber-600" : "text-[var(--primary)]"
            )}
          />
          <span className="min-w-0 truncate">{designerName ?? "Unassigned"}</span>
        </span>
        {isOwnerUnassigned || ownerName ? (
          <span
            className={cn(
              "flex flex-1 min-w-0 items-center justify-center gap-0.5 px-1.5 py-0.5 font-semibold",
              isOwnerUnassigned
                ? UNASSIGNED_OWNER_TEXT_CLASS
                : "bg-slate-100 text-slate-500"
            )}
            title={isOwnerUnassigned ? "No owner assigned" : "Order owner"}
          >
            <User
              className={cn(
                "h-[1em] w-[1em] shrink-0",
                isOwnerUnassigned ? "text-amber-600" : "text-slate-400"
              )}
            />
            <span className="min-w-0 truncate">
              {isOwnerUnassigned ? "Unassigned" : ownerName}
            </span>
          </span>
        ) : null}
      </div>

      {/* Expanded details */}
      {expanded ? (
        <div
          className="mt-2.5 space-y-2.5 border-t border-slate-100 pt-2.5"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] leading-snug">
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
                    "h-3.5 w-3.5 shrink-0",
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
            <div className="space-y-1">
              <WebhookSourceLabel
                webhookSource={order.webhook_source}
                sourceStyles={webhookSourceStyles}
                orderTitle={sharedOrderTitle(order)}
              />
              {displayCustomerName ? (
                <div className="flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5 shrink-0 text-slate-400" />
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
            <div className="flex flex-wrap gap-1.5">
              {specFields.map(({ field, label, display }) => (
                <span
                  key={field.id}
                  className="inline-flex max-w-full items-center gap-0.5 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600"
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
                <span className="inline-flex items-center rounded border border-blue-200/80 bg-[#dbeafe] px-1.5 py-0.5 text-[11px] text-[#1e40af]">
                  SKU: {skuCount}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      </div>{/* end padded content wrapper */}

      {/* Full-width tag footer bar — bar height fixed; font −20% from 13px */}
      {order.tag ? (
        <div
          style={{ backgroundColor: order.tag.color ?? "#e2e8f0" }}
          className="flex h-[14.3px] w-full items-center justify-center overflow-hidden text-[10.4px] font-medium leading-none tracking-wide text-white"
        >
          {order.tag.name}
        </div>
      ) : null}

      {/* Right-click admin actions / move menu */}
      {menuOpen && hasContextMenu ? (
        <div
          ref={menuRef}
          style={{
            top: menuPos.y,
            left: menuPos.x,
            maxHeight: "calc(100dvh - 16px)",
          }}
          className="fixed z-50 flex min-w-[11rem] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {hasActionMenu ? (
            <div className="shrink-0 border-b border-slate-100 py-1">
              {actionButtons.map((btn) => (
                <ActionButton
                  key={btn.id}
                  appearance="menu"
                  button={btn}
                  orderId={order.id}
                  orderNumber={order.title}
                  appUrl={appUrl}
                  groupSize={groupSize}
                  customerEmail={email ?? order.customer?.email}
                  customerPhone={phone ?? order.customer?.phone}
                  productLabel={productName || null}
                  onComplete={(result) => {
                    setMenuOpen(false);
                    onActionComplete?.(order, result);
                  }}
                  onError={(message) => onActionError?.(message)}
                />
              ))}
            </div>
          ) : null}
          {hasMoveMenu ? (
            <>
              <p className="flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                <MoveRight className="h-3 w-3" />
                Move to
              </p>
              <div className="min-h-0 flex-1 overflow-y-auto py-1">
                {availableColumns.map((col) => (
                  <button
                    key={col.id}
                    type="button"
                    onClick={() => {
                      onMoveToColumn?.(order, col.id);
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
            </>
          ) : null}
        </div>
      ) : null}

    </div>
  );
}
