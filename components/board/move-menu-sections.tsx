"use client";

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
}

/**
 * Renders a "Move to" stage list split into 3 labeled, color-tinted sections
 * (Design / Prepress · Production · Post-production). Grouping + colors come
 * from the central config in `@/lib/stage-groups`, so every menu that uses this
 * component stays visually identical. Display-only: click behavior is whatever
 * the caller does in `onSelect` — grouping never changes it.
 */
export function MoveMenuSections<T extends MoveMenuColumn>({
  columns,
  onSelect,
  itemClassName,
  headerClassName,
}: MoveMenuSectionsProps<T>) {
  const sections = groupStageColumns(columns);
  if (sections.length === 0) return null;

  return (
    <div className="max-h-[55vh] overflow-y-auto overscroll-contain">
      {sections.map((section) => (
        <div
          key={section.group.id}
          className={cn("py-1", section.group.sectionClassName)}
        >
          <p
            className={cn(
              "px-3 py-1 text-[10px] font-semibold uppercase tracking-wider",
              section.group.headerClassName,
              headerClassName
            )}
          >
            {section.group.label}
          </p>
          {section.columns.map((col) => (
            <button
              key={col.id}
              type="button"
              onClick={() => onSelect(col)}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-black/5",
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
          ))}
        </div>
      ))}
    </div>
  );
}
