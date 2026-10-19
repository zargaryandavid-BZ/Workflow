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
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
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
import {
  PRIORITY_SCORES,
  priorityScoreFromSpecs,
  parsePriorityScore,
  type PriorityScore,
} from "@/lib/order-priority-score";
import { notifyQueueChanged } from "@/lib/queue-events";
import { requestOrderMove } from "@/lib/orders/move-order-client";
import {
  columnPriorityMode,
  mergeSubsetOrder,
  moveId,
  moveIdToNumber,
  posByIdFromOrder,
  positionForMovedId,
  priorityGroupKey,
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
  onSetPriorityScore?: (
    order: OrderWithRelations,
    score: PriorityScore | null
  ) => void;
  /** Manual-order columns: keep board state in sync after a move. */
  onPositionSaved?: (orderId: string, position: number) => void;
  onOpenOrder: (order: OrderWithRelations) => void;
  /** Still loading more cards of this column (shown as a hint). */
  loadingMore?: boolean;
}

const SAVE_DEBOUNCE_MS = 600;

/**
 * List view → one column, ordered like the Kanban shows it, with an editable
 * "#" (1 = top), drag handle and ↑/↓ buttons. Reorders are optimistic, batched
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
  onSetPriorityScore,
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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  function handleDragEnd(key: string, event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = groupIds(key);
    const to = ids.indexOf(String(over.id));
    if (to === -1) return;
    applyMove(key, moveId(ids, String(active.id), to), String(active.id));
  }

  const total = orders.length;
  const showGroupHeaders =
    (mode === "designer_queue" || readOnlyColumn) && groupKeys.length > 0;

  return (
    <div className="min-w-0">
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
                ? "#1 = top of each designer's queue. Drag, use ↑/↓, or type a number."
                : "#1 = top of the prepress queue. Drag, use ↑/↓, or type a number."
              : "Manual order (#1 = top). Kanban shows this order when the column sort is “Manual order”."}
        </span>
        {!canReorder && !readOnlyColumn ? (
          <span className="text-amber-600">Only a manager can change the order.</span>
        ) : null}
        <SaveIndicator state={saveState} />
      </div>

      <table className="w-full min-w-[900px] border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-10 bg-white">
          <tr>
            {["", "#", "", "Priority", "Order", "Customer", "Item", "Designer", "Owner", "Due"].map(
              (h, i) => (
                <th
                  key={i}
                  className="border-b border-slate-200 px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500"
                >
                  {h}
                </th>
              )
            )}
          </tr>
        </thead>
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
              onDragEnd={(e) => handleDragEnd(key, e)}
            >
              <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                <tbody>
                  {showGroupHeaders ? (
                    <tr className="bg-slate-50">
                      <td
                        colSpan={10}
                        className="border-b border-t border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700"
                      >
                        {label}{" "}
                        <span className="font-normal text-slate-400">· {ids.length}</span>
                        {mode === "designer_queue" && !key ? (
                          <span className="ml-2 font-normal text-slate-400">
                            Assign a designer to put these in a queue.
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ) : null}
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
                        customFields={customFields}
                        fieldValues={fieldValuesByOrder[id] ?? {}}
                        thumb={firstThumbnailUrl(thumbnailByOrder[id]) ?? null}
                        owner={ownerNameByOrder[id] ?? ""}
                        designer={designerNameByOrder[id] ?? ""}
                        onSetPriorityScore={onSetPriorityScore}
                        onOpen={() => onOpenOrder(order)}
                        onMoveTo={(oneBased) =>
                          applyMove(key, moveIdToNumber(ids, id, oneBased), id)
                        }
                      />
                    );
                  })}
                </tbody>
              </SortableContext>
            </DndContext>
          );
        })}
      </table>
      {total === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-slate-400">
          No orders in this column for the current filters.
        </p>
      ) : null}
    </div>
  );
}

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

interface RowProps {
  order: OrderWithRelations;
  index: number;
  count: number;
  editable: boolean;
  customFields: CustomField[];
  fieldValues: Record<string, unknown>;
  thumb: string | null;
  owner: string;
  designer: string;
  onSetPriorityScore?: (
    order: OrderWithRelations,
    score: PriorityScore | null
  ) => void;
  onOpen: () => void;
  onMoveTo: (oneBased: number) => void;
}

function PriorityRow({
  order,
  index,
  count,
  editable,
  customFields,
  fieldValues,
  thumb,
  owner,
  designer,
  onSetPriorityScore,
  onOpen,
  onMoveTo,
}: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: order.id, disabled: !editable });
  const [draft, setDraft] = useState(String(index + 1));
  useEffect(() => setDraft(String(index + 1)), [index]);

  const product = productFromOrder(fieldValues, customFields);
  const customer = customerNameFromOrder(order, fieldValues, customFields);
  const item = partCardTitle(order, product) || product;
  const score = priorityScoreFromSpecs(order.specs);

  function commitDraft() {
    const n = Math.floor(Number(draft));
    if (!Number.isFinite(n) || n < 1 || n === index + 1) {
      setDraft(String(index + 1));
      return;
    }
    onMoveTo(n);
  }

  const stop = (e: SyntheticEvent) => e.stopPropagation();

  return (
    <tr
      ref={setNodeRef}
      data-order-id={order.id}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onClick={onOpen}
      className={cn(
        "cursor-pointer border-b border-slate-100 bg-white hover:bg-slate-50",
        isDragging && "relative z-20 shadow-md"
      )}
    >
      <td className="w-6 px-1 py-1.5" onClick={stop}>
        {editable ? (
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="cursor-grab touch-none rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 active:cursor-grabbing"
            aria-label={`Drag ${order.title}`}
            title="Drag to reorder"
          >
            <GripVertical className="h-4 w-4" />
          </button>
        ) : null}
      </td>
      <td className="w-14 px-1 py-1.5" onClick={stop}>
        {editable ? (
          <input
            type="number"
            min={1}
            max={count}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setDraft(String(index + 1));
            }}
            aria-label={`Position of ${order.title}`}
            className="h-7 w-12 rounded border border-slate-300 px-1 text-center text-sm font-bold tabular-nums focus:border-blue-400 focus:outline-none"
          />
        ) : (
          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-slate-800 px-1 text-[11px] font-bold tabular-nums text-white">
            {index + 1}
          </span>
        )}
      </td>
      <td className="w-14 whitespace-nowrap px-1 py-1.5" onClick={stop}>
        {editable ? (
          <span className="inline-flex gap-0.5">
            <button
              type="button"
              disabled={index === 0}
              onClick={() => onMoveTo(index)}
              className="rounded p-0.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30"
              aria-label="Move up"
              title="Move up"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
            <button
              type="button"
              disabled={index === count - 1}
              onClick={() => onMoveTo(index + 2)}
              className="rounded p-0.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30"
              aria-label="Move down"
              title="Move down"
            >
              <ArrowDown className="h-4 w-4" />
            </button>
          </span>
        ) : null}
      </td>
      <td className="w-20 px-1 py-1.5" onClick={stop}>
        {onSetPriorityScore ? (
          <select
            value={score ?? ""}
            onChange={(e) =>
              onSetPriorityScore(order, parsePriorityScore(e.target.value))
            }
            aria-label={`Priority score of ${order.title}`}
            title="Priority score (1–5, 5 = key account)"
            className="h-7 rounded border border-slate-300 bg-white px-1 text-sm tabular-nums"
          >
            <option value="">—</option>
            {PRIORITY_SCORES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-slate-600 tabular-nums">{score ?? "—"}</span>
        )}
      </td>
      <td className="whitespace-nowrap px-2 py-1.5 font-semibold text-slate-800">
        <span className="inline-flex items-center gap-2">
          {thumb ? (
            <Image
              src={thumb}
              alt=""
              width={24}
              height={24}
              unoptimized
              className="h-6 w-6 shrink-0 rounded object-cover"
            />
          ) : null}
          {formatShortOrderNumber(order.title)}
        </span>
      </td>
      <td className="max-w-[180px] truncate px-2 py-1.5 text-slate-700">
        {customer === "there" ? "" : customer}
      </td>
      <td className="max-w-[220px] truncate px-2 py-1.5 text-slate-700">{item}</td>
      <td className="whitespace-nowrap px-2 py-1.5 text-slate-600">{designer}</td>
      <td className="whitespace-nowrap px-2 py-1.5 text-slate-600">{owner}</td>
      <td className="whitespace-nowrap px-2 py-1.5 text-slate-600">
        {order.due_date ? formatDateShort(order.due_date) : "—"}
      </td>
    </tr>
  );
}
