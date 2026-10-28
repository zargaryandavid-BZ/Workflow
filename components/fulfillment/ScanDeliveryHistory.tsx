"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import { formatShortOrderNumber } from "@/lib/board-order-filters";
import {
  DELIVERY_PERIOD_COUNT,
  bucketDeliveries,
  deliveryPeriodDays,
  deliveryPeriodKeys,
  type DeliveryEvent,
  type DeliveryMetric,
  type DeliveryPeriod,
} from "@/lib/scan-delivery-history";

type HistoryResponse = {
  columns: { id: string; name: string }[];
  events: DeliveryEvent[];
  items_by_order: Record<string, number>;
  order_info: Record<string, { title: string; customer: string | null }>;
};

const LINES_PREVIEW = 8;
const fmt = (n: number) => n.toLocaleString("en-US");
const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const compactWhole = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 0,
});
/** Fewer bars on phones so every value label fits. */
const PHONE_PERIOD_COUNT: Record<DeliveryPeriod, number> = {
  day: 7,
  week: 8,
  month: 12,
};

const PERIOD_LABEL: Record<DeliveryPeriod, string> = {
  day: "Days",
  week: "Weeks",
  month: "Months",
};
const CURRENT_LABEL: Record<DeliveryPeriod, string> = {
  day: "Today",
  week: "This week",
  month: "This month",
};
const RANGE_UNIT: Record<DeliveryPeriod, string> = {
  day: "days",
  week: "weeks",
  month: "months",
};

function keyToDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** Short bar label; `sub` adds the month/year when it changes. */
function barLabel(key: string, period: DeliveryPeriod, first: boolean) {
  const date = keyToDate(key);
  if (period === "month") {
    const main = date.toLocaleDateString("en-US", { month: "short" });
    const sub =
      first || date.getMonth() === 0
        ? `'${String(date.getFullYear()).slice(2)}`
        : null;
    return { main, sub };
  }
  if (period === "week") {
    return { main: `${date.getMonth() + 1}/${date.getDate()}`, sub: null };
  }
  const sub =
    first || date.getDate() === 1
      ? date.toLocaleDateString("en-US", { month: "short" })
      : null;
  return { main: String(date.getDate()), sub };
}

function periodTitle(key: string, period: DeliveryPeriod): string {
  const date = keyToDate(key);
  if (period === "month") {
    return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  }
  const day = date.toLocaleDateString("en-US", {
    weekday: period === "day" ? "short" : undefined,
    month: "short",
    day: "numeric",
  });
  return period === "week" ? `Week of ${day}` : day;
}

export function ScanDeliveryHistory({
  open,
  onClose,
  apiUrl,
}: {
  open: boolean;
  onClose: () => void;
  /** `<scan api base>/history` (staff or kiosk). */
  apiUrl: string;
}) {
  const [metric, setMetric] = useState<DeliveryMetric>("orders");
  const [period, setPeriod] = useState<DeliveryPeriod>("month");
  const [columnId, setColumnId] = useState<string | null>(null);
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [phone, setPhone] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 639px)");
    const update = () => setPhone(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const count = (phone ? PHONE_PERIOD_COUNT : DELIVERY_PERIOD_COUNT)[period];
  const days = deliveryPeriodDays(period, count);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`${apiUrl}?days=${days}`, { signal: controller.signal })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? "Could not load history");
        setData(json as HistoryResponse);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Could not load history");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [open, days, apiUrl]);

  const columns = useMemo(() => data?.columns ?? [], [data]);
  const columnName = useMemo(
    () => new Map(columns.map((c) => [c.id, c.name])),
    [columns]
  );
  const buckets = useMemo(() => {
    if (!data) return [];
    return bucketDeliveries({
      events: data.events,
      itemsByOrder: data.items_by_order,
      keys: deliveryPeriodKeys(new Date(), period, count),
      period,
      metric,
      columnId,
    });
  }, [data, period, count, metric, columnId]);

  const total = buckets.reduce((sum, b) => sum + b.value, 0);
  const max = Math.max(1, ...buckets.map((b) => b.value));
  const currentKey = buckets[buckets.length - 1]?.key;
  const unit = metric === "orders" ? "orders" : "items";
  const barValue = (value: number) =>
    metric === "items"
      ? (phone ? compactWhole : compact).format(value)
      : fmt(value);

  const segment = <T extends string>(
    options: { value: T; label: string }[],
    value: T,
    onChange: (value: T) => void
  ) => (
    <div className="inline-flex shrink-0 rounded-lg border border-slate-200 bg-white p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "h-9 rounded-md px-3 text-sm font-medium",
            value === option.value
              ? "bg-slate-900 text-white"
              : "text-slate-600 hover:text-slate-900"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );

  const scrollToPeriod = (key: string) => {
    document
      .getElementById(`sent-history-${key}`)
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  return (
    <Modal open={open} onClose={onClose} title="Sent history" className="max-w-4xl">
      <div className="flex flex-col gap-5 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {segment<DeliveryMetric>(
              [
                { value: "orders", label: "Order qty" },
                { value: "items", label: "Items qty" },
              ],
              metric,
              setMetric
            )}
            {segment<DeliveryPeriod>(
              (["day", "week", "month"] as const).map((p) => ({
                value: p,
                label: PERIOD_LABEL[p],
              })),
              period,
              setPeriod
            )}
          </div>
          {data && columns.length > 0 ? (
            <p className="text-sm text-slate-500">
              Last {count} {RANGE_UNIT[period]}:{" "}
              <span className="text-xl font-semibold tabular-nums text-slate-900">
                {fmt(total)}
              </span>{" "}
              {unit}
            </p>
          ) : null}
        </div>

        {columns.length > 1 ? (
          <div className="flex flex-wrap gap-2">
            {[{ id: null as string | null, name: "All" }, ...columns].map((c) => (
              <button
                key={c.id ?? "all"}
                type="button"
                aria-pressed={columnId === c.id}
                onClick={() => setColumnId(c.id)}
                className={cn(
                  "h-8 rounded-full border px-3 text-sm font-medium",
                  columnId === c.id
                    ? "border-blue-600 bg-blue-50 text-blue-700"
                    : "border-slate-200 bg-white text-slate-600 hover:text-slate-900"
                )}
              >
                {c.name}
              </button>
            ))}
          </div>
        ) : null}

        {error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : !data ? (
          <p className="py-16 text-center text-sm text-slate-500">Loading…</p>
        ) : columns.length === 0 ? (
          <p className="py-16 text-center text-sm text-slate-500">
            No Sender buttons have a column yet. Mark a button as Sender in
            Configure columns.
          </p>
        ) : (
          <>
            <div className={cn("transition-opacity", loading && "opacity-50")}>
              <div className="flex h-56 items-end gap-1 border-b border-slate-200 sm:gap-2">
                {buckets.map((bucket) => {
                  const current = bucket.key === currentKey;
                  return (
                    <button
                      key={bucket.key}
                      type="button"
                      onClick={() => scrollToPeriod(bucket.key)}
                      title={`${periodTitle(bucket.key, period)}: ${fmt(bucket.value)} ${unit}`}
                      className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end"
                    >
                      <span
                        className={cn(
                          "mb-1 text-[10px] font-semibold tabular-nums sm:text-xs",
                          current
                            ? "text-blue-600"
                            : bucket.value > 0
                              ? "text-slate-800"
                              : "text-slate-400"
                        )}
                      >
                        {barValue(bucket.value)}
                      </span>
                      <span
                        className={cn(
                          "w-full max-w-12 rounded-t",
                          current
                            ? "bg-blue-600 group-hover:bg-blue-700"
                            : "bg-slate-700 group-hover:bg-slate-900"
                        )}
                        style={{
                          height: `${(bucket.value / max) * 85}%`,
                          minHeight: bucket.value > 0 ? 3 : 0,
                        }}
                      />
                    </button>
                  );
                })}
              </div>
              <div className="mt-2 flex gap-1 sm:gap-2">
                {buckets.map((bucket, index) => {
                  const current = bucket.key === currentKey;
                  const label = barLabel(bucket.key, period, index === 0);
                  return (
                    <div
                      key={bucket.key}
                      className={cn(
                        "min-w-0 flex-1 text-center text-[10px] leading-tight sm:text-xs",
                        current ? "font-semibold text-blue-600" : "text-slate-500"
                      )}
                    >
                      <span className="block">{label.main}</span>
                      {label.sub ? <span className="block">{label.sub}</span> : null}
                      {current ? (
                        <span className="hidden whitespace-nowrap sm:block">
                          {CURRENT_LABEL[period]}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="flex justify-between border-b border-slate-200 px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <span>{PERIOD_LABEL[period].slice(0, -1)}</span>
                <span>{metric === "orders" ? "Orders" : "Items"}</span>
              </div>
              <ul>
                {[...buckets].reverse().map((bucket) => {
                  const current = bucket.key === currentKey;
                  const showAll = expanded.has(bucket.key);
                  const lines = showAll
                    ? bucket.lines
                    : bucket.lines.slice(0, LINES_PREVIEW);
                  return (
                    <li
                      key={bucket.key}
                      id={`sent-history-${bucket.key}`}
                      className={cn(
                        "flex scroll-mt-4 items-center gap-4 border-b border-l-4 border-b-slate-100 px-3 py-3",
                        current ? "border-l-blue-600 bg-blue-50/40" : "border-l-transparent"
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            "font-semibold",
                            current ? "text-blue-700" : "text-slate-900"
                          )}
                        >
                          {periodTitle(bucket.key, period)}
                        </p>
                        {bucket.lines.length === 0 ? (
                          <p className="text-sm text-slate-400">Nothing sent</p>
                        ) : (
                          <ul className="mt-0.5 space-y-0.5 text-sm text-slate-600">
                            {lines.map((line) => {
                              const info = data.order_info[line.orderId];
                              return (
                                <li
                                  key={`${line.orderId}-${line.columnId}`}
                                  className="break-words"
                                >
                                  {period !== "day"
                                    ? `${new Date(line.at).toLocaleDateString("en-US", {
                                        month: "short",
                                        day: "numeric",
                                      })} · `
                                    : ""}
                                  <span className="font-mono font-medium text-slate-800">
                                    {formatShortOrderNumber(info?.title ?? "—")}
                                  </span>
                                  {info?.customer ? ` · ${info.customer}` : ""}
                                  {columnId
                                    ? ""
                                    : ` · ${columnName.get(line.columnId) ?? ""}`}
                                  {metric === "items"
                                    ? ` · ${fmt(line.amount)} items`
                                    : ""}
                                </li>
                              );
                            })}
                            {bucket.lines.length > LINES_PREVIEW ? (
                              <li>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpanded((prev) => {
                                      const next = new Set(prev);
                                      if (showAll) next.delete(bucket.key);
                                      else next.add(bucket.key);
                                      return next;
                                    })
                                  }
                                  className="font-medium text-blue-700 hover:text-blue-900"
                                >
                                  {showAll
                                    ? "Show less"
                                    : `Show all ${fmt(bucket.lines.length)}`}
                                </button>
                              </li>
                            ) : null}
                          </ul>
                        )}
                      </div>
                      <span className="shrink-0 text-base font-semibold tabular-nums text-slate-900">
                        {fmt(bucket.value)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
