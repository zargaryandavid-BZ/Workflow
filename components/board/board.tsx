"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
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
import { NotificationPopup } from "@/components/automation/notification-popup";
import { Input, Select } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { canDropIn, canDropOut } from "@/lib/permissions";
import type {
  BoardColumn,
  CustomField,
  Designer,
  NotificationType,
  OrderWithRelations,
  Role,
} from "@/lib/types";

interface NotifyRuleRef {
  from_column: string;
  notify_type: NotificationType;
}

import type { CardNotificationBadge } from "@/lib/card-badges";

interface BoardProps {
  tenantId: string;
  tenantName: string;
  role: Role;
  columns: BoardColumn[];
  initialOrders: OrderWithRelations[];
  customFields: CustomField[];
  fieldValuesByOrder: Record<string, Record<string, unknown>>;
  thumbnailByOrder: Record<string, string>;
  designers: Designer[];
  notifyRules: NotifyRuleRef[];
  notificationBadgeByOrder: Record<string, CardNotificationBadge>;
  ownerNameByOrder: Record<string, string>;
  smsConfigured: boolean;
  publicAppUrl: boolean;
}

export function Board({
  tenantId,
  tenantName,
  role,
  columns,
  initialOrders,
  customFields,
  fieldValuesByOrder,
  thumbnailByOrder,
  designers,
  notifyRules,
  notificationBadgeByOrder,
  ownerNameByOrder,
  smsConfigured,
  publicAppUrl,
}: BoardProps) {
  const router = useRouter();
  const [orders, setOrders] = useState<OrderWithRelations[]>(initialOrders);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [createColumn, setCreateColumn] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [notificationJob, setNotificationJob] = useState<{
    order: OrderWithRelations;
    columnName: string;
    type: NotificationType;
  } | null>(null);
  const [orderQuery, setOrderQuery] = useState("");
  const [personFilter, setPersonFilter] = useState("");

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
        .map((o) => `${o.id}:${o.column_id}:${o.position}:${o.updated_at}`)
        .join("|"),
    [initialOrders]
  );
  const draggingRef = useRef(false);
  const dragSourceColumnRef = useRef<string | null>(null);
  useEffect(() => {
    if (!draggingRef.current) setOrders(initialOrders);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  // Realtime: refresh the route when orders change for this tenant.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`orders-${tenantId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
          filter: `tenant_id=eq.${tenantId}`,
        },
        () => {
          if (!draggingRef.current) router.refresh();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenantId, router]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const filtersActive = orderQuery.trim() !== "" || personFilter !== "";

  const filteredOrders = useMemo(() => {
    const q = orderQuery.trim().toLowerCase();
    return orders.filter((o) => {
      if (q && !o.title.toLowerCase().includes(q)) return false;
      if (personFilter) {
        const designerId = (o.specs?.designer_id as string | undefined) ?? "";
        if (designerId !== personFilter) return false;
      }
      return true;
    });
  }, [orders, orderQuery, personFilter]);

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

    // Don't visually move the card into a column the user can't drop into.
    const target = columnsById.get(overColumn);
    if (target && !canDropIn(role, target)) return;

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
    if (
      to &&
      ((crossing &&
        (!from || !canDropOut(role, from) || !canDropIn(role, to))) ||
        (!crossing && !canDropIn(role, to)))
    ) {
      flashPermissionError(
        "You don't have permission to move that order here."
      );
      abortDrag();
      return;
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
      const res = await fetch("/api/orders/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: active.id,
          toColumnId: overColumn,
          position: newPosition,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        flashPermissionError(json.error ?? "Move was rejected.");
        setOrders(initialOrders);
      } else if (crossing) {
        // Offer the customer-notification popup when the target column has an
        // enabled notify rule configured for it.
        const rule = notifyRules.find((r) => r.from_column === overColumn);
        const movedOrder = orders.find((o) => o.id === active.id);
        const notifyType =
          rule?.notify_type ??
          (to?.name === "Missing Info"
            ? "missing_info"
            : to?.kind === "approval"
              ? "customer_approval"
              : null);
        if (notifyType && movedOrder) {
          setNotificationJob({
            order: { ...movedOrder, column_id: overColumn },
            columnName: to?.name ?? "",
            type: notifyType,
          });
        }
      }
    } finally {
      draggingRef.current = false;
      dragSourceColumnRef.current = null;
      router.refresh();
    }
  }

  return (
    <div className="flex h-full flex-col">
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
          {filtersActive ? (
            <button
              type="button"
              onClick={() => {
                setOrderQuery("");
                setPersonFilter("");
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
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
      >
        <div className="board-scroll flex min-h-0 flex-1 gap-3 overflow-x-auto px-4 pb-4">
          {columns.map((column, index) => (
            <Column
              key={column.id}
              column={column}
              canDragOut={canDropOut(role, column)}
              orders={ordersByColumn.get(column.id) ?? []}
              customFields={customFields}
              fieldValuesByOrder={fieldValuesByOrder}
              thumbnailByOrder={thumbnailByOrder}
              notificationBadgeByOrder={notificationBadgeByOrder}
              ownerNameByOrder={ownerNameByOrder}
              isFirst={index === 0}
              onOpenOrder={(o) => setDetailId(o.id)}
              onAdd={(colId) => setCreateColumn(colId)}
            />
          ))}
        </div>

        <DragOverlay>
          {activeOrder ? (
            <OrderCard
              order={activeOrder}
              customFields={customFields}
              fieldValues={fieldValuesByOrder[activeOrder.id]}
              thumbnail={thumbnailByOrder[activeOrder.id]}
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
        customFields={customFields}
        designers={designers}
        onCreated={() => {
          setCreateColumn(null);
          router.refresh();
        }}
      />

      <CardDetailModal
        orderId={detailId}
        open={detailId !== null}
        onClose={() => setDetailId(null)}
        customFields={customFields}
        columns={columns}
        designers={designers}
        role={role}
        onChanged={() => router.refresh()}
      />

      {notificationJob ? (
        <NotificationPopup
          order={notificationJob.order}
          columnName={notificationJob.columnName}
          type={notificationJob.type}
          tenantName={tenantName}
          customFields={customFields}
          fieldValues={fieldValuesByOrder[notificationJob.order.id] ?? {}}
          smsConfigured={smsConfigured}
          publicAppUrl={publicAppUrl}
          onClose={() => setNotificationJob(null)}
          onSaved={(message) => {
            setNotificationJob(null);
            flashToast(message);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}
