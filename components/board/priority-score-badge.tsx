import { cn } from "@/lib/utils";
import {
  PRIORITY_SCORE_BADGE_STYLES,
  type PriorityScore,
} from "@/lib/order-priority-score";

interface PriorityScoreBadgeProps {
  score: PriorityScore;
  className?: string;
  /** `sm` for lists; `md` for order card headers (matches customer circle). */
  size?: "sm" | "md";
}

/** Solid colored circle with the priority number (1–5) — same style on cards + customers. */
export function PriorityScoreBadge({
  score,
  className,
  size = "md",
}: PriorityScoreBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-bold tabular-nums leading-none text-white shadow-sm",
        size === "sm" ? "h-[18px] w-[18px] text-[10px]" : "h-5 w-5 text-[11px]",
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
