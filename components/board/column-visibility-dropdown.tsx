"use client";

import { useEffect, useRef, useState } from "react";
import { Columns3 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BoardColumn } from "@/lib/types";

interface Props {
  columns: BoardColumn[];
  hiddenColIds: Set<string>;
  onToggle: (columnId: string) => void;
  onShowAll: () => void;
  /** When true, styles as a segment next to Kanban / Table. */
  segmented?: boolean;
}

export function ColumnVisibilityDropdown({
  columns,
  hiddenColIds,
  onToggle,
  onShowAll,
  segmented = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const visibleCount = columns.length - hiddenColIds.size;
  const hasHidden = hiddenColIds.size > 0;

  useEffect(() => {
    if (!open) return;
    function close(e: MouseEvent | KeyboardEvent) {
      if (e instanceof KeyboardEvent) {
        if (e.key === "Escape") setOpen(false);
        return;
      }
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center justify-center transition-colors",
          segmented
            ? cn(
                "rounded-r-md border-l border-slate-300 px-2 py-1 text-sm",
                open
                  ? "bg-slate-800 text-white"
                  : "text-slate-600 hover:bg-slate-50"
              )
            : cn(
                "h-9 rounded-md border px-2 text-sm",
                hasHidden
                  ? "border-blue-400 bg-blue-50 text-blue-700 hover:bg-blue-100"
                  : "border-slate-300 text-slate-600 hover:bg-slate-50"
              )
        )}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="Choose visible columns"
        title="Choose visible columns"
      >
        <Columns3 className="h-3.5 w-3.5" />
        {hasHidden ? (
          <span
            className={cn(
              "ml-1 rounded-full px-1.5 text-[10px] font-semibold",
              segmented
                ? open
                  ? "bg-white/20 text-white"
                  : "bg-slate-200 text-slate-700"
                : "bg-blue-200/80 text-blue-800"
            )}
          >
            {visibleCount}/{columns.length}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label="Visible columns"
          className="absolute left-0 z-50 mt-1 w-56 rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Show columns
            </p>
            {hiddenColIds.size > 0 ? (
              <button
                type="button"
                onClick={() => {
                  onShowAll();
                  setOpen(false);
                }}
                className="text-xs font-medium text-blue-600 hover:text-blue-800"
              >
                Show all
              </button>
            ) : null}
          </div>
          <ul className="max-h-64 overflow-y-auto py-1">
            {columns.map((col) => {
              const visible = !hiddenColIds.has(col.id);
              return (
                <li key={col.id}>
                  <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={visible}
                      onChange={() => onToggle(col.id)}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-[var(--primary)] focus:ring-[var(--primary)]/30"
                    />
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: col.color ?? "#94a3b8" }}
                    />
                    <span className="truncate">{col.name}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
