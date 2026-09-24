"use client";

import { useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { groupStageColumns } from "@/lib/stage-groups";

/**
 * Minimal shape needed to render a "Move to" stage option. Every board menu's
 * ColumnOption is assignable to this.
 */
export interface MoveMenuColumn {
  id: string;
  name: string;
  color: string | null;
}

interface MoveMenuSectionsProps<T extends MoveMenuColumn> {
  /** Ordered list of destination columns (already filtered by the caller). */
  columns: T[];
  /** Called with the chosen column when a stage button is clicked. */
  onSelect: (column: T) => void;
  /** Extra classes for each stage button (e.g. `pl-8` to indent in a submenu). */
  itemClassName?: string;
  /** Extra classes for each section header (align it with the items). */
  headerClassName?: string;
  /**
   * Column to vertically center in the list (typically the next stage after
   * the card the user right-clicked).
   */
  scrollToColumnId?: string | null;
}

function scrollChildToCenter(container: HTMLElement, child: HTMLElement) {
  const cRect = container.getBoundingClientRect();
  const tRect = child.getBoundingClientRect();
  const delta =
    tRect.top + tRect.height / 2 - (cRect.top + container.clientHeight / 2);
  container.scrollTop += delta;
}

/**
 * Renders a "Move to" stage list: Start (ungrouped) then Design / Prepress,
 * Production, and Post-production. Grouping + colors come from the central
 * config in `@/lib/stage-groups`, so every menu that uses this component stays
 * visually identical. Display-only: click behavior is whatever the caller does
 * in `onSelect` — grouping never changes it.
 */
export function MoveMenuSections<T extends MoveMenuColumn>({
  columns,
  onSelect,
  itemClassName,
  headerClassName,
  scrollToColumnId,
}: MoveMenuSectionsProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sections = groupStageColumns(columns);

  useLayoutEffect(() => {
    const id = scrollToColumnId;
    if (!id) return;

    const run = () => {
      const container = scrollRef.current;
      if (!container) return;
      const selector = `[data-move-column-id="${CSS.escape(id)}"]`;
      const target = container.querySelector(selector);
      if (!(target instanceof HTMLElement)) return;
      scrollChildToCenter(container, target);
    };

    run();
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(run);
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
    // Intentionally not depending on `columns` identity — a new array every
    // render would re-center and fight the user scrolling to Finished.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToColumnId]);

  if (sections.length === 0) return null;

  return (
    <div
      ref={scrollRef}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain max-h-[55vh]"
    >
      {sections.map((section) => (
        <div
          key={section.group.id}
          className={cn("py-1", section.group.sectionClassName)}
        >
          {section.group.label ? (
            <p
              className={cn(
                "px-3 py-1 text-[10px] font-semibold uppercase tracking-wider",
                section.group.headerClassName,
                headerClassName
              )}
            >
              {section.group.label}
            </p>
          ) : null}
          {section.columns.map((col) => {
            const isNext = col.id === scrollToColumnId;
            return (
              <button
                key={col.id}
                type="button"
                data-move-column-id={col.id}
                onClick={() => onSelect(col)}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-black/5",
                  isNext
                    ? "bg-black/[0.06] font-medium text-slate-900"
                    : "text-slate-700",
                  itemClassName
                )}
              >
                <span
                  className={cn(
                    "h-2.5 w-2.5 shrink-0 rounded-full border",
                    section.group.dotClassName
                  )}
                  style={{ backgroundColor: col.color ?? "#e2e8f0" }}
                />
                <span className="truncate">{col.name}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
