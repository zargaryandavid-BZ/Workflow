"use client";

import {
  DIE_SHOP_STATUSES,
  DIE_SHOP_STATUS_LABEL,
  parseDieShopStatus,
  type DieShopStatus,
} from "@/lib/dies";
import { cn } from "@/lib/utils";

export const DIE_STATUS_CLASS: Record<DieShopStatus, string> = {
  working: "border-emerald-200 bg-emerald-50 text-emerald-800",
  out_of_order: "border-red-200 bg-red-50 text-red-800",
};

/** Working / Out of order. */
export function DieStatusSelect({
  value,
  disabled,
  onChange,
  className,
}: {
  value: DieShopStatus;
  disabled?: boolean;
  onChange: (status: DieShopStatus) => void;
  className?: string;
}) {
  return (
    <select
      aria-label="Status"
      value={value}
      disabled={disabled}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        const next = parseDieShopStatus(e.target.value);
        if (next) onChange(next);
      }}
      className={cn(
        "rounded-md border px-2 py-1 text-xs font-semibold disabled:opacity-60",
        DIE_STATUS_CLASS[value],
        className
      )}
    >
      {DIE_SHOP_STATUSES.map((status) => (
        <option key={status} value={status}>
          {DIE_SHOP_STATUS_LABEL[status]}
        </option>
      ))}
    </select>
  );
}
