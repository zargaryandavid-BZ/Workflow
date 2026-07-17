"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import Image from "next/image";
import {
  ArrowDownAZ,
  ArrowDownToLine,
  ArrowUpAZ,
  ArrowUpFromLine,
  Plus,
  RefreshCw,
} from "lucide-react";
import { OrderCard } from "./order-card";
import { GroupedOrderCard } from "./grouped-order-card";
import { groupOrdersForColumn } from "@/lib/group-orders";
import { effectiveDropRoles, parseDropRoles } from "@/lib/columns";
import { BOARD_ROLES, COLUMN_ACCENT, ROLE_ABBR } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { CardNotificationBadge } from "@/lib/card-badges";
import type { BoardShippingSign } from "@/lib/board-shipping";
import type {
  BoardColumn,
  ButtonAutomation,
  CardWarningRule,
  CustomField,
  Designer,
  OrderWithRelations,
  Role,
} from "@/lib/types";
import type { GroupDueDateUpdate } from "./group-due-dates-modal";
import type { WebhookSourceStyles } from "@/lib/webhook-source-styles";
import type { ActionButtonResult } from "./action-button";

type DateSort = "default" | "asc" | "desc";
type ColumnLoadStatus = "idle" | "loading" | "loaded" | "error";

interface ColumnOption {
  id: string;
  name: string;
  color: string | null;
}

interface ColumnProps {
  column: BoardColumn;
  canDragCards: boolean;
  canAcceptDrop: boolean;
  isDragActive: boolean;
  groupedView: boolean;
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
  webhookSourceStyles?: WebhookSourceStyles;
  isFirst: boolean;
  /** Columns this card can be moved to via right-click (pre-filtered by board). */
  availableColumns?: ColumnOption[];
  onMoveToColumn?: (order: OrderWithRelations, targetColumnId: string) => void;
  /** Admin-only automations for this column (filtered by board). */
  actionButtons?: ButtonAutomation[];
  appUrl?: string;
  onActionComplete?: (
    order: OrderWithRelations,
    result: ActionButtonResult
  ) => void;
  onActionError?: (message: string) => void;
  designers?: Designer[];
  onGroupAssignDesigner?: (
    orders: OrderWithRelations[],
    designer: { id: string | null; name: string | null }
  ) => void;
  onGroupSetDueDates?: (updates: GroupDueDateUpdate[]) => Promise<void>;
  onMoveGroup?: (orders: OrderWithRelations[], targetColumnId: string) => void;
  onOpenOrder: (order: OrderWithRelations) => void;
  onAdd: (columnId: string) => void;
  /** Lazy-load state for this column. */
  loadStatus: ColumnLoadStatus;
  /** Whether more pages of cards are available for this column. */
  hasMore: boolean;
  /** Total order count in this column from the DB (may exceed loaded cards). */
  total?: number;
  /** Called when the column enters the viewport — triggers the initial fetch. */
  onVisible: (columnId: string) => void;
  /** Called when the user clicks "Load more". */
  onLoadMore: (columnId: string) => void;
}

/** Short label of which roles a drop permission applies to. */
function dropLabel(roles: Role[] | null | undefined): string {
  const effective = effectiveDropRoles(parseDropRoles(roles));
  if (effective == null) return "All";
  if (effective.length === 0) return "Admins";
  return BOARD_ROLES.filter((r) => effective.includes(r))
    .map((r) => ROLE_ABBR[r])
    .join(" ");
}

/** Placeholder cards shown while a column's orders are loading. */
function ColumnSkeleton({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: Math.min(count, 5) }).map((_, i) => (
        <div
          key={i}
          className="animate-pulse rounded-xl bg-slate-100"
          style={{ height: "6rem", marginBottom: "0.375rem" }}
        />
      ))}
    </>
  );
}

export function Column({
  column,
  canDragCards,
  canAcceptDrop,
  isDragActive,
  groupedView,
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
  webhookSourceStyles,
  isFirst,
  availableColumns,
  onMoveToColumn,
  actionButtons = [],
  appUrl = "",
  onActionComplete,
  onActionError,
  designers = [],
  onGroupAssignDesigner,
  onGroupSetDueDates,
  onMoveGroup,
  onOpenOrder,
  onAdd,
  loadStatus,
  hasMore,
  total,
  onVisible,
  onLoadMore,
}: ColumnProps) {
  const [dateSort, setDateSort] = useState<DateSort>("default");

  const dropDisabled = isDragActive && !canAcceptDrop;
  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
    disabled: dropDisabled,
  });

  // Keep a stable ref to onVisible so the IntersectionObserver callback
  // never captures a stale closure.
  const onVisibleRef = useRef(onVisible);
  useEffect(() => {
    onVisibleRef.current = onVisible;
  }, [onVisible]);

  // Observe this column entering the viewport and trigger the initial fetch.
  const containerRef = useRef<HTMLDivElement>(null);

  // Combine the droppable ref from dnd-kit with our own container ref.
  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      (containerRef as React.MutableRefObject<HTMLDivElement | null>).current =
        node;
      setNodeRef(node);
    },
    [setNodeRef]
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          onVisibleRef.current(column.id);
        }
      },
      { rootMargin: "200px" } // start loading 200 px before entering viewport
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [column.id]);

  const showDropTarget = isDragActive && isOver && canAcceptDrop;

  const sortedOrders =
    dateSort === "default"
      ? orders
      : [...orders].sort((a, b) => {
          const ta = new Date(a.created_at).getTime();
          const tb = new Date(b.created_at).getTime();
          return dateSort === "asc" ? ta - tb : tb - ta;
        });

  const columnEntries = useMemo(
    () => (groupedView ? groupOrdersForColumn(sortedOrders) : null),
    [groupedView, sortedOrders]
  );

  function cycleDateSort() {
    setDateSort((prev) =>
      prev === "default" ? "asc" : prev === "asc" ? "desc" : "default"
    );
  }

  // Count badge: show total from DB when available, otherwise fall back to
  // loaded cards length.  Before any load the badge shows 0 briefly; total
  // arrives with the first API response.
  const displayCount =
    total !== undefined && total > orders.length ? total : orders.length;

  // How many cards still to load (shown in the "Load more" button).
  const remaining = (total ?? 0) - orders.length;

  return (
    <div
      ref={setRefs}
      data-column-id={column.id}
      className={cn(
        "flex h-full w-80 shrink-0 flex-col rounded-lg transition-[opacity,box-shadow]",
        isDragActive && !canAcceptDrop && "opacity-50",
        showDropTarget && "ring-2 ring-blue-400 ring-offset-2"
      )}
    >
      {/* ── Column header ─────────────────────────────────────── */}
      <div
        className={cn(
          "mb-2 rounded-t-lg border-t-4 bg-slate-200/60 px-3 py-2",
          !column.color ? COLUMN_ACCENT[column.kind] : undefined
        )}
        style={column.color ? { borderTopColor: column.color } : undefined}
      >
        <div className="flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-2">
            {column.color ? (
              <span
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ background: column.color }}
              />
            ) : null}
            <span className="truncate text-sm font-semibold text-slate-700">
              {column.name}
            </span>
            <span className="rounded-full bg-white px-1.5 text-xs font-medium text-slate-500">
              {displayCount}
            </span>
          </div>
          <div className="flex items-center gap-0.5">
            <button
              onClick={cycleDateSort}
              className={cn(
                "rounded p-1 transition-colors",
                dateSort === "default"
                  ? "text-slate-400 hover:bg-white hover:text-slate-600"
                  : "bg-blue-100 text-blue-600 hover:bg-blue-200"
              )}
              title={
                dateSort === "default"
                  ? "Sort by date created (oldest first)"
                  : dateSort === "asc"
                    ? "Sorted: oldest first — click for newest first"
                    : "Sorted: newest first — click to reset"
              }
            >
              {dateSort === "desc" ? (
                <ArrowDownAZ className="h-4 w-4" />
              ) : (
                <ArrowUpAZ className="h-4 w-4" />
              )}
            </button>
            {isFirst ? (
              <button
                onClick={() => onAdd(column.id)}
                className="rounded p-1 text-slate-500 hover:bg-white hover:text-slate-700"
                aria-label="Add order"
              >
                <Plus className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </div>

        {column.image_url ? (
          <Image
            src={column.image_url}
            alt=""
            width={320}
            height={96}
            className="mt-2 h-20 w-full rounded-md object-cover"
            unoptimized
          />
        ) : null}

        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] font-medium text-slate-500">
          <span
            className="inline-flex items-center gap-0.5"
            title="Roles that can drop orders into this stage"
          >
            <ArrowDownToLine className="h-3 w-3" />
            {dropLabel(column.drop_in_roles)}
          </span>
          <span
            className="inline-flex items-center gap-0.5"
            title="Roles that can take orders out of this stage"
          >
            <ArrowUpFromLine className="h-3 w-3" />
            {dropLabel(column.drop_out_roles)}
          </span>
        </div>
      </div>

      {/* ── Column body ───────────────────────────────────────── */}
      <div
        className={cn(
          "board-scroll flex min-h-[8rem] flex-1 flex-col gap-1.5 overflow-y-auto rounded-b-lg p-1 transition-colors",
          showDropTarget
            ? "bg-blue-50"
            : !column.color
              ? "bg-slate-100/40"
              : undefined
        )}
        style={
          !showDropTarget && column.color
            ? { backgroundColor: `${column.color}08` }
            : undefined
        }
      >
        <SortableContext
          items={sortedOrders.map((o) => o.id)}
          strategy={verticalListSortingStrategy}
        >
          {/* Loading skeleton */}
          {loadStatus === "loading" && orders.length === 0 ? (
            <ColumnSkeleton count={displayCount || 3} />
          ) : null}

          {/* Error state */}
          {loadStatus === "error" ? (
            <div className="flex flex-col items-center gap-2 py-6 text-sm text-slate-400">
              <span>Failed to load</span>
              <button
                type="button"
                onClick={() => onVisible(column.id)}
                className="inline-flex items-center gap-1 text-blue-500 hover:text-blue-700"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Retry
              </button>
            </div>
          ) : null}

          {/* Cards */}
          {columnEntries
            ? columnEntries.map((entry) =>
                entry.kind === "group" ? (
                  <GroupedOrderCard
                    key={`group-${entry.key}`}
                    entry={entry}
                    onOpen={onOpenOrder}
                    customFields={customFields}
                    fieldValuesByOrder={fieldValuesByOrder}
                    webhookSourceStyles={webhookSourceStyles}
                    designers={designers}
                    availableColumns={availableColumns}
                    onAssignDesigner={onGroupAssignDesigner}
                    onSetDueDates={onGroupSetDueDates}
                    onMoveGroup={onMoveGroup}
                  />
                ) : (
                  <OrderCard
                    key={entry.order.id}
                    order={entry.order}
                    canDrag={canDragCards}
                    customFields={customFields}
                    fieldValues={fieldValuesByOrder[entry.order.id]}
                    thumbnails={thumbnailByOrder[entry.order.id]}
                    designerName={designerNameByOrder[entry.order.id]}
                    notificationBadge={
                      notificationBadgeByOrder[entry.order.id]
                    }
                    ownerName={ownerNameByOrder[entry.order.id]}
                    shippingSign={shippingSignByOrder[entry.order.id]}
                    groupSize={groupSizeByOrder[entry.order.id]}
                    warningRules={warningRules}
                    animateWarnings={animateWarnings}
                    webhookSourceStyles={webhookSourceStyles}
                    columnColor={column.color}
                    availableColumns={availableColumns}
                    onMoveToColumn={onMoveToColumn}
                    actionButtons={actionButtons}
                    appUrl={appUrl}
                    onActionComplete={onActionComplete}
                    onActionError={onActionError}
                    onOpen={onOpenOrder}
                  />
                )
              )
            : sortedOrders.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  canDrag={canDragCards}
                  customFields={customFields}
                  fieldValues={fieldValuesByOrder[order.id]}
                  thumbnails={thumbnailByOrder[order.id]}
                  designerName={designerNameByOrder[order.id]}
                  notificationBadge={notificationBadgeByOrder[order.id]}
                  ownerName={ownerNameByOrder[order.id]}
                  shippingSign={shippingSignByOrder[order.id]}
                  groupSize={groupSizeByOrder[order.id]}
                  warningRules={warningRules}
                  animateWarnings={animateWarnings}
                  webhookSourceStyles={webhookSourceStyles}
                  columnColor={column.color}
                  availableColumns={availableColumns}
                  onMoveToColumn={onMoveToColumn}
                  actionButtons={actionButtons}
                  appUrl={appUrl}
                  onActionComplete={onActionComplete}
                  onActionError={onActionError}
                  onOpen={onOpenOrder}
                />
              ))}
        </SortableContext>

        {/* Load more */}
        {hasMore && loadStatus === "loaded" ? (
          <button
            type="button"
            onClick={() => onLoadMore(column.id)}
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white py-2 text-sm text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
          >
            {`Load more${remaining > 0 ? ` (${remaining} remaining)` : ""}`}
          </button>
        ) : null}

        {/* Loading spinner for subsequent pages */}
        {loadStatus === "loading" && orders.length > 0 ? (
          <div className="py-2 text-center text-xs text-slate-400">
            Loading…
          </div>
        ) : null}
      </div>
    </div>
  );
}
