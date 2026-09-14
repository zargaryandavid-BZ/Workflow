"use client";

import { useEffect, useRef, useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type QueueOrder = {
  id: string;
  title: string;
  priority: string;
  due_date: string | null;
  queue_pos: number;
  customer_name: string | null;
};

const PRIORITY_STYLE: Record<string, { bg: string; fg: string }> = {
  urgent: { bg: "#fee2e2", fg: "#b91c1c" },
  high:   { bg: "#ffedd5", fg: "#c2410c" },
  normal: { bg: "#e2e8f0", fg: "#475569" },
  low:    { bg: "#f1f5f9", fg: "#64748b" },
};

function SortableRow({
  order,
  index,
  canAssign,
}: {
  order: QueueOrder;
  index: number;
  canAssign: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: order.id, disabled: !canAssign });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  const ps = PRIORITY_STYLE[order.priority] ?? PRIORITY_STYLE.normal;

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 select-none"
    >
      {canAssign && (
        <span
          {...attributes}
          {...listeners}
          className="flex shrink-0 cursor-grab items-center justify-center text-slate-400 hover:text-slate-600 active:cursor-grabbing"
          aria-label="Drag to reorder"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
            <circle cx="4" cy="3" r="1.2" />
            <circle cx="10" cy="3" r="1.2" />
            <circle cx="4" cy="7" r="1.2" />
            <circle cx="10" cy="7" r="1.2" />
            <circle cx="4" cy="11" r="1.2" />
            <circle cx="10" cy="11" r="1.2" />
          </svg>
        </span>
      )}
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
        {index + 1}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">
        {order.title || "Untitled"}
        {order.customer_name && (
          <>
            <span className="mx-1.5 text-slate-300">|</span>
            <span className="font-normal text-slate-500">{order.customer_name}</span>
          </>
        )}
      </span>
      <span
        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase"
        style={{ background: ps.bg, color: ps.fg }}
      >
        {order.priority}
      </span>
      {order.due_date && (
        <span className="shrink-0 text-[11px] text-slate-400">{order.due_date}</span>
      )}
    </li>
  );
}

export function PrePressQueue() {
  const [orders, setOrders] = useState<QueueOrder[]>([]);
  const [canAssign, setCanAssign] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/prepress/queue", { cache: "no-store" });
        const json = await res.json();
        setOrders(json.orders ?? []);
        setCanAssign(Boolean(json.canAssign));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function persistOrder(newOrders: QueueOrder[]) {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/prepress/queue", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_ids: newOrders.map((o) => o.id) }),
      });
      const json = await res.json();
      if (!res.ok) setMsg(json.error ?? "Failed to save");
    } catch {
      setMsg("Network error — order may not have saved.");
    } finally {
      setSaving(false);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setOrders((prev) => {
      const oldIndex = prev.findIndex((o) => o.id === active.id);
      const newIndex = prev.findIndex((o) => o.id === over.id);
      const next = arrayMove(prev, oldIndex, newIndex);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void persistOrder(next), 300);
      return next;
    });
  }

  if (loading) return <div className="p-6 text-sm text-slate-500">Loading…</div>;

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="mb-0.5 text-xl font-semibold text-slate-800">Pre-press Queue</h1>
          <p className="text-sm text-slate-500">
            {canAssign
              ? "All jobs in your Prepress column — drag to set work priority."
              : "Jobs currently in the Prepress column, in priority order."}
          </p>
        </div>
        {saving && <span className="text-xs text-slate-400">Saving…</span>}
      </div>

      {msg && <p className="mb-3 text-sm text-rose-600">{msg}</p>}

      {orders.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
          No jobs in the Prepress column right now.
        </p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={orders.map((o) => o.id)} strategy={verticalListSortingStrategy}>
            <ol className="space-y-2">
              {orders.map((o, i) => (
                <SortableRow key={o.id} order={o} index={i} canAssign={canAssign} />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
