"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { CheckSquare, Copy, Loader2, Plus, Square, X } from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import { partCardTitle } from "@/lib/group-orders";
import { ProductionStageSelect } from "@/components/board/production-stage-select";
import {
  DAILY_PRIORITY_BUCKET_LABELS,
  DAILY_PRIORITY_BUCKET_OPTIONS,
  PRESS_LABELS,
  PRESS_OPTIONS,
} from "@/lib/production-fields";
import type { DailyPriorityBucket, PressType, ProductionStage } from "@/lib/types";

interface PriorityOrder {
  id: string;
  title: string;
  webhook_source: string | null;
  specs: Record<string, unknown> | null;
  due_date: string | null;
  press: PressType | null;
  production_stage: ProductionStage | null;
  daily_priority_bucket: DailyPriorityBucket | null;
  daily_priority_rank: number | null;
  daily_priority_done: boolean;
  daily_priority_note: string | null;
  customer: { id?: string; name?: string | null; company?: string | null } | null;
}

interface SearchResult {
  id: string;
  title: string;
  due_date: string | null;
  customer: { name?: string; company?: string } | null;
}

function orderLabel(order: PriorityOrder): string {
  const custom = partCardTitle(order);
  const customer = order.customer?.company || order.customer?.name || null;
  return [custom, customer].filter(Boolean).join(" — ") || order.title;
}

/** One texting-ready line: "15219 - Customer - note". Skips parts that aren't set. */
function textLineFor(order: PriorityOrder): string {
  const customer = order.customer?.company || order.customer?.name || null;
  return [order.title, customer, order.daily_priority_note].filter(Boolean).join(" - ");
}

function SortableRow({
  order,
  index,
  canManage,
  onToggleDone,
  onMoveBucket,
  onRemove,
  onNoteChange,
  busy,
}: {
  order: PriorityOrder;
  index: number;
  canManage: boolean;
  onToggleDone: (order: PriorityOrder) => void;
  onMoveBucket: (order: PriorityOrder, bucket: DailyPriorityBucket) => void;
  onRemove: (order: PriorityOrder) => void;
  onNoteChange: (order: PriorityOrder, note: string) => void;
  busy: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: order.id, disabled: !canManage });

  const [noteDraft, setNoteDraft] = useState(order.daily_priority_note ?? "");
  useEffect(() => {
    setNoteDraft(order.daily_priority_note ?? "");
  }, [order.daily_priority_note]);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  const otherBucket: DailyPriorityBucket =
    order.daily_priority_bucket === "today" ? "tomorrow" : "today";

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex flex-col gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {canManage ? (
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
        ) : null}
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
          {index + 1}
        </span>
        <button
          type="button"
          onClick={() => onToggleDone(order)}
          disabled={busy}
          className="shrink-0 text-slate-500 hover:text-slate-700 disabled:opacity-50"
          aria-label={order.daily_priority_done ? "Mark not done" : "Mark done"}
          title={order.daily_priority_done ? "Mark not done" : "Mark done"}
        >
          {order.daily_priority_done ? (
            <CheckSquare className="h-4 w-4 text-emerald-600" />
          ) : (
            <Square className="h-4 w-4" />
          )}
        </button>
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-sm font-medium",
            order.daily_priority_done
              ? "text-slate-400 line-through"
              : "text-slate-800"
          )}
          title={orderLabel(order)}
        >
          {order.title}
          {orderLabel(order) !== order.title ? (
            <span className="font-normal text-slate-500"> — {orderLabel(order)}</span>
          ) : null}
        </span>
      </div>
      {canManage ? (
        <input
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
          onBlur={() => {
            if (noteDraft !== (order.daily_priority_note ?? "")) {
              onNoteChange(order, noteDraft);
            }
          }}
          placeholder="Note for the floor — e.g. 1000 pcs, hand run"
          className="ml-8 w-[calc(100%-2rem)] rounded border border-transparent bg-slate-50 px-2 py-1 text-xs text-slate-600 focus:border-blue-300 focus:bg-white focus:outline-none"
        />
      ) : order.daily_priority_note ? (
        <p className="ml-8 truncate text-xs text-slate-500" title={order.daily_priority_note}>
          {order.daily_priority_note}
        </p>
      ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 pl-8 sm:pl-0">
        <ProductionStageSelect
          orderId={order.id}
          stage={order.production_stage}
          className="text-[9px]"
        />
        {order.due_date ? (
          <span className="text-[11px] text-slate-400">Due {formatDate(order.due_date)}</span>
        ) : null}
        {canManage ? (
          <>
            <button
              type="button"
              onClick={() => onMoveBucket(order, otherBucket)}
              className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 hover:bg-slate-50"
              title={`Move to ${DAILY_PRIORITY_BUCKET_LABELS[otherBucket]}`}
            >
              → {DAILY_PRIORITY_BUCKET_LABELS[otherBucket]}
            </button>
            <button
              type="button"
              onClick={() => onRemove(order)}
              className="rounded p-1 text-slate-400 hover:bg-slate-50 hover:text-rose-600"
              title="Remove from priority list"
              aria-label="Remove from priority list"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </>
        ) : null}
      </div>
    </li>
  );
}

function AddOrderPanel({
  press,
  bucket,
  onAdded,
}: {
  press: PressType;
  bucket: DailyPriorityBucket;
  onAdded: (orderId: string, press: PressType, bucket: DailyPriorityBucket) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `/api/orders/priority-list?search=${encodeURIComponent(query.trim())}`,
          { cache: "no-store" }
        );
        const json = (await res.json().catch(() => ({}))) as { orders?: SearchResult[] };
        setResults(json.orders ?? []);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, open]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 py-1.5 text-xs font-medium text-slate-500 hover:border-slate-400 hover:text-slate-700"
      >
        <Plus className="h-3.5 w-3.5" />
        Add to {PRESS_LABELS[press]} — {DAILY_PRIORITY_BUCKET_LABELS[bucket]}
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
      <div className="mb-1.5 flex items-center gap-1.5">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search order # or customer…"
          className="h-8 flex-1 rounded border border-slate-300 bg-white px-2 text-xs focus:border-blue-400 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setQuery("");
            setResults([]);
          }}
          className="rounded p-1 text-slate-400 hover:bg-slate-100"
          aria-label="Cancel"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {searching ? (
        <p className="px-1 py-1 text-[11px] text-slate-400">Searching…</p>
      ) : results.length > 0 ? (
        <ul className="max-h-40 space-y-0.5 overflow-y-auto">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => {
                  onAdded(r.id, press, bucket);
                  setOpen(false);
                  setQuery("");
                  setResults([]);
                }}
                className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs hover:bg-white"
              >
                <span className="truncate">
                  {r.title}
                  {r.customer?.company || r.customer?.name ? (
                    <span className="text-slate-500">
                      {" "}
                      — {r.customer.company || r.customer.name}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : query.trim().length >= 2 ? (
        <p className="px-1 py-1 text-[11px] text-slate-400">No matches (or already on a list).</p>
      ) : null}
    </div>
  );
}

function PressColumn({
  press,
  orders,
  canManage,
  activeBucket,
  onBucketToggle,
  onReorder,
  onToggleDone,
  onMoveBucket,
  onRemove,
  onNoteChange,
  onAdded,
  busyIds,
}: {
  press: PressType;
  orders: PriorityOrder[];
  canManage: boolean;
  activeBucket: DailyPriorityBucket;
  onBucketToggle: (press: PressType, bucket: DailyPriorityBucket) => void;
  onReorder: (press: PressType, bucket: DailyPriorityBucket, orderedIds: string[]) => void;
  onToggleDone: (order: PriorityOrder) => void;
  onMoveBucket: (order: PriorityOrder, bucket: DailyPriorityBucket) => void;
  onRemove: (order: PriorityOrder) => void;
  onNoteChange: (order: PriorityOrder, note: string) => void;
  onAdded: (orderId: string, press: PressType, bucket: DailyPriorityBucket) => void;
  busyIds: Set<string>;
}) {
  const [copied, setCopied] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );
  const visible = orders.filter(
    (o) => o.press === press && o.daily_priority_bucket === activeBucket
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = visible.findIndex((o) => o.id === active.id);
    const newIndex = visible.findIndex((o) => o.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const next = arrayMove(visible, oldIndex, newIndex);
    onReorder(press, activeBucket, next.map((o) => o.id));
  }

  return (
    <div className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-800">
          {PRESS_LABELS[press]} Press
        </h2>
        <button
          type="button"
          onClick={() => {
            const text = visible.map(textLineFor).join("\n");
            void navigator.clipboard.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          disabled={visible.length === 0}
          className="flex items-center gap-1 rounded border border-slate-200 px-1.5 py-1 text-[10px] font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-40"
          title="Copy this list to text/send to production"
        >
          <Copy className="h-3 w-3" />
          {copied ? "Copied" : "Copy for text"}
        </button>
        <div className="flex h-7 items-stretch overflow-hidden rounded-md border border-slate-300 text-xs">
          {DAILY_PRIORITY_BUCKET_OPTIONS.map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => onBucketToggle(press, b)}
              className={cn(
                "px-2 font-medium transition-colors",
                activeBucket === b
                  ? "bg-slate-800 text-white"
                  : "bg-white text-slate-600 hover:bg-slate-50"
              )}
            >
              {DAILY_PRIORITY_BUCKET_LABELS[b]}
              {" "}
              (
              {orders.filter((o) => o.press === press && o.daily_priority_bucket === b).length}
              )
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-xs text-slate-500">
          Nothing queued for {DAILY_PRIORITY_BUCKET_LABELS[activeBucket]}.
        </p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={visible.map((o) => o.id)} strategy={verticalListSortingStrategy}>
            <ul className="space-y-1.5">
              {visible.map((o, i) => (
                <SortableRow
                  key={o.id}
                  order={o}
                  index={i}
                  canManage={canManage}
                  onToggleDone={onToggleDone}
                  onMoveBucket={onMoveBucket}
                  onRemove={onRemove}
                  onNoteChange={onNoteChange}
                  busy={busyIds.has(o.id)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {canManage ? (
        <div className="mt-2">
          <AddOrderPanel press={press} bucket={activeBucket} onAdded={onAdded} />
        </div>
      ) : null}
    </div>
  );
}

export function PriorityListBoard() {
  const [orders, setOrders] = useState<PriorityOrder[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeBucket, setActiveBucket] = useState<Record<PressType, DailyPriorityBucket>>({
    "6K": "today",
    "15K": "today",
  });
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const reorderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/orders/priority-list", { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as {
        orders?: PriorityOrder[];
        canManage?: boolean;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "Failed to load");
      setOrders(json.orders ?? []);
      setCanManage(Boolean(json.canManage));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setBusy = useCallback((id: string, busy: boolean) => {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const handleToggleDone = useCallback(
    async (order: PriorityOrder) => {
      const nextDone = !order.daily_priority_done;
      setOrders((prev) =>
        prev.map((o) => (o.id === order.id ? { ...o, daily_priority_done: nextDone } : o))
      );
      setBusy(order.id, true);
      try {
        const res = await fetch("/api/orders/priority-list/done", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: order.id, done: nextDone }),
        });
        if (!res.ok) throw new Error("Failed to save");
      } catch {
        // rollback
        setOrders((prev) =>
          prev.map((o) =>
            o.id === order.id ? { ...o, daily_priority_done: order.daily_priority_done } : o
          )
        );
      } finally {
        setBusy(order.id, false);
      }
    },
    [setBusy]
  );

  const patchAssignment = useCallback(
    async (updates: Array<{ orderId: string; press?: PressType | null; daily_priority_bucket?: DailyPriorityBucket | null; daily_priority_rank?: number | null; daily_priority_note?: string | null }>) => {
      await fetch("/api/orders/priority-list", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      });
    },
    []
  );

  const handleMoveBucket = useCallback(
    (order: PriorityOrder, bucket: DailyPriorityBucket) => {
      setOrders((prev) =>
        prev.map((o) =>
          o.id === order.id
            ? { ...o, daily_priority_bucket: bucket, daily_priority_done: false }
            : o
        )
      );
      void patchAssignment([
        { orderId: order.id, daily_priority_bucket: bucket, daily_priority_rank: 0 },
      ]);
    },
    [patchAssignment]
  );

  const handleRemove = useCallback(
    (order: PriorityOrder) => {
      setOrders((prev) => prev.filter((o) => o.id !== order.id));
      void patchAssignment([
        { orderId: order.id, daily_priority_bucket: null, daily_priority_rank: null },
      ]);
    },
    [patchAssignment]
  );

  const handleAdded = useCallback(
    (orderId: string, press: PressType, bucket: DailyPriorityBucket) => {
      const rank =
        orders.filter((o) => o.press === press && o.daily_priority_bucket === bucket).length;
      void patchAssignment([
        { orderId, press, daily_priority_bucket: bucket, daily_priority_rank: rank },
      ]).then(() => void load());
    },
    [orders, patchAssignment, load]
  );

  const handleNoteChange = useCallback(
    (order: PriorityOrder, note: string) => {
      const trimmed = note.trim() || null;
      setOrders((prev) =>
        prev.map((o) => (o.id === order.id ? { ...o, daily_priority_note: trimmed } : o))
      );
      void patchAssignment([{ orderId: order.id, daily_priority_note: trimmed }]);
    },
    [patchAssignment]
  );

  const handleReorder = useCallback(
    (press: PressType, bucket: DailyPriorityBucket, orderedIds: string[]) => {
      setOrders((prev) => {
        const rankById = new Map(orderedIds.map((id, i) => [id, i]));
        return prev.map((o) =>
          o.press === press && o.daily_priority_bucket === bucket && rankById.has(o.id)
            ? { ...o, daily_priority_rank: rankById.get(o.id)! }
            : o
        );
      });
      if (reorderTimer.current) clearTimeout(reorderTimer.current);
      reorderTimer.current = setTimeout(() => {
        void patchAssignment(
          orderedIds.map((id, i) => ({ orderId: id, daily_priority_rank: i }))
        );
      }, 300);
    },
    [patchAssignment]
  );

  const grouped = useMemo(() => orders, [orders]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <h1 className="mb-1 text-xl font-semibold text-slate-800">Priority List</h1>
      <p className="mb-4 text-sm text-slate-500">
        {canManage
          ? "Set and reorder what each press works today and tomorrow — drag to reorder."
          : "What each press is working today and tomorrow — check off jobs as you finish them."}
      </p>
      {error ? <p className="mb-3 text-sm text-rose-600">{error}</p> : null}
      <div className="flex flex-col gap-4 md:flex-row">
        {PRESS_OPTIONS.map((press) => (
          <PressColumn
            key={press}
            press={press}
            orders={grouped}
            canManage={canManage}
            activeBucket={activeBucket[press]}
            onBucketToggle={(p, b) => setActiveBucket((prev) => ({ ...prev, [p]: b }))}
            onReorder={handleReorder}
            onToggleDone={handleToggleDone}
            onMoveBucket={handleMoveBucket}
            onRemove={handleRemove}
            onNoteChange={handleNoteChange}
            onAdded={handleAdded}
            busyIds={busyIds}
          />
        ))}
      </div>
    </div>
  );
}
