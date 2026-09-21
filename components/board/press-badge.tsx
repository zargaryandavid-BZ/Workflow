import { cn } from "@/lib/utils";
import { PRESS_LABELS } from "@/lib/production-fields";
import type { PressType } from "@/lib/types";

/** Small read-only badge showing which HP Indigo press an order runs on. */
export function PressBadge({
  press,
  className,
}: {
  press: PressType;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded px-1 py-px text-[9px] font-bold uppercase tracking-wide",
        "bg-slate-800 text-white",
        className
      )}
      title={`Press: ${PRESS_LABELS[press]}`}
    >
      {PRESS_LABELS[press]}
    </span>
  );
}
