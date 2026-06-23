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
import { Search, X } from "lucide-react";
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
import {
  getMissingFields,
  type MissingField,
} from "@/lib/orders/validate-ready-to-move";
import { requestOrderMove } from "@/lib/orders/move-order-client";
import type {
  BoardColumn,
  Category,
  CustomField,
  Designer,
  ButtonAutomation,
  FastActionButton,
  OrderWithRelations,
  Role,
} from "@/lib/types";
import type { OrderOwner } from "./order-form-body";

import type { CardNotificationBadge } from "@/lib/card-badges";

/** Prefer pointer position so empty columns and wide boards register drops reliably. */
const boardCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) return pointerCollisions;
  return closestCorners(args);
};

interface BoardProps {
  tenantId: string;
  tenantName: string;
  role: Role;
  columns: BoardColumn[];
  initialOrders: OrderWithRelations[];
  categories: Category[];
  owners: OrderOwner[];
  currentUserId: string;
  customFields: CustomField[];
  fieldValuesByOrder: Record<string, Record<string, unknown>>;
  thumbnailByOrder: Record<string, string>;
  designerNameByOrder: Record<string, string>;
  designers: Designer[];
  notifyColumns: NotifyColumnConfig[];
  notificationBadgeByOrder: Record<string, CardNotificationBadge>;
  ownerNameByOrder: Record<string, string>;
  smsConfigured: boolean;
  publicAppUrl: boolean;
  buttonAutomations: ButtonAutomation[];
  fastActionButtons: FastActionButton[];
  initialOrderId?: string | null;
  appUrl: string;
}

export function Board({
  tenantId,
  tenantName,
  role,
  columns,
  initialOrders,
  categories,
  owners,
  currentUserId,
  customFields,
  fieldValuesByOrder,
  thumbnailByOrder,
  designerNameByOrder,
  designers,
  notifyColumns,
  notificationBadgeByOrder,
  ownerNameByOrder,
  smsConfigured,
  publicAppUrl,
  buttonAutomations,
  fastActionButtons,
  initialOrderId = null,
  appUrl,
}: BoardProps) {
  const router = useRouter();
  const [orders, setOrders] = useState<OrderWithRelations[]>(initialOrders);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [createColumn, setCreateColumn] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
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
  const [moveBlockedState, setMoveBlockedState] = useState<{
    orderId: string;
    missingFields: MissingField[];
  } | null>(null);

  useEffect(() => {
    if (
      initialOrderId &&
      orders.some((o) => o.id === initialOrderId)
    ) {
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

  // Keep local state in sync when the server sends fresh data (e.g. realtime
  // refresh) and we are not mid-drag.
  const signature = useMemo(
    () =>
      initialOrders
        .map((o) => `${o.id}:${o.column_id}:${o.position}:${o.updated_at}:${o.category_id ?? ""}`)
        .join("|"),
    [initialOrders]
  );
  const draggingRef = useRef(false);
  const dragSourceColumnRef = useRef<string | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Debounced full reload — board page is heavy (signed URLs, notifications). */
  const scheduleRefresh = useCallback(() => {
    if (draggingRef.current) return;
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => router.refresh(), 800);
  }, [router]);

  useEffect(() => {
    if (!draggingRef.current) setOrders(initialOrders);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  // Realtime: move cards immediately, then refresh server data (badges, etc.).
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
          setOrders((prev) => prev.filter((o) => o.id !== old.id));
        }
        scheduleRefresh();
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
        scheduleRefresh();
        return;
      }

      if (eventType === "UPDATE" && row.column_id) {
        let columnMoved = false;
        setOrders((prev) => {
          const idx = prev.findIndex((o) => o.id === row.id);
          if (idx === -1) return prev;
          columnMoved = prev[idx].column_id !== row.column_id;
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
        // Refresh badges and sync from server when a customer response moves the card.
        if (columnMoved) scheduleRefresh();
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
  }, [tenantId, scheduleRefresh]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const ownerFilterOptions = owners;

  const filtersActive =
    orderQuery.trim() !== "" || personFilter !== "" || ownerFilter !== "";

  const filteredOrders = useMemo(() => {
    const q = orderQuery.trim().toLowerCase();
    return orders.filter((o) => {
      if (q && !o.title.toLowerCase().includes(q)) return false;
      if (personFilter) {
        const designerId = (o.specs?.designer_id as string | undefined) ?? "";
        if (designerId !== personFilter) return false;
      }
      if (ownerFilter && o.created_by !== ownerFilter) return false;
      return true;
    });
  }, [orders, orderQuery, personFilter, ownerFilter]);

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

    // Don't preview a move the user can't complete (needs drop-out + drop-in).
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
    setOrders(initialOrders);
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

    // Enforce per-column drop permissions before persisting.
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

    if (crossing && to?.kind !== "exception") {
      const order = orders.find((o) => o.id === active.id);
      if (order) {
        const missingFields = getMissingFields(
          order,
          fieldValuesByOrder[order.id] ?? {},
          customFields
        );
        if (missingFields.length > 0) {
          abortDrag();
          setMoveBlockedState({ orderId: order.id, missingFields });
          return;
        }
      }
    }

    // Reorder within the destination column.
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

    setOrders((prevOrders) =>
      prevOrders.map((o) =>
        o.id === active.id
          ? { ...o, column_id: overColumn, position: newPosition }
          : o
      )
    );

    try {
      const result = await requestOrderMove(
        {
          orderId: String(active.id),
          toColumnId: overColumn,
          position: newPosition,
        },
        {
          fromColumnId: sourceColumn,
          columns,
        }
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
        setOrders(initialOrders);
        scheduleRefresh();
      } else if (crossing) {
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
        // When automation is disabled, do nothing — card stays in the column silently.
      }
    } finally {
      draggingRef.current = false;
      dragSourceColumnRef.current = null;
    }
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <h1 className="text-lg font-semibold text-slate-800">Production Board</h1>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <div className="relative min-w-[10rem] flex-1 sm:w-56 sm:flex-none">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={orderQuery}
              onChange={(e) => setOrderQuery(e.target.value)}
              placeholder="Filter by order number…"
              className="h-9 w-full pl-8"
              aria-label="Filter by order number"
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
              orders={ordersByColumn.get(column.id) ?? []}
              customFields={customFields}
              fieldValuesByOrder={fieldValuesByOrder}
              thumbnailByOrder={thumbnailByOrder}
              designerNameByOrder={designerNameByOrder}
              notificationBadgeByOrder={notificationBadgeByOrder}
              ownerNameByOrder={ownerNameByOrder}
              isFirst={index === 0}
              onOpenOrder={(o) => setDetailId(o.id)}
              onAdd={(colId) => setCreateColumn(colId)}
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
          router.refresh();
        }}
      />

      <CardDetailModal
        orderId={detailId}
        open={detailId !== null}
        onClose={closeOrderDetail}
        customFields={customFields}
        owners={owners}
        columns={columns}
        designers={designers}
        role={role}
        userId={currentUserId}
        onChanged={() => router.refresh()}
        onLinkCopied={flashToast}
        buttonAutomations={buttonAutomations}
        fastActionButtons={fastActionButtons}
        appUrl={appUrl}
        categories={categories}
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
