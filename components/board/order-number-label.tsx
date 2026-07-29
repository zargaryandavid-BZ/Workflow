"use client";

import { cn } from "@/lib/utils";
import { useGdriveFolderHasFiles } from "@/lib/use-gdrive-folder-has-files";

interface OrderNumberLabelProps {
  orderId: string;
  title: string;
  groupSize?: number | null;
  artworkUrl?: string | null;
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
  className,
  groupClassName,
}: OrderNumberLabelProps) {
  const folderHasFiles = useGdriveFolderHasFiles(orderId, artworkUrl);

  return (
    <span
      className={cn(
        folderHasFiles ? "text-emerald-600" : undefined,
        className
      )}
      title={
        folderHasFiles
          ? "Final production folder has files"
          : undefined
      }
    >
      {formatShortOrderNumber(title)}
      {groupSize != null && groupSize >= 2 ? (
        <span
          className={cn(
            "font-normal",
            folderHasFiles ? "text-emerald-500/80" : "text-slate-400",
            groupClassName
          )}
        >
          {" "}
          ({groupSize})
        </span>
      ) : null}
    </span>
  );
}
