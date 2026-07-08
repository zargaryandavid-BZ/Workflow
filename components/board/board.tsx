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
import { Activity, Layers, Search, X } from "lucide-react";
import {
  customerContactFromOrder,
  customerNameFromOrder,
} from "@/lib/notification-messages";
import { Column } from "./column";
import { OrderCard } from "./order-card";
import { CreateOrderModal } from "./create-order-modal";
import { CardDetailModal } from "./card-detail-modal";
import { MoveBlockedModal } from "./move-blocked-modal";
import { Input, Select } from "@/components/ui/input";
import { type NotifyColumnConfig } from "@/lib/board-notify";
import { NotificationPopup } from "@/components/automation/notification-popup";
import { createClient } from "@/lib/supabase/client";
import { canDragInColumn, canDropIn, canDropOut } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { type MissingField } from "@/lib/orders/validate-ready-to-move";
import { requestOrderMove } from "@/lib/orders/move-order-client";
import { getGroupKey } from "@/lib/group-orders";
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
import type { OrderOwner } from "./order-form-body";
import type { CardNotificationBadge } from "@/lib/card-badges";
import type { ColumnOrdersResponse } from "@/app/api/board/column-orders/route";

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
    Record<string, string>
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

  // ── UI state ────────────────────────────────────────────────────────────────
  const [activeId, setActiveId] = useState<string | null>(null);
  const [createColumn, setCreateColumn] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const detailGroupSize = useMemo(() => {
    if (!detailId) return undefined;
    const order = orders.find((o) => o.id === detailId);
    if (!order) return undefined;
    const key = getGroupKey(order);
    if (!key) return undefined;
    const count = orders.filter((o) => getGroupKey(o) === key).length;
    return count >= 2 ? count : undefined;
  }, [detailId, orders]);

  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [notifyPopup, setNotifyPopup] = useState<{
    order: OrderWithRelations;
    notifyColumn: NotifyColumnConfig;
    columnName: string;
  } | null>(null);
  const [orderQuery, setOrderQuery] = useState("");
  const [personFilter, setPersonFilter] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [groupedView, setGroupedView] = useState(false);
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
    if (initialOrderId && orders.some((o) => o.id === initialOrderId)) {
      setDetailId(initialOrderId);
    }
  }, [initialOrderId, orders]);

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

  // ── Per-column fetch ─────────────────────────────────────────────────────────
  const fetchColumnOrders = useCallback(
    async (columnId: string, page: number) => {
      // Prevent duplicate in-flight fetches for page 0.
      if (
        page === 0 &&
        columnLoadStatusRef.current[columnId] === "loading"
      ) {
        return;
      }

      columnLoadStatusRef.current = {
        ...columnLoadStatusRef.current,
        [columnId]: "loading",
      };
      setColumnLoadStatus((s) => ({ ...s, [columnId]: "loading" }));

      try {
        const res = await fetch(
          `/api/board/column-orders?columnId=${encodeURIComponent(columnId)}&page=${page}`
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = (await res.json()) as ColumnOrdersResponse;

        // Merge orders into central state. Page 0 replaces the column's
        // existing orders (handles refreshes); later pages append.
        setOrders((prev) => {
          let next: OrderWithRelations[];
          if (page === 0) {
            const kept = prev.filter((o) => o.column_id !== columnId);
            next = [...kept, ...data.orders];
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

        setColumnHasMore((s) => ({ ...s, [columnId]: data.hasMore }));
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
      }
    },
    [] // all dependencies are refs or stable setters
  );

  // Called by Column's IntersectionObserver when it enters the viewport.
  const onColumnVisible = useCallback(
    (columnId: string) => {
      const status = columnLoadStatusRef.current[columnId] ?? "idle";
      if (status !== "idle") return;
      void fetchColumnOrders(columnId, 0);
    },
    [fetchColumnOrders]
  );

  // Called by Column's "Load more" button.
  const onLoadMore = useCallback(
    (columnId: string) => {
      const nextPage = (columnCurrentPageRef.current[columnId] ?? -1) + 1;
      void fetchColumnOrders(columnId, nextPage);
    },
    [fetchColumnOrders]
  );

  // ── Refresh helpers ──────────────────────────────────────────────────────────
  const draggingRef = useRef(false);
  const dragSourceColumnRef = useRef<string | null>(null);
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

    setOrders((prev) => {
      const next = prev.map((o) =>
        o.id === order.id
          ? { ...o, column_id: toColumnId, position: newPosition }
          : o
      );
      boardOrdersRef.current = next;
      return next;
    });

    const result = await requestOrderMove(
      { orderId: order.id, toColumnId, position: newPosition },
      { fromColumnId, columns }
    );

    if (!result.ok) {
      if (result.missingFields?.length) {
        setOrders(snapshot);
        boardOrdersRef.current = snapshot;
        setMoveBlockedState({
          orderId: order.id,
          missingFields: result.missingFields,
        });
        return;
      }
      flashPermissionError(result.error ?? "Move was rejected.");
      setOrders(snapshot);
      boardOrdersRef.current = snapshot;
      scheduleRefresh();
      return;
    }

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

  function findColumnId(id: string): string | null {
    if (columns.some((c) => c.id === id)) return id;
    return orders.find((o) => o.id === id)?.column_id ?? null;
  }

  function onDragStart(event: DragStartEvent) {
    draggingRef.current = true;
    const id = String(event.active.id);
    dragSourceColumnRef.current = findColumnId(id);
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

    setOrders((prev) =>
      prev.map((o) =>
        o.id === active.id ? { ...o, column_id: overColumn } : o
      )
    );
  }

  function abortDrag() {
    draggingRef.current = false;
    dragSourceColumnRef.current = null;
    setOrders(boardOrdersRef.current);
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

    const columnOrders = orders
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

    setOrders((prevOrders) => {
      const next = prevOrders.map((o) =>
        o.id === active.id
          ? { ...o, column_id: overColumn, position: newPosition }
          : o
      );
      boardOrdersRef.current = next;
      return next;
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
          abortDrag();
          setMoveBlockedState({
            orderId: String(active.id),
            missingFields: result.missingFields,
          });
          return;
        }
        flashPermissionError(result.error ?? "Move was rejected.");
        setOrders(boardOrdersRef.current);
        scheduleRefresh();
      } else if (crossing) {
        // Load the destination column if it hasn't been loaded yet.
        if (!loadedColumnsRef.current.has(overColumn)) {
          void fetchColumnOrders(overColumn, 0);
        }
        const notifyColumn = notifyColumns.find(
          (c) => c.column_id === overColumn
        );
        const movedOrder = orders.find((o) => o.id === active.id);
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
    }
  }

  // ── Filters ──────────────────────────────────────────────────────────────────
  const ownerFilterOptions = owners;
  const filtersActive =
    orderQuery.trim() !== "" || personFilter !== "" || ownerFilter !== "";

  const filteredOrders = useMemo(() => {
    const q = orderQuery.trim().toLowerCase();
    return orders.filter((o) => {
      if (q) {
        const fv = fieldValuesByOrder[o.id] ?? {};
        const customerName = customerNameFromOrder(
          o,
          fv,
          customFields
        ).toLowerCase();
        const { email, phone } = customerContactFromOrder(o, fv, customFields);
        const searchable = [o.title, customerName, email ?? "", phone ?? ""]
          .join(" ")
          .toLowerCase();
        if (!searchable.includes(q)) return false;
      }
      if (personFilter) {
        const designerId =
          (o.specs?.designer_id as string | undefined) ?? "";
        if (designerId !== personFilter) return false;
      }
      if (ownerFilter && o.created_by !== ownerFilter) return false;
      return true;
    });
  }, [orders, orderQuery, personFilter, ownerFilter, fieldValuesByOrder, customFields]);

  const ordersByColumn = useMemo(() => {
    const map = new Map<string, OrderWithRelations[]>();
    for (const col of columns) map.set(col.id, []);
    for (const order of [...filteredOrders].sort(
      (a, b) => a.position - b.position
    )) {
      if (!map.has(order.column_id)) map.set(order.column_id, []);
      map.get(order.column_id)!.push(order);
    }
    return map;
  }, [filteredOrders, columns]);

  const activeOrder = orders.find((o) => o.id === activeId) ?? null;
  const activeOrderColumnColor = activeOrder
    ? (columns.find((c) => c.id === activeOrder.column_id)?.color ?? null)
    : null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <h1 className="text-lg font-semibold text-slate-800">
          Production Board
        </h1>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <div className="relative min-w-[10rem] flex-1 sm:w-56 sm:flex-none">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={orderQuery}
              onChange={(e) => setOrderQuery(e.target.value)}
              placeholder="Filter by order, customer, email, phone…"
              className="h-9 w-full pl-8"
              aria-label="Filter by order number, customer name, email or phone"
            />
          </div>
          <Select
            value={personFilter}
            onChange={(e) => setPersonFilter(e.target.value)}
            className="h-9 min-w-[8rem] max-w-[12rem] flex-1 truncate sm:w-44 sm:flex-none"
            aria-label="Filter by person"
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
            className="h-9 min-w-[8rem] max-w-[12rem] flex-1 truncate sm:w-44 sm:flex-none text-sm"
            aria-label="Filter by owner"
          >
            <option value="">All owners</option>
            {ownerFilterOptions.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.name}
              </option>
            ))}
          </Select>
          {filtersActive ? (
            <button
              type="button"
              onClick={() => {
                setOrderQuery("");
                setPersonFilter("");
                setOwnerFilter("");
              }}
              className="inline-flex h-9 shrink-0 items-center gap-1 rounded-md border border-slate-300 px-2.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              <X className="h-4 w-4" /> Clear
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setGroupedView((v) => !v)}
            title={
              groupedView
                ? "Switch to normal view"
                : "Group items by order number"
            }
            className={cn(
              "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-sm transition-colors",
              groupedView
                ? "border-blue-400 bg-blue-50 text-blue-700 hover:bg-blue-100"
                : "border-slate-300 text-slate-600 hover:bg-slate-50"
            )}
          >
            <Layers className="h-4 w-4" />
            Group
          </button>
          {warningRules.length > 0 ? (
            <button
              type="button"
              onClick={() => setAnimateWarnings((v) => !v)}
              title={
                animateWarnings
                  ? "Switch warnings to border only"
                  : "Switch warnings to animation"
              }
              className={cn(
                "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-sm transition-colors",
                animateWarnings
                  ? "border-amber-400 bg-amber-50 text-amber-700 hover:bg-amber-100"
                  : "border-slate-300 text-slate-600 hover:bg-slate-50"
              )}
            >
              <Activity className="h-4 w-4" />
              Animate
            </button>
          ) : null}
          <span className="shrink-0 whitespace-nowrap text-sm text-slate-500">
            {filtersActive
              ? `${filteredOrders.length} of ${orders.length} jobs`
              : `${orders.length} jobs`}
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
            {columns.map((column, index) => (
              <Column
                key={column.id}
                column={column}
                canDragCards={canDragInColumn(role, column)}
                canAcceptDrop={canDropIn(role, column)}
                isDragActive={activeId !== null}
                groupedView={groupedView}
                orders={ordersByColumn.get(column.id) ?? []}
                customFields={customFields}
                fieldValuesByOrder={fieldValuesByOrder}
                thumbnailByOrder={thumbnailByOrder}
                designerNameByOrder={designerNameByOrder}
                notificationBadgeByOrder={notificationBadgeByOrder}
                ownerNameByOrder={ownerNameByOrder}
                warningRules={warningRules}
                animateWarnings={animateWarnings}
                isFirst={index === 0}
                availableColumns={getMoveableColumns(column.id)}
                onMoveToColumn={handleContextMove}
                onOpenOrder={(o) => setDetailId(o.id)}
                onAdd={(colId) => setCreateColumn(colId)}
                loadStatus={columnLoadStatus[column.id] ?? "idle"}
                hasMore={columnHasMore[column.id] ?? false}
                total={columnTotal[column.id]}
                onVisible={onColumnVisible}
                onLoadMore={onLoadMore}
              />
            ))}
          </div>
        </div>

        <DragOverlay>
          {activeOrder ? (
            <OrderCard
              order={activeOrder}
              customFields={customFields}
              fieldValues={fieldValuesByOrder[activeOrder.id]}
              thumbnail={thumbnailByOrder[activeOrder.id]}
              designerName={designerNameByOrder[activeOrder.id]}
              notificationBadge={notificationBadgeByOrder[activeOrder.id]}
              ownerName={ownerNameByOrder[activeOrder.id]}
              warningRules={warningRules}
              animateWarnings={animateWarnings}
              columnColor={activeOrderColumnColor}
              onOpen={() => {}}
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      <CreateOrderModal
        open={createColumn !== null}
        onClose={() => setCreateColumn(null)}
        columnId={createColumn}
        columns={columns}
        owners={owners}
        customFields={customFields}
        designers={designers}
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
        customFields={customFields}
        owners={owners}
        columns={columns}
        designers={designers}
        role={role}
        userId={currentUserId}
        currentUserName={currentUserName}
        onChanged={() => {
          // Re-fetch the column of the edited order for fresh data.
          const order = boardOrdersRef.current.find((o) => o.id === detailId);
          if (order) void fetchColumnOrders(order.column_id, 0);
          router.refresh();
        }}
        onLinkCopied={flashToast}
        buttonAutomations={buttonAutomations}
        fastActionButtons={fastActionButtons}
        appUrl={appUrl}
        tags={tags}
        notifyColumns={notifyColumns}
        onNotifyColumn={(order, notifyColumn, columnName) => {
          setNotifyPopup({ order, notifyColumn, columnName });
        }}
      />

      {notifyPopup ? (
        <NotificationPopup
          order={notifyPopup.order}
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
