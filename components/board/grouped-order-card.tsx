"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarClock, ChevronDown, ChevronUp, ExternalLink, Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PRIORITY_STYLES } from "@/lib/constants";
import { itemLabel, type GroupEntry } from "@/lib/group-orders";
import { cn, formatDateShort } from "@/lib/utils";
import type { OrderWithRelations } from "@/lib/types";

interface GroupedOrderCardProps {
  entry: GroupEntry;
  onOpen: (order: OrderWithRelations) => void;
}

export function GroupedOrderCard({ entry, onOpen }: GroupedOrderCardProps) {
  const { key, orders } = entry;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Representative order — lowest webhook_item_index, then by position.
  const rep = [...orders].sort((a, b) => {
    const ai = typeof a.specs?.webhook_item_index === "number" ? a.specs.webhook_item_index : 999;
    const bi = typeof b.specs?.webhook_item_index === "number" ? b.specs.webhook_item_index : 999;
    if (ai !== bi) return ai - bi;
    return a.position - b.position;
  })[0];

  const priority = rep.priority;
  const dueDate = rep.due_date;

  // Earliest due date across all items for the badge.
  const earliestDue = orders
    .map((o) => o.due_date)
    .filter((d): d is string => Boolean(d))
    .sort()[0] ?? null;

  // Close popover on outside click.
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {/* Main grouped card */}
      <div
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "cursor-pointer rounded-md border-2 border-blue-200 bg-blue-50 p-2 shadow-sm transition-shadow hover:shadow-md",
          open && "ring-2 ring-blue-400 ring-offset-1"
        )}
      >
        {/* Header row */}
        <div className="flex items-start justify-between gap-1">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <Layers className="h-3.5 w-3.5 shrink-0 text-blue-500" />
            <span className="truncate text-xs font-semibold text-slate-800">
              {key}
            </span>
            <span className="shrink-0 rounded-full bg-blue-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
              {orders.length} items
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {priority && priority !== "normal" ? (
              <Badge className={cn("px-1.5 py-0 text-[10px]", PRIORITY_STYLES[priority])}>
                {priority}
              </Badge>
            ) : null}
            {open ? (
              <ChevronUp className="h-3.5 w-3.5 text-slate-400" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
            )}
          </div>
        </div>

        {/* Due date row */}
        {earliestDue ? (
          <div className="mt-1 flex items-center gap-1 text-[10px] text-slate-500">
            <CalendarClock className="h-3 w-3 shrink-0" />
            <span>{formatDateShort(earliestDue)}</span>
            {orders.some((o) => o.due_date && o.due_date !== dueDate) ? (
              <span className="text-slate-400">(varies)</span>
            ) : null}
          </div>
        ) : null}

        {/* Item summary — always visible */}
        <div className="mt-1.5 space-y-0.5">
          {orders.map((order) => (
            <div
              key={order.id}
              className="truncate text-[10px] text-slate-600"
            >
              · {itemLabel(order)}
            </div>
          ))}
        </div>
      </div>

      {/* Expanded item list popover */}
      {open ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-lg border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <span className="text-xs font-semibold text-slate-700">
              {key} — {orders.length} items
            </span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setOpen(false); }}
              className="text-xs text-slate-400 hover:text-slate-600"
            >
              ✕
            </button>
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {[...orders]
              .sort((a, b) => {
                const ai = typeof a.specs?.webhook_item_index === "number" ? a.specs.webhook_item_index : 999;
                const bi = typeof b.specs?.webhook_item_index === "number" ? b.specs.webhook_item_index : 999;
                if (ai !== bi) return ai - bi;
                return a.position - b.position;
              })
              .map((order, idx) => (
                <button
                  key={order.id}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpen(false);
                    onOpen(order);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-slate-50"
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[10px] font-semibold text-blue-600">
                    {idx + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-slate-800">
                      {itemLabel(order)}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-slate-400">
                      <span>{order.title}</span>
                      {order.due_date ? (
                        <span className="flex items-center gap-0.5">
                          <CalendarClock className="h-2.5 w-2.5" />
                          {formatDateShort(order.due_date)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-300 group-hover:text-slate-500" />
                </button>
              ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
