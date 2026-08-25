import { cn } from "@/lib/utils";
import { Star } from "lucide-react";
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

/**
 * Solid colored circle with the priority number (1–4). Score 5 marks a key
 * account and renders a star instead of the number to avoid "what does 5 mean?"
 * confusion on the card. The stored score is unchanged.
 */
export function PriorityScoreBadge({
  score,
  className,
  size = "md",
}: PriorityScoreBadgeProps) {
  const isKeyAccount = score === 5;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-bold tabular-nums leading-none text-white shadow-sm",
        size === "sm" ? "h-[18px] w-[18px] text-[10px]" : "h-5 w-5 text-[11px]",
        PRIORITY_SCORE_BADGE_STYLES[score],
        className
      )}
      title={isKeyAccount ? "Key account" : `Priority ${score}`}
      aria-label={isKeyAccount ? "Key account" : `Priority ${score}`}
    >
      {isKeyAccount ? (
        <Star
          className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"}
          fill="currentColor"
          strokeWidth={0}
          aria-hidden
        />
      ) : (
        score
      )}
    </span>
  );
}
