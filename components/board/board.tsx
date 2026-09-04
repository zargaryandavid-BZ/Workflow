"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import {
  Activity,
  AlertTriangle,
  Archive,
  CalendarClock,
  CalendarDays,
  Layers,
  LayoutDashboard,
  List,
  Search,
  Table2,
  X,
} from "lucide-react";
import { Column } from "./column";
import { BoardTable } from "./board-table";
import { BoardListView } from "./board-list-view";
import { ColumnVisibilityDropdown } from "./column-visibility-dropdown";
import { DesignerLeaderboardButton } from "./designer-leaderboard";
import { OrderCard } from "./order-card";
import { GroupedOrderCard } from "./grouped-order-card";
import { CreateOrderModal } from "./create-order-modal";
import { CardDetailModal } from "./card-detail-modal";
import { MoveBlockedModal } from "./move-blocked-modal";
import { FinishedCompletionSmsDialog } from "./finished-completion-sms-dialog";
import type { GroupDueDateUpdate } from "./group-due-dates-modal";
import type { ActionButtonResult } from "./action-button";
import { Input, Select } from "@/components/ui/input";
import { type NotifyColumnConfig } from "@/lib/board-notify";
import { NotificationPopup } from "@/components/automation/notification-popup";
import { createClient } from "@/lib/supabase/client";
import { fetchRetryingStale404, fetchWithAuth, isStaleNext404 } from "@/lib/fetch-with-auth";
import {
  canDragInColumn,
  canDropIn,
  canEditOrderDetails,
  canLeaveColumn,
  canMove,
  canSetBoardTagAndPriority,
  canUseBoardActionButtons,
} from "@/lib/permissions";
import {
  CARD_IMAGE_CHANGED_EVENT,
  preferCardImage,
  type BoardThumbnail,
  type CardImageSource,
} from "@/lib/card-image";
import { QUEUE_CHANGED_EVENT, type QueueChangedDetail } from "@/lib/queue-events";
import { cn } from "@/lib/utils";
import { type MissingField } from "@/lib/orders/validate-ready-to-move";
import { requestOrderMove } from "@/lib/orders/move-order-client";
import { HoldReasonPopup } from "@/components/board/hold-reason-popup";
import { isHoldColumn } from "@/lib/hold-column";
import {
  finishedCompletionSmsSent,
  isFinishedNoReviewStage,
} from "@/lib/net-terms-fulfill";
import {
  getGroupKey,
  orderGroupSearchSuggestions,
  parseGroupDragId,
  uniqueOrdersById,
  type GroupEntry,
} from "@/lib/group-orders";
import {
  businessDateString,
  isOrderNumberQuery,
  orderMatchesBoardFilters,
  isOrderArchived,
} from "@/lib/board-order-filters";
import {
  getComboStock,
  comboStockConfirmed,
  isComboOrder,
} from "@/lib/combo-stock";
import {
  MANUAL_WEBHOOK_SOURCE_FILTER,
  OTHER_WEBHOOK_SOURCE_FILTER,
  UNASSIGNED_OWNER_FILTER,
} from "@/lib/constants";
import { DEFAULT_WEBHOOK_SOURCE_STYLES } from "@/lib/webhook-source-styles";
import { filterButtonsForColumn } from "@/lib/button-automations";
import {
  loadHiddenColumnIds,
  saveHiddenColumnIds,
} from "@/lib/board-column-visibility";
import {
  defaultSortForColumn,
  getColumnSortMode,
  loadColumnSortMap,
  saveColumnSortMap,
  sortOrdersForColumn,
  type ColumnSortMap,
  type ColumnSortMode,
} from "@/lib/board-column-sort";
import { isStartColumn } from "@/lib/board-columns";
import {
  buildStaffDueSpecs,
  DEFAULT_PROCESSING_DAYS,
  mergeDueSpecsIntoOrderSpecs,
  type DueDateMode,
} from "@/lib/due-date";
import type {
  BoardColumn,
  CardWarningRule,
  Tag,
  CustomField,
  Designer,
  ButtonAutomation,
  FastActionButton,
  IntegrationMode,
  OrderTagSummary,
  OrderWithRelations,
  Role,
} from "@/lib/types";
import type { PriorityScore } from "@/lib/order-priority-score";
import {
  manualPrioritySpecsPatch,
  priorityScoreFromSpecs,
} from "@/lib/order-priority-score";
import { isApplicationEnabled } from "@/lib/order-application";
import { isRushOrder } from "@/lib/order-rush";
import { calendarDaysUntilDue } from "@/lib/board-due-date";
import { columnsIncludedInBoardHealth } from "@/lib/board-health";
import {
  hoursInCurrentColumn,
  daysInCurrentColumn,
} from "@/lib/card-warning-rules";
import { stageKey } from "@/lib/stage-groups";
import {
  evaluateEmergency,
  matchesQuickFilter,
  quickFilterMeta,
  type EmergencyQuickFilter,
  type EmergencyResult,
} from "@/lib/emergency-view";
import {
  DEFAULT_EMERGENCY_BALANCE,
  normalizeEmergencyBalance,
  type EmergencyBalanceConfig,
  type EmergencyDueQuickFilterKey,
} from "@/lib/emergency-balance";
import {
  columnIdsForQuickFilter,
  isQuickFilterVisible,
} from "@/lib/emergency-quick-filters";
import type { WebhookSourceStyles } from "@/lib/webhook-source-styles";
import type { OrderOwner } from "./order-form-body";
import type { CardNotificationBadge } from "@/lib/card-badges";
import type { ColumnOrdersResponse } from "@/app/api/board/column-orders/route";
import type { SearchOrdersResponse } from "@/app/api/board/search-orders/route";
import type { BoardOrderEnrichment } from "@/lib/board-order-enrichment";
import type { BoardShippingSign } from "@/lib/board-shipping";
import type { DieAlert, DieBoardStatus } from "@/lib/die-request";
import {
  countDesignerLoads,
  designerLoadColumnIds,
} from "@/lib/designer-load";
import { isShippedCustomerColumn } from "@/lib/shipped-customer-column";
import {
  chipsToStampOnEnter,
  withTimeChipStamp,
  type TimeChip,
} from "@/lib/time-chips";

/** Prefer pointer position so empty columns and wide boards register drops reliably. */
const boardCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) return pointerCollisions;
  return closestCorners(args);
};

/** Browser network blips: offline, HMR restart, aborted navigation. */
function isTransientNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("network error") ||
    msg.includes("load failed") ||
    err.name === "AbortError"
  );
}

/**
 * Pick a card to scroll to after search — the first match in board order
 * (column order, then position). Works for BOTH order-number and name/text
 * queries: a multi-part order (XXX-1 + XXX-2 …) now navigates to its first part
 * instead of giving up, which is why searches "sometimes didn't take".
 */
function pickSearchAutoNavTarget(
  q: string,
  orders: OrderWithRelations[],
  columns: BoardColumn[]
): { columnId: string; orderId: string } | null {
  if (!q || orders.length === 0) return null;

  const colIndex = new Map(columns.map((c, i) => [c.id, i]));
  const sorted = [...orders].sort((a, b) => {
    const ai = colIndex.get(a.column_id) ?? Number.MAX_SAFE_INTEGER;
    const bi = colIndex.get(b.column_id) ?? Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    return a.position - b.position;
  });
  return { columnId: sorted[0].column_id, orderId: sorted[0].id };
}

type ColumnLoadStatus = "idle" | "loading" | "loaded" | "error";

interface BoardProps {
  tenantId: string;
  tenantName: string;
  role: Role;
  columns: BoardColumn[];
  tags: Tag[];
  owners: OrderOwner[];
  currentUserId: string;
  currentUserName: string;
  customFields: CustomField[];
  tenantIntegrationMode?: IntegrationMode;
  designers: Designer[];
  notifyColumns: NotifyColumnConfig[];
  smsConfigured: boolean;
  publicAppUrl: boolean;
  buttonAutomations: ButtonAutomation[];
  fastActionButtons: FastActionButton[];
  warningRules?: CardWarningRule[];
  warningAnimationOpacity?: number;
  warningAnimationSpeedMs?: number;
  warningAnimationSpreadPx?: number;
  /** Weekdays that count toward stale warnings (Date.getDay: 0–6). */
  warningWorkingDays?: number[];
  /** Emergency / Urgency view thresholds (defaults = current hardcoded balance). */
  emergencyBalance?: EmergencyBalanceConfig;
  webhookSourceStyles?: WebhookSourceStyles;
  timeChips?: TimeChip[];
  initialOrderId?: string | null;
  appUrl: string;
}

export function Board({
  tenantId,
  tenantName,
  role,
  columns,
  tags,
  owners,
  currentUserId,
  currentUserName,
  customFields,
  tenantIntegrationMode = "local",
  designers,
  notifyColumns,
  smsConfigured,
  publicAppUrl,
  buttonAutomations,
  fastActionButtons,
  warningRules = [],
  warningAnimationOpacity = 30,
  warningAnimationSpeedMs = 2500,
  warningAnimationSpreadPx = 3,
  warningWorkingDays = [1, 2, 3, 4, 5],
  emergencyBalance: emergencyBalanceProp,
  webhookSourceStyles = undefined,
  timeChips = [],
  initialOrderId = null,
  appUrl,
}: BoardProps) {
  const router = useRouter();
  const emergencyBalance = useMemo(
    () =>
      normalizeEmergencyBalance(
        emergencyBalanceProp ?? DEFAULT_EMERGENCY_BALANCE,
        columns.map((c) => ({ id: c.id, name: c.name }))
      ),
    [emergencyBalanceProp, columns]
  );
  const emergencyQuickFilterMeta = useMemo(
    () => quickFilterMeta(emergencyBalance),
    [emergencyBalance]
  );

  // ── Core order state ────────────────────────────────────────────────────────
  const [orders, setOrders] = useState<OrderWithRelations[]>([]);

  // Canonical snapshot used for DnD rollback — updated on every non-drag mutation.
  const boardOrdersRef = useRef<OrderWithRelations[]>([]);

  // ── Per-column lazy-load state ───────────────────────────────────────────────
  const [columnLoadStatus, setColumnLoadStatus] = useState<
    Record<string, ColumnLoadStatus>
  >({});
  const [columnHasMore, setColumnHasMore] = useState<Record<string, boolean>>(
    {}
  );
  const [columnTotal, setColumnTotal] = useState<Record<string, number>>({});
  // Tracks the last page loaded per column so "load more" fetches the next one.
  const columnCurrentPageRef = useRef<Record<string, number>>({});
  // Tracks which columns have ever been loaded (used by scheduleRefresh).
  const loadedColumnsRef = useRef(new Set<string>());
  // Mirror of columnLoadStatus in a ref to avoid stale closures in callbacks.
  const columnLoadStatusRef = useRef<Record<string, ColumnLoadStatus>>({});

  // ── Enrichment maps (populated per-column as cards load) ────────────────────
  const [fieldValuesByOrder, setFieldValuesByOrder] = useState<
    Record<string, Record<string, unknown>>
  >({});
  const [thumbnailByOrder, setThumbnailByOrder] = useState<
    Record<string, BoardThumbnail[]>
  >({});
  const [notificationBadgeByOrder, setNotificationBadgeByOrder] = useState<
    Record<string, CardNotificationBadge>
  >({});
  const [ownerNameByOrder, setOwnerNameByOrder] = useState<
    Record<string, string>
  >({});
  const [designerNameByOrder, setDesignerNameByOrder] = useState<
    Record<string, string>
  >({});
  const [shippingSignByOrder, setShippingSignByOrder] = useState<
    Record<string, BoardShippingSign>
  >({});
  const [dieAlertByOrder, setDieAlertByOrder] = useState<
    Record<string, DieAlert>
  >({});
  const [dieStatusByOrder, setDieStatusByOrder] = useState<
    Record<string, DieBoardStatus>
  >({});
  const [approvalDateByOrder, setApprovalDateByOrder] = useState<
    Record<string, string>
  >({});

  // ── UI state ────────────────────────────────────────────────────────────────
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeGroup, setActiveGroup] = useState<GroupEntry | null>(null);
  const [createColumn, setCreateColumn] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [highlightedOrderId, setHighlightedOrderId] = useState<string | null>(
    null
  );
  const [orderQuery, setOrderQuery] = useState("");
  const [personFilter, setPersonFilter] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [webhookSourceFilter, setWebhookSourceFilter] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [dueTodayOnly, setDueTodayOnly] = useState(false);
  // Archive: finished orders are hidden from the active board (so they stop
  // showing as late/stuck) but stay retrievable. `archivedOnly` shows only the
  // archived set. Uses specs.archived — additive, no schema change.
  const [archivedOnly, setArchivedOnly] = useState(false);
  // Emergency / Urgency view (read-only overlay; changes no existing data).
  const [emergencyOnly, setEmergencyOnly] = useState(false);
  const [emergencyQuickFilter, setEmergencyQuickFilter] =
    useState<EmergencyQuickFilter | null>(null);
  // Soft warning when a combo/application job is dragged past the Application stage.
  const [comboAppWarning, setComboAppWarning] = useState<{
    orderTitle: string;
    toColumnName: string;
    proceed: () => void;
  } | null>(null);
  const [finishedSmsPrompt, setFinishedSmsPrompt] = useState<{
    orders: { id: string; title: string }[];
  } | null>(null);

  // Drop a due chip filter if settings hide that chip.
  useEffect(() => {
    if (!emergencyQuickFilter) return;
    if (emergencyQuickFilter === "combo_at_risk") {
      if (emergencyBalance.toolbar.combo_at_risk_visible === false) {
        setEmergencyQuickFilter(null);
      }
      return;
    }
    if (!isQuickFilterVisible(emergencyBalance, emergencyQuickFilter)) {
      setEmergencyQuickFilter(null);
      if (emergencyQuickFilter === "late") setOverdueOnly(false);
      if (emergencyQuickFilter === "due_today") setDueTodayOnly(false);
    }
  }, [emergencyBalance, emergencyQuickFilter]);

  useEffect(() => {
    if (
      emergencyOnly &&
      emergencyBalance.toolbar.emergency_visible === false
    ) {
      setEmergencyOnly(false);
    }
  }, [emergencyBalance.toolbar.emergency_visible, emergencyOnly]);

  const [searchResults, setSearchResults] = useState<OrderWithRelations[] | null>(
    null
  );
  const [searchEnrichments, setSearchEnrichments] =
    useState<BoardOrderEnrichment | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  /** Avoid re-scrolling for the same unique query while results refresh. */
  const lastAutoNavQueryRef = useRef("");
  /** Scroll target after a unique search (may wait for a hidden column to reappear). */
  const pendingSearchNavRef = useRef<{
    columnId: string;
    orderId: string;
  } | null>(null);
  /** Bumps when a new search nav target is set so the scroll effect re-runs. */
  const [searchNavNonce, setSearchNavNonce] = useState(0);
  const boardScrollRef = useRef<HTMLDivElement | null>(null);
  const columnsRef = useRef(columns);
  columnsRef.current = columns;

  const detailGroupSize = useMemo(() => {
    if (!detailId) return undefined;
    const source = searchResults ?? orders;
    const order = source.find((o) => o.id === detailId);
    if (!order) return undefined;
    const key = getGroupKey(order);
    if (!key) return undefined;
    const count = source.filter((o) => getGroupKey(o) === key).length;
    return count >= 2 ? count : undefined;
  }, [detailId, orders, searchResults]);

  /** How many parts of the detail order's group share the same column, plus that column's name. */
  const detailGroupSameColumn = useMemo(() => {
    if (!detailId) return undefined;
    const source = searchResults ?? orders;
    const order = source.find((o) => o.id === detailId);
    if (!order) return undefined;
    const key = getGroupKey(order);
    if (!key) return undefined;
    const groupOrders = source.filter((o) => getGroupKey(o) === key);
    if (groupOrders.length < 2) return undefined;
    const sameCount = groupOrders.filter((o) => o.column_id === order.column_id).length;
    const colName = columns.find((c) => c.id === order.column_id)?.name ?? "this column";
    return { sameColumnCount: sameCount, columnName: colName };
  }, [detailId, orders, searchResults, columns]);

  const doneColumnIds = useMemo(
    () => new Set(columns.filter((c) => c.kind === "done").map((c) => c.id)),
    [columns]
  );
  /** Same column set as Board health (through Ready to Ship). */
  const activePipelineColumnIds = useMemo(
    () =>
      new Set(
        columnsIncludedInBoardHealth(
          columns.map((c) => ({ id: c.id, name: c.name, kind: c.kind }))
        ).map((c) => c.id)
      ),
    [columns]
  );

  /** Per due-chip column range (Start → through column from Emergency settings). */
  const dueQuickFilterColumnIds = useMemo(() => {
    const cols = columns.map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind,
    }));
    const qf = emergencyBalance.quick_filters;
    return {
      one_day_left: columnIdsForQuickFilter(
        cols,
        qf.one_day_left.through_column_id
      ),
      due_today: columnIdsForQuickFilter(cols, qf.due_today.through_column_id),
      late: columnIdsForQuickFilter(cols, qf.late.through_column_id),
    } satisfies Record<EmergencyDueQuickFilterKey, Set<string>>;
  }, [columns, emergencyBalance.quick_filters]);

  const businessToday = businessDateString();

  // Live designer load (Start + In Progress) from loaded board orders, seeded
  // from server counts so the assign dropdown stays accurate as cards move.
  // Shown as Name (cards)/skuRows — e.g. Manny (3)/8.
  const designersWithLoad = useMemo(() => {
    const loadColIds = designerLoadColumnIds(columns);
    if (loadColIds.length === 0) {
      return designers.map((d) => ({
        ...d,
        load: d.load ?? 0,
        skuCount: d.skuCount ?? 0,
      }));
    }
    const loadSet = new Set(loadColIds);
    const loadColumnsLoaded = loadColIds.every((id) =>
      loadedColumnsRef.current.has(id)
    );
    if (!loadColumnsLoaded) {
      return designers.map((d) => ({
        ...d,
        load: d.load ?? 0,
        skuCount: d.skuCount ?? 0,
      }));
    }
    const counts = countDesignerLoads(
      designers.map((d) => d.id),
      orders,
      loadSet
    );
    return designers.map((d) => {
      const stats = counts.get(d.id);
      return {
        ...d,
        load: stats?.load ?? 0,
        skuCount: stats?.skuCount ?? 0,
      };
    });
  }, [designers, orders, columns, columnLoadStatus]);

  const knownWebhookSourceKeys = useMemo(
    () =>
      (webhookSourceStyles ?? DEFAULT_WEBHOOK_SOURCE_STYLES).sources.map((s) =>
        s.key.toLowerCase()
      ),
    [webhookSourceStyles]
  );

  /** Column scope for Late / Due today full-DB load (matches chip through-column). */
  const dueDateLoadColumnIds = useMemo(() => {
    if (overdueOnly) return dueQuickFilterColumnIds.late;
    if (dueTodayOnly) return dueQuickFilterColumnIds.due_today;
    return activePipelineColumnIds;
  }, [
    overdueOnly,
    dueTodayOnly,
    dueQuickFilterColumnIds,
    activePipelineColumnIds,
  ]);

  const boardFilters = useMemo(
    () => ({
      q: orderQuery,
      personFilter,
      ownerFilter,
      webhookSourceFilter,
      knownWebhookSourceKeys,
      overdueOnly,
      dueTodayOnly,
      doneColumnIds,
      activePipelineColumnIds: dueDateLoadColumnIds,
    }),
    [
      orderQuery,
      personFilter,
      ownerFilter,
      webhookSourceFilter,
      knownWebhookSourceKeys,
      overdueOnly,
      dueTodayOnly,
      doneColumnIds,
      dueDateLoadColumnIds,
    ]
  );

  /** Maps every orderId to its cross-column group size (only set when ≥ 2). */
  const groupSizeByOrder = useMemo(() => {
    const filtersOn =
      orderQuery.trim() !== "" ||
      personFilter !== "" ||
      ownerFilter !== "" ||
      webhookSourceFilter !== "" ||
      overdueOnly ||
      dueTodayOnly;
    const source = filtersOn
      ? (searchResults ??
        orders.filter((order) =>
          orderMatchesBoardFilters(
            order,
            fieldValuesByOrder[order.id] ?? {},
            customFields,
            boardFilters
          )
        ))
      : orders;
    const keyIds = new Map<string, string[]>();
    for (const o of source) {
      const key = getGroupKey(o);
      if (!key) continue;
      if (!keyIds.has(key)) keyIds.set(key, []);
      keyIds.get(key)!.push(o.id);
    }
    const map: Record<string, number> = {};
    for (const ids of keyIds.values()) {
      if (ids.length >= 2) {
        for (const id of ids) map[id] = ids.length;
      }
    }
    return map;
  }, [
    orders,
    searchResults,
    orderQuery,
    personFilter,
    ownerFilter,
    webhookSourceFilter,
    overdueOnly,
    dueTodayOnly,
    boardFilters,
    fieldValuesByOrder,
    customFields,
  ]);

  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [notifyPopup, setNotifyPopup] = useState<{
    order: OrderWithRelations;
    notifyColumn: NotifyColumnConfig;
    columnName: string;
    groupOrders?: OrderWithRelations[];
  } | null>(null);
  const [holdReasonPopup, setHoldReasonPopup] = useState<{
    orderId: string;
    orderTitle: string;
    columnName: string;
  } | null>(null);
  const [groupedView, setGroupedView] = useState(false);
  const groupedViewRef = useRef(false);
  groupedViewRef.current = groupedView;
  const [boardView, setBoardView] = useState<"kanban" | "table" | "list">(
    "kanban"
  );
  const [hiddenColIds, setHiddenColIds] = useState<Set<string>>(() => new Set());
  const [columnSortById, setColumnSortById] = useState<ColumnSortMap>({});
  const columnSortByIdRef = useRef<ColumnSortMap>({});
  columnSortByIdRef.current = columnSortById;
  const [persistedUiReady, setPersistedUiReady] = useState(false);
  const isDesignerRole = role === "designer";

  // Restore column UI prefs after mount so SSR HTML matches the first client render.
  // Person/owner filters intentionally reset on refresh (not restored from storage).
  useEffect(() => {
    setHiddenColIds(loadHiddenColumnIds(tenantId));
    setColumnSortById(loadColumnSortMap(tenantId));
    setPersistedUiReady(true);
  }, [tenantId]);

  useEffect(() => {
    if (!persistedUiReady) return;
    saveColumnSortMap(tenantId, columnSortById);
  }, [persistedUiReady, tenantId, columnSortById]);

  function setColumnSortMode(columnId: string, mode: ColumnSortMode) {
    // Start column sort is locked to Priority: 5 → None for all users.
    if (isStartColumn(columnId, columns)) return;
    const columnDefault = defaultSortForColumn(false);
    setColumnSortById((prev) => {
      let next: ColumnSortMap;
      if (mode === columnDefault) {
        if (!(columnId in prev)) return prev;
        next = { ...prev };
        delete next[columnId];
      } else if (prev[columnId] === mode) {
        return prev;
      } else {
        next = { ...prev, [columnId]: mode };
      }
      columnSortByIdRef.current = next;
      return next;
    });
    // Reload first page with DB order matching the new sort (pagination fix).
    columnCurrentPageRef.current = {
      ...columnCurrentPageRef.current,
      [columnId]: 0,
    };
    void fetchColumnOrdersRef.current(columnId, 0, { reset: true });
  }

  function setAllColumnsSortMode(mode: ColumnSortMode) {
    const next: ColumnSortMap = {};
    for (const col of columns) {
      if (isStartColumn(col.id, columns)) continue;
      const colDefault = defaultSortForColumn(false);
      if (mode !== colDefault) next[col.id] = mode;
    }
    columnSortByIdRef.current = next;
    setColumnSortById(next);
    for (const col of columns) {
      if (isStartColumn(col.id, columns)) continue;
      columnCurrentPageRef.current = {
        ...columnCurrentPageRef.current,
        [col.id]: 0,
      };
      void fetchColumnOrdersRef.current(col.id, 0, { reset: true });
    }
  }
  const visibleColumns = useMemo(
    () => columns.filter((c) => !hiddenColIds.has(c.id)),
    [columns, hiddenColIds]
  );

  const toggleColumnVisibility = useCallback(
    (columnId: string) => {
      setHiddenColIds((prev) => {
        const next = new Set(prev);
        if (next.has(columnId)) {
          next.delete(columnId);
        } else {
          const visibleAfterHide =
            columns.filter((c) => !next.has(c.id) && c.id !== columnId).length;
          if (visibleAfterHide === 0) return prev;
          next.add(columnId);
        }
        saveHiddenColumnIds(tenantId, next);
        return next;
      });
    },
    [columns, tenantId]
  );

  const showAllColumns = useCallback(() => {
    setHiddenColIds(new Set());
    saveHiddenColumnIds(tenantId, new Set());
  }, [tenantId]);
  const [animateWarnings, setAnimateWarnings] = useState(true);
  const dueFilterMenuRef = useRef<HTMLDetailsElement | null>(null);
  const [moveBlockedState, setMoveBlockedState] = useState<{
    orderId: string;
    missingFields: MissingField[];
  } | null>(null);

  // Close toolbar <details> menus when clicking outside.
  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      const due = dueFilterMenuRef.current;
      if (due?.open && !due.contains(target)) {
        due.open = false;
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  // Apply per-tenant warning animation CSS variables client-side.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--w-opacity", String(warningAnimationOpacity / 100));
    root.style.setProperty("--w-spread", `${warningAnimationSpreadPx}px`);
    root.style.setProperty("--w-duration", `${warningAnimationSpeedMs / 1000}s`);
  }, [warningAnimationOpacity, warningAnimationSpeedMs, warningAnimationSpreadPx]);

  // Open detail modal when deep-linked via ?order=<id>.
  useEffect(() => {
    const source = searchResults ?? orders;
    if (initialOrderId && source.some((o) => o.id === initialOrderId)) {
      setHighlightedOrderId(null);
      setDetailId(initialOrderId);
    }
  }, [initialOrderId, orders, searchResults]);

  function openOrderDetail(orderId: string) {
    setHighlightedOrderId(null);
    setDetailId(orderId);
  }

  function clearCardHighlight() {
    setHighlightedOrderId(null);
  }

  /** Keep last-closed card ring until another card opens or empty board is clicked. */
  function handleBoardPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!highlightedOrderId) return;
    const target = e.target;
    if (!(target instanceof Element)) return;
    if (
      target.closest("[data-order-card]") ||
      target.closest("[data-order-id]") ||
      target.closest("[data-order-ids]")
    ) {
      return;
    }
    clearCardHighlight();
  }

  // When filters are active, search the full database instead of filtering
  // only the lazily-loaded pages already in memory.
  // Single key keeps the useEffect deps array size stable across HMR.
  const boardSearchKey = [
    orderQuery,
    personFilter,
    ownerFilter,
    webhookSourceFilter,
    knownWebhookSourceKeys.join(","),
    overdueOnly ? "1" : "0",
    dueTodayOnly ? "1" : "0",
    overdueOnly
      ? (emergencyBalance.quick_filters.late.through_column_id ?? "")
      : "",
    dueTodayOnly
      ? (emergencyBalance.quick_filters.due_today.through_column_id ?? "")
      : "",
    tenantId,
  ].join("\0");

  useEffect(() => {
    const q = orderQuery.trim();
    const filtersActive =
      q !== "" ||
      personFilter !== "" ||
      ownerFilter !== "" ||
      webhookSourceFilter !== "" ||
      overdueOnly ||
      dueTodayOnly;

    if (!q) {
      lastAutoNavQueryRef.current = "";
      pendingSearchNavRef.current = null;
    }

    if (!filtersActive) {
      setSearchResults(null);
      setSearchEnrichments(null);
      setSearchLoading(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearchLoading(true);
      void (async () => {
        try {
          const params = new URLSearchParams();
          if (q) params.set("q", q);
          if (personFilter) params.set("designerId", personFilter);
          if (ownerFilter) params.set("ownerId", ownerFilter);
          if (webhookSourceFilter) {
            params.set("webhookSource", webhookSourceFilter);
            if (
              webhookSourceFilter === OTHER_WEBHOOK_SOURCE_FILTER &&
              knownWebhookSourceKeys.length > 0
            ) {
              params.set("knownSources", knownWebhookSourceKeys.join(","));
            }
          }
          if (overdueOnly) {
            params.set("overdueOnly", "1");
            const through =
              emergencyBalance.quick_filters.late.through_column_id;
            if (through) params.set("throughColumnId", through);
          }
          if (dueTodayOnly) {
            params.set("dueTodayOnly", "1");
            const through =
              emergencyBalance.quick_filters.due_today.through_column_id;
            if (through) params.set("throughColumnId", through);
          }

          const res = await fetchWithAuth(`/api/board/search-orders?${params}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = (await res.json()) as SearchOrdersResponse;
          if (cancelled) return;

          setSearchResults(data.orders);
          setSearchEnrichments({
            fieldValuesByOrder: data.fieldValuesByOrder,
            thumbnailByOrder: data.thumbnailByOrder,
            notificationBadgeByOrder: data.notificationBadgeByOrder,
            ownerNameByOrder: data.ownerNameByOrder,
            designerNameByOrder: data.designerNameByOrder,
            shippingSignByOrder: data.shippingSignByOrder ?? {},
            dieAlertByOrder: data.dieAlertByOrder ?? {},
            dieStatusByOrder: data.dieStatusByOrder ?? {},
            approvalDateByOrder: data.approvalDateByOrder ?? {},
          });

          // Auto-nav: unique order-number hit, or first match for name/text search.
          // Multi-part order numbers (XXX-1 + XXX-2) intentionally stay put.
          if (q && lastAutoNavQueryRef.current !== q) {
            const target = pickSearchAutoNavTarget(
              q,
              data.orders,
              columnsRef.current
            );
            lastAutoNavQueryRef.current = q;
            if (target) {
              pendingSearchNavRef.current = target;
              setHighlightedOrderId(target.orderId);
              setSearchNavNonce((n) => n + 1);
              setHiddenColIds((prev) => {
                if (!prev.has(target.columnId)) return prev;
                const next = new Set(prev);
                next.delete(target.columnId);
                saveHiddenColumnIds(tenantId, next);
                return next;
              });
            } else {
              pendingSearchNavRef.current = null;
            }
          }
        } catch (err) {
          console.error("[Board] Failed to search orders:", err);
          // Keep searchResults null so the board falls back to filtering
          // already-loaded orders instead of showing an empty board.
          if (!cancelled) {
            setSearchResults(null);
            setSearchEnrichments(null);
          }
        } finally {
          if (!cancelled) setSearchLoading(false);
        }
      })();
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // boardSearchKey encodes all filter inputs; orderQuery/etc. are read from closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable single dep avoids HMR size churn
  }, [boardSearchKey]);

  // Scroll to the search hit once its column/card is visible in the DOM.
  useEffect(() => {
    const pending = pendingSearchNavRef.current;
    if (!pending) return;
    if (hiddenColIds.has(pending.columnId)) return;

    const { columnId, orderId } = pending;
    let cancelled = false;
    let attempts = 0;
    // ~6s: the target card can render late (search results still populating, a
    // long column, or a just-unhidden column), and giving up too early was the
    // main cause of "search doesn't jump to the order".
    const maxAttempts = 120;

    /**
     * Center in the board strip (X) and column body (Y).
     * Avoid scrollIntoView — its inline:"nearest" parks cards on the edge
     * and fights the horizontal center scroll.
     */
    const scrollBoardTo = (el: Element) => {
      const scroller = boardScrollRef.current;
      const target = el as HTMLElement;
      if (scroller) {
        const sRect = scroller.getBoundingClientRect();
        const eRect = target.getBoundingClientRect();
        const nextLeft =
          scroller.scrollLeft +
          (eRect.left + eRect.width / 2 - (sRect.left + sRect.width / 2));
        scroller.scrollTo({ left: nextLeft, behavior: "smooth" });
      }
      const colScroll = target.closest(
        "[data-column-scroll]"
      ) as HTMLElement | null;
      if (colScroll && colScroll.contains(target) && colScroll !== target) {
        const cRect = colScroll.getBoundingClientRect();
        const eRect = target.getBoundingClientRect();
        const nextTop =
          colScroll.scrollTop +
          (eRect.top + eRect.height / 2 - (cRect.top + cRect.height / 2));
        colScroll.scrollTo({ top: nextTop, behavior: "smooth" });
      } else {
        // Not inside a Kanban column (e.g. a Table/List row) — plain center-scroll.
        target.scrollIntoView({ block: "center", inline: "nearest" });
      }
      if (window.scrollX !== 0) window.scrollTo(0, window.scrollY);
    };

    const tryScroll = () => {
      if (cancelled) return;
      const orderEl = document.querySelector(`[data-order-id="${orderId}"]`);
      const groupEl = document.querySelector(
        `[data-order-ids*="${orderId}"]`
      );
      const columnEl = document.querySelector(`[data-column-id="${columnId}"]`);
      const el = orderEl ?? groupEl;

      if (el) {
        scrollBoardTo(el);
        // Keep the ref until settle so React Strict Mode remount can re-scroll.
        window.setTimeout(() => {
          if (
            !cancelled &&
            pendingSearchNavRef.current?.orderId === orderId
          ) {
            pendingSearchNavRef.current = null;
          }
        }, 500);
        return;
      }

      attempts += 1;
      if (attempts < maxAttempts) {
        window.setTimeout(tryScroll, 50);
        return;
      }

      // Card never appeared — fall back to the column.
      if (columnEl) scrollBoardTo(columnEl);
      pendingSearchNavRef.current = null;
    };

    // Two frames so filtered columns finish layout before measuring.
    const id = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(tryScroll);
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(id);
    };
  }, [searchNavNonce, hiddenColIds, searchResults, boardView]);

  // Safety net: if the *document* scrolls sideways, pin it back.
  // Only act on viewport/document scroll — never on .board-scroll / columns.
  // A capture listener that calls scrollTo on every nested scroll freezes
  // horizontal board panning in Safari / iPad (gesture gets cancelled).
  useEffect(() => {
    const pinWindowX = (event?: Event) => {
      if (event) {
        const t = event.target;
        if (
          t !== document &&
          t !== document.documentElement &&
          t !== document.body
        ) {
          return;
        }
      }
      if (window.scrollX !== 0) window.scrollTo(0, window.scrollY);
    };
    pinWindowX();
    window.addEventListener("scroll", pinWindowX, true);
    return () => window.removeEventListener("scroll", pinWindowX, true);
  }, []);

  useEffect(() => {
    if (boardView !== "kanban") return;
    const el = boardScrollRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      const absX = Math.abs(e.deltaX);
      const absY = Math.abs(e.deltaY);
      const horizontal =
        e.shiftKey || absX > absY || (absX > 0 && absY < 1);
      if (!horizontal) return;
      const dx = e.shiftKey && absX <= absY ? e.deltaY : e.deltaX;
      if (dx === 0) return;
      e.preventDefault();
      el.scrollLeft += dx;
    };

    let panPointerId: number | null = null;
    let panStartX = 0;
    let panStartScroll = 0;
    const interactive =
      "button,a,input,select,textarea,[data-order-card],[data-order-id]";
    const onPointerDown = (e: globalThis.PointerEvent) => {
      if (e.button !== 0) return;
      const t = e.target;
      if (!(t instanceof Element) || t.closest(interactive)) return;
      panPointerId = e.pointerId;
      panStartX = e.clientX;
      panStartScroll = el.scrollLeft;
    };
    const onPointerMove = (e: globalThis.PointerEvent) => {
      if (panPointerId !== e.pointerId) return;
      el.scrollLeft = panStartScroll - (e.clientX - panStartX);
    };
    const endPan = (e: globalThis.PointerEvent) => {
      if (panPointerId === e.pointerId) panPointerId = null;
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", endPan);
    el.addEventListener("pointercancel", endPan);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", endPan);
      el.removeEventListener("pointercancel", endPan);
    };
  }, [boardView]);

  function closeOrderDetail() {
    const closedId = detailId;
    setDetailId(null);
    if (initialOrderId) {
      router.replace("/board", { scroll: false });
    }
    if (!closedId) return;

    setHighlightedOrderId(closedId);

    const scrollBoardTo = (el: Element) => {
      const scroller = boardScrollRef.current;
      const target = el as HTMLElement;
      if (scroller) {
        const sRect = scroller.getBoundingClientRect();
        const eRect = target.getBoundingClientRect();
        const nextLeft =
          scroller.scrollLeft +
          (eRect.left + eRect.width / 2 - (sRect.left + sRect.width / 2));
        scroller.scrollTo({ left: nextLeft, behavior: "smooth" });
      }
      const colScroll = target.closest(
        "[data-column-scroll]"
      ) as HTMLElement | null;
      if (colScroll && colScroll.contains(target) && colScroll !== target) {
        const cRect = colScroll.getBoundingClientRect();
        const eRect = target.getBoundingClientRect();
        const nextTop =
          colScroll.scrollTop +
          (eRect.top + eRect.height / 2 - (cRect.top + cRect.height / 2));
        colScroll.scrollTo({ top: nextTop, behavior: "smooth" });
      } else {
        // Not inside a Kanban column (e.g. a Table/List row) — plain center-scroll.
        target.scrollIntoView({ block: "center", inline: "nearest" });
      }
      if (window.scrollX !== 0) window.scrollTo(0, window.scrollY);
    };

    let attempts = 0;
    const tryScroll = () => {
      const orderEl = document.querySelector(`[data-order-id="${closedId}"]`);
      const groupEl = document.querySelector(
        `[data-order-ids*="${closedId}"]`
      );
      const el = orderEl ?? groupEl;
      if (el) {
        scrollBoardTo(el);
        return;
      }
      attempts += 1;
      if (attempts < 20) window.setTimeout(tryScroll, 40);
    };
    window.requestAnimationFrame(tryScroll);
  }

  function flashToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 3500);
  }

  const columnsById = useMemo(() => {
    const map = new Map<string, BoardColumn>();
    for (const c of columns) map.set(c.id, c);
    return map;
  }, [columns]);

  function flashPermissionError(message: string) {
    setPermissionError(message);
    window.setTimeout(() => setPermissionError(null), 3500);
  }

  /**
   * When the designer/owner/search filter is active the board renders
   * `searchResults`, not `orders`. Moves must update both or the card snaps back.
   */
  function patchOrderPlacement(
    orderId: string,
    patch: Partial<
      Pick<OrderWithRelations, "column_id" | "position" | "last_moved_at" | "specs">
    > & { column_id: string }
  ) {
    setOrders((prev) => {
      const next = prev.map((o) =>
        o.id === orderId ? { ...o, ...patch } : o
      );
      boardOrdersRef.current = next;
      return next;
    });
    setSearchResults((prev) => {
      if (!prev) return prev;
      const next = prev.map((o) =>
        o.id === orderId ? { ...o, ...patch } : o
      );
      return next;
    });
  }

  /** Optimistic stamps for custom time chips when entering a column. */
  function columnEnterPatch(
    order: OrderWithRelations,
    toColumnId: string
  ): Partial<Pick<OrderWithRelations, "last_moved_at" | "specs">> {
    const now = new Date().toISOString();
    const toStamp = chipsToStampOnEnter(timeChips, toColumnId);
    if (toStamp.length === 0) return { last_moved_at: now };
    let specs = { ...(order.specs ?? {}) } as OrderWithRelations["specs"];
    for (const chip of toStamp) {
      specs = withTimeChipStamp(specs, chip.id, now) as OrderWithRelations["specs"];
    }
    return { last_moved_at: now, specs };
  }

  function restoreOrdersSnapshot(snapshot: OrderWithRelations[]) {
    boardOrdersRef.current = snapshot;
    setOrders(snapshot);
    setSearchResults((prev) => {
      if (!prev) return prev;
      const byId = new Map(snapshot.map((o) => [o.id, o]));
      return prev.map((o) => {
        const updated = byId.get(o.id);
        return updated
          ? { ...o, column_id: updated.column_id, position: updated.position }
          : o;
      });
    });
  }

  // Tracks recent successful cross-column moves so we can detect stale merges.
  // Map so multi-card group moves all stay protected during column refetches.
  const recentMovesRef = useRef<
    Map<
      string,
      { fromColumnId: string; toColumnId: string; at: number }
    >
  >(new Map());
  const recentDeletedRef = useRef<Map<string, number>>(new Map());
  const recentArchivedRef = useRef<Map<string, number>>(new Map());

  function pruneRecentMap(map: Map<string, number>, maxAgeMs = 60_000) {
    const cutoff = Date.now() - maxAgeMs;
    for (const [id, at] of map) {
      if (at < cutoff) map.delete(id);
    }
  }

  function rememberDeleted(orderId: string) {
    recentDeletedRef.current.set(orderId, Date.now());
    pruneRecentMap(recentDeletedRef.current);
  }

  function rememberArchived(orderId: string) {
    recentArchivedRef.current.set(orderId, Date.now());
    pruneRecentMap(recentArchivedRef.current);
  }

  function stripOrderFromBoard(orderId: string) {
    setOrders((prev) => {
      const next = prev.filter((o) => o.id !== orderId);
      boardOrdersRef.current = next;
      return next;
    });
    setSearchResults((prev) =>
      prev ? prev.filter((o) => o.id !== orderId) : prev
    );
  }

  function rememberMove(
    orderId: string,
    fromColumnId: string,
    toColumnId: string
  ) {
    recentMovesRef.current.set(orderId, {
      fromColumnId,
      toColumnId,
      at: Date.now(),
    });
    // Drop stale entries (keep map small).
    const cutoff = Date.now() - 60_000;
    for (const [id, move] of recentMovesRef.current) {
      if (move.at < cutoff) recentMovesRef.current.delete(id);
    }
  }

  /** After a move: refresh only the two columns involved — not the whole board. */
  function refreshMoveColumns(fromColumnId: string, toColumnId: string) {
    void fetchColumnOrders(fromColumnId, 0);
    if (toColumnId !== fromColumnId) {
      void fetchColumnOrders(toColumnId, 0);
    }
  }

  // When a page-0 fetch is requested while one is already in flight, queue a
  // follow-up so post-save / post-move refreshes are not dropped.
  const pendingColumnRefetchRef = useRef(new Set<string>());
  // Debounce post-save enrichment refreshes so Save doesn't immediately
  // re-hit /api/board/column-orders (and compete with the PATCH).
  const softColumnRefreshTimersRef = useRef<
    Map<string, ReturnType<typeof setTimeout>>
  >(new Map());
  const fetchColumnOrdersRef = useRef<
    (
      columnId: string,
      page: number,
      opts?: { reset?: boolean }
    ) => Promise<void>
  >(async () => {});
  const page0InFlightRef = useRef(new Set<string>());

  const scheduleSoftColumnRefresh = useCallback((columnId: string) => {
    const existing = softColumnRefreshTimersRef.current.get(columnId);
    if (existing) clearTimeout(existing);
    softColumnRefreshTimersRef.current.set(
      columnId,
      setTimeout(() => {
        softColumnRefreshTimersRef.current.delete(columnId);
        void fetchColumnOrdersRef.current(columnId, 0);
      }, 1200)
    );
  }, []);

  // ── Per-column fetch ─────────────────────────────────────────────────────────
  const fetchColumnOrders = useCallback(
    async (
      columnId: string,
      page: number,
      opts?: { reset?: boolean }
    ) => {
      const reset = opts?.reset === true;
      // Prevent duplicate in-flight page-0 fetches — queue instead of drop.
      if (page === 0 && page0InFlightRef.current.has(columnId)) {
        pendingColumnRefetchRef.current.add(columnId);
        return;
      }
      if (page === 0) page0InFlightRef.current.add(columnId);

      const wasLoaded = loadedColumnsRef.current.has(columnId);
      const silentRefresh = wasLoaded && page === 0 && !reset;
      if (!silentRefresh) {
        columnLoadStatusRef.current = {
          ...columnLoadStatusRef.current,
          [columnId]: "loading",
        };
        setColumnLoadStatus((s) => ({ ...s, [columnId]: "loading" }));
      }

      try {
        const sortMode = getColumnSortMode(
          columnSortByIdRef.current,
          columnId,
          {
            isStartColumn: isStartColumn(columnId, columnsRef.current),
          }
        );
        const url = `/api/board/column-orders?columnId=${encodeURIComponent(columnId)}&page=${page}&sort=${encodeURIComponent(sortMode)}${groupedViewRef.current ? "&groupSiblings=1" : ""}`;
        let res: Response;
        try {
          res = await fetchWithAuth(url);
        } catch (err) {
          // Browser "Failed to fetch" (offline, HMR restart, aborted nav).
          if (!isTransientNetworkError(err)) throw err;
          await new Promise((r) => setTimeout(r, 600));
          res = await fetchWithAuth(url);
        }
        // Retry once on transient upstream / server errors (e.g. Supabase
        // timeouts) or a Turbopack HTML 404 while the route is compiling.
        if (
          res.status === 500 ||
          res.status === 503 ||
          isStaleNext404(res)
        ) {
          await new Promise((r) => setTimeout(r, 600));
          res = await fetchWithAuth(url);
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = (await res.json()) as ColumnOrdersResponse;

        // Page 0 updates the first page in place. Extra cards from "Load more"
        // stay unless this is a sort reset — otherwise a background refresh
        // drops the rest of the column and snaps scroll back to the top.
        setOrders((prev) => {
          let next: OrderWithRelations[];
          if (page === 0) {
            const fetchedIds = new Set(data.orders.map((o) => o.id));
            const kept = prev.filter(
              (o) =>
                o.column_id !== columnId &&
                !fetchedIds.has(o.id) &&
                !recentDeletedRef.current.has(o.id)
            );
            const overflow = reset
              ? []
              : prev.filter(
                  (o) =>
                    o.column_id === columnId &&
                    !fetchedIds.has(o.id) &&
                    !recentDeletedRef.current.has(o.id)
                );
            const mergedFetched = data.orders.flatMap((o) => {
              if (recentDeletedRef.current.has(o.id)) return [];
              const archivedAt = recentArchivedRef.current.get(o.id);
              if (archivedAt && Date.now() - archivedAt < 60_000) {
                o = {
                  ...o,
                  specs: { ...(o.specs ?? {}), archived: true },
                };
              }
              const rm = recentMovesRef.current.get(o.id);
              if (
                rm &&
                Date.now() - rm.at < 60_000 &&
                o.column_id !== rm.toColumnId
              ) {
                return [{ ...o, column_id: rm.toColumnId }];
              }
              return [o];
            });
            next = [...kept, ...mergedFetched, ...overflow];
          } else {
            const existingIds = new Set(prev.map((o) => o.id));
            const newOnly = data.orders.filter((o) => !existingIds.has(o.id));
            next = [...prev, ...newOnly];
          }
          next = uniqueOrdersById(next);
          boardOrdersRef.current = next;
          return next;
        });

        // Merge enrichments — always additive, orphaned entries are harmless.
        setFieldValuesByOrder((prev) => ({
          ...prev,
          ...data.fieldValuesByOrder,
        }));
        setThumbnailByOrder((prev) => ({ ...prev, ...data.thumbnailByOrder }));
        setNotificationBadgeByOrder((prev) => ({
          ...prev,
          ...data.notificationBadgeByOrder,
        }));
        setOwnerNameByOrder((prev) => ({ ...prev, ...data.ownerNameByOrder }));
        setDesignerNameByOrder((prev) => ({
          ...prev,
          ...data.designerNameByOrder,
        }));
        setShippingSignByOrder((prev) => ({
          ...prev,
          ...(data.shippingSignByOrder ?? {}),
        }));
        setDieAlertByOrder((prev) => ({
          ...prev,
          ...(data.dieAlertByOrder ?? {}),
        }));
        setDieStatusByOrder((prev) => ({
          ...prev,
          ...(data.dieStatusByOrder ?? {}),
        }));
        setApprovalDateByOrder((prev) => ({
          ...prev,
          ...(data.approvalDateByOrder ?? {}),
        }));

        const localCount = boardOrdersRef.current.filter(
          (o) => o.column_id === columnId
        ).length;
        setColumnHasMore((s) => ({
          ...s,
          [columnId]: data.total > localCount,
        }));
        setColumnTotal((s) => ({ ...s, [columnId]: data.total }));
        if (reset || page > 0) {
          columnCurrentPageRef.current = {
            ...columnCurrentPageRef.current,
            [columnId]: page,
          };
        } else {
          const prevPage = columnCurrentPageRef.current[columnId] ?? 0;
          columnCurrentPageRef.current = {
            ...columnCurrentPageRef.current,
            [columnId]: Math.max(prevPage, 0),
          };
        }
        columnLoadStatusRef.current = {
          ...columnLoadStatusRef.current,
          [columnId]: "loaded",
        };
        setColumnLoadStatus((s) => ({ ...s, [columnId]: "loaded" }));
        loadedColumnsRef.current.add(columnId);
      } catch (err) {
        const transient = isTransientNetworkError(err);
        if (transient && wasLoaded) {
          // Soft-fail background refresh — leave column as loaded.
          console.warn("[Board] Column refresh skipped (network):", columnId);
          columnLoadStatusRef.current = {
            ...columnLoadStatusRef.current,
            [columnId]: "loaded",
          };
          setColumnLoadStatus((s) => ({ ...s, [columnId]: "loaded" }));
        } else {
          console.error("[Board] Failed to load column orders:", err);
          columnLoadStatusRef.current = {
            ...columnLoadStatusRef.current,
            [columnId]: "error",
          };
          setColumnLoadStatus((s) => ({ ...s, [columnId]: "error" }));
        }
      } finally {
        if (page === 0) page0InFlightRef.current.delete(columnId);
        if (
          pendingColumnRefetchRef.current.has(columnId) &&
          !page0InFlightRef.current.has(columnId)
        ) {
          pendingColumnRefetchRef.current.delete(columnId);
          void fetchColumnOrders(columnId, 0);
        }
      }
    },
    [] // all dependencies are refs or stable setters
  );
  fetchColumnOrdersRef.current = fetchColumnOrders;

  const groupedViewBootRef = useRef(true);
  useEffect(() => {
    if (groupedViewBootRef.current) {
      groupedViewBootRef.current = false;
      return;
    }
    for (const col of columnsRef.current) {
      if (loadedColumnsRef.current.has(col.id)) {
        void fetchColumnOrdersRef.current(col.id, 0);
      }
    }
  }, [groupedView]);

  // Called by Column's IntersectionObserver / Table when a column needs data.
  // Retry allowed after error; idle kicks off the first load.
  const onColumnVisible = useCallback(
    (columnId: string) => {
      const status = columnLoadStatusRef.current[columnId] ?? "idle";
      if (status === "loading" || status === "loaded") return;
      void fetchColumnOrders(columnId, 0);
    },
    [fetchColumnOrders]
  );

  // Table view has no IntersectionObserver — load every column when entering it.
  useEffect(() => {
    if (boardView !== "table") return;
    for (const col of columns) {
      const status = columnLoadStatusRef.current[col.id] ?? "idle";
      if (status === "idle" || status === "error") {
        void fetchColumnOrders(col.id, 0);
      }
    }
  }, [boardView, columns, fetchColumnOrders]);

  // Called by Column's "Load more" button.
  const onLoadMore = useCallback(
    (columnId: string) => {
      const nextPage = (columnCurrentPageRef.current[columnId] ?? -1) + 1;
      void fetchColumnOrders(columnId, nextPage);
    },
    [fetchColumnOrders]
  );

  const handleContextActionComplete = useCallback(
    (order: OrderWithRelations, result: ActionButtonResult) => {
      flashToast(result.message);
      if (result.refreshOrder) {
        void fetchColumnOrders(order.column_id, 0);
        router.refresh();
      }
    },
    [fetchColumnOrders, router]
  );

  // ── Refresh helpers ──────────────────────────────────────────────────────────
  const draggingRef = useRef(false);
  const dragSourceColumnRef = useRef<string | null>(null);
  const dragSnapshotRef = useRef<OrderWithRelations[] | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Debounced refresh: re-fetches server metadata (column configs, etc.)
   * and page 0 of every already-loaded column to pick up badge changes,
   * new orders created by webhooks, etc.
   */
  const scheduleRefresh = useCallback((reason = "unknown") => {
    if (draggingRef.current) return;
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      // Refresh server-rendered metadata (columns, custom fields, tags, etc.)
      router.refresh();
      // Refresh orders + enrichments for every visible column.
      for (const colId of loadedColumnsRef.current) {
        void fetchColumnOrders(colId, 0);
      }
    }, 800);
  }, [router, fetchColumnOrders]);

  // ── Realtime subscription ────────────────────────────────────────────────────
  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    function onOrderChange(payload: {
      eventType: string;
      new: Record<string, unknown>;
      old: Record<string, unknown>;
    }) {
      const eventType = payload.eventType;

      if (eventType === "DELETE") {
        const old = payload.old as { id?: string; tenant_id?: string };
        if (old.tenant_id && old.tenant_id !== tenantId) return;
        if (old.id) {
          rememberDeleted(old.id);
          setOrders((prev) => {
            const next = prev.filter((o) => o.id !== old.id);
            boardOrdersRef.current = next;
            return next;
          });
          setSearchResults((prev) =>
            prev ? prev.filter((o) => o.id !== old.id) : prev
          );
        }
        return;
      }

      const row = payload.new as {
        id?: string;
        tenant_id?: string;
        column_id?: string;
        position?: number;
        updated_at?: string;
      };
      if (!row.id || row.tenant_id !== tenantId) return;

      if (eventType === "INSERT") {
        // Re-fetch the affected column if it has been loaded already.
        const colId = row.column_id;
        if (colId && loadedColumnsRef.current.has(colId)) {
          if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
          refreshTimerRef.current = setTimeout(() => {
            void fetchColumnOrders(colId, 0);
            flashToast("New order received");
          }, 800);
        }
        return;
      }

      if (eventType === "UPDATE" && row.column_id) {
        setOrders((prev) => {
          const idx = prev.findIndex((o) => o.id === row.id);
          if (idx === -1) return prev;
          const next = [...prev];
          next[idx] = {
            ...next[idx],
            column_id: row.column_id as string,
            position:
              typeof row.position === "number"
                ? row.position
                : next[idx].position,
            updated_at:
              typeof row.updated_at === "string"
                ? row.updated_at
                : next[idx].updated_at,
          };
          boardOrdersRef.current = next;
          return next;
        });
        setSearchResults((prev) => {
          if (!prev) return prev;
          const idx = prev.findIndex((o) => o.id === row.id);
          if (idx === -1) return prev;
          const next = [...prev];
          next[idx] = {
            ...next[idx],
            column_id: row.column_id as string,
            position:
              typeof row.position === "number"
                ? row.position
                : next[idx].position,
            updated_at:
              typeof row.updated_at === "string"
                ? row.updated_at
                : next[idx].updated_at,
          };
          return next;
        });
        // Do not scheduleRefresh() here — a full board refetch after every
        // realtime UPDATE makes moves feel stuck/laggy. Local state + light
        // column refresh on intentional moves is enough.
      }
    }

    async function bindRealtime() {
      const { data: sessionData } = await supabase.auth.getSession();
      if (cancelled) return;

      const token = sessionData.session?.access_token;
      if (token) {
        await supabase.realtime.setAuth(token);
      }
      if (cancelled) return;

      channel = supabase
        .channel(`board-${tenantId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "orders",
            filter: `tenant_id=eq.${tenantId}`,
          },
          onOrderChange
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "job_notifications",
            filter: `tenant_id=eq.${tenantId}`,
          },
          () => scheduleRefresh("job_notifications")
        )
        .subscribe();
    }

    void bindRealtime();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.access_token) {
        await supabase.realtime.setAuth(session.access_token);
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      if (channel) supabase.removeChannel(channel);
    };
  }, [tenantId, scheduleRefresh, fetchColumnOrders]);

  // 20-second polling fallback for missed realtime events (column configs, etc.)
  useEffect(() => {
    const id = setInterval(() => {
      if (!draggingRef.current) scheduleRefresh("poll-20s");
    }, 20_000);
    return () => clearInterval(id);
  }, [scheduleRefresh]);

  // Idle auto-move rules: check ~every minute while the board is open.
  useEffect(() => {
    let cancelled = false;
    async function runIdle() {
      try {
        const res = await fetchRetryingStale404("/api/automations/run-idle-moves", {
          method: "POST",
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { moved?: number };
        if ((data.moved ?? 0) > 0 && !draggingRef.current) {
          scheduleRefresh("idle-auto-move");
        }
      } catch {
        // Non-fatal
      }
    }
    void runIdle();
    const id = setInterval(() => {
      if (!draggingRef.current) void runIdle();
    }, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [scheduleRefresh]);

  // ── DnD ────────────────────────────────────────────────────────────────────
  // Distance high enough that a horizontal pan across the board is not
  // stolen as a card drag (esp. trackpad / touch).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 12 } })
  );

  /** Returns the columns a card in `fromColumnId` can be moved to via right-click. */
  function getMoveableColumns(fromColumnId: string) {
    const fromCol = columnsById.get(fromColumnId);
    if (!fromCol || !canLeaveColumn(role, fromCol)) return [];
    return columns.filter((c) => c.id !== fromColumnId && canDropIn(role, c));
  }

  /** Handles a column move triggered from the right-click context menu. */
  /** True when an order carries Application (a combo, or an app-service item). */
  function orderNeedsApplication(order: OrderWithRelations): boolean {
    const fv = fieldValuesByOrder[order.id] ?? {};
    if (isApplicationEnabled(order.specs, customFields, fv)) return true;
    // Belt-and-suspenders: catch combos by product value until CRM auto-flags them.
    return Object.values(fv).some(
      (v) => typeof v === "string" && /combo/i.test(v)
    );
  }

  /** True when moving `order` to `toColumnId` would skip the Application stage. */
  function moveSkipsApplication(
    order: OrderWithRelations,
    toColumnId: string
  ): boolean {
    if (applicationStageIndex < 0) return false;
    const fromIdx = columnIndexById.get(order.column_id) ?? -1;
    const toIdx = columnIndexById.get(toColumnId) ?? -1;
    if (fromIdx < 0 || toIdx < 0) return false;
    // Only when jumping FROM a pre-application stage TO a post-application stage.
    if (!(fromIdx < applicationStageIndex && toIdx > applicationStageIndex))
      return false;
    return orderNeedsApplication(order);
  }

  /**
   * A combo order can't leave "In Progress" until the warehouse confirms stock
   * (reply 1 = in stock or 2 = ordered). Admins / account managers can override.
   * Returns a blocking reason for non-managers, or null if the move is allowed.
   */
  function comboStockMoveBlock(
    order: OrderWithRelations,
    toColumnId: string
  ): string | null {
    if (role === "admin" || role === "account_manager") return null;
    const fromCol = columnsById.get(order.column_id);
    const toCol = columnsById.get(toColumnId);
    if (!fromCol || !toCol) return null;
    if (toCol.id === fromCol.id) return null;
    if (fromCol.name.trim().toLowerCase() !== "in progress") return null;
    if (
      !isComboOrder(order, fieldValuesByOrder[order.id] ?? {}, customFields)
    ) {
      return null;
    }
    const stock = getComboStock(order);
    if (comboStockConfirmed(stock?.status)) return null;
    return stock?.status === "cant_get"
      ? "Warehouse can't get the stock for this combo. A manager must decide before it leaves In Progress."
      : "Combo stock isn't confirmed yet — waiting on the warehouse. A manager can override.";
  }

  function offerFinishedCompletionSms(
    moved: OrderWithRelations[],
    columnName: string
  ) {
    if (!isFinishedNoReviewStage(columnName)) return;
    const pending = moved.filter((o) => !finishedCompletionSmsSent(o.specs));
    if (pending.length === 0) return;
    setFinishedSmsPrompt({
      orders: pending.map((o) => ({ id: o.id, title: o.title })),
    });
  }

  async function handleContextMove(
    order: OrderWithRelations,
    toColumnId: string
  ) {
    if (order.specs?.locked === true) {
      flashPermissionError("This card is locked — unlock it to move.");
      return;
    }
    const stockBlock = comboStockMoveBlock(order, toColumnId);
    if (stockBlock) {
      flashPermissionError(stockBlock);
      return;
    }
    if (moveSkipsApplication(order, toColumnId)) {
      setComboAppWarning({
        orderTitle: order.title,
        toColumnName: columnsById.get(toColumnId)?.name ?? "that stage",
        proceed: () => {
          setComboAppWarning(null);
          void runContextMove(order, toColumnId);
        },
      });
      return;
    }
    await runContextMove(order, toColumnId);
  }

  async function runContextMove(
    order: OrderWithRelations,
    toColumnId: string
  ) {
    const fromColumnId = order.column_id;
    const fromCol = columnsById.get(fromColumnId);
    const toCol = columnsById.get(toColumnId);
    if (!fromCol || !toCol) return;

    if (!canMove(role, fromCol, toCol)) {
      if (!canLeaveColumn(role, fromCol)) {
        flashPermissionError(
          `You can't move orders out of "${fromCol.name}". Check the ↑ permission on that column.`
        );
      } else {
        flashPermissionError(
          `You can't drop orders into "${toCol.name}". Check the ↓ permission on that column.`
        );
      }
      return;
    }

    const destOrders = orders
      .filter((o) => o.column_id === toColumnId)
      .sort((a, b) => a.position - b.position);
    const lastPos = destOrders[destOrders.length - 1]?.position ?? 0;
    const newPosition = lastPos + 1000;

    const snapshot = boardOrdersRef.current;

    patchOrderPlacement(order.id, {
      column_id: toColumnId,
      position: newPosition,
      ...columnEnterPatch(order, toColumnId),
    });

    const result = await requestOrderMove(
      { orderId: order.id, toColumnId, position: newPosition },
      { fromColumnId, columns }
    );


    if (!result.ok) {
      if (result.missingFields?.length) {
        restoreOrdersSnapshot(snapshot);
        setMoveBlockedState({
          orderId: order.id,
          missingFields: result.missingFields,
        });
        return;
      }
      flashPermissionError(result.error ?? "Move was rejected.");
      restoreOrdersSnapshot(snapshot);
      scheduleRefresh();
      return;
    }

    rememberMove(order.id, fromColumnId, toColumnId);
    refreshMoveColumns(fromColumnId, toColumnId);

    const notifyColumn = notifyColumns.find((c) => c.column_id === toColumnId);
    if (notifyColumn && notifyColumn.automation_enabled) {
      setNotifyPopup({
        order: { ...order, column_id: toColumnId },
        notifyColumn,
        columnName: toCol.name,
      });
    }
    if (isHoldColumn(toCol)) {
      setHoldReasonPopup({
        orderId: order.id,
        orderTitle: order.title,
        columnName: toCol.name,
      });
    }
    offerFinishedCompletionSms([order], toCol.name);
  }

  function patchOrderFields(
    orderId: string,
    patch: Partial<OrderWithRelations>
  ) {
    setOrders((prev) => {
      const next = prev.map((o) => (o.id === orderId ? { ...o, ...patch } : o));
      boardOrdersRef.current = next;
      return next;
    });
    setSearchResults((prev) => {
      if (!prev) return prev;
      return prev.map((o) => (o.id === orderId ? { ...o, ...patch } : o));
    });
  }

  async function patchOrderApi(
    orderId: string,
    body: Record<string, unknown>
  ) {
    const res = await fetchWithAuth(`/api/orders/${orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(json.error ?? "Failed to update order");
    }
  }

  async function handleGroupAssignDesigner(
    groupOrders: OrderWithRelations[],
    designer: { id: string | null; name: string | null }
  ) {
    if (groupOrders.length === 0) return;
    const snapshot = boardOrdersRef.current;
    const designerName = designer.name ?? "";

    for (const order of groupOrders) {
      const specs = {
        ...(order.specs ?? {}),
        designer_id: designer.id,
        designer_name: designer.name,
      };
      patchOrderFields(order.id, { specs });
      setDesignerNameByOrder((prev) => ({
        ...prev,
        [order.id]: designerName,
      }));
    }

    // Filtered board reads searchEnrichments.designerNameByOrder, which
    // otherwise keeps the stale name until the filter is cleared.
    setSearchEnrichments((prev) => {
      if (!prev) return prev;
      const designerNameByOrder = { ...prev.designerNameByOrder };
      for (const order of groupOrders) {
        designerNameByOrder[order.id] = designerName;
      }
      return { ...prev, designerNameByOrder };
    });

    try {
      await Promise.all(
        groupOrders.map((order) =>
          patchOrderApi(order.id, {
            specs: {
              ...(order.specs ?? {}),
              designer_id: designer.id,
              designer_name: designer.name,
            },
          })
        )
      );
      flashToast(
        designer.name
          ? `Assigned ${designer.name} to ${groupOrders.length} items`
          : `Cleared designer on ${groupOrders.length} items`
      );
    } catch (err) {
      restoreOrdersSnapshot(snapshot);
      flashPermissionError(
        err instanceof Error ? err.message : "Failed to assign designer"
      );
    }
  }

  function handleCardThumbnailsChange(
    orderId: string,
    thumbnails: BoardThumbnail[]
  ) {
    setThumbnailByOrder((prev) => ({ ...prev, [orderId]: thumbnails }));
    setSearchEnrichments((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        thumbnailByOrder: { ...prev.thumbnailByOrder, [orderId]: thumbnails },
      };
    });
  }

  useEffect(() => {
    function onCardImageChanged(event: Event) {
      const detail = (event as CustomEvent<{
        orderId?: string;
        source?: CardImageSource;
        id?: string;
        url?: string | null;
      }>).detail;
      if (!detail?.orderId || !detail.id || !detail.source) return;
      const orderId = detail.orderId;
      const imageId = detail.id;
      const source = detail.source;
      const preferred = { source, id: imageId };
      const url = detail.url;
      setThumbnailByOrder((prev) => {
        const list = prev[orderId] ?? [];
        let next = preferCardImage(list, preferred);
        if (next[0]?.id !== imageId && typeof url === "string" && url) {
          next = [
            { url, id: imageId, source },
            ...list.filter((t) => t.id !== imageId),
          ];
        }
        return { ...prev, [orderId]: next };
      });
      setSearchEnrichments((prev) => {
        if (!prev) return prev;
        const list = prev.thumbnailByOrder[orderId] ?? [];
        let next = preferCardImage(list, preferred);
        if (next[0]?.id !== imageId && typeof url === "string" && url) {
          next = [
            { url, id: imageId, source },
            ...list.filter((t) => t.id !== imageId),
          ];
        }
        return {
          ...prev,
          thumbnailByOrder: {
            ...prev.thumbnailByOrder,
            [orderId]: next,
          },
        };
      });
    }
    window.addEventListener(CARD_IMAGE_CHANGED_EVENT, onCardImageChanged);
    return () => {
      window.removeEventListener(CARD_IMAGE_CHANGED_EVENT, onCardImageChanged);
    };
  }, []);

  // Designer queue re-ranked on a card → update every affected card's stored
  // position so the #N badges renumber without a refetch.
  useEffect(() => {
    function onQueueChanged(event: Event) {
      const detail = (event as CustomEvent<QueueChangedDetail>).detail;
      const posById = detail?.posById;
      if (!posById || Object.keys(posById).length === 0) return;
      setOrders((prev) =>
        prev.map((o) =>
          o.id in posById
            ? {
                ...o,
                queue_rank: posById[o.id] + 1,
                specs: {
                  ...(o.specs ?? {}),
                  designer_queue_pos: posById[o.id],
                },
              }
            : o
        )
      );
    }
    window.addEventListener(QUEUE_CHANGED_EVENT, onQueueChanged);
    return () => window.removeEventListener(QUEUE_CHANGED_EVENT, onQueueChanged);
  }, []);

  async function handleSetTag(
    order: OrderWithRelations,
    tag: OrderTagSummary | null
  ) {
    const snapshot = boardOrdersRef.current;
    patchOrderFields(order.id, {
      tag_id: tag?.id ?? null,
      tag: tag,
    });
    try {
      await patchOrderApi(order.id, { tagId: tag?.id ?? null });
      flashToast(tag ? `Tagged as ${tag.name}` : "Tag cleared");
    } catch (err) {
      restoreOrdersSnapshot(snapshot);
      flashPermissionError(
        err instanceof Error ? err.message : "Failed to update tag"
      );
    }
  }

  async function handleSetPriorityScore(
    order: OrderWithRelations,
    score: PriorityScore | null
  ) {
    const snapshot = boardOrdersRef.current;
    const specs = manualPrioritySpecsPatch(
      (order.specs ?? {}) as Record<string, unknown>,
      score
    );
    patchOrderFields(order.id, { specs });
    try {
      await patchOrderApi(order.id, { specs });
      flashToast(
        score != null ? `Priority set to ${score}` : "Priority cleared"
      );
    } catch (err) {
      restoreOrdersSnapshot(snapshot);
      flashPermissionError(
        err instanceof Error ? err.message : "Failed to update priority"
      );
    }
  }

  async function handleSetReprint(order: OrderWithRelations, on: boolean) {
    const snapshot = boardOrdersRef.current;
    const specs = {
      ...((order.specs ?? {}) as Record<string, unknown>),
      reprint: on,
    };
    patchOrderFields(order.id, { specs });
    try {
      await patchOrderApi(order.id, { specs });
      flashToast(on ? "Marked as reprint" : "Reprint mark removed");
    } catch (err) {
      restoreOrdersSnapshot(snapshot);
      flashPermissionError(
        err instanceof Error ? err.message : "Failed to update reprint"
      );
    }
  }

  async function handleSetLocked(order: OrderWithRelations, on: boolean) {
    const snapshot = boardOrdersRef.current;
    const specs = {
      ...((order.specs ?? {}) as Record<string, unknown>),
      locked: on,
    };
    patchOrderFields(order.id, { specs });
    try {
      await patchOrderApi(order.id, { specs });
      flashToast(on ? "Card locked" : "Card unlocked");
    } catch (err) {
      restoreOrdersSnapshot(snapshot);
      flashPermissionError(
        err instanceof Error ? err.message : "Failed to update lock"
      );
    }
  }

  async function handleGroupSetDueDates(updates: GroupDueDateUpdate[]) {
    if (updates.length === 0) return;
    const snapshot = boardOrdersRef.current;

    for (const { orderId, dueDate } of updates) {
      patchOrderFields(orderId, { due_date: dueDate });
    }

    try {
      await Promise.all(
        updates.map(({ orderId, dueDate }) =>
          patchOrderApi(orderId, { dueDate })
        )
      );
      flashToast(`Updated due dates for ${updates.length} items`);
    } catch (err) {
      restoreOrdersSnapshot(snapshot);
      throw err;
    }
  }

  async function handleSetDueDate(
    order: OrderWithRelations,
    update: {
      mode: DueDateMode;
      dueDate?: string | null;
      processingDays?: number | null;
    }
  ) {
    const snapshot = boardOrdersRef.current;
    const built = buildStaffDueSpecs({
      mode: update.mode,
      dueDate: update.dueDate,
      processingDays: update.processingDays,
      previousSpecs: order.specs,
    });
    const nextSpecs = mergeDueSpecsIntoOrderSpecs(order.specs, built.specs);
    patchOrderFields(order.id, {
      due_date: built.dueDate,
      specs: nextSpecs,
    });

    try {
      await patchOrderApi(order.id, {
        dueDate: built.dueDate,
        dueDateMode: update.mode,
        dueProcessingDays:
          update.mode === "after_approval"
            ? (update.processingDays ?? DEFAULT_PROCESSING_DAYS)
            : null,
      });
      flashToast(
        update.mode === "after_approval"
          ? "Due set to after approval"
          : built.dueDate
            ? `Due date set to ${built.dueDate}`
            : "Due date updated"
      );
    } catch (err) {
      restoreOrdersSnapshot(snapshot);
      flashPermissionError(
        err instanceof Error ? err.message : "Failed to update due date"
      );
    }
  }

  async function handleGroupMove(
    groupOrders: OrderWithRelations[],
    toColumnId: string
  ) {
    if (groupOrders.length === 0) return;
    const fromColumnId = groupOrders[0].column_id;
    const fromCol = columnsById.get(fromColumnId);
    const toCol = columnsById.get(toColumnId);
    if (!fromCol || !toCol) return;

    if (!canMove(role, fromCol, toCol)) {
      if (!canLeaveColumn(role, fromCol)) {
        flashPermissionError(
          `You can't move orders out of "${fromCol.name}". Check the ↑ permission on that column.`
        );
      } else {
        flashPermissionError(
          `You can't drop orders into "${toCol.name}". Check the ↓ permission on that column.`
        );
      }
      return;
    }

    const destOrders = orders
      .filter((o) => o.column_id === toColumnId)
      .sort((a, b) => a.position - b.position);
    let lastPos = destOrders[destOrders.length - 1]?.position ?? 0;

    const snapshot = boardOrdersRef.current;
    const moves: { order: OrderWithRelations; position: number }[] = [];
    for (const order of groupOrders) {
      lastPos += 1000;
      moves.push({ order, position: lastPos });
      patchOrderPlacement(order.id, {
        column_id: toColumnId,
        position: lastPos,
        ...columnEnterPatch(order, toColumnId),
      });
    }

    const results: Awaited<ReturnType<typeof requestOrderMove>>[] = [];
    for (const { order, position } of moves) {
      results.push(
        await requestOrderMove(
          { orderId: order.id, toColumnId, position },
          { fromColumnId, columns }
        )
      );
    }

    const failedIdx = results.findIndex((r) => !r.ok);
    if (failedIdx !== -1) {
      const failed = results[failedIdx]!;
      if (!failed.ok) {
        restoreOrdersSnapshot(snapshot);
        if (failed.missingFields?.length) {
          setMoveBlockedState({
            orderId: moves[failedIdx]?.order.id ?? moves[0].order.id,
            missingFields: failed.missingFields,
          });
        } else {
          flashPermissionError(failed.error ?? "Move was rejected.");
        }
        return;
      }
    }

    for (const order of groupOrders) {
      rememberMove(order.id, fromColumnId, toColumnId);
    }
    refreshMoveColumns(fromColumnId, toColumnId);

    const notifyColumn = notifyColumns.find((c) => c.column_id === toColumnId);
    if (notifyColumn && notifyColumn.automation_enabled) {
      setNotifyPopup({
        order: { ...groupOrders[0], column_id: toColumnId },
        notifyColumn,
        columnName: toCol.name,
        groupOrders: groupOrders.map((o) => ({ ...o, column_id: toColumnId })),
      });
    }
    offerFinishedCompletionSms(groupOrders, toCol.name);

    flashToast(`Moved ${groupOrders.length} items to ${toCol.name}`);
  }

  function findColumnId(id: string): string | null {
    if (columns.some((c) => c.id === id)) return id;
    const groupDrag = parseGroupDragId(id);
    if (groupDrag) return groupDrag.columnId;
    const fromSearch = searchResults?.find((o) => o.id === id)?.column_id;
    if (fromSearch) return fromSearch;
    return orders.find((o) => o.id === id)?.column_id ?? null;
  }

  function groupOrdersFromSnapshot(
    snapshot: OrderWithRelations[],
    columnId: string,
    key: string
  ): OrderWithRelations[] {
    return snapshot.filter(
      (o) => o.column_id === columnId && getGroupKey(o) === key
    );
  }

  function onDragStart(event: DragStartEvent) {
    draggingRef.current = true;
    const id = String(event.active.id);
    const groupDrag = parseGroupDragId(id);
    const sourceColumn = groupDrag?.columnId ?? findColumnId(id);
    dragSourceColumnRef.current = sourceColumn;
    dragSnapshotRef.current = boardOrdersRef.current;
    setActiveId(id);
    if (groupDrag && sourceColumn) {
      const members = groupOrdersFromSnapshot(
        boardOrdersRef.current,
        sourceColumn,
        groupDrag.key
      );
      setActiveGroup(
        members.length >= 2
          ? { kind: "group", key: groupDrag.key, orders: members }
          : null
      );
    } else {
      setActiveGroup(null);
    }
  }

  function onDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;
    const activeColumn = findColumnId(String(active.id));
    const overColumn = findColumnId(String(over.id));
    if (!activeColumn || !overColumn || activeColumn === overColumn) return;

    const source = columnsById.get(activeColumn);
    const target = columnsById.get(overColumn);
    if (!source || !target) return;
    if (!canMove(role, source, target)) return;

    const groupDrag = parseGroupDragId(String(active.id));
    // Groups keep their source placement until drop. Moving them mid-drag would
    // remount the card under a new sortable id (`group:${columnId}:${key}`).
    if (groupDrag) return;

    // Visual-only during drag: update React state for both orders + searchResults,
    // and keep boardOrdersRef in sync so drop placement uses the live column.
    setOrders((prev) => {
      const next = prev.map((o) =>
        o.id === active.id ? { ...o, column_id: overColumn } : o
      );
      boardOrdersRef.current = next;
      return next;
    });
    setSearchResults((prev) => {
      if (!prev) return prev;
      return prev.map((o) =>
        o.id === active.id ? { ...o, column_id: overColumn } : o
      );
    });
  }

  function abortDrag() {
    draggingRef.current = false;
    dragSourceColumnRef.current = null;
    if (dragSnapshotRef.current) {
      restoreOrdersSnapshot(dragSnapshotRef.current);
    }
    dragSnapshotRef.current = null;
    setActiveGroup(null);
  }

  async function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    const sourceColumn = dragSourceColumnRef.current;
    const groupDrag = parseGroupDragId(String(active.id));
    if (!over) {
      abortDrag();
      return;
    }

    const overColumn = findColumnId(String(over.id));
    const activeColumn = sourceColumn ?? findColumnId(String(active.id));
    if (!activeColumn || !overColumn) {
      abortDrag();
      return;
    }

    const from = columnsById.get(activeColumn);
    const to = columnsById.get(overColumn);
    const crossing = activeColumn !== overColumn;
    if (crossing) {
      if (from && to && !canMove(role, from, to)) {
        if (!canLeaveColumn(role, from)) {
          flashPermissionError(
            `You can't move orders out of "${from.name}". Check the ↑ permission on that column.`
          );
        } else {
          flashPermissionError(
            `You can't drop orders into "${to.name}". Check the ↓ permission on that column.`
          );
        }
        abortDrag();
        return;
      }
      const draggedOrder = boardOrdersRef.current.find(
        (o) => o.id === String(active.id)
      );
      if (draggedOrder) {
        const stockBlock = comboStockMoveBlock(draggedOrder, overColumn);
        if (stockBlock) {
          flashPermissionError(stockBlock);
          abortDrag();
          return;
        }
      }
    } else if (to && !canDropIn(role, to)) {
      flashPermissionError(
        `You can't reorder orders in "${to.name}". Check the ↓ permission on that column.`
      );
      abortDrag();
      return;
    }

    // Group card: move every item in the group to the target column.
    if (groupDrag) {
      const snap = dragSnapshotRef.current ?? boardOrdersRef.current;
      const groupOrders = groupOrdersFromSnapshot(
        snap,
        groupDrag.columnId,
        groupDrag.key
      );
      draggingRef.current = false;
      dragSourceColumnRef.current = null;
      dragSnapshotRef.current = null;
      setActiveGroup(null);
      if (!crossing || groupOrders.length === 0) {
        return;
      }
      await handleGroupMove(groupOrders, overColumn);
      return;
    }

    const placementSource =
      personFilter ||
      ownerFilter ||
      webhookSourceFilter ||
      orderQuery.trim() ||
      overdueOnly ||
      dueTodayOnly
        ? (searchResults ?? orders)
        : orders;
    const sortMode = getColumnSortMode(columnSortById, overColumn, {
      isStartColumn: isStartColumn(overColumn, columns),
    });
    const columnOrders = sortOrdersForColumn(
      placementSource.filter((o) => o.column_id === overColumn),
      sortMode
    );
    const oldIndex = columnOrders.findIndex((o) => o.id === active.id);
    let newIndex = columnOrders.findIndex((o) => o.id === over.id);
    if (newIndex === -1) {
      const overGroup = parseGroupDragId(String(over.id));
      if (overGroup) {
        // Dropped on a group card — place after the group's last member.
        const groupMemberIds = new Set(
          columnOrders
            .filter((o) => getGroupKey(o) === overGroup.key)
            .map((o) => o.id)
        );
        let lastIdx = -1;
        columnOrders.forEach((o, i) => {
          if (groupMemberIds.has(o.id)) lastIdx = i;
        });
        newIndex = lastIdx === -1 ? columnOrders.length - 1 : lastIdx;
      } else {
        newIndex = columnOrders.length - 1;
      }
    }

    const reordered =
      oldIndex === -1
        ? columnOrders
        : arrayMove(columnOrders, oldIndex, Math.max(0, newIndex));

    const movedIndex = reordered.findIndex((o) => o.id === active.id);
    const prev = reordered[movedIndex - 1]?.position ?? 0;
    const next = reordered[movedIndex + 1]?.position;
    const newPosition =
      next === undefined ? prev + 1000 : (prev + next) / 2;

    // Same-column drag: keep the card where it was dropped (manual order).
    if (!crossing) {
      setColumnSortMode(overColumn, "manual");
    }

    const activeOrderForPatch =
      boardOrdersRef.current.find((o) => o.id === active.id) ??
      orders.find((o) => o.id === active.id);

    // Combo/application guard: warn before letting a combo skip the Application
    // stage. Snap the card back, then re-run the move only if Rafael confirms.
    if (
      crossing &&
      activeOrderForPatch &&
      moveSkipsApplication(activeOrderForPatch, overColumn)
    ) {
      abortDrag();
      setComboAppWarning({
        orderTitle: activeOrderForPatch.title,
        toColumnName: columnsById.get(overColumn)?.name ?? "that stage",
        proceed: () => {
          setComboAppWarning(null);
          void runContextMove(activeOrderForPatch, overColumn);
        },
      });
      return;
    }

    patchOrderPlacement(String(active.id), {
      column_id: overColumn,
      position: newPosition,
      ...(crossing && activeOrderForPatch
        ? columnEnterPatch(activeOrderForPatch, overColumn)
        : {}),
    });

    try {
      const result = await requestOrderMove(
        {
          orderId: String(active.id),
          toColumnId: overColumn,
          position: newPosition,
        },
        { fromColumnId: sourceColumn, columns }
      );
      if (!result.ok) {
        if (result.missingFields?.length) {
          if (dragSnapshotRef.current) {
            restoreOrdersSnapshot(dragSnapshotRef.current);
          }
          setMoveBlockedState({
            orderId: String(active.id),
            missingFields: result.missingFields,
          });
          return;
        }
        flashPermissionError(result.error ?? "Move was rejected.");
        if (dragSnapshotRef.current) {
          restoreOrdersSnapshot(dragSnapshotRef.current);
        }
        scheduleRefresh();
      } else if (crossing) {
        rememberMove(String(active.id), activeColumn, overColumn);
        refreshMoveColumns(activeColumn, overColumn);
        const notifyColumn = notifyColumns.find(
          (c) => c.column_id === overColumn
        );
        const movedOrder =
          boardOrdersRef.current.find((o) => o.id === active.id) ??
          orders.find((o) => o.id === active.id);
        if (notifyColumn && movedOrder && notifyColumn.automation_enabled) {
          setNotifyPopup({
            order: { ...movedOrder, column_id: overColumn },
            notifyColumn,
            columnName: columnsById.get(overColumn)?.name ?? "",
          });
        }
        const overCol = columnsById.get(overColumn);
        if (movedOrder && isHoldColumn(overCol)) {
          setHoldReasonPopup({
            orderId: movedOrder.id,
            orderTitle: movedOrder.title,
            columnName: overCol?.name ?? "Hold",
          });
        }
        if (activeOrderForPatch) {
          offerFinishedCompletionSms(
            [activeOrderForPatch],
            columnsById.get(overColumn)?.name ?? ""
          );
        }
      }
    } finally {
      draggingRef.current = false;
      dragSourceColumnRef.current = null;
      dragSnapshotRef.current = null;
      setActiveGroup(null);
    }
  }

  // ── Filters ──────────────────────────────────────────────────────────────────
  const ownerFilterOptions = owners;
  const sourceStyleConfig = webhookSourceStyles ?? DEFAULT_WEBHOOK_SOURCE_STYLES;
  const filtersActive =
    orderQuery.trim() !== "" ||
    personFilter !== "" ||
    ownerFilter !== "" ||
    webhookSourceFilter !== "" ||
    overdueOnly ||
    dueTodayOnly;

  // Prefer full-DB search results. While search is in flight (or if it fails
  // open), fall back to filtering already-loaded cards so matches in visible
  // columns still appear. Search covers unloaded / "Load more" pages.
  const localFilteredOrders = useMemo(() => {
    if (!filtersActive) return orders;
    return orders.filter((order) =>
      orderMatchesBoardFilters(
        order,
        fieldValuesByOrder[order.id] ?? {},
        customFields,
        boardFilters
      )
    );
  }, [
    filtersActive,
    orders,
    boardFilters,
    fieldValuesByOrder,
    customFields,
  ]);

  const displayOrders = useMemo(() => {
    const rawBase = filtersActive
      ? (searchResults ?? localFilteredOrders)
      : orders;
    // Archived orders are hidden from the active board (and from every overlay
    // that derives from displayOrders: Emergency, Late/Due counts, List, Table)
    // unless the Archived filter is on, which then shows only them.
    const base = uniqueOrdersById(
      rawBase.filter((order) =>
        archivedOnly ? isOrderArchived(order) : !isOrderArchived(order)
      )
    );
    if (!isDesignerRole) return base;
    return base.filter(
      (order) =>
        String(order.specs?.designer_id ?? "") === currentUserId
    );
  }, [
    filtersActive,
    searchResults,
    localFilteredOrders,
    orders,
    archivedOnly,
    isDesignerRole,
    currentUserId,
  ]);

  const archivedCount = useMemo(
    () => orders.reduce((n, o) => n + (isOrderArchived(o) ? 1 : 0), 0),
    [orders]
  );

  /** e.g. typing "XXX" → suggest "XXX-(3)" with part titles to continue filtering. */
  const orderGroupSuggestions = useMemo(
    () =>
      orderGroupSearchSuggestions(
        orderQuery,
        searchResults ?? localFilteredOrders
      ),
    [orderQuery, searchResults, localFilteredOrders]
  );
  const [groupSuggestionsOpen, setGroupSuggestionsOpen] = useState(false);
  const searchBoxRef = useRef<HTMLDivElement | null>(null);

  // Close the multi-part order dropdown on outside click.
  useEffect(() => {
    if (!groupSuggestionsOpen || orderGroupSuggestions.length === 0) return;
    function onPointerDown(e: MouseEvent | globalThis.PointerEvent) {
      const el = searchBoxRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) {
        setGroupSuggestionsOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [groupSuggestionsOpen, orderGroupSuggestions.length]);

  const showGroupSuggestions =
    groupSuggestionsOpen && orderGroupSuggestions.length > 0;

  const displayFieldValuesByOrder = filtersActive && searchEnrichments
    ? searchEnrichments.fieldValuesByOrder
    : fieldValuesByOrder;
  const displayThumbnailByOrder = filtersActive && searchEnrichments
    ? searchEnrichments.thumbnailByOrder
    : thumbnailByOrder;
  const displayNotificationBadgeByOrder = filtersActive && searchEnrichments
    ? searchEnrichments.notificationBadgeByOrder
    : notificationBadgeByOrder;
  const displayOwnerNameByOrder = filtersActive && searchEnrichments
    ? searchEnrichments.ownerNameByOrder
    : ownerNameByOrder;
  const displayDesignerNameByOrder = filtersActive && searchEnrichments
    ? searchEnrichments.designerNameByOrder
    : designerNameByOrder;
  const displayShippingSignByOrder = filtersActive && searchEnrichments
    ? searchEnrichments.shippingSignByOrder
    : shippingSignByOrder;
  const displayDieAlertByOrder = filtersActive && searchEnrichments
    ? searchEnrichments.dieAlertByOrder
    : dieAlertByOrder;
  const displayDieStatusByOrder = filtersActive && searchEnrichments
    ? searchEnrichments.dieStatusByOrder
    : dieStatusByOrder;
  const displayApprovalDateByOrder = filtersActive && searchEnrichments
    ? searchEnrichments.approvalDateByOrder
    : approvalDateByOrder;

  // ── Emergency / Urgency view (read-only overlay) ──────────────────────────
  const emergencyActive = emergencyOnly || emergencyQuickFilter !== null;

  const columnIndexById = useMemo(() => {
    const m = new Map<string, number>();
    columns.forEach((c, i) => m.set(c.id, i));
    return m;
  }, [columns]);

  const applicationStageIndex = useMemo(
    () =>
      columns.findIndex(
        (c) => stageKey(c.name) === stageKey("In the application")
      ),
    [columns]
  );

  // Per-order emergency evaluation — a PURE READ of fields already on each order.
  // Only computed while the view/filter is active, so it costs nothing when off.
  // Same column scope as Board health (through Ready to Ship).
  const emergencyByOrder = useMemo(() => {
    const map: Record<string, EmergencyResult> = {};
    if (!emergencyActive) return map;
    const now = Date.now();
    for (const order of displayOrders) {
      if (!activePipelineColumnIds.has(order.column_id)) continue;
      const col = columns.find((c) => c.id === order.column_id);
      if (!col) continue;
      map[order.id] = evaluateEmergency(
        {
          columnId: col.id,
          columnName: col.name,
          hoursHere: hoursInCurrentColumn(order.last_moved_at, now),
          workingDaysHere: daysInCurrentColumn(
            order.last_moved_at,
            now,
            warningWorkingDays
          ),
          daysToDue: order.due_date
            ? calendarDaysUntilDue(order.due_date, businessToday)
            : null,
          isRush: isRushOrder(order),
          hasApplication: isApplicationEnabled(
            order.specs,
            customFields,
            fieldValuesByOrder[order.id] ?? {}
          ),
          priorityScore: priorityScoreFromSpecs(order.specs),
          isKeyAccount: false, // CRM key-account flag — companion piece, wired later
        },
        emergencyBalance
      );
    }
    return map;
  }, [
    emergencyActive,
    displayOrders,
    columns,
    customFields,
    fieldValuesByOrder,
    warningWorkingDays,
    emergencyBalance,
    businessToday,
    activePipelineColumnIds,
  ]);

  // Counts for each quick-filter chip (due chips use per-filter column ranges).
  const emergencyQuickFilterCounts = useMemo(() => {
    const counts: Record<EmergencyQuickFilter, number> = {
      one_day_left: 0,
      due_today: 0,
      late: 0,
      combo_at_risk: 0,
    };
    const keys = Object.keys(counts) as EmergencyQuickFilter[];
    for (const order of displayOrders) {
      const colIdx = columnIndexById.get(order.column_id) ?? -1;
      const beforeApplicationStage =
        applicationStageIndex < 0 ? true : colIdx < applicationStageIndex;
      const input = {
        daysToDue: order.due_date
          ? calendarDaysUntilDue(order.due_date, businessToday)
          : null,
        hasApplication: isApplicationEnabled(
          order.specs,
          customFields,
          fieldValuesByOrder[order.id] ?? {}
        ),
        beforeApplicationStage,
      };
      for (const key of keys) {
        const scope =
          key === "combo_at_risk"
            ? activePipelineColumnIds
            : dueQuickFilterColumnIds[key];
        if (!scope.has(order.column_id)) continue;
        if (matchesQuickFilter(key, input, emergencyBalance)) counts[key] += 1;
      }
    }
    return counts;
  }, [
    displayOrders,
    columnIndexById,
    applicationStageIndex,
    customFields,
    fieldValuesByOrder,
    emergencyBalance,
    activePipelineColumnIds,
    dueQuickFilterColumnIds,
    businessToday,
  ]);

  // Orders that survive the Emergency toggle and/or the active quick-filter.
  const emergencyPassIds = useMemo(() => {
    const set = new Set<string>();
    if (!emergencyActive) return set;
    const filterScope =
      emergencyQuickFilter == null
        ? activePipelineColumnIds
        : emergencyQuickFilter === "combo_at_risk"
          ? activePipelineColumnIds
          : dueQuickFilterColumnIds[emergencyQuickFilter];
    for (const order of displayOrders) {
      if (!filterScope.has(order.column_id)) continue;
      if (emergencyOnly && !emergencyByOrder[order.id]?.severity) continue;
      if (emergencyQuickFilter) {
        const colIdx = columnIndexById.get(order.column_id) ?? -1;
        const beforeApplicationStage =
          applicationStageIndex < 0 ? true : colIdx < applicationStageIndex;
        const match = matchesQuickFilter(
          emergencyQuickFilter,
          {
            daysToDue: order.due_date
              ? calendarDaysUntilDue(order.due_date, businessToday)
              : null,
            hasApplication: isApplicationEnabled(
              order.specs,
              customFields,
              fieldValuesByOrder[order.id] ?? {}
            ),
            beforeApplicationStage,
          },
          emergencyBalance
        );
        if (!match) continue;
      }
      set.add(order.id);
    }
    return set;
  }, [
    emergencyActive,
    emergencyOnly,
    emergencyQuickFilter,
    displayOrders,
    emergencyByOrder,
    columnIndexById,
    applicationStageIndex,
    customFields,
    fieldValuesByOrder,
    emergencyBalance,
    activePipelineColumnIds,
    dueQuickFilterColumnIds,
    businessToday,
  ]);

  const emergencyFilteredOrders = useMemo(
    () =>
      emergencyActive
        ? displayOrders.filter((o) => emergencyPassIds.has(o.id))
        : displayOrders,
    [emergencyActive, displayOrders, emergencyPassIds]
  );

  const ordersByColumn = useMemo(() => {
    const map = new Map<string, OrderWithRelations[]>();
    for (const col of columns) map.set(col.id, []);
    // Bucket first, then sort per column — avoids a full-list sort on every render.
    for (const order of displayOrders) {
      if (emergencyActive && !emergencyPassIds.has(order.id)) continue;
      const list = map.get(order.column_id);
      if (list) list.push(order);
      else map.set(order.column_id, [order]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.position - b.position);
    }
    return map;
  }, [displayOrders, columns, emergencyActive, emergencyPassIds]);

  const activeOrder =
    displayOrders.find((o) => o.id === activeId) ??
    orders.find((o) => o.id === activeId) ??
    null;
  const activeOrderColumnColor = activeOrder
    ? (columns.find((c) => c.id === activeOrder.column_id)?.color ?? null)
    : null;

  const selectedPersonLabel =
    designers.find((d) => d.id === personFilter)?.name ?? "All designers";
  const selectedOwnerLabel =
    ownerFilter === UNASSIGNED_OWNER_FILTER
      ? "Unassigned"
      : ownerFilterOptions.find((o) => o.id === ownerFilter)?.name ??
        "All owners";
  const selectedWebhookSourceLabel =
    webhookSourceFilter === MANUAL_WEBHOOK_SOURCE_FILTER
      ? "Manual"
      : webhookSourceFilter === OTHER_WEBHOOK_SOURCE_FILTER
        ? sourceStyleConfig.other.label
        : sourceStyleConfig.sources.find(
            (s) => s.key === webhookSourceFilter
          )?.label ?? "All sources";
  const dueFilterValue = dueTodayOnly
    ? "today"
    : overdueOnly
      ? "overdue"
      : "";
  const canAnimateWarnings = warningRules.length > 0;

  function adaptiveSelectWidth(label: string, minCh = 8, maxCh = 12) {
    return `${Math.min(maxCh, Math.max(minCh, label.length + 2))}ch`;
  }

  const toolbarShellRef = useRef<HTMLDivElement>(null);
  const toolbarInnerRef = useRef<HTMLDivElement>(null);
  const [toolbarScale, setToolbarScale] = useState(1);

  const visibleEmergencyChips = (
    [
      "one_day_left",
      "due_today",
      "late",
      "combo_at_risk",
    ] as EmergencyQuickFilter[]
  ).filter((key) =>
    key === "combo_at_risk"
      ? emergencyBalance.toolbar.combo_at_risk_visible !== false
      : isQuickFilterVisible(emergencyBalance, key)
  );

  useEffect(() => {
    const shell = toolbarShellRef.current;
    const inner = toolbarInnerRef.current;
    if (!shell || !inner) return;

    const measure = () => {
      // Measure intrinsic content width (ignore flex stretch / ml-auto).
      const prevZoom = inner.style.getPropertyValue("zoom");
      const prevWidth = inner.style.width;
      inner.style.setProperty("zoom", "1");
      inner.style.width = "max-content";
      const available = shell.clientWidth;
      const needed = inner.scrollWidth;
      if (prevZoom) inner.style.setProperty("zoom", prevZoom);
      else inner.style.removeProperty("zoom");
      inner.style.width = prevWidth;
      const next =
        needed > available && available > 0
          ? Math.max(0.7, available / needed)
          : 1;
      setToolbarScale((prev) =>
        Math.abs(prev - next) < 0.008 ? prev : next
      );
    };

    const raf = requestAnimationFrame(measure);
    const ro = new ResizeObserver(measure);
    ro.observe(shell);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [
    personFilter,
    ownerFilter,
    webhookSourceFilter,
    emergencyOnly,
    emergencyQuickFilter,
    filtersActive,
    displayOrders.length,
    searchLoading,
    isDesignerRole,
    visibleEmergencyChips.length,
    emergencyBalance.toolbar.emergency_visible,
  ]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full w-full max-w-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div
        ref={toolbarShellRef}
        className="relative z-40 w-full min-w-0 overflow-x-auto overflow-y-visible px-3 py-2"
      >
        <div
          ref={toolbarInnerRef}
          className="flex flex-nowrap items-center gap-1.5"
          style={{
            zoom: toolbarScale,
            width: toolbarScale < 0.999 ? "max-content" : "100%",
          }}
        >
        <div className="flex shrink-0 items-center gap-1.5">
          <h1 className="whitespace-nowrap text-base font-semibold text-slate-800">
            Production Board
          </h1>
          <div className="flex h-8 items-stretch rounded-md border border-slate-300 text-sm">
            <button
              type="button"
              onClick={() => setBoardView("kanban")}
              className={cn(
                "inline-flex items-center justify-center gap-1 rounded-l-md px-2 transition-colors",
                boardView === "kanban"
                  ? "bg-slate-800 text-white"
                  : "text-slate-600 hover:bg-slate-50"
              )}
              title="Kanban view"
            >
              <LayoutDashboard className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden min-[1100px]:inline">Kanban</span>
            </button>
            <button
              type="button"
              onClick={() => setBoardView("table")}
              className={cn(
                "inline-flex items-center justify-center gap-1 border-l border-slate-300 px-2 transition-colors",
                boardView === "table"
                  ? "bg-slate-800 text-white"
                  : "text-slate-600 hover:bg-slate-50"
              )}
              title="Table view"
            >
              <Table2 className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden min-[1100px]:inline">Table</span>
            </button>
            <button
              type="button"
              onClick={() => setBoardView("list")}
              className={cn(
                "inline-flex items-center justify-center gap-1 border-l border-slate-300 px-2 transition-colors",
                boardView === "list"
                  ? "bg-slate-800 text-white"
                  : "text-slate-600 hover:bg-slate-50"
              )}
              title="List view"
            >
              <List className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden min-[1100px]:inline">List</span>
            </button>
            <ColumnVisibilityDropdown
              columns={columns}
              hiddenColIds={hiddenColIds}
              onToggle={toggleColumnVisibility}
              onShowAll={showAllColumns}
              segmented
            />
          </div>
        </div>
        <div
          className={cn(
            "flex shrink-0 flex-nowrap items-center gap-1.5",
            toolbarScale >= 0.999 && "ml-auto"
          )}
        >
          <div
            ref={searchBoxRef}
            className="relative w-56 shrink-0"
          >
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <Input
              value={orderQuery}
              onChange={(e) => {
                setOrderQuery(e.target.value);
                setGroupSuggestionsOpen(true);
              }}
              onFocus={() => {
                if (orderGroupSuggestions.length > 0) {
                  setGroupSuggestionsOpen(true);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape" && showGroupSuggestions) {
                  e.preventDefault();
                  setGroupSuggestionsOpen(false);
                  e.currentTarget.blur();
                }
              }}
              placeholder="Search…"
              className="h-8 w-full pl-7 text-sm"
              aria-label="Search orders, customers, products, and notes"
              aria-autocomplete="list"
              aria-expanded={showGroupSuggestions}
            />
            {showGroupSuggestions ? (
              <div
                role="listbox"
                aria-label="Matching multi-part orders"
                className="absolute left-0 right-0 top-full z-[200] mt-1 max-h-64 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg"
              >
                {orderGroupSuggestions.map((suggestion) => (
                  <div key={suggestion.key} className="border-b border-slate-100 last:border-b-0">
                    <button
                      type="button"
                      role="option"
                      className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setOrderQuery(suggestion.key);
                        setGroupSuggestionsOpen(false);
                        setBoardView("kanban");
                        setGroupedView(true);
                      }}
                      title="Show every part in this order group"
                    >
                      <span>{suggestion.label}</span>
                      <span className="text-xs font-normal text-slate-500">
                        {suggestion.parts.length} parts
                      </span>
                    </button>
                    <div className="pb-1">
                      {suggestion.parts.map((part) => (
                        <button
                          key={part.id}
                          type="button"
                          role="option"
                          className="flex w-full px-3 py-1 pl-5 text-left text-xs text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setOrderQuery(part.title);
                            setGroupSuggestionsOpen(false);
                          }}
                        >
                          {part.title}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          {!isDesignerRole ? (
            <Select
              value={personFilter}
              onChange={(e) => setPersonFilter(e.target.value)}
              style={{ width: adaptiveSelectWidth(selectedPersonLabel) }}
              className="h-8 max-w-[12rem] shrink-0 truncate text-sm"
              aria-label="Filter by designer"
              title={selectedPersonLabel}
            >
              <option value="">All designers</option>
              {designers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          ) : null}
          <Select
            value={ownerFilter}
            onChange={(e) => setOwnerFilter(e.target.value)}
            style={{ width: adaptiveSelectWidth(selectedOwnerLabel) }}
            className="h-8 max-w-[12rem] shrink-0 truncate text-sm"
            aria-label="Filter by owner"
            title={selectedOwnerLabel}
          >
            <option value="">All owners</option>
            <option value={UNASSIGNED_OWNER_FILTER}>Unassigned</option>
            {ownerFilterOptions.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.name}
              </option>
            ))}
          </Select>
          <Select
            value={webhookSourceFilter}
            onChange={(e) => setWebhookSourceFilter(e.target.value)}
            style={{
              width: adaptiveSelectWidth(selectedWebhookSourceLabel, 10, 14),
            }}
            className="h-8 max-w-[12rem] shrink-0 truncate text-sm"
            aria-label="Filter by webhook source"
            title={selectedWebhookSourceLabel}
          >
            <option value="">All sources</option>
            <option value={MANUAL_WEBHOOK_SOURCE_FILTER}>Manual</option>
            {sourceStyleConfig.sources.map((src) => (
              <option key={src.key} value={src.key}>
                {src.label}
              </option>
            ))}
            <option value={OTHER_WEBHOOK_SOURCE_FILTER}>
              {sourceStyleConfig.other.label}
            </option>
          </Select>
          <details ref={dueFilterMenuRef} className="relative shrink-0">
            <summary
              className={cn(
                "flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-md border transition-colors [&::-webkit-details-marker]:hidden",
                dueFilterValue === "today" &&
                  "border-amber-300 bg-amber-50 text-amber-800",
                dueFilterValue === "overdue" &&
                  "border-red-300 bg-red-50 text-red-700",
                dueFilterValue === "" &&
                  "border-slate-300 text-slate-600 hover:bg-slate-50"
              )}
              aria-label="Filter by due date"
              title={
                dueFilterValue === "today"
                  ? "Today's due"
                  : dueFilterValue === "overdue"
                    ? "Overdue"
                    : "Due dates"
              }
            >
              <CalendarDays className="h-4 w-4" />
            </summary>
            <div className="absolute right-0 z-[200] mt-1 w-40 rounded-md border border-slate-200 bg-white p-1 shadow-lg">
              <button
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-slate-50",
                  dueFilterValue === ""
                    ? "bg-slate-100 font-medium text-slate-800"
                    : "text-slate-700"
                )}
                onClick={(e) => {
                  setDueTodayOnly(false);
                  setOverdueOnly(false);
                  setEmergencyQuickFilter(null);
                  e.currentTarget.closest("details")?.removeAttribute("open");
                }}
              >
                All due dates
              </button>
              <button
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-slate-50",
                  dueFilterValue === "today"
                    ? "bg-amber-50 font-medium text-amber-800"
                    : "text-slate-700"
                )}
                onClick={(e) => {
                  setDueTodayOnly(true);
                  setOverdueOnly(false);
                  setEmergencyQuickFilter("due_today");
                  e.currentTarget.closest("details")?.removeAttribute("open");
                }}
              >
                <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                Today
              </button>
              <button
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-slate-50",
                  dueFilterValue === "overdue"
                    ? "bg-red-50 font-medium text-red-700"
                    : "text-slate-700"
                )}
                onClick={(e) => {
                  setOverdueOnly(true);
                  setDueTodayOnly(false);
                  setEmergencyQuickFilter("late");
                  e.currentTarget.closest("details")?.removeAttribute("open");
                }}
              >
                <CalendarClock className="h-3.5 w-3.5 shrink-0" />
                Overdue
              </button>
            </div>
          </details>
          {/* Emergency / Urgency view — read-only overlay + quick filters */}
          {emergencyBalance.toolbar.emergency_visible !== false ? (
            <button
              type="button"
              onClick={() => setEmergencyOnly((v) => !v)}
              className={cn(
                "flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-2 text-sm font-medium transition-colors",
                emergencyOnly
                  ? "border-red-500 bg-red-600 text-white hover:bg-red-700"
                  : "border-slate-300 text-slate-600 hover:bg-slate-50"
              )}
              title="Emergency view — show only jobs that need attention right now"
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              Emergency
            </button>
          ) : null}
          {archivedOnly || archivedCount > 0 ? (
            <button
              type="button"
              onClick={() => setArchivedOnly((v) => !v)}
              className={cn(
                "flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-2 text-sm font-medium transition-colors",
                archivedOnly
                  ? "border-slate-700 bg-slate-800 text-white hover:bg-slate-900"
                  : "border-slate-300 text-slate-600 hover:bg-slate-50"
              )}
              title={
                archivedOnly
                  ? "Showing archived (finished) orders — click to return to the active board"
                  : "Show archived (finished) orders — hidden from the active board but kept searchable"
              }
            >
              <Archive className="h-3.5 w-3.5 shrink-0" />
              Archived{archivedCount > 0 ? ` (${archivedCount})` : ""}
            </button>
          ) : null}
          {visibleEmergencyChips.length > 0 ? (
            <div className="flex h-8 shrink-0 items-stretch overflow-hidden rounded-md border border-slate-300 text-xs">
              {visibleEmergencyChips.map((key, i) => {
                  const active = emergencyQuickFilter === key;
                  const count = emergencyQuickFilterCounts[key];
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        if (active) {
                          setEmergencyQuickFilter(null);
                          if (key === "late") setOverdueOnly(false);
                          if (key === "due_today") setDueTodayOnly(false);
                          return;
                        }
                        setEmergencyQuickFilter(key);
                        if (key === "late") {
                          setOverdueOnly(true);
                          setDueTodayOnly(false);
                        } else if (key === "due_today") {
                          setDueTodayOnly(true);
                          setOverdueOnly(false);
                        } else {
                          setOverdueOnly(false);
                          setDueTodayOnly(false);
                        }
                      }}
                      className={cn(
                        "inline-flex items-center gap-1 whitespace-nowrap px-1.5 font-medium transition-colors",
                        i > 0 && "border-l border-slate-300",
                        active
                          ? "bg-amber-500 text-white"
                          : "text-slate-600 hover:bg-slate-50"
                      )}
                      title={emergencyQuickFilterMeta[key].description}
                    >
                      {emergencyQuickFilterMeta[key].label}
                      <span
                        className={cn(
                          "tabular-nums",
                          active ? "text-white/90" : "text-slate-400"
                        )}
                      >
                        ({count})
                      </span>
                    </button>
                  );
                })}
            </div>
          ) : null}
          <DesignerLeaderboardButton />
          <button
            type="button"
            aria-pressed={groupedView}
            onClick={() => {
              setGroupedView((enabled) => {
                const next = !enabled;
                if (next) setBoardView("kanban");
                return next;
              });
            }}
            className={cn(
              "inline-flex h-8 shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap rounded-md border px-2 text-sm font-medium transition-colors",
              groupedView
                ? "border-blue-400 bg-blue-50 text-blue-700"
                : "border-slate-300 text-slate-600 hover:bg-slate-50"
            )}
            aria-label="Group related order cards"
            title="Stack multi-part orders (same column) into one card"
          >
            <Layers className="h-4 w-4 shrink-0" />
            Group
          </button>
          {canAnimateWarnings ? (
            <button
              type="button"
              aria-pressed={animateWarnings}
              onClick={() => setAnimateWarnings((enabled) => !enabled)}
              className={cn(
                "flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md border transition-colors",
                animateWarnings
                  ? "border-blue-400 bg-blue-50 text-blue-700"
                  : "border-slate-300 text-slate-600 hover:bg-slate-50"
              )}
              aria-label="Animate warning cards"
              title="Animate warning cards"
            >
              <Activity className="h-4 w-4" />
            </button>
          ) : null}
          {filtersActive ? (
            <button
              type="button"
              onClick={() => {
                setOrderQuery("");
                setPersonFilter("");
                setOwnerFilter("");
                setWebhookSourceFilter("");
                setOverdueOnly(false);
                setDueTodayOnly(false);
                setEmergencyQuickFilter(null);
              }}
              className="inline-flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-slate-300 px-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              <X className="h-4 w-4" /> Clear
            </button>
          ) : null}
          <span className="shrink-0 whitespace-nowrap text-sm text-slate-500">
            {filtersActive && searchLoading
              ? "Searching…"
              : `${displayOrders.length} job${displayOrders.length === 1 ? "" : "s"}`}
          </span>
        </div>
        </div>
      </div>

      {permissionError ? (
        <div className="mx-4 mb-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
          {permissionError}
        </div>
      ) : null}

      {toast ? (
        <div className="mx-4 mb-2 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {toast}
        </div>
      ) : null}

      {boardView === "list" ? (
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <BoardListView
            orders={emergencyFilteredOrders}
            columns={columns}
            customFields={customFields}
            fieldValuesByOrder={displayFieldValuesByOrder}
            thumbnailByOrder={displayThumbnailByOrder}
            ownerNameByOrder={displayOwnerNameByOrder}
            designerNameByOrder={displayDesignerNameByOrder}
            onOpenOrder={(o) => openOrderDetail(o.id)}
          />
        </div>
      ) : boardView === "table" ? (
        <div
          className="min-h-0 min-w-0 flex-1 overflow-hidden"
          onPointerDown={handleBoardPointerDown}
        >
        <BoardTable
          columns={columns}
          hiddenColIds={hiddenColIds}
          onToggleColumnVisibility={toggleColumnVisibility}
          orders={emergencyFilteredOrders}
          columnSortById={columnSortById}
          onApplySortToAllColumns={setAllColumnsSortMode}
          customFields={customFields}
          fieldValuesByOrder={displayFieldValuesByOrder}
          thumbnailByOrder={displayThumbnailByOrder}
          designerNameByOrder={displayDesignerNameByOrder}
          notificationBadgeByOrder={displayNotificationBadgeByOrder}
          ownerNameByOrder={displayOwnerNameByOrder}
          shippingSignByOrder={displayShippingSignByOrder}
          dieAlertByOrder={displayDieAlertByOrder}
          dieStatusByOrder={displayDieStatusByOrder}
          approvalDateByOrder={displayApprovalDateByOrder}
          groupSizeByOrder={groupSizeByOrder}
          warningRules={warningRules}
          animateWarnings={animateWarnings}
          warningWorkingDays={warningWorkingDays}
          webhookSourceStyles={webhookSourceStyles}
          timeChips={timeChips}
          role={role}
          getMoveableColumns={getMoveableColumns}
          onMoveToColumn={handleContextMove}
          buttonAutomations={buttonAutomations}
          appUrl={appUrl}
          onActionComplete={handleContextActionComplete}
          onActionError={flashPermissionError}
          onResendApproval={(order) => {
            const col = columns.find((c) => c.id === order.column_id);
            setNotifyPopup({
              order,
              notifyColumn: {
                column_id: order.column_id,
                notify_type: "customer_approval",
                automation_enabled: true,
              },
              columnName: col?.name ?? "Approval",
            });
          }}
          onOpenOrder={(o) => openOrderDetail(o.id)}
          onVisible={onColumnVisible}
          highlightedOrderId={highlightedOrderId}
          tags={canSetBoardTagAndPriority(role) ? tags : undefined}
          onSetTag={
            canSetBoardTagAndPriority(role) ? handleSetTag : undefined
          }
          onSetPriorityScore={
            canSetBoardTagAndPriority(role)
              ? handleSetPriorityScore
              : undefined
          }
        />
        </div>
      ) : (
      <DndContext
        id="production-board"
        sensors={sensors}
        collisionDetection={boardCollisionDetection}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
      >
        <div className="relative z-0 min-h-0 min-w-0 w-full max-w-full flex-1 overflow-hidden">
        <div
          ref={boardScrollRef}
          onPointerDown={handleBoardPointerDown}
          className="board-scroll board-h-scroll h-full min-h-0 min-w-0 w-full max-w-full overflow-x-auto overflow-y-hidden overscroll-x-contain"
        >
          <div className="flex h-full w-max min-w-full gap-3 px-3 pb-4 sm:px-4">
            {visibleColumns.map((column, index) => {
              const columnOrders = ordersByColumn.get(column.id) ?? [];
              const dragFromId = activeId
                ? dragSourceColumnRef.current ?? findColumnId(activeId)
                : null;
              const dragFrom = dragFromId
                ? columnsById.get(dragFromId)
                : null;
              const canAcceptDrop =
                dragFrom != null
                  ? canMove(role, dragFrom, column)
                  : canDropIn(role, column);
              return (
              <Column
                key={column.id}
                column={column}
                canDragCards={canDragInColumn(role, column)}
                canAcceptDrop={canAcceptDrop}
                isDragActive={activeId !== null}
                groupedView={groupedView}
                orders={columnOrders}
                sortMode={getColumnSortMode(columnSortById, column.id, {
                  isStartColumn: isStartColumn(column.id, columns),
                })}
                onSortModeChange={(mode) => setColumnSortMode(column.id, mode)}
                customFields={customFields}
                fieldValuesByOrder={displayFieldValuesByOrder}
                thumbnailByOrder={displayThumbnailByOrder}
                onCardThumbnailsChange={
                  canEditOrderDetails(role)
                    ? handleCardThumbnailsChange
                    : undefined
                }
                designerNameByOrder={displayDesignerNameByOrder}
                notificationBadgeByOrder={displayNotificationBadgeByOrder}
                ownerNameByOrder={displayOwnerNameByOrder}
                groupSizeByOrder={groupSizeByOrder}
                shippingSignByOrder={displayShippingSignByOrder}
                dieAlertByOrder={displayDieAlertByOrder}
                dieStatusByOrder={displayDieStatusByOrder}
                approvalDateByOrder={displayApprovalDateByOrder}
                warningRules={warningRules}
                animateWarnings={animateWarnings}
                warningWorkingDays={warningWorkingDays}
                emergencyByOrder={emergencyByOrder}
                webhookSourceStyles={webhookSourceStyles}
                timeChips={timeChips}
                isFirst={index === 0}
                sortLocked={isStartColumn(column.id, columns)}
                availableColumns={getMoveableColumns(column.id)}
                onMoveToColumn={handleContextMove}
                actionButtons={
                  canUseBoardActionButtons(role)
                    ? filterButtonsForColumn(buttonAutomations, column.id)
                    : []
                }
                appUrl={appUrl}
                onActionComplete={handleContextActionComplete}
                onActionError={flashPermissionError}
                onResendApproval={(order) => {
                  const col = columns.find((c) => c.id === order.column_id);
                  setNotifyPopup({
                    order,
                    notifyColumn: {
                      column_id: order.column_id,
                      notify_type: "customer_approval",
                      automation_enabled: true,
                    },
                    columnName: col?.name ?? "Approval",
                  });
                }}
                designers={designersWithLoad}
                onGroupAssignDesigner={handleGroupAssignDesigner}
                tags={
                  canSetBoardTagAndPriority(role) ? tags : undefined
                }
                onSetTag={
                  canSetBoardTagAndPriority(role) ? handleSetTag : undefined
                }
                onSetPriorityScore={
                  canSetBoardTagAndPriority(role)
                    ? handleSetPriorityScore
                    : undefined
                }
                onSetReprint={
                  canSetBoardTagAndPriority(role) ? handleSetReprint : undefined
                }
                onSetLocked={
                  canSetBoardTagAndPriority(role) ? handleSetLocked : undefined
                }
                onGroupSetDueDates={handleGroupSetDueDates}
                onSetDueDate={handleSetDueDate}
                highlightedOrderId={highlightedOrderId}
                onMoveGroup={handleGroupMove}
                onOpenOrder={(o) => openOrderDetail(o.id)}
                onAdd={(colId) => setCreateColumn(colId)}
                role={role}
                loadStatus={
                  filtersActive
                    ? searchLoading
                      ? "loading"
                      : "loaded"
                    : (columnLoadStatus[column.id] ?? "idle")
                }
                hasMore={filtersActive ? false : (columnHasMore[column.id] ?? false)}
                total={
                  filtersActive ? columnOrders.length : columnTotal[column.id]
                }
                onVisible={onColumnVisible}
                onLoadMore={onLoadMore}
              />
            );
            })}
          </div>
        </div>
        </div>

        <DragOverlay>
          {activeGroup ? (
            <GroupedOrderCard
              entry={activeGroup}
              onOpen={() => {}}
              customFields={customFields}
              fieldValuesByOrder={displayFieldValuesByOrder}
              webhookSourceStyles={webhookSourceStyles}
            />
          ) : activeOrder ? (
            <OrderCard
              order={activeOrder}
              customFields={customFields}
              fieldValues={displayFieldValuesByOrder[activeOrder.id]}
              thumbnails={displayThumbnailByOrder[activeOrder.id]}
              designerName={displayDesignerNameByOrder[activeOrder.id]}
              notificationBadge={displayNotificationBadgeByOrder[activeOrder.id]}
              ownerName={displayOwnerNameByOrder[activeOrder.id]}
              shippingSign={displayShippingSignByOrder[activeOrder.id]}
              dieAlert={displayDieAlertByOrder[activeOrder.id]}
              dieStatus={displayDieStatusByOrder[activeOrder.id]}
              approvalDate={displayApprovalDateByOrder[activeOrder.id] ?? null}
              warningRules={warningRules}
              animateWarnings={animateWarnings}
              warningWorkingDays={warningWorkingDays}
              webhookSourceStyles={webhookSourceStyles}
              columnColor={activeOrderColumnColor}
              columnKind={
                columns.find((c) => c.id === activeOrder.column_id)?.kind ?? null
              }
              columnName={
                columns.find((c) => c.id === activeOrder.column_id)?.name ?? null
              }
              showShippedEnteredDate={isShippedCustomerColumn(
                columns.find((c) => c.id === activeOrder.column_id)?.name
              )}
              timeChips={timeChips}
              onOpen={() => {}}
            />
          ) : null}
        </DragOverlay>
      </DndContext>
      )}

      <CreateOrderModal
        open={createColumn !== null}
        onClose={() => setCreateColumn(null)}
        columnId={createColumn}
        columns={columns}
        owners={owners}
        customFields={customFields}
        tenantIntegrationMode={tenantIntegrationMode}
        designers={designersWithLoad}
        currentUserId={currentUserId}
        onCreated={(order) => {
          const createdColumnId = order?.column_id ?? createColumn;
          setCreateColumn(null);
          if (createdColumnId) void fetchColumnOrders(createdColumnId, 0);
          if (createColumn && createColumn !== createdColumnId) {
            void fetchColumnOrders(createColumn, 0);
          }
          router.refresh();
        }}
      />

      <CardDetailModal
        orderId={detailId}
        open={detailId !== null}
        onClose={closeOrderDetail}
        groupSize={detailGroupSize}
        groupSameColumnCount={detailGroupSameColumn?.sameColumnCount}
        groupColumnName={detailGroupSameColumn?.columnName}
        customFields={customFields}
        owners={owners}
        columns={columns}
        designers={designersWithLoad}
        role={role}
        userId={currentUserId}
        currentUserName={currentUserName}
        onChanged={(patch) => {
          // Apply saved fields immediately so the card footer (tag, title, etc.)
          // updates without waiting on a column refetch.
          if (detailId && patch?.removed) {
            rememberDeleted(detailId);
            stripOrderFromBoard(detailId);
            return;
          }
          if (detailId && patch) {
            if (patch.specs?.archived === true) {
              rememberArchived(detailId);
            }
            // Fast Action / move: update column instantly on the board.
            if (
              typeof patch.column_id === "string" &&
              patch.column_id.trim()
            ) {
              const existing = boardOrdersRef.current.find(
                (o) => o.id === detailId
              );
              const fromColumnId = existing?.column_id;
              const toColumnId = patch.column_id;
              if (fromColumnId && fromColumnId !== toColumnId) {
                const destOrders = boardOrdersRef.current
                  .filter((o) => o.column_id === toColumnId)
                  .sort((a, b) => a.position - b.position);
                const lastPos =
                  destOrders[destOrders.length - 1]?.position ?? 0;
                patchOrderPlacement(detailId, {
                  column_id: toColumnId,
                  position: lastPos + 1000,
                  ...(existing
                    ? columnEnterPatch(existing, toColumnId)
                    : { last_moved_at: new Date().toISOString() }),
                });
                rememberMove(detailId, fromColumnId, toColumnId);
                refreshMoveColumns(fromColumnId, toColumnId);
                const destName =
                  columnsById.get(toColumnId)?.name ?? "";
                if (existing) {
                  offerFinishedCompletionSms([existing], destName);
                }
                return;
              }
            }

            const applyPatch = (o: OrderWithRelations) =>
              o.id === detailId ? { ...o, ...patch } : o;

            setOrders((prev) => {
              const next = prev.map(applyPatch);
              boardOrdersRef.current = next;
              return next;
            });
            // Filtered / search view reads searchResults + searchEnrichments —
            // keep those in sync or the board still shows the old designer/owner.
            setSearchResults((prev) => (prev ? prev.map(applyPatch) : prev));

            if (patch.created_by !== undefined) {
              const ownerName =
                owners.find((o) => o.id === patch.created_by)?.name ?? "";
              setOwnerNameByOrder((prev) => ({
                ...prev,
                [detailId]: ownerName,
              }));
              setSearchEnrichments((prev) =>
                prev
                  ? {
                      ...prev,
                      ownerNameByOrder: {
                        ...prev.ownerNameByOrder,
                        [detailId]: ownerName,
                      },
                    }
                  : prev
              );
            }
            if (
              patch.specs?.designer_name !== undefined ||
              patch.specs?.designer_id !== undefined
            ) {
              const designerName = String(patch.specs?.designer_name ?? "");
              setDesignerNameByOrder((prev) => ({
                ...prev,
                [detailId]: designerName,
              }));
              setSearchEnrichments((prev) =>
                prev
                  ? {
                      ...prev,
                      designerNameByOrder: {
                        ...prev.designerNameByOrder,
                        [detailId]: designerName,
                      },
                    }
                  : prev
              );
            }
            // Field patches are applied optimistically above. Do not soft-refresh
            // here — a column refetch can race the PATCH and restore stale due_date.
            return;
          }
          // Soft-refresh enrichments after a successful save (no patch).
          const order = boardOrdersRef.current.find((o) => o.id === detailId);
          if (order) scheduleSoftColumnRefresh(order.column_id);
        }}
        onLinkCopied={flashToast}
        buttonAutomations={buttonAutomations}
        fastActionButtons={fastActionButtons}
        appUrl={appUrl}
        tags={tags}
        webhookSourceStyles={webhookSourceStyles}
        notifyColumns={notifyColumns}
        onNotifyColumn={(order, notifyColumn, columnName) => {
          setNotifyPopup({ order, notifyColumn, columnName });
        }}
      />

      {holdReasonPopup ? (
        <HoldReasonPopup
          orderId={holdReasonPopup.orderId}
          orderTitle={holdReasonPopup.orderTitle}
          columnName={holdReasonPopup.columnName}
          onClose={() => setHoldReasonPopup(null)}
          onSaved={(message) => {
            setHoldReasonPopup(null);
            flashToast(message);
            scheduleRefresh();
          }}
        />
      ) : null}

      {notifyPopup ? (
        <NotificationPopup
          order={notifyPopup.order}
          columnId={notifyPopup.notifyColumn.column_id}
          columnName={notifyPopup.columnName}
          type={notifyPopup.notifyColumn.notify_type}
          tenantName={tenantName}
          customFields={customFields}
          fieldValues={fieldValuesByOrder[notifyPopup.order.id] ?? {}}
          smsConfigured={smsConfigured}
          publicAppUrl={publicAppUrl}
          groupOrderIds={notifyPopup.groupOrders?.map((o) => o.id)}
          onClose={() => {
            setNotifyPopup(null);
            scheduleRefresh();
          }}
          onSaved={(message) => {
            setNotifyPopup(null);
            flashToast(message);
            scheduleRefresh();
          }}
        />
      ) : null}

      {moveBlockedState ? (
        <MoveBlockedModal
          missingFields={moveBlockedState.missingFields}
          onOpenCard={() => {
            openOrderDetail(moveBlockedState.orderId);
            setMoveBlockedState(null);
          }}
          onClose={() => setMoveBlockedState(null)}
        />
      ) : null}

      {comboAppWarning ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-slate-800">
                  Skipping the Application stage?
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  <span className="font-medium">
                    {comboAppWarning.orderTitle}
                  </span>{" "}
                  is a combo / application job and hasn&rsquo;t gone through{" "}
                  <span className="font-medium">In the application</span> yet.
                  You&rsquo;re moving it to{" "}
                  <span className="font-medium">
                    {comboAppWarning.toColumnName}
                  </span>
                  .
                </p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setComboAppWarning(null)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={comboAppWarning.proceed}
                className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
              >
                Move anyway
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {finishedSmsPrompt ? (
        <FinishedCompletionSmsDialog
          orders={finishedSmsPrompt.orders}
          onClose={() => setFinishedSmsPrompt(null)}
        />
      ) : null}
    </div>
  );
}
