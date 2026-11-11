import { cn } from "@/lib/utils";
import { cardLinkedNumberLabels } from "@/lib/order-linked-numbers";

/**
 * Small muted label with the same order's number in the other system
 * (`CRM ORD-2026-15643` on a portal card, `Portal BZ-529` on a CRM card).
 * Renders nothing when the webhook never sent a linked number.
 */
export function LinkedOrderNumbers({
  title,
  specs,
  className,
}: {
  title: string | null | undefined;
  specs: unknown;
  className?: string;
}) {
  const labels = cardLinkedNumberLabels(
    title,
    specs && typeof specs === "object" ? (specs as Record<string, unknown>) : null
  );
  if (labels.length === 0) return null;
  const text = labels.join(" · ");
  return (
    <span
      className={cn(
        "shrink-0 whitespace-nowrap text-[10px] font-medium leading-none tabular-nums text-slate-400",
        className
      )}
      title={`Same order in other systems: ${text}`}
    >
      {text}
    </span>
  );
}
