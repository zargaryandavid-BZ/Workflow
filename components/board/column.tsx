"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import Image from "next/image";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Plus,
  RefreshCw,
} from "lucide-react";
import { OrderCard } from "./order-card";
import { GroupedOrderCard } from "./grouped-order-card";
import {
  getGroupKey,
  groupDragId,
  groupOrdersForColumn,
} from "@/lib/group-orders";
import {
  COLUMN_SORT_OPTIONS,
  sortOrdersForColumn,
  type ColumnSortMode,
} from "@/lib/board-column-sort";
import { isShippedCustomerColumn } from "@/lib/shipped-customer-column";
import { effectiveDropRoles, parseDropRoles } from "@/lib/columns";
import { BOARD_ROLES, COLUMN_ACCENT, ROLE_ABBR } from "@/lib/constants";
import { canAssignDesignerOnBoard, canSetBoardTagAndPriority } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { BoardThumbnail } from "@/lib/card-image";
import type { CardNotificationBadge } from "@/lib/card-badges";
import { isBoardHealthCutoffColumn } from "@/lib/board-health";
import { nextColumnIdAfter } from "@/lib/stage-groups";
import type { BoardShippingSign } from "@/lib/board-shipping";
import {
  READY_TO_SHIP_SHIPPING_OPTIONS,
  orderMatchesReadyToShipShippingFilter,
  type ReadyToShipShippingFilter,
} from "@/lib/ready-to-ship-shipping-filter";
import {
  isCompleteGroupInColumn,
  isReadyToShipNotifyColumn,
} from "@/lib/ready-to-ship-group";
import type { DieAlert, DieBoardStatus } from "@/lib/die-request";
import type {
  BoardColumn,
  ButtonAutomation,
  CardWarningRule,
  CustomField,
  DailyPriorityBucket,
  Designer,
  OrderTagSummary,
  OrderWithRelations,
  PressType,
  Role,
  Tag,
} from "@/lib/types";
import type { GroupDueDateUpdate } from "./group-due-dates-modal";
import type { WebhookSourceStyles } from "@/lib/webhook-source-styles";
import type { TimeChip } from "@/lib/time-chips";
import type { ActionButtonResult } from "./action-button";
import type { PriorityScore } from "@/lib/order-priority-score";
import type { EmergencyResult } from "@/lib/emergency-view";

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
  sortMode: ColumnSortMode;
  onSortModeChange: (mode: ColumnSortMode) => void;
  shippingFilter?: ReadyToShipShippingFilter;
  onShippingFilterChange?: (mode: ReadyToShipShippingFilter) => void;
  shippingFilterOptions?: { value: ReadyToShipShippingFilter; label: string }[];
  customFields: CustomField[];
  fieldValuesByOrder: Record<string, Record<string, unknown>>;
  thumbnailByOrder: Record<string, BoardThumbnail[]>;
  onCardThumbnailsChange?: (
    orderId: string,
    thumbnails: BoardThumbnail[]
  ) => void;
  designerNameByOrder: Record<string, string>;
  notificationBadgeByOrder: Record<string, CardNotificationBadge>;
  ownerNameByOrder: Record<string, string>;
  shippingSignByOrder?: Record<string, BoardShippingSign>;
  dieAlertByOrder?: Record<string, DieAlert>;
  dieStatusByOrder?: Record<string, DieBoardStatus>;
  approvalDateByOrder?: Record<string, string>;
  groupSizeByOrder?: Record<string, number>;
  warningRules?: CardWarningRule[];
  animateWarnings?: boolean;
  warningWorkingDays?: number[];
  /** Emergency-view result per order (read-only; empty unless the view is on). */
  emergencyByOrder?: Record<string, EmergencyResult>;
  webhookSourceStyles?: WebhookSourceStyles;
  timeChips?: TimeChip[];
  isFirst: boolean;
  /** When true, sort dropdown is fixed (Start column → Priority 5→None). */
  sortLocked?: boolean;
  /** Columns this card can be moved to via right-click (pre-filtered by board). */
  availableColumns?: ColumnOption[];
  /** Board column ids in pipeline order — used to center Move to on the next stage. */
  boardColumnIds?: string[];
  onMoveToColumn?: (order: OrderWithRelations, targetColumnId: string) => void;
  /** Admin-only automations for this column (filtered by board). */
  actionButtons?: ButtonAutomation[];
  appUrl?: string;
  onActionComplete?: (
    order: OrderWithRelations,
    result: ActionButtonResult
  ) => void;
  onActionError?: (message: string) => void;
  onResendApproval?: (order: OrderWithRelations) => void;
  onBatchRerequest?: () => void;
  designers?: Designer[];
  onGroupAssignDesigner?: (
    orders: OrderWithRelations[],
    designer: { id: string | null; name: string | null }
  ) => void;
  /** Board tags for right-click Tag menu. */
  tags?: Tag[];
  onSetTag?: (
    order: OrderWithRelations,
    tag: OrderTagSummary | null
  ) => void;
  onSetPriorityScore?: (
    order: OrderWithRelations,
    score: PriorityScore | null
  ) => void;
  /** Add/move an order onto the shared daily Priority List from the board. */
  onSetDailyPriority?: (
    order: OrderWithRelations,
    press: PressType,
    bucket: DailyPriorityBucket
  ) => void;
  /** Take an order off the shared daily Priority List. */
  onRemoveDailyPriority?: (order: OrderWithRelations) => void;
  onSetReprint?: (order: OrderWithRelations, on: boolean) => void;
  onSetLocked?: (order: OrderWithRelations, on: boolean) => void;
  onSetTimeBudget?: (order: OrderWithRelations, seconds: number | null) => void;
  onGroupSetDueDates?: (updates: GroupDueDateUpdate[]) => Promise<void>;
  onSetDueDate?: (
    order: OrderWithRelations,
    update: {
      mode: "fixed" | "after_approval";
      dueDate?: string | null;
      processingDays?: number | null;
    }
  ) => void;
  /** Order id to briefly highlight after closing the job ticket. */
  highlightedOrderId?: string | null;
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
  role?: Role;
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
  sortMode,
  onSortModeChange,
  shippingFilter = "all",
  onShippingFilterChange,
  shippingFilterOptions,
  customFields,
  fieldValuesByOrder,
  thumbnailByOrder,
  onCardThumbnailsChange,
  designerNameByOrder,
  notificationBadgeByOrder,
  ownerNameByOrder,
  shippingSignByOrder = {},
  dieAlertByOrder = {},
  dieStatusByOrder = {},
  approvalDateByOrder = {},
  groupSizeByOrder = {},
  warningRules = [],
  animateWarnings = true,
  warningWorkingDays = [1, 2, 3, 4, 5],
  emergencyByOrder = {},
  webhookSourceStyles,
  timeChips = [],
  isFirst,
  sortLocked = false,
  availableColumns,
  boardColumnIds,
  onMoveToColumn,
  actionButtons = [],
  appUrl = "",
  onActionComplete,
  onActionError,
  onResendApproval,
  onBatchRerequest,
  designers = [],
  onGroupAssignDesigner,
  tags = [],
  onSetTag,
  onSetPriorityScore,
  onSetDailyPriority,
  onRemoveDailyPriority,
  onSetReprint,
  onSetLocked,
  onSetTimeBudget,
  onGroupSetDueDates,
  onSetDueDate,
  highlightedOrderId = null,
  onMoveGroup,
  onOpenOrder,
  onAdd,
  loadStatus,
  hasMore,
  total,
  onVisible,
  onLoadMore,
  role,
}: ColumnProps) {
  const nextMoveColumnId = useMemo(
    () =>
      nextColumnIdAfter(
        column.id,
        boardColumnIds ?? [],
        (availableColumns ?? []).map((c) => c.id)
      ),
    [column.id, boardColumnIds, availableColumns]
  );

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

  const showShippingFilter = isBoardHealthCutoffColumn(column) || onShippingFilterChange !== undefined;

  const sortedOrders = useMemo(
    () => sortOrdersForColumn(orders, sortMode),
    [orders, sortMode]
  );

  const visibleOrders = useMemo(() => {
    if (!showShippingFilter || shippingFilter === "all") return sortedOrders;
    return sortedOrders.filter((order) =>
      orderMatchesReadyToShipShippingFilter(
        shippingSignByOrder[order.id],
        shippingFilter
      )
    );
  }, [
    showShippingFilter,
    shippingFilter,
    sortedOrders,
    shippingSignByOrder,
  ]);

  const showShippedEnteredDate = isShippedCustomerColumn(column.name);

  const columnEntries = useMemo(
    () => (groupedView ? groupOrdersForColumn(visibleOrders) : null),
    [groupedView, visibleOrders]
  );

  const readyToNotifyColumn = isReadyToShipNotifyColumn(column);
  const partsInColumnByOrderId = useMemo(() => {
    const byKey = new Map<string, number>();
    for (const o of visibleOrders) {
      const key = getGroupKey(o);
      if (!key) continue;
      byKey.set(key, (byKey.get(key) ?? 0) + 1);
    }
    const map: Record<string, number> = {};
    for (const o of visibleOrders) {
      const key = getGroupKey(o);
      map[o.id] = key ? (byKey.get(key) ?? 1) : 1;
    }
    return map;
  }, [visibleOrders]);

  // Count badge: show total from DB when available, otherwise fall back to
  // loaded cards length.  Before any load the badge shows 0 briefly; total
  // arrives with the first API response.
  const displayCount =
    showShippingFilter && shippingFilter !== "all"
      ? visibleOrders.length
      : total !== undefined && total > orders.length
        ? total
        : orders.length;

  // How many cards still to load (shown in the "Load more" button).
  const remaining = (total ?? 0) - orders.length;

  return (
    <div
      ref={setRefs}
      data-column-id={column.id}
      className={cn(
        "flex h-full w-[22rem] shrink-0 flex-col rounded-lg transition-[opacity,box-shadow]",
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
            <span
              className="truncate text-sm font-semibold text-slate-700"
              title={column.name}
            >
              {column.name}
            </span>
            <span className="rounded-full bg-white px-1.5 text-xs font-medium text-slate-500">
              {displayCount}
            </span>
          </div>
          <div className="flex items-center gap-0.5">
            <label className="sr-only" htmlFor={`col-sort-${column.id}`}>
              Sort {column.name}
            </label>
            <select
              id={`col-sort-${column.id}`}
              value={sortMode}
              disabled={sortLocked}
              onChange={(e) =>
                onSortModeChange(e.target.value as ColumnSortMode)
              }
              className={cn(
                "max-w-[7.5rem] truncate rounded border border-slate-200 bg-white py-0.5 pl-1 pr-0 text-[10px] font-medium text-slate-600",
                sortMode !== "manual" && "border-blue-200 bg-blue-50 text-blue-700",
                sortLocked && "cursor-not-allowed opacity-90"
              )}
              title={
                sortLocked
                  ? "Start and Prepress always sort by Priority: 5 → None"
                  : "Sort cards in this column"
              }
            >
              {COLUMN_SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {showShippingFilter && onShippingFilterChange ? (
              <>
                <label className="sr-only" htmlFor={`col-ship-${column.id}`}>
                  Filter shipping {column.name}
                </label>
                <select
                  id={`col-ship-${column.id}`}
                  value={shippingFilter}
                  onChange={(e) =>
                    onShippingFilterChange(
                      e.target.value as ReadyToShipShippingFilter
                    )
                  }
                  className={cn(
                    "max-w-[7.5rem] truncate rounded border border-slate-200 bg-white py-0.5 pl-1 pr-0 text-[10px] font-medium text-slate-600",
                    shippingFilter !== "all" &&
                      "border-blue-200 bg-blue-50 text-blue-700"
                  )}
                  title="Filter by shipping: Pickup, FedEx, Self FedEx, Awaiting"
                >
                  {(shippingFilterOptions ?? READY_TO_SHIP_SHIPPING_OPTIONS).map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </>
            ) : null}
            {(column.kind === "approval" || column.kind === "exception") && onBatchRerequest ? (
              <button
                onClick={onBatchRerequest}
                className="flex items-center justify-center rounded border border-blue-500 bg-blue-500 p-1 text-white hover:bg-blue-600 hover:border-blue-600"
                aria-label={column.kind === "approval" ? "Re-request approvals" : "Re-request missing info"}
                title={column.kind === "approval" ? "Re-request approvals" : "Re-request missing info"}
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            ) : null}
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
            width={352}
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
        data-column-scroll
        className={cn(
          "board-scroll flex min-h-[8rem] flex-1 flex-col gap-1.5 overflow-y-auto overscroll-contain rounded-b-lg p-1 transition-colors",
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
          items={
            columnEntries
              ? columnEntries.map((entry) =>
                  entry.kind === "group"
                    ? groupDragId(column.id, entry.key)
                    : entry.order.id
                )
              : visibleOrders.map((o) => o.id)
          }
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
                    columnId={column.id}
                    canDrag={canDragCards}
                    onOpen={onOpenOrder}
                    customFields={customFields}
                    fieldValuesByOrder={fieldValuesByOrder}
                    webhookSourceStyles={webhookSourceStyles}
                    designers={designers}
                    availableColumns={availableColumns}
                    nextMoveColumnId={nextMoveColumnId}
                    onAssignDesigner={
                      role && canAssignDesignerOnBoard(role)
                        ? onGroupAssignDesigner
                        : undefined
                    }
                    onSetDueDates={onGroupSetDueDates}
                    onMoveGroup={onMoveGroup}
                    highlightedOrderId={highlightedOrderId}
                    readyToNotify={
                      readyToNotifyColumn &&
                      isCompleteGroupInColumn(
                        entry.orders.length,
                        groupSizeByOrder[entry.orders[0]?.id]
                      )
                    }
                  />
                ) : (
                  <OrderCard
                    key={entry.order.id}
                    order={entry.order}
                    canDrag={canDragCards}
                    customFields={customFields}
                    fieldValues={fieldValuesByOrder[entry.order.id]}
                    thumbnails={thumbnailByOrder[entry.order.id]}
                    onCardThumbnailsChange={onCardThumbnailsChange}
                    designerName={designerNameByOrder[entry.order.id]}
                    designers={designers}
                    onAssignDesigner={
                      role &&
                      canAssignDesignerOnBoard(role) &&
                      onGroupAssignDesigner
                        ? (designer) =>
                            onGroupAssignDesigner([entry.order], designer)
                        : undefined
                    }
                    tags={
                      role && canSetBoardTagAndPriority(role) ? tags : undefined
                    }
                    onSetTag={
                      role && canSetBoardTagAndPriority(role) && onSetTag
                        ? (tag) => onSetTag(entry.order, tag)
                        : undefined
                    }
                    onSetPriorityScore={
                      role &&
                      canSetBoardTagAndPriority(role) &&
                      onSetPriorityScore
                        ? (score) => onSetPriorityScore(entry.order, score)
                        : undefined
                    }
                    onSetDailyPriority={
                      role &&
                      canSetBoardTagAndPriority(role) &&
                      onSetDailyPriority
                        ? (press, bucket) =>
                            onSetDailyPriority(entry.order, press, bucket)
                        : undefined
                    }
                    onRemoveDailyPriority={
                      role &&
                      canSetBoardTagAndPriority(role) &&
                      onRemoveDailyPriority
                        ? () => onRemoveDailyPriority(entry.order)
                        : undefined
                    }
                    onSetReprint={
                      role && canSetBoardTagAndPriority(role) && onSetReprint
                        ? (on) => onSetReprint(entry.order, on)
                        : undefined
                    }
                    onSetLocked={
                      role && canSetBoardTagAndPriority(role) && onSetLocked
                        ? (on) => onSetLocked(entry.order, on)
                        : undefined
                    }
                    onSetTimeBudget={
                      role && canSetBoardTagAndPriority(role) && onSetTimeBudget
                        ? (seconds) => onSetTimeBudget(entry.order, seconds)
                        : undefined
                    }
                    onSetDueDate={
                      onSetDueDate
                        ? (update) => onSetDueDate(entry.order, update)
                        : undefined
                    }
                    highlighted={highlightedOrderId === entry.order.id}
                    notificationBadge={
                      notificationBadgeByOrder[entry.order.id]
                    }
                    ownerName={ownerNameByOrder[entry.order.id]}
                    shippingSign={shippingSignByOrder[entry.order.id]}
                    dieAlert={dieAlertByOrder[entry.order.id]}
                    dieStatus={dieStatusByOrder[entry.order.id]}
                    approvalDate={approvalDateByOrder[entry.order.id] ?? null}
                    groupSize={groupSizeByOrder[entry.order.id]}
                    readyToNotify={
                      readyToNotifyColumn &&
                      isCompleteGroupInColumn(
                        partsInColumnByOrderId[entry.order.id],
                        groupSizeByOrder[entry.order.id]
                      )
                    }
                    warningRules={warningRules}
                    animateWarnings={animateWarnings}
                    warningWorkingDays={warningWorkingDays}
                    emergencySeverity={emergencyByOrder[entry.order.id]?.severity ?? null}
                    emergencyReasons={emergencyByOrder[entry.order.id]?.reasons}
                    webhookSourceStyles={webhookSourceStyles}
                    columnColor={column.color}
                    columnKind={column.kind}
                    columnName={column.name}
                    showShippedEnteredDate={showShippedEnteredDate}
                    timeChips={timeChips}
                    availableColumns={availableColumns}
                    nextMoveColumnId={nextMoveColumnId}
                    onMoveToColumn={onMoveToColumn}
                    actionButtons={actionButtons}
                    appUrl={appUrl}
                    onActionComplete={onActionComplete}
                    onActionError={onActionError}
                    onResendApproval={onResendApproval}
                    onOpen={onOpenOrder}
                    role={role}
                  />
                )
              )
            : visibleOrders.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  canDrag={canDragCards}
                  customFields={customFields}
                  fieldValues={fieldValuesByOrder[order.id]}
                  thumbnails={thumbnailByOrder[order.id]}
                  onCardThumbnailsChange={onCardThumbnailsChange}
                  designerName={designerNameByOrder[order.id]}
                  designers={designers}
                  onAssignDesigner={
                    role &&
                    canAssignDesignerOnBoard(role) &&
                    onGroupAssignDesigner
                      ? (designer) =>
                          onGroupAssignDesigner([order], designer)
                      : undefined
                  }
                  tags={
                    role && canSetBoardTagAndPriority(role) ? tags : undefined
                  }
                  onSetTag={
                    role && canSetBoardTagAndPriority(role) && onSetTag
                      ? (tag) => onSetTag(order, tag)
                      : undefined
                  }
                  onSetPriorityScore={
                    role &&
                    canSetBoardTagAndPriority(role) &&
                    onSetPriorityScore
                      ? (score) => onSetPriorityScore(order, score)
                      : undefined
                  }
                  onSetDailyPriority={
                    role &&
                    canSetBoardTagAndPriority(role) &&
                    onSetDailyPriority
                      ? (press, bucket) =>
                          onSetDailyPriority(order, press, bucket)
                      : undefined
                  }
                  onRemoveDailyPriority={
                    role &&
                    canSetBoardTagAndPriority(role) &&
                    onRemoveDailyPriority
                      ? () => onRemoveDailyPriority(order)
                      : undefined
                  }
                  onSetReprint={
                    role && canSetBoardTagAndPriority(role) && onSetReprint
                      ? (on) => onSetReprint(order, on)
                      : undefined
                  }
                  onSetLocked={
                    role && canSetBoardTagAndPriority(role) && onSetLocked
                      ? (on) => onSetLocked(order, on)
                      : undefined
                  }
                  onSetTimeBudget={
                    role && canSetBoardTagAndPriority(role) && onSetTimeBudget
                      ? (seconds) => onSetTimeBudget(order, seconds)
                      : undefined
                  }
                  onSetDueDate={
                    onSetDueDate
                      ? (update) => onSetDueDate(order, update)
                      : undefined
                  }
                  highlighted={highlightedOrderId === order.id}
                  notificationBadge={notificationBadgeByOrder[order.id]}
                  ownerName={ownerNameByOrder[order.id]}
                  shippingSign={shippingSignByOrder[order.id]}
                  dieAlert={dieAlertByOrder[order.id]}
                  dieStatus={dieStatusByOrder[order.id]}
                  approvalDate={approvalDateByOrder[order.id] ?? null}
                  groupSize={groupSizeByOrder[order.id]}
                  readyToNotify={
                    readyToNotifyColumn &&
                    isCompleteGroupInColumn(
                      partsInColumnByOrderId[order.id],
                      groupSizeByOrder[order.id]
                    )
                  }
                  warningRules={warningRules}
                  animateWarnings={animateWarnings}
                  warningWorkingDays={warningWorkingDays}
                  emergencySeverity={emergencyByOrder[order.id]?.severity ?? null}
                  emergencyReasons={emergencyByOrder[order.id]?.reasons}
                  webhookSourceStyles={webhookSourceStyles}
                  columnColor={column.color}
                  columnKind={column.kind}
                  columnName={column.name}
                  showShippedEnteredDate={showShippedEnteredDate}
                  timeChips={timeChips}
                  availableColumns={availableColumns}
                  nextMoveColumnId={nextMoveColumnId}
                  onMoveToColumn={onMoveToColumn}
                  actionButtons={actionButtons}
                  appUrl={appUrl}
                  onActionComplete={onActionComplete}
                  onActionError={onActionError}
                  onResendApproval={onResendApproval}
                  onOpen={onOpenOrder}
                  role={role}
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
