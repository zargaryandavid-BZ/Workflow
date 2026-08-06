import { cn } from "@/lib/utils";
import {
  PRIORITY_SCORE_BADGE_STYLES,
  type PriorityScore,
} from "@/lib/order-priority-score";

interface PriorityScoreBadgeProps {
  score: PriorityScore;
  className?: string;
  /** Slightly larger circle for card headers. */
  size?: "sm" | "md";
}

/** Colored circle with the priority number (1–5). */
export function PriorityScoreBadge({
  score,
  className,
  size = "md",
}: PriorityScoreBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-bold tabular-nums leading-none",
        size === "sm" ? "h-4 w-4 text-[9px]" : "h-5 w-5 text-xs",
        PRIORITY_SCORE_BADGE_STYLES[score],
        className
      )}
      title={`Priority ${score}`}
      aria-label={`Priority ${score}`}
    >
      {score}
    </span>
  );
}
