"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Check, Download, Link2, Search } from "lucide-react";
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
  jobTicketUrl,
  shareUrl,
}: {
  open: boolean;
  onClose: () => void;
  /** `<scan api base>/history` (staff or kiosk). */
  apiUrl: string;
  /** `<scan api base>/job-ticket` — per-order job ticket download. */
  jobTicketUrl?: string;
  /** `<scan api base>/history/share` — mints a read-only external link. */
  shareUrl?: string;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Sent history" className="max-w-4xl">
      <SentHistoryPanel
        apiUrl={apiUrl}
        jobTicketUrl={jobTicketUrl}
        shareUrl={shareUrl}
      />
    </Modal>
  );
}

/**
 * Sent history chart + per-period order list. Used in the Scan modal and on
 * the public share page (no job tickets or share button there).
 */
export function SentHistoryPanel({
  apiUrl,
  jobTicketUrl,
  shareUrl,
}: {
  apiUrl: string;
  jobTicketUrl?: string;
  shareUrl?: string;
}) {
  const [metric, setMetric] = useState<DeliveryMetric>("orders");
  const [period, setPeriod] = useState<DeliveryPeriod>("month");
  const [columnId, setColumnId] = useState<string | null>(null);
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [phone, setPhone] = useState(false);
  const [search, setSearch] = useState("");
  const [share, setShare] = useState<
    | { state: "idle" }
    | { state: "busy" }
    | { state: "copied"; url: string; days: number }
    | { state: "manual"; url: string; days: number }
    | { state: "error"; message: string }
  >({ state: "idle" });

  async function copyShareLink() {
    if (!shareUrl) return;
    setShare({ state: "busy" });
    try {
      const res = await fetch(shareUrl, { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as {
        url?: string;
        days?: number;
        error?: string;
      };
      if (!res.ok || !json.url) throw new Error(json.error ?? "Could not create link");
      const days = json.days ?? 90;
      try {
        // Some browsers never settle the permission prompt: fall back fast.
        await Promise.race([
          navigator.clipboard.writeText(json.url),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("clipboard timeout")), 1500)
          ),
        ]);
        setShare({ state: "copied", url: json.url, days });
      } catch {
        setShare({ state: "manual", url: json.url, days });
      }
    } catch (err) {
      setShare({
        state: "error",
        message: err instanceof Error ? err.message : "Could not create link",
      });
    }
  }

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
  }, [days, apiUrl]);

  const columns = useMemo(() => data?.columns ?? [], [data]);
  const columnName = useMemo(
    () => new Map(columns.map((c) => [c.id, c.name])),
    [columns]
  );
  // Customer / order # search narrows the chart and the list together.
  const searchedEvents = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data.events;
    return data.events.filter((event) => {
      const info = data.order_info[event.orderId];
      return (
        (info?.customer ?? "").toLowerCase().includes(q) ||
        (info?.title ?? "").toLowerCase().includes(q)
      );
    });
  }, [data, search]);
  const buckets = useMemo(() => {
    if (!data) return [];
    return bucketDeliveries({
      events: searchedEvents,
      itemsByOrder: data.items_by_order,
      keys: deliveryPeriodKeys(new Date(), period, count),
      period,
      metric,
      columnId,
    });
  }, [data, searchedEvents, period, count, metric, columnId]);

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

        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-0 flex-1 basis-56">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search customer or order #"
              aria-label="Search customer or order number"
              className="h-10 w-full rounded-lg border border-slate-300 bg-white py-2 pl-8 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-300"
            />
          </label>
          {shareUrl ? (
            <button
              type="button"
              onClick={() => void copyShareLink()}
              disabled={share.state === "busy"}
              className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {share.state === "copied" ? (
                <Check className="h-4 w-4 text-emerald-600" />
              ) : (
                <Link2 className="h-4 w-4" />
              )}
              {share.state === "busy"
                ? "Creating link…"
                : share.state === "copied"
                  ? "Link copied"
                  : "Copy share link"}
            </button>
          ) : null}
        </div>
        {share.state === "copied" ? (
          <p className="-mt-3 text-xs text-slate-500">
            Anyone with this link can view this history (read-only, no job
            tickets) for {share.days} days.
          </p>
        ) : share.state === "manual" ? (
          <div className="-mt-3 flex flex-col gap-1">
            <p className="text-xs text-slate-500">
              Copy this link (read-only, valid {share.days} days):
            </p>
            <input
              readOnly
              value={share.url}
              onFocus={(e) => e.currentTarget.select()}
              className="h-9 w-full rounded-md border border-slate-300 bg-slate-50 px-2 text-xs text-slate-700"
            />
          </div>
        ) : share.state === "error" ? (
          <p className="-mt-3 text-xs text-red-600">{share.message}</p>
        ) : null}

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
                                  className="flex items-start justify-between gap-3 break-words"
                                >
                                  <span className="min-w-0">
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
                                  </span>
                                  {jobTicketUrl ? (
                                    <a
                                      href={`${jobTicketUrl}?order_id=${encodeURIComponent(line.orderId)}`}
                                      download
                                      title={`Download job ticket for ${info?.title ?? "this order"}`}
                                      className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-slate-200 px-2 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                                    >
                                      <Download className="h-3.5 w-3.5" />
                                      Job ticket
                                    </a>
                                  ) : null}
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
  );
}
