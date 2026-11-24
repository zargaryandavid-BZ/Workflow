"use client";

import { cn } from "@/lib/utils";
import { useGdriveFolderHasFiles } from "@/lib/use-gdrive-folder-has-files";
import type { PriorityScore } from "@/lib/order-priority-score";
import { formatShortOrderNumber } from "@/lib/board-order-filters";
import { displayOrderNumberText } from "@/lib/order-display-number";
import { PriorityScoreBadge } from "./priority-score-badge";

export { formatShortOrderNumber };

interface OrderNumberLabelProps {
  orderId: string;
  title: string;
  /** Card specs — portal `BZ-…` cards show their CRM number when present. */
  specs?: unknown;
  groupSize?: number | null;
  artworkUrl?: string | null;
  /** When set, shown as a colored circle left of the order number. */
  priorityScore?: PriorityScore | null;
  className?: string;
  groupClassName?: string;
}

/** Order # — green when the Artwork / Final production Drive folder has files. */
export function OrderNumberLabel({
  orderId,
  title,
  specs,
  groupSize,
  artworkUrl,
  priorityScore = null,
  className,
  groupClassName,
}: OrderNumberLabelProps) {
  const folderHasFiles = useGdriveFolderHasFiles(orderId, artworkUrl);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1",
        folderHasFiles ? "text-emerald-600" : undefined,
        className
      )}
      title={
        folderHasFiles
          ? "Final production folder has files"
          : undefined
      }
    >
      {priorityScore != null ? (
        <PriorityScoreBadge score={priorityScore} />
      ) : null}
      {displayOrderNumberText({ title, specs })}
      {groupSize != null && groupSize >= 2 ? (
        <span
          className={cn(
            "font-normal",
            folderHasFiles ? "text-emerald-500/80" : "text-slate-400",
            groupClassName
          )}
        >
          ({groupSize})
        </span>
      ) : null}
    </span>
  );
}
