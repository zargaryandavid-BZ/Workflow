"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  classifyStage,
  groupStageColumns,
  likelyNextColumns,
  type StageGroupId,
} from "@/lib/stage-groups";

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
  /**
   * Name of the stage the card is in now. When given, the usual next stages
   * are shown first ("Likely next") and only the current stage's group stays
   * open; other groups fold into one-line headers (click to open).
   */
  fromColumnName?: string | null;
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
  fromColumnName,
}: MoveMenuSectionsProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sections = groupStageColumns(columns);
  const smart = Boolean(fromColumnName);
  const suggested = smart
    ? likelyNextColumns(fromColumnName, columns, scrollToColumnId)
    : [];
  const currentGroup: StageGroupId | null = fromColumnName
    ? classifyStage({ id: "", name: fromColumnName }).group
    : null;
  const [opened, setOpened] = useState<Set<StageGroupId>>(() => new Set());
  const isOpen = (id: StageGroupId) =>
    !smart || id === "start" || id === currentGroup || opened.has(id);
  const toggle = (id: StageGroupId) =>
    setOpened((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  useLayoutEffect(() => {
    const id = scrollToColumnId;
    if (!id || smart) return;

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
      {suggested.length > 0 ? (
        <div className="border-b border-slate-200 py-1">
          <p
            className={cn(
              "px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-blue-600",
              headerClassName
            )}
          >
            Likely next
          </p>
          {suggested.map((col) => (
            <StageButton
              key={`s-${col.id}`}
              col={col}
              dotClassName={STAGE_DOT(col)}
              highlight
              itemClassName={itemClassName}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : null}
      {sections.map((section) => {
        const open = isOpen(section.group.id);
        const label = section.group.label || "Start";
        return (
          <div
            key={section.group.id}
            className={cn("py-1", section.group.sectionClassName)}
          >
            {smart && section.group.id !== "start" ? (
              <button
                type="button"
                onClick={() => toggle(section.group.id)}
                aria-expanded={open}
                className={cn(
                  "flex w-full items-center gap-1 px-3 py-1 text-left text-[10px] font-semibold uppercase tracking-wider hover:bg-black/5",
                  section.group.headerClassName,
                  headerClassName
                )}
              >
                {open ? (
                  <ChevronDown className="h-3 w-3 shrink-0" />
                ) : (
                  <ChevronRight className="h-3 w-3 shrink-0" />
                )}
                <span className="truncate">{label}</span>
                {!open ? (
                  <span className="ml-auto font-normal normal-case tracking-normal text-slate-400">
                    {section.columns.length}
                  </span>
                ) : null}
              </button>
            ) : section.group.label ? (
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
            {open
              ? section.columns.map((col) => (
                  <StageButton
                    key={col.id}
                    col={col}
                    dotClassName={section.group.dotClassName}
                    highlight={!smart && col.id === scrollToColumnId}
                    dataId
                    itemClassName={itemClassName}
                    onSelect={onSelect}
                  />
                ))
              : null}
          </div>
        );
      })}
    </div>
  );
}

const STAGE_DOT = (col: { id: string; name: string }) => {
  const g = classifyStage(col).group;
  return g === "design"
    ? "border-rose-300"
    : g === "production"
      ? "border-amber-300"
      : g === "postproduction"
        ? "border-emerald-300"
        : "border-slate-300";
};

function StageButton<T extends MoveMenuColumn>({
  col,
  dotClassName,
  highlight,
  dataId,
  itemClassName,
  onSelect,
}: {
  col: T;
  dotClassName: string;
  highlight?: boolean;
  dataId?: boolean;
  itemClassName?: string;
  onSelect: (column: T) => void;
}) {
  return (
    <button
      type="button"
      data-move-column-id={dataId ? col.id : undefined}
      onClick={() => onSelect(col)}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-black/5",
        highlight ? "bg-black/[0.06] font-medium text-slate-900" : "text-slate-700",
        itemClassName
      )}
    >
      <span
        className={cn("h-2.5 w-2.5 shrink-0 rounded-full border", dotClassName)}
        style={{ backgroundColor: col.color ?? "#e2e8f0" }}
      />
      <span className="truncate">{col.name}</span>
    </button>
  );
}
