"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  CalendarClock,
  Clock,
  CreditCard,
  Car,
  Eye,
  EyeOff,
  MapPin,
  MoveRight,
  Truck,
  User,
} from "lucide-react";
import { cn, formatDateShort } from "@/lib/utils";
import {
  cardOrderQty,
  cardSkuCount,
  findOrderFormField,
} from "@/lib/order-form";
import {
  customerContactFromOrder,
  customerNameFromOrder,
} from "@/lib/notification-messages";
import {
  CARD_BADGE_LABELS,
  CARD_BADGE_STYLES,
  type CardNotificationBadge,
} from "@/lib/card-badges";
import {
  PRIORITY_STYLES,
  UNASSIGNED_DESIGNER_TEXT_CLASS,
} from "@/lib/constants";
import { orderTagsFromSpecs } from "@/lib/order-tags";
import { getActiveWarning, CARD_WARNING_BORDER_COLORS } from "@/lib/card-warning-rules";
import { OrderBillingGlobe } from "./order-billing-globe";
import { ActionButton, type ActionButtonResult } from "./action-button";
import { filterButtonsForColumn } from "@/lib/button-automations";
import type {
  BoardColumn,
  ButtonAutomation,
  CardWarningRule,
  CustomField,
  OrderWithRelations,
  Role,
} from "@/lib/types";
import type { BoardShippingSign } from "@/lib/board-shipping";
import { shippingTagClass } from "@/lib/board-shipping";
import type { WebhookSourceStyles } from "@/lib/webhook-source-styles";
import { WebhookSourceLabel } from "./webhook-source-label";

interface ColumnOption {
  id: string;
  name: string;
  color: string | null;
}

interface BoardTableProps {
  columns: BoardColumn[];
  hiddenColIds: Set<string>;
  onToggleColumnVisibility: (columnId: string) => void;
  orders: OrderWithRelations[];
  customFields: CustomField[];
  fieldValuesByOrder: Record<string, Record<string, unknown>>;
  thumbnailByOrder: Record<string, string[]>;
  designerNameByOrder: Record<string, string>;
  notificationBadgeByOrder: Record<string, CardNotificationBadge>;
  ownerNameByOrder: Record<string, string>;
  shippingSignByOrder?: Record<string, BoardShippingSign>;
  groupSizeByOrder?: Record<string, number>;
  warningRules?: CardWarningRule[];
  animateWarnings?: boolean;
  warningWorkingDays?: number[];
  webhookSourceStyles?: WebhookSourceStyles;
  role: Role;
  getMoveableColumns: (fromColumnId: string) => ColumnOption[];
  onMoveToColumn: (order: OrderWithRelations, toColumnId: string) => void;
  buttonAutomations?: ButtonAutomation[];
  appUrl?: string;
  onActionComplete?: (
    order: OrderWithRelations,
    result: ActionButtonResult
  ) => void;
  onActionError?: (message: string) => void;
  onOpenOrder: (order: OrderWithRelations) => void;
  onVisible: (columnId: string) => void;
}

interface MenuState {
  order: OrderWithRelations;
  x: number;
  y: number;
}

export function BoardTable({
  columns,
  hiddenColIds,
  onToggleColumnVisibility,
  orders,
  customFields,
  fieldValuesByOrder,
  thumbnailByOrder,
  designerNameByOrder,
  notificationBadgeByOrder,
  ownerNameByOrder,
  shippingSignByOrder = {},
  groupSizeByOrder = {},
  warningRules = [],
  animateWarnings = true,
  warningWorkingDays = [1, 2, 3, 4, 5],
  webhookSourceStyles,
  role,
  getMoveableColumns,
  onMoveToColumn,
  buttonAutomations = [],
  appUrl = "",
  onActionComplete,
  onActionError,
  onOpenOrder,
  onVisible,
}: BoardTableProps) {
  const [menuState, setMenuState] = useState<MenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // ── Resizable Order column ────────────────────────────────────────────────
  const STORAGE_KEY = "board-table-order-col-width";
  const MIN_WIDTH = 140;
  const MAX_WIDTH = 480;

  const [orderColWidth, setOrderColWidth] = useState<number>(() => {
    if (typeof window === "undefined") return 220;
    const stored = localStorage.getItem(STORAGE_KEY);
    const parsed = stored ? parseInt(stored, 10) : NaN;
    return !isNaN(parsed) && parsed >= MIN_WIDTH && parsed <= MAX_WIDTH ? parsed : 220;
  });

  const dragStartX = useRef<number | null>(null);
  const dragStartWidth = useRef<number>(220);

  function onResizeMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    dragStartX.current = e.clientX;
    dragStartWidth.current = orderColWidth;

    function onMouseMove(ev: MouseEvent) {
      if (dragStartX.current === null) return;
      const delta = ev.clientX - dragStartX.current;
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragStartWidth.current + delta));
      setOrderColWidth(next);
    }

    function onMouseUp() {
      dragStartX.current = null;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      // Persist after drag ends
      setOrderColWidth((w) => {
        localStorage.setItem(STORAGE_KEY, String(w));
        return w;
      });
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }

  // Hiding a column also filters out rows currently in that column.
  const visibleOrders =
    hiddenColIds.size === 0
      ? orders
      : orders.filter((o) => !hiddenColIds.has(o.column_id));

  // Trigger lazy-load for all columns when table mounts — all are "visible"
  // in table view since there's no horizontal scroll per-column IntersectionObserver.
  useEffect(() => {
    for (const col of columns) {
      onVisible(col.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close right-click menu on outside click or Escape.
  useEffect(() => {
    if (!menuState) return;
    function close(e: MouseEvent | KeyboardEvent) {
      if (e instanceof KeyboardEvent) {
        if (e.key === "Escape") setMenuState(null);
        return;
      }
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuState(null);
      }
    }
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menuState]);

  const productField = findOrderFormField(customFields, "Product");
  const materialsField = findOrderFormField(customFields, "Materials");

  return (
    <div className="board-scroll min-h-0 flex-1 overflow-auto px-4 pb-4">
      <table className="border-collapse text-sm">
        {/* ── Sticky header ───────────────────────────────────── */}
        <thead>
          <tr>
            {/* Order info column — user-resizable */}
            <th
              scope="col"
              style={{ width: orderColWidth, minWidth: orderColWidth, maxWidth: orderColWidth }}
              className="sticky left-0 top-0 z-20 border-b border-r border-slate-200 bg-slate-50 px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
            >
              <div className="relative flex items-center">
                Order
                {/* Resize handle */}
                <div
                  onMouseDown={onResizeMouseDown}
                  className="absolute -right-2 top-0 z-10 flex h-full w-4 cursor-col-resize items-center justify-center"
                  title="Drag to resize column"
                >
                  <div className="h-4 w-0.5 rounded-full bg-slate-300 transition-colors hover:bg-slate-500" />
                </div>
              </div>
            </th>
            {/* Tags / people column */}
            <th
              scope="col"
              className="sticky top-0 z-10 w-px border-b border-r border-slate-200 bg-slate-50 px-2 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap"
            >
              Tags
            </th>
            {/* One column per kanban stage */}
            {columns.map((col) => {
              const isHidden = hiddenColIds.has(col.id);
              return (
                <th
                  key={col.id}
                  scope="col"
                  className={cn(
                    "group/th sticky top-0 z-10 border-b border-r border-slate-200 bg-slate-50 px-2 py-2.5 text-center text-xs font-semibold text-slate-600 transition-all",
                    isHidden ? "w-8" : "w-px"
                  )}
                >
                  {isHidden ? (
                    // Collapsed state — just the eye-off icon
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onToggleColumnVisibility(col.id); }}
                      title={`Show "${col.name}"`}
                      className="flex w-full items-center justify-center text-slate-300 hover:text-slate-600"
                    >
                      <EyeOff className="h-3.5 w-3.5" />
                    </button>
                  ) : (
                    // Visible state — name + eye icon on hover
                    <div className="flex items-center justify-center gap-1.5 whitespace-nowrap">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: col.color ?? "#94a3b8" }}
                      />
                      <span className="truncate">{col.name}</span>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onToggleColumnVisibility(col.id); }}
                        title={`Hide "${col.name}"`}
                        className="ml-0.5 shrink-0 rounded p-0.5 text-slate-300 opacity-0 transition-opacity group-hover/th:opacity-100 hover:text-slate-600"
                      >
                        <Eye className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </th>
              );
            })}
            {/* Filler — absorbs remaining horizontal space */}
            <th scope="col" className="sticky top-0 z-10 w-full border-b border-slate-200 bg-slate-50" />
          </tr>
        </thead>

        {/* ── Body ────────────────────────────────────────────── */}
        <tbody>
          {visibleOrders.length === 0 ? (
            <tr>
              <td
                colSpan={columns.filter(c => !hiddenColIds.has(c.id)).length + 2}
                className="py-12 text-center text-sm text-slate-400"
              >
                No orders match the current filters.
              </td>
            </tr>
          ) : null}

          {visibleOrders.map((order) => {
            const fieldValues = fieldValuesByOrder[order.id] ?? {};
            const thumbnail = thumbnailByOrder[order.id]?.[0];
            const designerName =
              designerNameByOrder[order.id]?.trim() ||
              (typeof order.specs?.designer_name === "string"
                ? order.specs.designer_name.trim()
                : "") ||
              null;
            const notificationBadge = notificationBadgeByOrder[order.id];
            const ownerName = ownerNameByOrder[order.id];
            const shippingSign = shippingSignByOrder[order.id];

            const customerName = customerNameFromOrder(
              order,
              fieldValues,
              customFields
            );
            const displayCustomerName =
              customerName === "there" ? null : customerName;

            const productName = productField
              ? String(fieldValues[productField.id] ?? "").trim()
              : "";
            const materialsName = materialsField
              ? String(fieldValues[materialsField.id] ?? "").trim()
              : "";
            const orderQty = cardOrderQty(customFields, fieldValues, order.specs);
            const skuCount = cardSkuCount(order.specs);

            const orderTags = orderTagsFromSpecs(order.specs);
            const activeWarning = getActiveWarning(
              order,
              warningRules,
              warningWorkingDays
            );
            const isDesignerUnassigned = !designerName;

            const moveableColumns = getMoveableColumns(order.column_id);
            const moveableIds = new Set(moveableColumns.map((c) => c.id));

            const summaryParts = [
              productName || null,
              materialsName || null,
              orderQty != null ? `qty ${orderQty}` : null,
              skuCount > 0 ? `${skuCount} SKU` : null,
            ].filter(Boolean);

            const warningBorderStyle =
              activeWarning && !animateWarnings
                ? { borderLeftColor: CARD_WARNING_BORDER_COLORS[activeWarning.rule.color] }
                : undefined;

            return (
              <tr
                key={order.id}
                data-order-id={order.id}
                className="cursor-pointer border-b border-slate-100 hover:bg-slate-50/60"
                onClick={() => onOpenOrder(order)}
                onContextMenu={(e) => {
                  if (!moveableColumns.length) return;
                  e.preventDefault();
                  setMenuState({ order, x: e.clientX, y: e.clientY });
                }}
              >
                {/* ── Order info cell (sticky left) ────────────── */}
                <td
                  className={cn(
                    "sticky left-0 z-10 border-r border-slate-200 bg-white px-3 py-1.5",
                    activeWarning && !animateWarnings ? "border-l-2" : "border-l-0"
                  )}
                  style={{ width: orderColWidth, minWidth: orderColWidth, maxWidth: orderColWidth, ...warningBorderStyle }}
                >
                  <div className="flex items-start gap-2">
                    {thumbnail ? (
                      <Image
                        src={thumbnail}
                        alt=""
                        width={32}
                        height={32}
                        className="h-8 w-8 shrink-0 rounded object-cover"
                        unoptimized
                      />
                    ) : null}

                    <div className="min-w-0 flex-1">
                      <WebhookSourceLabel
                        webhookSource={order.webhook_source}
                        sourceStyles={webhookSourceStyles}
                      />
                      {/* Customer + order number */}
                      <div className="flex items-baseline gap-1.5">
                        {displayCustomerName ? (
                          <span className="truncate text-sm font-bold leading-tight text-slate-800">
                            {displayCustomerName}
                          </span>
                        ) : null}
                        <span className="shrink-0 text-sm font-semibold leading-tight text-slate-700">
                          {order.title
                            .replace(/^ORD-\d{4}-/, "")
                            .replace(/^0+(\d)/, "$1")}
                          {(groupSizeByOrder[order.id] ?? 0) >= 2 ? (
                            <span className="font-normal text-slate-400"> ({groupSizeByOrder[order.id]})</span>
                          ) : null}
                        </span>
                      </div>

                      {/* Dates + spec summary */}
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        {order.due_date ? (
                          <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-500">
                            <CalendarClock className="h-2.5 w-2.5 shrink-0" />
                            {formatDateShort(order.due_date)}
                          </span>
                        ) : null}
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-400">
                          <Clock className="h-2.5 w-2.5 shrink-0" />
                          {formatDateShort(order.created_at)}
                        </span>
                        {summaryParts.length > 0 ? (
                          <span className="text-[10px] text-slate-500">
                            {summaryParts.join(" · ")}
                          </span>
                        ) : null}
                      </div>

                    </div>
                  </div>
                </td>

                {/* ── People / tags cell ────────────────────────── */}
                <td className="w-px border-r border-slate-200 px-2 py-1.5 align-top">
                  <div className="flex flex-col gap-1">
                    {notificationBadge ? (
                      <span
                        className={cn(
                          "inline-flex items-center whitespace-nowrap rounded-full border px-1.5 py-px text-[10px] font-medium",
                          CARD_BADGE_STYLES[notificationBadge]
                        )}
                      >
                        {CARD_BADGE_LABELS[notificationBadge]}
                      </span>
                    ) : null}
                    {orderTags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center whitespace-nowrap rounded-full border border-slate-200 bg-slate-100 px-1.5 py-px text-[10px] font-medium text-slate-600"
                      >
                        {tag}
                      </span>
                    ))}
                    <span
                      className={cn(
                        "inline-flex items-center gap-0.5 whitespace-nowrap rounded-full px-1.5 py-px text-[10px] font-semibold",
                        isDesignerUnassigned
                          ? UNASSIGNED_DESIGNER_TEXT_CLASS
                          : "bg-[var(--primary)]/10 text-[var(--primary)]"
                      )}
                    >
                      <User className="h-2.5 w-2.5 shrink-0" />
                      {designerName ?? "Unassigned"}
                    </span>
                    {ownerName ? (
                      <span className="inline-flex items-center gap-0.5 whitespace-nowrap rounded-full bg-slate-100 px-1.5 py-px text-[10px] font-semibold text-slate-500">
                        <User className="h-2.5 w-2.5 shrink-0 text-slate-400" />
                        {ownerName}
                      </span>
                    ) : null}
                    {order.priority && order.priority !== "normal" ? (
                      <span
                        className={cn(
                          "inline-flex items-center whitespace-nowrap rounded-full px-1.5 py-px text-[10px] font-medium capitalize",
                          PRIORITY_STYLES[order.priority] ?? "bg-slate-100 text-slate-600"
                        )}
                      >
                        {order.priority}
                      </span>
                    ) : null}
                    {shippingSign ? (
                      <span
                        className={cn(
                          "inline-flex items-center gap-0.5 whitespace-nowrap rounded-full px-1.5 py-px text-[10px] font-semibold",
                          shippingTagClass(shippingSign)
                        )}
                        title={shippingSign.title}
                      >
                        {shippingSign.kind === "awaiting" ? (
                          <Clock className="h-2.5 w-2.5" />
                        ) : shippingSign.kind === "payment_pending" ? (
                          <CreditCard className="h-2.5 w-2.5" />
                        ) : shippingSign.kind === "pickup" ? (
                          <MapPin className="h-2.5 w-2.5" />
                        ) : shippingSign.kind === "uber" ? (
                          <Car className="h-2.5 w-2.5" />
                        ) : (
                          <Truck className="h-2.5 w-2.5" />
                        )}
                        {shippingSign.label}
                      </span>
                    ) : null}
                    <OrderBillingGlobe specs={order.specs} />
                  </div>
                </td>

                {/* ── One cell per kanban column ────────────────── */}
                {columns.map((col) => {
                  const isHidden = hiddenColIds.has(col.id);
                  const isCurrent = order.column_id === col.id;
                  const canMoveTo = !isCurrent && moveableIds.has(col.id);

                  // Collapsed column — just a narrow empty cell
                  if (isHidden) {
                    return (
                      <td
                        key={col.id}
                        className="w-8 border-r border-slate-200 bg-slate-50/40 p-0"
                      />
                    );
                  }

                  if (isCurrent) {
                    return (
                      <td
                        key={col.id}
                        className="w-px border-r border-slate-200 text-center align-middle"
                        style={{
                          backgroundColor: col.color
                            ? `${col.color}1a`
                            : "rgba(148,163,184,0.1)",
                          borderLeft: `3px solid ${col.color ?? "#94a3b8"}`,
                        }}
                      >
                        <span
                          className="inline-block h-3 w-3 rounded-full"
                          style={{
                            backgroundColor: col.color ?? "#94a3b8",
                          }}
                        />
                      </td>
                    );
                  }

                  if (canMoveTo) {
                    return (
                      <td
                        key={col.id}
                        className="w-px border-r border-slate-200 p-1"
                      />
                    );
                  }

                  return (
                    <td
                      key={col.id}
                      className="w-px border-r border-slate-200 p-1"
                    />
                  );
                })}
                {/* Filler cell */}
                <td className="border-slate-200" />
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Right-click context menu */}
      {menuState ? (
        <div
          ref={menuRef}
          style={{
            top: menuState.y,
            left: menuState.x,
            maxHeight: `calc(100dvh - ${menuState.y}px - 8px)`,
          }}
          className="fixed z-50 flex min-w-[11rem] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {(() => {
            const actionButtons =
              role === "admin"
                ? filterButtonsForColumn(
                    buttonAutomations,
                    menuState.order.column_id
                  )
                : [];
            const moveable = getMoveableColumns(menuState.order.column_id);
            const values =
              fieldValuesByOrder[menuState.order.id] ?? {};
            const contact = customerContactFromOrder(
              menuState.order,
              values,
              customFields
            );
            const productField = findOrderFormField(customFields, "Product");
            const productLabel = productField
              ? String(values[productField.id] ?? "").trim()
              : "";
            return (
              <>
                {actionButtons.length > 0 ? (
                  <div className="shrink-0 border-b border-slate-100 py-1">
                    {actionButtons.map((btn) => (
                      <ActionButton
                        key={btn.id}
                        appearance="menu"
                        button={btn}
                        orderId={menuState.order.id}
                        orderNumber={menuState.order.title}
                        appUrl={appUrl}
                        groupSize={groupSizeByOrder[menuState.order.id]}
                        customerEmail={
                          contact.email ?? menuState.order.customer?.email
                        }
                        customerPhone={
                          contact.phone ?? menuState.order.customer?.phone
                        }
                        productLabel={productLabel || null}
                        onComplete={(result) => {
                          onActionComplete?.(menuState.order, result);
                          setMenuState(null);
                        }}
                        onError={(message) => onActionError?.(message)}
                      />
                    ))}
                  </div>
                ) : null}
                {moveable.length > 0 ? (
                  <>
                    <p className="flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      <MoveRight className="h-3 w-3" />
                      Move to
                    </p>
                    <div className="overflow-y-auto py-1">
                      {moveable.map((col) => (
                        <button
                          key={col.id}
                          type="button"
                          onClick={() => {
                            onMoveToColumn(menuState.order, col.id);
                            setMenuState(null);
                          }}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
                        >
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full border border-slate-200"
                            style={{
                              backgroundColor: col.color ?? "#e2e8f0",
                            }}
                          />
                          <span className="truncate">{col.name}</span>
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}
              </>
            );
          })()}
        </div>
      ) : null}
    </div>
  );
}
