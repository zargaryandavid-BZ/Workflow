"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";
import Image from "next/image";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type Modifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { cn, formatDateShort } from "@/lib/utils";
import type { CustomField, OrderWithRelations } from "@/lib/types";
import {
  customerNameFromOrder,
  productFromOrder,
} from "@/lib/notification-messages";
import { partCardTitle } from "@/lib/group-orders";
import { firstThumbnailUrl, type BoardThumbnail } from "@/lib/card-image";
import { notifyQueueChanged } from "@/lib/queue-events";
import { requestOrderMove } from "@/lib/orders/move-order-client";
import {
  columnPriorityMode,
  mergeSubsetOrder,
  moveIdToNumber,
  posByIdFromOrder,
  positionForMovedId,
  priorityGroupKey,
  priorityOptions,
  reorderAfterDrag,
  sortForColumnPriority,
} from "@/lib/list-column-priority";
import { formatShortOrderNumber } from "./order-number-label";

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

interface Props {
  columnId: string;
  columnName: string;
  /** Orders already narrowed to this column + the board's top filters. */
  orders: OrderWithRelations[];
  customFields: CustomField[];
  fieldValuesByOrder: Record<string, Record<string, unknown>>;
  thumbnailByOrder: Record<string, BoardThumbnail[]>;
  ownerNameByOrder: Record<string, string>;
  designerNameByOrder: Record<string, string>;
  /** Manager roles (admin / pre-prod owner / account manager). */
  canReorder: boolean;
  /** Manual-order columns: keep board state in sync after a move. */
  onPositionSaved?: (orderId: string, position: number) => void;
  onOpenOrder: (order: OrderWithRelations) => void;
  /** Still loading more cards of this column (shown as a hint). */
  loadingMore?: boolean;
}

const SAVE_DEBOUNCE_MS = 600;

/** Rows only move up/down (no sideways wobble). */
const restrictToVerticalAxis: Modifier = ({ transform }) => ({
  ...transform,
  x: 0,
});

/**
 * List view → one column, ordered like the Kanban shows it. One "Priority"
 * control (1..N for that designer's jobs), drag the whole row, ↑/↓ buttons. Reorders are optimistic, batched
 * (one save per designer / column after a short pause) and rolled back on
 * error.
 */
export function ColumnPriorityList({
  columnId,
  columnName,
  orders,
  customFields,
  fieldValuesByOrder,
  thumbnailByOrder,
  ownerNameByOrder,
  designerNameByOrder,
  canReorder,
  onPositionSaved,
  onOpenOrder,
  loadingMore,
}: Props) {
  const mode = columnPriorityMode(columnName);
  const isQueue = mode === "designer_queue" || mode === "prepress_queue";
  const readOnlyColumn = mode === "designer_queue_readonly";

  // Server-confirmed order per group (designer or "all").
  const baseGroups = useMemo(() => {
    const sorted = sortForColumnPriority(
      orders.map((o) => ({ ...o, specs: (o.specs ?? null) as Record<string, unknown> | null })),
      mode
    );
    const map = new Map<string, string[]>();
    for (const o of sorted) {
      const key = priorityGroupKey(o, mode);
      const list = map.get(key) ?? [];
      list.push(o.id);
      map.set(key, list);
    }
    return map;
  }, [orders, mode]);

  const orderById = useMemo(() => {
    const m = new Map<string, OrderWithRelations>();
    orders.forEach((o) => m.set(o.id, o));
    return m;
  }, [orders]);

  // Optimistic local order per group until the save lands.
  const [override, setOverride] = useState<Record<string, string[]>>({});
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const versionRef = useRef(new Map<string, number>());
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const overrideRef = useRef(override);
  overrideRef.current = override;
  // Manual-order columns: positions we just saved (board state may lag).
  const savedPositionRef = useRef(new Map<string, number>());

  // Switching column drops any unsaved local order.
  useEffect(() => {
    const timers = timersRef.current;
    savedPositionRef.current.clear();
    setOverride({});
    setSaveState({ kind: "idle" });
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, [columnId]);

  const groupIds = useCallback(
    (key: string): string[] => {
      const base = baseGroups.get(key) ?? [];
      const local = override[key];
      if (!local) return base;
      const baseSet = new Set(base);
      const kept = local.filter((id) => baseSet.has(id));
      const keptSet = new Set(kept);
      return [...kept, ...base.filter((id) => !keptSet.has(id))];
    },
    [baseGroups, override]
  );

  const groupKeys = useMemo(() => {
    const keys = Array.from(baseGroups.keys());
    return keys.sort((a, b) => {
      if (!a) return 1; // "No designer" last
      if (!b) return -1;
      const an = designerLabel(a);
      const bn = designerLabel(b);
      return an.localeCompare(bn);
    });
    function designerLabel(key: string): string {
      const first = baseGroups.get(key)?.[0];
      return (first && designerNameByOrder[first]) || "";
    }
  }, [baseGroups, designerNameByOrder]);

  const groupEditable = useCallback(
    (key: string) => {
      if (!canReorder || readOnlyColumn) return false;
      if (mode === "designer_queue" && !key) return false; // no designer
      return true;
    },
    [canReorder, readOnlyColumn, mode]
  );

  async function saveGroup(key: string, version: number, movedId: string) {
    const ids = overrideRef.current[key];
    if (!ids) return;
    setSaveState({ kind: "saving" });
    try {
      if (mode === "manual_position") {
        const positions: Record<string, number> = {};
        for (const id of ids) {
          positions[id] =
            savedPositionRef.current.get(id) ?? orderById.get(id)?.position ?? 0;
        }
        const position = positionForMovedId(ids, movedId, positions);
        if (position == null) return;
        const result = await requestOrderMove({
          orderId: movedId,
          toColumnId: columnId,
          position,
        });
        if (!result.ok) throw new Error(result.error ?? "Could not save order");
        savedPositionRef.current.set(movedId, position);
        onPositionSaved?.(movedId, position);
      } else {
        // Load the FULL queue so hidden (filtered-out / not loaded) cards keep
        // their place and nobody's number collides.
        const designerId = mode === "designer_queue" ? key : undefined;
        const listUrl =
          mode === "prepress_queue"
            ? "/api/prepress/queue"
            : `/api/designers/queue?designer_id=${encodeURIComponent(designerId ?? "")}`;
        const listRes = await fetch(listUrl, { cache: "no-store" });
        const listJson = (await listRes.json().catch(() => ({}))) as {
          orders?: { id: string }[];
          error?: string;
        };
        if (!listRes.ok) throw new Error(listJson.error ?? "Could not load queue");
        const fullIds = (listJson.orders ?? []).map((o) => o.id);
        const merged = mergeSubsetOrder(fullIds, ids);
        if (merged.length === 0) return;
        const res = await fetch(
          mode === "prepress_queue" ? "/api/prepress/queue" : "/api/designers/queue",
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              mode === "prepress_queue"
                ? { order_ids: merged }
                : { designer_id: designerId, order_ids: merged }
            ),
          }
        );
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(json.error ?? "Could not save order");
        // Updates every #N badge on the board (orders + filtered results).
        notifyQueueChanged({
          kind: mode === "prepress_queue" ? "prepress" : "designer",
          designerId,
          posById: posByIdFromOrder(merged),
        });
      }
      if (versionRef.current.get(key) === version) {
        setOverride((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        setSaveState({ kind: "saved" });
      }
    } catch (err) {
      // Roll back to the last saved order.
      if (versionRef.current.get(key) === version) {
        setOverride((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }
      setSaveState({
        kind: "error",
        message: err instanceof Error ? err.message : "Could not save order",
      });
    }
  }

  function applyMove(key: string, nextIds: string[], movedId: string) {
    if (!groupEditable(key)) return;
    const current = groupIds(key);
    if (nextIds.join() === current.join()) return;
    setOverride((prev) => ({ ...prev, [key]: nextIds }));
    overrideRef.current = { ...overrideRef.current, [key]: nextIds };
    const version = (versionRef.current.get(key) ?? 0) + 1;
    versionRef.current.set(key, version);
    setSaveState({ kind: "saving" });

    const run = () => {
      chainRef.current = chainRef.current.then(() =>
        saveGroup(key, version, movedId)
      );
    };
    // Manual order is one write per move — save right away. Queues are
    // renumbered in one batch after a short pause (rapid ↑/↓ = one save).
    if (mode === "manual_position") {
      run();
      return;
    }
    const existing = timersRef.current.get(key);
    if (existing) clearTimeout(existing);
    timersRef.current.set(
      key,
      setTimeout(() => {
        timersRef.current.delete(key);
        if (versionRef.current.get(key) === version) run();
      }, SAVE_DEBOUNCE_MS)
    );
  }

  // Mouse: drag the whole row after a small move (a plain click still opens
  // the order). Touch: press-and-hold so the list can still scroll.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 6 },
    })
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  // The click that ends a drag must not open the order.
  const suppressClickUntilRef = useRef(0);

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(key: string, event: DragEndEvent) {
    setActiveId(null);
    suppressClickUntilRef.current = Date.now() + 250;
    const { active, over } = event;
    const ids = groupIds(key);
    const next = reorderAfterDrag(
      ids,
      String(active.id),
      over ? String(over.id) : null
    );
    if (next !== ids) applyMove(key, next, String(active.id));
  }

  const total = orders.length;
  const showGroupHeaders =
    (mode === "designer_queue" || readOnlyColumn) && groupKeys.length > 0;
  const activeOrder = activeId ? orderById.get(activeId) ?? null : null;

  const rowProps = (id: string) => ({
    customFields,
    fieldValues: fieldValuesByOrder[id] ?? {},
    thumb: firstThumbnailUrl(thumbnailByOrder[id]) ?? null,
    owner: ownerNameByOrder[id] ?? "",
    designer: designerNameByOrder[id] ?? "",
  });

  return (
    <div className="min-w-[900px]">
      <div className="mb-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
        <span>
          {total} order{total === 1 ? "" : "s"} in {columnName}
          {loadingMore ? " · loading more…" : ""}
        </span>
        <span className="text-slate-400">
          {readOnlyColumn
            ? "Queue order (shared with Start) — reorder from the Start column."
            : isQueue
              ? mode === "designer_queue"
                ? "Priority 1 = top of each designer's queue. Drag a row, use ↑/↓, or pick a number."
                : "Priority 1 = top of the prepress queue. Drag a row, use ↑/↓, or pick a number."
              : "Manual order (1 = top). Kanban shows this order when the column sort is “Manual order”."}
        </span>
        {!canReorder && !readOnlyColumn ? (
          <span className="text-amber-600">Only a manager can change the order.</span>
        ) : null}
        <SaveIndicator state={saveState} />
      </div>

      <div
        className={cn(
          GRID,
          "sticky top-0 z-10 border-b border-slate-200 bg-white py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500"
        )}
      >
        <span />
        <span>Priority</span>
        <span />
        <span>Order</span>
        <span>Customer</span>
        <span>Item</span>
        <span>Designer</span>
        <span>Owner</span>
        <span>Due</span>
      </div>

      {groupKeys.map((key) => {
        const ids = groupIds(key);
        const editable = groupEditable(key);
        const firstId = ids[0];
        const label =
          mode === "designer_queue" || readOnlyColumn
            ? key
              ? (firstId && designerNameByOrder[firstId]) || "Designer"
              : "No designer"
            : null;
        return (
          <DndContext
            key={key || "none"}
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragStart={handleDragStart}
            onDragCancel={() => setActiveId(null)}
            onDragEnd={(e) => handleDragEnd(key, e)}
          >
            {showGroupHeaders ? (
              <div className="border-b border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700">
                {label}{" "}
                <span className="font-normal text-slate-400">
                  · {ids.length} job{ids.length === 1 ? "" : "s"}
                </span>
                {mode === "designer_queue" && !key ? (
                  <span className="ml-2 font-normal text-slate-400">
                    Assign a designer to put these in a queue.
                  </span>
                ) : null}
              </div>
            ) : null}
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
              <div>
                {ids.map((id, index) => {
                  const order = orderById.get(id);
                  if (!order) return null;
                  return (
                    <PriorityRow
                      key={id}
                      order={order}
                      index={index}
                      count={ids.length}
                      editable={editable}
                      {...rowProps(id)}
                      onOpen={() => {
                        if (Date.now() < suppressClickUntilRef.current) return;
                        onOpenOrder(order);
                      }}
                      onMoveTo={(oneBased) =>
                        applyMove(key, moveIdToNumber(ids, id, oneBased), id)
                      }
                    />
                  );
                })}
              </div>
            </SortableContext>
            <DragOverlay>
              {activeOrder && ids.includes(activeOrder.id) ? (
                <RowContent
                  order={activeOrder}
                  index={ids.indexOf(activeOrder.id)}
                  count={ids.length}
                  editable={false}
                  overlay
                  {...rowProps(activeOrder.id)}
                />
              ) : null}
            </DragOverlay>
          </DndContext>
        );
      })}
      {total === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-slate-400">
          No orders in this column for the current filters.
        </p>
      ) : null}
    </div>
  );
}

/** Columns: handle | priority | ↑↓ | order | customer | item | designer | owner | due */
const GRID =
  "grid grid-cols-[28px_76px_56px_minmax(180px,1.2fr)_minmax(120px,1fr)_minmax(140px,1.4fr)_110px_110px_90px] items-center gap-x-2 px-2";

const THUMB_PX = 72;

function SaveIndicator({ state }: { state: SaveState }) {
  if (state.kind === "idle") return null;
  if (state.kind === "saving") {
    return <span className="ml-auto font-medium text-slate-500">Saving…</span>;
  }
  if (state.kind === "saved") {
    return <span className="ml-auto font-medium text-emerald-600">Saved ✓</span>;
  }
  return (
    <span className="ml-auto font-medium text-rose-600">
      Not saved — {state.message}
    </span>
  );
}

interface ContentProps {
  order: OrderWithRelations;
  index: number;
  count: number;
  editable: boolean;
  customFields: CustomField[];
  fieldValues: Record<string, unknown>;
  thumb: string | null;
  owner: string;
  designer: string;
  onMoveTo?: (oneBased: number) => void;
  /** Floating copy shown under the pointer while dragging. */
  overlay?: boolean;
}

/** Stop pointer/click on controls so they never start a drag or open the order. */
const stopAll = {
  onPointerDown: (e: SyntheticEvent) => e.stopPropagation(),
  onMouseDown: (e: SyntheticEvent) => e.stopPropagation(),
  onTouchStart: (e: SyntheticEvent) => e.stopPropagation(),
  onClick: (e: SyntheticEvent) => e.stopPropagation(),
  onKeyDown: (e: SyntheticEvent) => e.stopPropagation(),
};

function RowContent({
  order,
  index,
  count,
  editable,
  customFields,
  fieldValues,
  thumb,
  owner,
  designer,
  onMoveTo,
  overlay,
}: ContentProps) {
  const product = productFromOrder(fieldValues, customFields);
  const customer = customerNameFromOrder(order, fieldValues, customFields);
  const item = partCardTitle(order, product) || product;
  const rank = index + 1;

  return (
    <div
      className={cn(
        GRID,
        "min-h-[84px] border-b border-slate-100 bg-white py-1.5 text-sm",
        overlay && "rounded-md border border-blue-300 shadow-xl ring-2 ring-blue-200"
      )}
    >
      <span
        className="flex h-full items-center justify-center text-slate-400"
        title={editable || overlay ? "Drag to reorder" : undefined}
      >
        {editable || overlay ? <GripVertical className="h-5 w-5" /> : null}
      </span>

      <span {...stopAll}>
        {editable && onMoveTo ? (
          <select
            value={rank}
            onChange={(e) => onMoveTo(Number(e.target.value))}
            aria-label={`Priority of ${order.title} (1 = top)`}
            title={`Priority ${rank} of ${count} — pick a number to move this job`}
            className="h-8 w-[68px] cursor-pointer rounded-md border border-slate-300 bg-white px-1.5 text-sm font-bold tabular-nums text-slate-800 focus:border-blue-400 focus:outline-none"
          >
            {priorityOptions(count).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        ) : (
          <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-slate-800 px-1.5 text-xs font-bold tabular-nums text-white">
            {rank}
          </span>
        )}
      </span>

      <span className="inline-flex gap-0.5" {...stopAll}>
        {editable && onMoveTo ? (
          <>
            <button
              type="button"
              disabled={index === 0}
              onClick={() => onMoveTo(index)}
              className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30"
              aria-label="Move up"
              title="Move up"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
            <button
              type="button"
              disabled={index === count - 1}
              onClick={() => onMoveTo(index + 2)}
              className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30"
              aria-label="Move down"
              title="Move down"
            >
              <ArrowDown className="h-4 w-4" />
            </button>
          </>
        ) : null}
      </span>

      <span className="inline-flex min-w-0 items-center gap-2 font-semibold text-slate-800">
        <span
          className="flex shrink-0 items-center justify-center overflow-hidden rounded bg-slate-50"
          style={{ width: THUMB_PX, height: THUMB_PX }}
        >
          {thumb ? (
            <Image
              src={thumb}
              alt=""
              width={THUMB_PX}
              height={THUMB_PX}
              unoptimized
              loading="lazy"
              draggable={false}
              className="max-h-full max-w-full object-contain"
            />
          ) : null}
        </span>
        <span className="truncate">{formatShortOrderNumber(order.title)}</span>
      </span>
      <span className="truncate text-slate-700">
        {customer === "there" ? "" : customer}
      </span>
      <span className="truncate text-slate-700">{item}</span>
      <span className="truncate text-slate-600">{designer}</span>
      <span className="truncate text-slate-600">{owner}</span>
      <span className="whitespace-nowrap text-slate-600">
        {order.due_date ? formatDateShort(order.due_date) : "—"}
      </span>
    </div>
  );
}

interface RowProps extends Omit<ContentProps, "overlay" | "onMoveTo"> {
  onOpen: () => void;
  onMoveTo: (oneBased: number) => void;
}

/**
 * Whole row is the drag target (mouse: move 4px; touch: press-and-hold).
 * Plain <div> rows, not <tr> — Safari doesn't move table rows with
 * transforms, which is why the old handle-only drag didn't work there.
 * While dragging, the row's slot shows as a blue dashed drop placeholder.
 */
function PriorityRow({ onOpen, ...props }: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: props.order.id, disabled: !props.editable });

  return (
    <div
      ref={setNodeRef}
      data-order-id={props.order.id}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      className={cn(
        "relative select-none",
        props.editable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
        "hover:[&>div]:bg-slate-50",
        isDragging &&
          "z-10 [&>div]:border-2 [&>div]:border-dashed [&>div]:border-blue-400 [&>div]:!bg-blue-50 [&>div>*]:opacity-30"
      )}
    >
      <RowContent {...props} />
    </div>
  );
}
