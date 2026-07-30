"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Plus, X } from "lucide-react";
import {
  FAST_ACTION_COLOR_CLASSES,
  isFastActionButtonColor,
} from "@/lib/fast-action-buttons";
import { cn } from "@/lib/utils";
import type { BoardColumn, FastActionButton } from "@/lib/types";

export type CreateFastActionDefaults = {
  /** Column where the new button should appear (card is in). */
  showInColumnId: string;
  /** Prefill move-to destination + name from a board column. */
  destinationColumnId?: string;
  name?: string;
};

interface Props {
  columns: BoardColumn[];
  buttons: FastActionButton[];
  disabled?: boolean;
  onButtonsChange: (
    next:
      | FastActionButton[]
      | ((prev: FastActionButton[]) => FastActionButton[])
  ) => void;
  onCreateForColumn: (defaults: CreateFastActionDefaults) => void;
}

/** Whether the button is assigned to appear when a card is in `columnId`. */
function showsInColumn(btn: FastActionButton, columnId: string): boolean {
  if (btn.destination_column_id === columnId) return false;
  if (btn.show_in_columns.length === 0) return true;
  return btn.show_in_columns.includes(columnId);
}

/**
 * Empty `show_in_columns` means all columns. After edits we keep that
 * convention, or expand to an explicit list. Using only the destination id
 * means "nowhere" (destination is always auto-hidden on cards).
 */
function showNowhereIds(btn: FastActionButton): string[] {
  return btn.destination_column_id ? [btn.destination_column_id] : [];
}

function nextAfterRemove(
  btn: FastActionButton,
  columnId: string,
  columns: BoardColumn[]
): string[] {
  const dest = btn.destination_column_id;
  const eligible = columns
    .map((c) => c.id)
    .filter((id) => id !== dest && id !== columnId);

  if (btn.show_in_columns.length === 0) {
    // Was "all columns" → every eligible column except the one removed.
    return eligible.length > 0 ? eligible : showNowhereIds(btn);
  }

  const next = btn.show_in_columns.filter((id) => id !== columnId);
  if (next.length === 0) return showNowhereIds(btn);
  // Drop destination if it was somehow listed.
  return next.filter((id) => id !== dest);
}

function nextAfterAdd(
  btn: FastActionButton,
  columnId: string,
  columns: BoardColumn[]
): string[] {
  if (btn.destination_column_id === columnId) return btn.show_in_columns;

  // Already on all columns.
  if (btn.show_in_columns.length === 0) return btn.show_in_columns;

  const dest = btn.destination_column_id;
  const isNowhere =
    dest != null &&
    btn.show_in_columns.length === 1 &&
    btn.show_in_columns[0] === dest;

  if (isNowhere) return [columnId];

  if (btn.show_in_columns.includes(columnId)) return btn.show_in_columns;

  // If the explicit list already covers every other eligible column, adding
  // the last one is equivalent to "all".
  const eligible = columns
    .map((c) => c.id)
    .filter((id) => id !== dest);
  const next = [...new Set([...btn.show_in_columns, columnId])].filter(
    (id) => id !== dest
  );
  if (
    eligible.length > 0 &&
    eligible.every((id) => next.includes(id))
  ) {
    return [];
  }
  return next;
}

export function FastActionByColumnMatrix({
  columns,
  buttons,
  disabled = false,
  onButtonsChange,
  onCreateForColumn,
}: Props) {
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openAddFor, setOpenAddFor] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, maxHeight: 320 });
  const [mounted, setMounted] = useState(false);
  const addMenuRef = useRef<HTMLDivElement | null>(null);
  const addButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  useEffect(() => setMounted(true), []);

  function placeMenu(columnId: string) {
    const btn = addButtonRefs.current.get(columnId);
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const menuWidth = 320; // w-80
    const pad = 8;
    let left = rect.left;
    if (left + menuWidth > window.innerWidth - pad) {
      left = Math.max(pad, window.innerWidth - menuWidth - pad);
    }

    const spaceBelow = window.innerHeight - rect.bottom - pad;
    const spaceAbove = rect.top - pad;
    const preferBelow = spaceBelow >= 220 || spaceBelow >= spaceAbove;
    const maxHeight = Math.min(
      420,
      Math.max(180, preferBelow ? spaceBelow - 4 : spaceAbove - 4)
    );
    const top = preferBelow
      ? rect.bottom + 4
      : Math.max(pad, rect.top - maxHeight - 4);

    setMenuPos({ top, left, maxHeight });
  }

  function openAddMenu(columnId: string) {
    placeMenu(columnId);
    setOpenAddFor(columnId);
  }

  useLayoutEffect(() => {
    if (!openAddFor) return;
    placeMenu(openAddFor);
  }, [openAddFor]);

  useEffect(() => {
    if (!openAddFor) return;
    function onDoc(e: MouseEvent) {
      const target = e.target as Node;
      if (addMenuRef.current?.contains(target)) return;
      const trigger = addButtonRefs.current.get(openAddFor);
      if (trigger?.contains(target)) return;
      setOpenAddFor(null);
    }
    function onReposition() {
      placeMenu(openAddFor);
    }
    function onOutsideScroll(e: Event) {
      // Keep menu scrollable — only close when the page/table scrolls underneath.
      const target = e.target as Node | null;
      if (target && addMenuRef.current?.contains(target)) return;
      setOpenAddFor(null);
    }
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onOutsideScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onOutsideScroll, true);
    };
  }, [openAddFor]);

  const columnNameById = useMemo(
    () => new Map(columns.map((c) => [c.id, c.name])),
    [columns]
  );

  const openColumn = openAddFor
    ? columns.find((c) => c.id === openAddFor) ?? null
    : null;

  /** Move-to destinations not already shown on the open row (includes columns with no button yet). */
  const openDestinations = useMemo(() => {
    if (!openAddFor) return [];
    return columns
      .filter((c) => c.id !== openAddFor)
      .map((dest) => {
        const matching = buttons.filter(
          (b) => b.destination_column_id === dest.id
        );
        // Any button to this dest already on the row → hide the option
        // (avoids duplicate destinations when multiple buttons share a target).
        const alreadyShown = matching.some((b) =>
          showsInColumn(b, openAddFor)
        );
        // Prefer attaching a button that isn't on this column yet.
        const existing =
          matching.find((b) => !showsInColumn(b, openAddFor)) ?? null;
        return { dest, existing, alreadyShown };
      })
      .filter((row) => !row.alreadyShown)
      .sort((a, b) => a.dest.name.localeCompare(b.dest.name));
  }, [openAddFor, columns, buttons]);

  async function persistShowIn(
    btn: FastActionButton,
    show_in_columns: string[]
  ) {
    const previous = buttons;
    setPendingKey(btn.id);
    setError(null);

    const optimistic = { ...btn, show_in_columns };
    onButtonsChange((prev) =>
      prev.map((b) => (b.id === btn.id ? optimistic : b))
    );

    const res = await fetch(`/api/fast-action-buttons/${btn.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ show_in_columns }),
    });

    setPendingKey(null);
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      setError(json.error ?? "Failed to update button");
      onButtonsChange(previous);
      return;
    }
    const json = (await res.json()) as { button: FastActionButton };
    onButtonsChange((prev) =>
      prev.map((b) => (b.id === btn.id ? json.button : b))
    );
  }

  async function removeFromColumn(btn: FastActionButton, columnId: string) {
    if (disabled || pendingKey) return;
    await persistShowIn(btn, nextAfterRemove(btn, columnId, columns));
  }

  async function addToColumn(btn: FastActionButton, columnId: string) {
    if (disabled || pendingKey) return;
    setOpenAddFor(null);
    await persistShowIn(btn, nextAfterAdd(btn, columnId, columns));
  }

  /** Attach an existing button, or create one that moves to `dest`. */
  async function addDestination(
    dest: BoardColumn,
    existing: FastActionButton | null,
    showInColumnId: string
  ) {
    if (disabled || pendingKey) return;
    setOpenAddFor(null);

    if (existing) {
      await addToColumn(existing, showInColumnId);
      return;
    }

    const pendingId = `new:${dest.id}`;
    setPendingKey(pendingId);
    setError(null);

    const res = await fetch("/api/fast-action-buttons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: dest.name,
        color: "blue",
        destination_column_id: dest.id,
        show_in_columns: [showInColumnId],
      }),
    });

    setPendingKey(null);
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      setError(json.error ?? "Failed to create button");
      return;
    }
    const json = (await res.json()) as { button: FastActionButton };
    onButtonsChange((prev) => [...prev, json.button]);
  }

  if (columns.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 py-10 text-center text-sm text-slate-500">
        Add board columns first, then assign fast action buttons per stage.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">
        Each row is a board column. Chips are buttons shown when a card is in
        that column. Remove a chip to hide it there, or add an existing button /
        create a new one.
      </p>

      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}

      <div className="overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="sticky left-0 z-10 w-48 bg-slate-50 px-3 py-2.5 text-xs font-semibold text-slate-600">
                Card is in
              </th>
              <th className="px-3 py-2.5 text-xs font-semibold text-slate-600">
                Show button
              </th>
            </tr>
          </thead>
          <tbody>
            {columns.map((col) => {
              const shown = buttons.filter((b) => showsInColumn(b, col.id));
              const menuOpen = openAddFor === col.id;

              return (
                <tr
                  key={col.id}
                  className="border-b border-slate-100 last:border-b-0"
                >
                  <td className="sticky left-0 z-10 bg-white px-3 py-3 align-top shadow-[1px_0_0_0_rgb(226_232_240)]">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-6 w-1 shrink-0 rounded-full"
                        style={{ background: col.color ?? "#94a3b8" }}
                        aria-hidden
                      />
                      <span className="font-medium text-slate-800">
                        {col.name}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {shown.length === 0 ? (
                        <span className="text-xs text-slate-400">
                          No buttons
                        </span>
                      ) : null}
                      {shown.map((btn) => {
                        const color = isFastActionButtonColor(btn.color)
                          ? btn.color
                          : "blue";
                        const destName =
                          columnNameById.get(
                            btn.destination_column_id ?? ""
                          ) ?? "—";
                        const busy =
                          pendingKey === btn.id ||
                          pendingKey === `new:${btn.destination_column_id}`;
                        return (
                          <span
                            key={btn.id}
                            className={cn(
                              "inline-flex max-w-full items-center gap-1 rounded-full px-2 py-1 text-xs font-medium",
                              FAST_ACTION_COLOR_CLASSES[color],
                              (busy || !btn.enabled) && "opacity-60"
                            )}
                            title={
                              btn.enabled
                                ? `Moves to ${destName}`
                                : `Moves to ${destName} (disabled)`
                            }
                          >
                            {busy ? (
                              <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                            ) : null}
                            <span className="truncate">{btn.name}</span>
                            <button
                              type="button"
                              disabled={disabled || !!pendingKey}
                              onClick={() =>
                                void removeFromColumn(btn, col.id)
                              }
                              className="ml-0.5 rounded-full p-0.5 hover:bg-black/10 disabled:opacity-40"
                              aria-label={`Remove ${btn.name} from ${col.name}`}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        );
                      })}

                      <button
                        type="button"
                        ref={(el) => {
                          if (el) addButtonRefs.current.set(col.id, el);
                          else addButtonRefs.current.delete(col.id);
                        }}
                        disabled={disabled}
                        onClick={() =>
                          menuOpen ? setOpenAddFor(null) : openAddMenu(col.id)
                        }
                        className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 px-2 py-1 text-xs font-medium text-slate-500 hover:border-slate-400 hover:bg-slate-50 hover:text-slate-700 disabled:opacity-40"
                      >
                        <Plus className="h-3 w-3" />
                        Add
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {mounted && openAddFor && openColumn
        ? createPortal(
            <div
              ref={addMenuRef}
              style={{
                top: menuPos.top,
                left: menuPos.left,
                maxHeight: menuPos.maxHeight,
              }}
              className="fixed z-[200] w-80 overflow-y-auto overscroll-contain rounded-lg border border-slate-200 bg-white py-1 shadow-xl"
              onWheel={(e) => e.stopPropagation()}
            >
              <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Move card to
              </p>
              {openDestinations.length === 0 ? (
                <p className="px-3 py-2 text-xs text-slate-400">
                  Every destination is already on this column.
                </p>
              ) : (
                openDestinations.map(({ dest, existing }) => (
                  <button
                    key={dest.id}
                    type="button"
                    disabled={!!pendingKey}
                    onClick={() =>
                      void addDestination(dest, existing, openAddFor)
                    }
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    title={
                      existing
                        ? `Show “${existing.name}” on this column`
                        : `Create button that moves to ${dest.name}`
                    }
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {existing?.name ?? dest.name}
                    </span>
                    {!existing ? (
                      <span className="shrink-0 text-[10px] font-medium uppercase text-slate-400">
                        New
                      </span>
                    ) : null}
                  </button>
                ))
              )}
              <div className="border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    const columnId = openAddFor;
                    setOpenAddFor(null);
                    onCreateForColumn({ showInColumnId: columnId });
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-blue-700 hover:bg-blue-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Custom button…
                </button>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
