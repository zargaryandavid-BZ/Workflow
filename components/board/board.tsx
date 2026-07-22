"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  CalendarClock,
  CalendarDays,
  Layers,
  LayoutDashboard,
  Search,
  Table2,
  X,
} from "lucide-react";
import { Column } from "./column";
import { BoardTable } from "./board-table";
import { ColumnVisibilityDropdown } from "./column-visibility-dropdown";
import { OrderCard } from "./order-card";
import { CreateOrderModal } from "./create-order-modal";
import { CardDetailModal } from "./card-detail-modal";
import { MoveBlockedModal } from "./move-blocked-modal";
import type { GroupDueDateUpdate } from "./group-due-dates-modal";
import type { ActionButtonResult } from "./action-button";
import { Input, Select } from "@/components/ui/input";
import { type NotifyColumnConfig } from "@/lib/board-notify";
import { NotificationPopup } from "@/components/automation/notification-popup";
import { createClient } from "@/lib/supabase/client";
import { fetchWithAuth } from "@/lib/fetch-with-auth";
import { canDragInColumn, canDropIn, canDropOut } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { type MissingField } from "@/lib/orders/validate-ready-to-move";
import { requestOrderMove } from "@/lib/orders/move-order-client";
import { getGroupKey, orderGroupSearchSuggestions } from "@/lib/group-orders";
import { orderMatchesBoardFilters } from "@/lib/board-order-filters";
import { UNASSIGNED_OWNER_FILTER } from "@/lib/constants";
import { filterButtonsForColumn } from "@/lib/button-automations";
import {
  loadHiddenColumnIds,
  saveHiddenColumnIds,
} from "@/lib/board-column-visibility";
import {
  loadPersonFilter,
  savePersonFilter,
  loadOwnerFilter,
  saveOwnerFilter,
} from "@/lib/board-person-filter";
import type {
  BoardColumn,
  CardWarningRule,
  Tag,
  CustomField,
  Designer,
  ButtonAutomation,
  FastActionButton,
  OrderWithRelations,
  Role,
} from "@/lib/types";
import type { WebhookSourceStyles } from "@/lib/webhook-source-styles";
import type { OrderOwner } from "./order-form-body";
import type { CardNotificationBadge } from "@/lib/card-badges";
import type { ColumnOrdersResponse } from "@/app/api/board/column-orders/route";
import type { SearchOrdersResponse } from "@/app/api/board/search-orders/route";
import type { BoardOrderEnrichment } from "@/lib/board-order-enrichment";
import type { BoardShippingSign } from "@/lib/board-shipping";
import {
  countDesignerLoads,
  designerLoadColumnIds,
} from "@/lib/designer-load";

/** Prefer pointer position so empty columns and wide boards register drops reliably. */
const boardCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) return pointerCollisions;
  return closestCorners(args);
};

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
  webhookSourceStyles?: WebhookSourceStyles;
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
  webhookSourceStyles = undefined,
  initialOrderId = null,
  appUrl,
}: BoardProps) {
  const router = useRouter();

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
    Record<string, string[]>
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
  const [approvalDateByOrder, setApprovalDateByOrder] = useState<
    Record<string, string>
  >({});

  // ── UI state ────────────────────────────────────────────────────────────────
  const [activeId, setActiveId] = useState<string | null>(null);
  const [createColumn, setCreateColumn] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [orderQuery, setOrderQuery] = useState("");
  const [personFilter, setPersonFilter] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [dueTodayOnly, setDueTodayOnly] = useState(false);
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

  // Live designer load (Start + In Progress) from loaded board orders, seeded
  // from server counts so the assign dropdown stays accurate as cards move.
  const designersWithLoad = useMemo(() => {
    const loadColIds = designerLoadColumnIds(columns);
    if (loadColIds.length === 0) {
      return designers.map((d) => ({ ...d, load: d.load ?? 0 }));
    }
    const loadSet = new Set(loadColIds);
    const loadColumnsLoaded = loadColIds.every((id) =>
      loadedColumnsRef.current.has(id)
    );
    if (!loadColumnsLoaded) {
      return designers.map((d) => ({ ...d, load: d.load ?? 0 }));
    }
    const counts = countDesignerLoads(
      designers.map((d) => d.id),
      orders,
      loadSet
    );
    return designers.map((d) => ({
      ...d,
      load: counts.get(d.id) ?? 0,
    }));
  }, [designers, orders, columns, columnLoadStatus]);

  const boardFilters = useMemo(
    () => ({
      q: orderQuery,
      personFilter,
      ownerFilter,
      overdueOnly,
      dueTodayOnly,
      doneColumnIds,
    }),
    [orderQuery, personFilter, ownerFilter, overdueOnly, dueTodayOnly, doneColumnIds]
  );

  /** Maps every orderId to its cross-column group size (only set when ≥ 2). */
  const groupSizeByOrder = useMemo(() => {
    const filtersOn =
      orderQuery.trim() !== "" ||
      personFilter !== "" ||
      ownerFilter !== "" ||
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
  } | null>(null);
  const [groupedView, setGroupedView] = useState(false);
  const [boardView, setBoardView] = useState<"kanban" | "table">("kanban");
  const [hiddenColIds, setHiddenColIds] = useState<Set<string>>(() => new Set());
  const [persistedFiltersReady, setPersistedFiltersReady] = useState(false);

  // Restore after mount so SSR HTML matches the first client render.
  useEffect(() => {
    const savedPerson = loadPersonFilter(tenantId);
    if (savedPerson && designers.some((d) => d.id === savedPerson)) {
      setPersonFilter(savedPerson);
    }
    const savedOwner = loadOwnerFilter(tenantId);
    if (
      savedOwner === UNASSIGNED_OWNER_FILTER ||
      (savedOwner && owners.some((o) => o.id === savedOwner))
    ) {
      setOwnerFilter(savedOwner);
    }
    setHiddenColIds(loadHiddenColumnIds(tenantId));
    setPersistedFiltersReady(true);
    // designers/owners from initial props; re-run only if tenant changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  useEffect(() => {
    if (!persistedFiltersReady) return;
    savePersonFilter(tenantId, personFilter);
  }, [persistedFiltersReady, tenantId, personFilter]);

  useEffect(() => {
    if (!persistedFiltersReady) return;
    saveOwnerFilter(tenantId, ownerFilter);
  }, [persistedFiltersReady, tenantId, ownerFilter]);

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
  const [moveBlockedState, setMoveBlockedState] = useState<{
    orderId: string;
    missingFields: MissingField[];
  } | null>(null);

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
      setDetailId(initialOrderId);
    }
  }, [initialOrderId, orders, searchResults]);

  // When filters are active, search the full database instead of filtering
  // only the lazily-loaded pages already in memory.
  useEffect(() => {
    const q = orderQuery.trim();
    const filtersActive =
      q !== "" ||
      personFilter !== "" ||
      ownerFilter !== "" ||
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
          if (overdueOnly) params.set("overdueOnly", "1");
          if (dueTodayOnly) params.set("dueTodayOnly", "1");

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
            approvalDateByOrder: data.approvalDateByOrder ?? {},
          });

          // Unique text search (XXX-1, or XXX with only one part): jump to its column.
          // Multiple hits for a base order (XXX-1 + XXX-2) stay put — no navigation.
          if (
            q &&
            data.orders.length === 1 &&
            lastAutoNavQueryRef.current !== q
          ) {
            lastAutoNavQueryRef.current = q;
            const columnId = data.orders[0].column_id;
            const orderId = data.orders[0].id;
            pendingSearchNavRef.current = { columnId, orderId };
            setHiddenColIds((prev) => {
              if (!prev.has(columnId)) return prev;
              const next = new Set(prev);
              next.delete(columnId);
              saveHiddenColumnIds(tenantId, next);
              return next;
            });
          } else if (q) {
            if (lastAutoNavQueryRef.current !== q) {
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
    }, 400);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [orderQuery, personFilter, ownerFilter, overdueOnly, dueTodayOnly, tenantId]);

  // Scroll to the unique search hit once its column is visible in the DOM.
  useEffect(() => {
    const pending = pendingSearchNavRef.current;
    if (!pending) return;
    if (hiddenColIds.has(pending.columnId)) return;

    const { columnId, orderId } = pending;

    // Do not clear pending until scroll succeeds — Strict Mode cleanup
    // cancels rAF; clearing early would drop the nav on the remount pass.
    const id = window.requestAnimationFrame(() => {
      const columnEl = document.querySelector(`[data-column-id="${columnId}"]`);
      const orderEl = document.querySelector(`[data-order-id="${orderId}"]`);
      if (!columnEl && !orderEl) return;
      pendingSearchNavRef.current = null;

      // Prefer the card so horizontal (board) + vertical (column) scroll
      // both land with the hit in the center of the viewport.
      if (orderEl) {
        orderEl.scrollIntoView({
          behavior: "smooth",
          block: "center",
          inline: "center",
        });
        return;
      }
      columnEl?.scrollIntoView({
        behavior: "smooth",
        inline: "center",
        block: "nearest",
      });
    });
    return () => window.cancelAnimationFrame(id);
  }, [hiddenColIds, searchResults, boardView]);

  function closeOrderDetail() {
    setDetailId(null);
    if (initialOrderId) {
      router.replace("/board", { scroll: false });
    }
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
    patch: { column_id: string; position?: number }
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
  const recentMoveRef = useRef<{
    orderId: string;
    fromColumnId: string;
    toColumnId: string;
    at: number;
  } | null>(null);

  // When a page-0 fetch is requested while one is already in flight, queue a
  // follow-up so post-save / post-move refreshes are not dropped.
  const pendingColumnRefetchRef = useRef(new Set<string>());

  // ── Per-column fetch ─────────────────────────────────────────────────────────
  const fetchColumnOrders = useCallback(
    async (columnId: string, page: number) => {
      // Prevent duplicate in-flight fetches for page 0 — queue instead of drop.
      if (
        page === 0 &&
        columnLoadStatusRef.current[columnId] === "loading"
      ) {
        pendingColumnRefetchRef.current.add(columnId);
        return;
      }

      columnLoadStatusRef.current = {
        ...columnLoadStatusRef.current,
        [columnId]: "loading",
      };
      setColumnLoadStatus((s) => ({ ...s, [columnId]: "loading" }));

      try {
        const url = `/api/board/column-orders?columnId=${encodeURIComponent(columnId)}&page=${page}`;
        let res = await fetchWithAuth(url);
        // Retry once on transient upstream / server errors (e.g. Supabase timeouts).
        if (res.status === 500 || res.status === 503) {
          await new Promise((r) => setTimeout(r, 600));
          res = await fetchWithAuth(url);
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = (await res.json()) as ColumnOrdersResponse;

        // Merge orders into central state. Page 0 replaces the column's
        // existing orders (handles refreshes); later pages append.
        // Cards already in this column but outside page 0 (e.g. just moved to
        // the end) are preserved so they don't vanish until "Load more".
        setOrders((prev) => {
          let next: OrderWithRelations[];
          if (page === 0) {
            const fetchedIds = new Set(data.orders.map((o) => o.id));
            // Drop any local copies of fetched ids first so a stale source-column
            // response cannot leave a duplicate with the old column_id.
            const kept = prev.filter(
              (o) => o.column_id !== columnId && !fetchedIds.has(o.id)
            );
            const overflow = prev.filter(
              (o) => o.column_id === columnId && !fetchedIds.has(o.id)
            );
            // Prefer recent optimistic move placement over a stale fetch row.
            const rm = recentMoveRef.current;
            const mergedFetched = data.orders.map((o) => {
              if (
                rm &&
                o.id === rm.orderId &&
                Date.now() - rm.at < 15_000 &&
                o.column_id !== rm.toColumnId
              ) {
                return { ...o, column_id: rm.toColumnId };
              }
              return o;
            });
            next = [...kept, ...mergedFetched, ...overflow];

          } else {
            const existingIds = new Set(prev.map((o) => o.id));
            const newOnly = data.orders.filter((o) => !existingIds.has(o.id));
            next = [...prev, ...newOnly];
          }
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
        setApprovalDateByOrder((prev) => ({
          ...prev,
          ...(data.approvalDateByOrder ?? {}),
        }));

        const hasOverflow =
          page === 0 &&
          boardOrdersRef.current.some(
            (o) =>
              o.column_id === columnId &&
              !data.orders.some((fetched) => fetched.id === o.id)
          );

        setColumnHasMore((s) => ({
          ...s,
          [columnId]: data.hasMore || hasOverflow,
        }));
        setColumnTotal((s) => ({ ...s, [columnId]: data.total }));
        columnCurrentPageRef.current = {
          ...columnCurrentPageRef.current,
          [columnId]: page,
        };
        columnLoadStatusRef.current = {
          ...columnLoadStatusRef.current,
          [columnId]: "loaded",
        };
        setColumnLoadStatus((s) => ({ ...s, [columnId]: "loaded" }));
        loadedColumnsRef.current.add(columnId);
      } catch (err) {
        console.error("[Board] Failed to load column orders:", err);
        columnLoadStatusRef.current = {
          ...columnLoadStatusRef.current,
          [columnId]: "error",
        };
        setColumnLoadStatus((s) => ({ ...s, [columnId]: "error" }));
      } finally {
        if (
          page === 0 &&
          pendingColumnRefetchRef.current.has(columnId)
        ) {
          pendingColumnRefetchRef.current.delete(columnId);
          void fetchColumnOrders(columnId, 0);
        }
      }
    },
    [] // all dependencies are refs or stable setters
  );

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
  const scheduleRefresh = useCallback(() => {
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
          setOrders((prev) => {
            const next = prev.filter((o) => o.id !== old.id);
            boardOrdersRef.current = next;
            return next;
          });
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
        scheduleRefresh();
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
          () => scheduleRefresh()
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
      if (!draggingRef.current) scheduleRefresh();
    }, 20_000);
    return () => clearInterval(id);
  }, [scheduleRefresh]);

  // ── DnD ────────────────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  /** Returns the columns a card in `fromColumnId` can be moved to via right-click. */
  function getMoveableColumns(fromColumnId: string) {
    const fromCol = columnsById.get(fromColumnId);
    if (!fromCol || !canDropOut(role, fromCol)) return [];
    return columns.filter((c) => c.id !== fromColumnId && canDropIn(role, c));
  }

  /** Handles a column move triggered from the right-click context menu. */
  async function handleContextMove(
    order: OrderWithRelations,
    toColumnId: string
  ) {
    const fromColumnId = order.column_id;
    const fromCol = columnsById.get(fromColumnId);
    const toCol = columnsById.get(toColumnId);
    if (!fromCol || !toCol) return;

    if (!canDropOut(role, fromCol)) {
      flashPermissionError(
        `You can't move orders out of "${fromCol.name}". Check the ↑ permission on that column.`
      );
      return;
    }
    if (!canDropIn(role, toCol)) {
      flashPermissionError(
        `You can't drop orders into "${toCol.name}". Check the ↓ permission on that column.`
      );
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

    recentMoveRef.current = {
      orderId: order.id,
      fromColumnId,
      toColumnId,
      at: Date.now(),
    };

    // If the destination column hasn't been loaded yet, load it now so the
    // moved card appears there.
    if (!loadedColumnsRef.current.has(toColumnId)) {
      void fetchColumnOrders(toColumnId, 0);
    }

    const notifyColumn = notifyColumns.find((c) => c.column_id === toColumnId);
    if (notifyColumn && notifyColumn.automation_enabled) {
      setNotifyPopup({
        order: { ...order, column_id: toColumnId },
        notifyColumn,
        columnName: toCol.name,
      });
    }
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

    for (const order of groupOrders) {
      const specs = {
        ...(order.specs ?? {}),
        designer_id: designer.id,
        designer_name: designer.name,
      };
      patchOrderFields(order.id, { specs });
      setDesignerNameByOrder((prev) => ({
        ...prev,
        [order.id]: designer.name ?? "",
      }));
    }

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

  async function handleGroupMove(
    groupOrders: OrderWithRelations[],
    toColumnId: string
  ) {
    if (groupOrders.length === 0) return;
    const fromColumnId = groupOrders[0].column_id;
    const fromCol = columnsById.get(fromColumnId);
    const toCol = columnsById.get(toColumnId);
    if (!fromCol || !toCol) return;

    if (!canDropOut(role, fromCol)) {
      flashPermissionError(
        `You can't move orders out of "${fromCol.name}". Check the ↑ permission on that column.`
      );
      return;
    }
    if (!canDropIn(role, toCol)) {
      flashPermissionError(
        `You can't drop orders into "${toCol.name}". Check the ↓ permission on that column.`
      );
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
      });
    }

    for (const { order, position } of moves) {
      const result = await requestOrderMove(
        { orderId: order.id, toColumnId, position },
        { fromColumnId, columns }
      );

      if (!result.ok) {
        restoreOrdersSnapshot(snapshot);
        if (result.missingFields?.length) {
          setMoveBlockedState({
            orderId: order.id,
            missingFields: result.missingFields,
          });
        } else {
          flashPermissionError(result.error ?? "Move was rejected.");
        }
        return;
      }
    }

    if (!loadedColumnsRef.current.has(toColumnId)) {
      void fetchColumnOrders(toColumnId, 0);
    }

    const notifyColumn = notifyColumns.find((c) => c.column_id === toColumnId);
    if (notifyColumn && notifyColumn.automation_enabled) {
      setNotifyPopup({
        order: { ...groupOrders[0], column_id: toColumnId },
        notifyColumn,
        columnName: toCol.name,
      });
    }

    flashToast(`Moved ${groupOrders.length} items to ${toCol.name}`);
  }

  function findColumnId(id: string): string | null {
    if (columns.some((c) => c.id === id)) return id;
    const fromSearch = searchResults?.find((o) => o.id === id)?.column_id;
    if (fromSearch) return fromSearch;
    return orders.find((o) => o.id === id)?.column_id ?? null;
  }

  function onDragStart(event: DragStartEvent) {
    draggingRef.current = true;
    const id = String(event.active.id);
    dragSourceColumnRef.current = findColumnId(id);
    dragSnapshotRef.current = boardOrdersRef.current;
    setActiveId(id);
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
    if (!canDropOut(role, source) || !canDropIn(role, target)) return;

    // Visual-only during drag: update React state for both orders + searchResults,
    // but keep boardOrdersRef / dragSnapshotRef as the pre-drag rollback point.
    setOrders((prev) =>
      prev.map((o) =>
        o.id === active.id ? { ...o, column_id: overColumn } : o
      )
    );
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
  }

  async function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    const sourceColumn = dragSourceColumnRef.current;
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
      if (from && !canDropOut(role, from)) {
        flashPermissionError(
          `You can't move orders out of "${from.name}". Check the ↑ permission on that column.`
        );
        abortDrag();
        return;
      }
      if (to && !canDropIn(role, to)) {
        flashPermissionError(
          `You can't drop orders into "${to.name}". Check the ↓ permission on that column.`
        );
        abortDrag();
        return;
      }
    } else if (to && !canDropIn(role, to)) {
      flashPermissionError(
        `You can't reorder orders in "${to.name}". Check the ↓ permission on that column.`
      );
      abortDrag();
      return;
    }

    const placementSource =
      personFilter ||
      ownerFilter ||
      orderQuery.trim() ||
      overdueOnly ||
      dueTodayOnly
        ? (searchResults ?? orders)
        : orders;
    const columnOrders = placementSource
      .filter((o) => o.column_id === overColumn)
      .sort((a, b) => a.position - b.position);
    const oldIndex = columnOrders.findIndex((o) => o.id === active.id);
    let newIndex = columnOrders.findIndex((o) => o.id === over.id);
    if (newIndex === -1) newIndex = columnOrders.length - 1;

    const reordered =
      oldIndex === -1
        ? columnOrders
        : arrayMove(columnOrders, oldIndex, Math.max(0, newIndex));

    const movedIndex = reordered.findIndex((o) => o.id === active.id);
    const prev = reordered[movedIndex - 1]?.position ?? 0;
    const next = reordered[movedIndex + 1]?.position;
    const newPosition =
      next === undefined ? prev + 1000 : (prev + next) / 2;

    patchOrderPlacement(String(active.id), {
      column_id: overColumn,
      position: newPosition,
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
        recentMoveRef.current = {
          orderId: String(active.id),
          fromColumnId: activeColumn,
          toColumnId: overColumn,
          at: Date.now(),
        };
        // Load the destination column if it hasn't been loaded yet.
        if (!loadedColumnsRef.current.has(overColumn)) {
          void fetchColumnOrders(overColumn, 0);
        }
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
        scheduleRefresh();
      }
    } finally {
      draggingRef.current = false;
      dragSourceColumnRef.current = null;
      dragSnapshotRef.current = null;
    }
  }

  // ── Filters ──────────────────────────────────────────────────────────────────
  const ownerFilterOptions = owners;
  const filtersActive =
    orderQuery.trim() !== "" ||
    personFilter !== "" ||
    ownerFilter !== "" ||
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

  const displayOrders = filtersActive
    ? (searchResults ?? localFilteredOrders)
    : orders;

  /** e.g. typing "XXX" → suggest "XXX-(3)" with part titles to continue filtering. */
  const orderGroupSuggestions = useMemo(
    () =>
      orderGroupSearchSuggestions(
        orderQuery,
        searchResults ?? localFilteredOrders
      ),
    [orderQuery, searchResults, localFilteredOrders]
  );

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
  const displayApprovalDateByOrder = filtersActive && searchEnrichments
    ? searchEnrichments.approvalDateByOrder
    : approvalDateByOrder;

  const ordersByColumn = useMemo(() => {
    const map = new Map<string, OrderWithRelations[]>();
    for (const col of columns) map.set(col.id, []);
    for (const order of [...displayOrders].sort(
      (a, b) => a.position - b.position
    )) {
      if (!map.has(order.column_id)) map.set(order.column_id, []);
      map.get(order.column_id)!.push(order);
    }
    return map;
  }, [displayOrders, columns]);

  const activeOrder =
    displayOrders.find((o) => o.id === activeId) ??
    orders.find((o) => o.id === activeId) ??
    null;
  const activeOrderColumnColor = activeOrder
    ? (columns.find((c) => c.id === activeOrder.column_id)?.color ?? null)
    : null;

  const selectedPersonLabel =
    designers.find((d) => d.id === personFilter)?.name ?? "All people";
  const selectedOwnerLabel =
    ownerFilter === UNASSIGNED_OWNER_FILTER
      ? "Unassigned"
      : ownerFilterOptions.find((o) => o.id === ownerFilter)?.name ??
        "All owners";
  const dueFilterValue = dueTodayOnly
    ? "today"
    : overdueOnly
      ? "overdue"
      : "";
  const canAnimateWarnings = warningRules.length > 0;

  function adaptiveSelectWidth(label: string, minCh = 10, maxCh = 16) {
    return `${Math.min(maxCh, Math.max(minCh, label.length + 3))}ch`;
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 sm:gap-3">
          <h1 className="text-lg font-semibold text-slate-800">
            Production Board
          </h1>
          <div className="flex rounded-md border border-slate-300 text-sm">
            <button
              type="button"
              onClick={() => setBoardView("kanban")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-l-md px-2.5 py-1 transition-colors",
                boardView === "kanban"
                  ? "bg-slate-800 text-white"
                  : "text-slate-600 hover:bg-slate-50"
              )}
              title="Kanban view"
            >
              <LayoutDashboard className="h-3.5 w-3.5" />
              Kanban
            </button>
            <button
              type="button"
              onClick={() => setBoardView("table")}
              className={cn(
                "inline-flex items-center gap-1.5 border-l border-slate-300 px-2.5 py-1 transition-colors",
                boardView === "table"
                  ? "bg-slate-800 text-white"
                  : "text-slate-600 hover:bg-slate-50"
              )}
              title="Table view"
            >
              <Table2 className="h-3.5 w-3.5" />
              Table
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
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
          <div className="relative min-w-[10rem] max-w-md flex-1 basis-[12rem]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={orderQuery}
              onChange={(e) => setOrderQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && orderGroupSuggestions.length > 0) {
                  e.currentTarget.blur();
                }
              }}
              placeholder="Filter by order, customer, email, phone…"
              className="h-9 w-full pl-8"
              aria-label="Filter by order number, customer name, email or phone"
              aria-autocomplete="list"
              aria-expanded={orderGroupSuggestions.length > 0}
            />
            {orderGroupSuggestions.length > 0 ? (
              <div
                role="listbox"
                aria-label="Matching multi-part orders"
                className="absolute left-0 right-0 top-full z-40 mt-1 max-h-64 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg"
              >
                {orderGroupSuggestions.map((suggestion) => (
                  <div key={suggestion.key} className="border-b border-slate-100 last:border-b-0">
                    <button
                      type="button"
                      role="option"
                      className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setOrderQuery(`${suggestion.key}-`)}
                      title="Continue typing the part number"
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
                          onClick={() => setOrderQuery(part.title)}
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
          <Select
            value={personFilter}
            onChange={(e) => setPersonFilter(e.target.value)}
            style={{ width: adaptiveSelectWidth(selectedPersonLabel) }}
            className="h-9 max-w-[14rem] shrink-0 truncate text-sm"
            aria-label="Filter by person"
            title={selectedPersonLabel}
          >
            <option value="">All people</option>
            {designers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <Select
            value={ownerFilter}
            onChange={(e) => setOwnerFilter(e.target.value)}
            style={{ width: adaptiveSelectWidth(selectedOwnerLabel) }}
            className="h-9 max-w-[14rem] shrink-0 truncate text-sm"
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
          <details className="relative shrink-0">
            <summary
              className={cn(
                "flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-md border transition-colors [&::-webkit-details-marker]:hidden",
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
            <div className="absolute right-0 z-50 mt-1 w-40 rounded-md border border-slate-200 bg-white p-1 shadow-lg">
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
                  e.currentTarget.closest("details")?.removeAttribute("open");
                }}
              >
                <CalendarClock className="h-3.5 w-3.5 shrink-0" />
                Overdue
              </button>
            </div>
          </details>
          <details className="relative shrink-0">
            <summary
              className={cn(
                "flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-md border transition-colors [&::-webkit-details-marker]:hidden",
                groupedView
                  ? "border-blue-400 bg-blue-50 text-blue-700"
                  : "border-slate-300 text-slate-600 hover:bg-slate-50"
              )}
              aria-label="Board view options"
              title="Group cards and warning animation"
            >
              <Layers className="h-4 w-4" />
            </summary>
            <div className="absolute right-0 z-50 mt-1 w-44 rounded-md border border-slate-200 bg-white p-1 shadow-lg">
              <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                <input
                  type="checkbox"
                  className="rounded border-slate-300"
                  checked={groupedView}
                  onChange={(e) => setGroupedView(e.target.checked)}
                />
                <Layers className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                Group
              </label>
              {canAnimateWarnings ? (
                <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    className="rounded border-slate-300"
                    checked={animateWarnings}
                    onChange={(e) => setAnimateWarnings(e.target.checked)}
                  />
                  <Activity className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                  Animate
                </label>
              ) : null}
            </div>
          </details>
          {filtersActive ? (
            <button
              type="button"
              onClick={() => {
                setOrderQuery("");
                setPersonFilter("");
                setOwnerFilter("");
                setOverdueOnly(false);
                setDueTodayOnly(false);
              }}
              className="inline-flex h-9 shrink-0 items-center gap-1 rounded-md border border-slate-300 px-2.5 text-sm text-slate-600 hover:bg-slate-50"
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

      {boardView === "table" ? (
        <BoardTable
          columns={columns}
          hiddenColIds={hiddenColIds}
          onToggleColumnVisibility={toggleColumnVisibility}
          orders={displayOrders}
          customFields={customFields}
          fieldValuesByOrder={displayFieldValuesByOrder}
          thumbnailByOrder={displayThumbnailByOrder}
          designerNameByOrder={displayDesignerNameByOrder}
          notificationBadgeByOrder={displayNotificationBadgeByOrder}
          ownerNameByOrder={displayOwnerNameByOrder}
          shippingSignByOrder={displayShippingSignByOrder}
          groupSizeByOrder={groupSizeByOrder}
          warningRules={warningRules}
          animateWarnings={animateWarnings}
          warningWorkingDays={warningWorkingDays}
          webhookSourceStyles={webhookSourceStyles}
          role={role}
          getMoveableColumns={getMoveableColumns}
          onMoveToColumn={handleContextMove}
          buttonAutomations={buttonAutomations}
          appUrl={appUrl}
          onActionComplete={handleContextActionComplete}
          onActionError={flashPermissionError}
          onOpenOrder={(o) => setDetailId(o.id)}
          onVisible={onColumnVisible}
        />
      ) : (
      <DndContext
        id="production-board"
        sensors={sensors}
        collisionDetection={boardCollisionDetection}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
      >
        <div className="board-scroll min-h-0 min-w-0 flex-1 overflow-x-scroll overflow-y-hidden">
          <div className="flex h-full min-w-max gap-3 px-4 pb-4">
            {visibleColumns.map((column, index) => {
              const columnOrders = ordersByColumn.get(column.id) ?? [];
              return (
              <Column
                key={column.id}
                column={column}
                canDragCards={canDragInColumn(role, column)}
                canAcceptDrop={canDropIn(role, column)}
                isDragActive={activeId !== null}
                groupedView={groupedView}
                orders={columnOrders}
                customFields={customFields}
                fieldValuesByOrder={displayFieldValuesByOrder}
                thumbnailByOrder={displayThumbnailByOrder}
                designerNameByOrder={displayDesignerNameByOrder}
                notificationBadgeByOrder={displayNotificationBadgeByOrder}
                ownerNameByOrder={displayOwnerNameByOrder}
                groupSizeByOrder={groupSizeByOrder}
                shippingSignByOrder={displayShippingSignByOrder}
                approvalDateByOrder={displayApprovalDateByOrder}
                warningRules={warningRules}
                animateWarnings={animateWarnings}
                warningWorkingDays={warningWorkingDays}
                webhookSourceStyles={webhookSourceStyles}
                isFirst={index === 0}
                availableColumns={getMoveableColumns(column.id)}
                onMoveToColumn={handleContextMove}
                actionButtons={
                  role === "admin"
                    ? filterButtonsForColumn(buttonAutomations, column.id)
                    : []
                }
                appUrl={appUrl}
                onActionComplete={handleContextActionComplete}
                onActionError={flashPermissionError}
                designers={designersWithLoad}
                onGroupAssignDesigner={handleGroupAssignDesigner}
                onGroupSetDueDates={handleGroupSetDueDates}
                onMoveGroup={handleGroupMove}
                onOpenOrder={(o) => setDetailId(o.id)}
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

        <DragOverlay>
          {activeOrder ? (
            <OrderCard
              order={activeOrder}
              customFields={customFields}
              fieldValues={displayFieldValuesByOrder[activeOrder.id]}
              thumbnails={displayThumbnailByOrder[activeOrder.id]}
              designerName={displayDesignerNameByOrder[activeOrder.id]}
              notificationBadge={displayNotificationBadgeByOrder[activeOrder.id]}
              ownerName={displayOwnerNameByOrder[activeOrder.id]}
              shippingSign={displayShippingSignByOrder[activeOrder.id]}
              approvalDate={displayApprovalDateByOrder[activeOrder.id] ?? null}
              warningRules={warningRules}
              animateWarnings={animateWarnings}
              warningWorkingDays={warningWorkingDays}
              webhookSourceStyles={webhookSourceStyles}
              columnColor={activeOrderColumnColor}
              columnKind={
                columns.find((c) => c.id === activeOrder.column_id)?.kind ?? null
              }
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
        designers={designersWithLoad}
        currentUserId={currentUserId}
        onCreated={() => {
          setCreateColumn(null);
          // Re-fetch the column the new order was created in.
          if (createColumn) void fetchColumnOrders(createColumn, 0);
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
          if (detailId && patch) {
            setOrders((prev) => {
              const next = prev.map((o) =>
                o.id === detailId ? { ...o, ...patch } : o
              );
              boardOrdersRef.current = next;
              return next;
            });
            if (patch.created_by !== undefined) {
              const ownerName =
                owners.find((o) => o.id === patch.created_by)?.name ?? "";
              setOwnerNameByOrder((prev) => ({
                ...prev,
                [detailId]: ownerName,
              }));
            }
            if (patch.specs?.designer_name !== undefined) {
              setDesignerNameByOrder((prev) => ({
                ...prev,
                [detailId]: String(patch.specs?.designer_name ?? ""),
              }));
            }
          }
          // Re-fetch the column of the edited order for enrichments / field values.
          const order = boardOrdersRef.current.find((o) => o.id === detailId);
          if (order) void fetchColumnOrders(order.column_id, 0);
          router.refresh();
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
            setDetailId(moveBlockedState.orderId);
            setMoveBlockedState(null);
          }}
          onClose={() => setMoveBlockedState(null)}
        />
      ) : null}
    </div>
  );
}
