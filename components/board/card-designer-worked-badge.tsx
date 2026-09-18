"use client";

import type { SyntheticEvent } from "react";
import Link from "next/link";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/time-tracking";

/**
 * How long designers have worked this job — always on the card (every column).
 */
export function CardDesignerWorkedBadge({
  orderId,
  seconds,
  className,
}: {
  orderId?: string;
  seconds: number;
  className?: string;
}) {
  if (seconds < 1) return null;
  const label = formatDuration(seconds);
  const classNames = cn(
    "inline-flex items-center gap-1 rounded-full bg-slate-800/90 px-2 py-0.5 text-[11px] font-semibold text-white tabular-nums shadow-sm",
    className
  );
  const inner = (
    <>
      <Clock className="h-3 w-3" aria-hidden />
      {label}
    </>
  );
  const title = `Designer time on this job: ${label}`;
  const stop = (e: SyntheticEvent) => e.stopPropagation();

  if (!orderId) {
    return (
      <span className={classNames} title={title}>
        {inner}
      </span>
    );
  }

  return (
    <Link
      href={`/time?tab=log&order=${encodeURIComponent(orderId)}`}
      onClick={stop}
      onPointerDown={stop}
      className={classNames}
      title={title}
    >
      {inner}
    </Link>
  );
}
