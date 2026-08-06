"use client";

import { cn } from "@/lib/utils";
import { useGdriveFolderHasFiles } from "@/lib/use-gdrive-folder-has-files";
import type { PriorityScore } from "@/lib/order-priority-score";
import { PriorityScoreBadge } from "./priority-score-badge";

interface OrderNumberLabelProps {
  orderId: string;
  title: string;
  groupSize?: number | null;
  artworkUrl?: string | null;
  /** When set, shown as a colored circle left of the order number. */
  priorityScore?: PriorityScore | null;
  className?: string;
  groupClassName?: string;
}

export function formatShortOrderNumber(title: string) {
  return title.replace(/^ORD-\d{4}-/, "").replace(/^0+(\d)/, "$1");
}

/** Order # — green when the Artwork / Final production Drive folder has files. */
export function OrderNumberLabel({
  orderId,
  title,
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
      {formatShortOrderNumber(title)}
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
