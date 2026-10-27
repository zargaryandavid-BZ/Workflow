"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  ExternalLink,
  ImageIcon,
  Loader2,
  PackageCheck,
  RefreshCw,
  Search,
  Trash2,
  Truck,
} from "lucide-react";
import type {
  ShippingStatusItem,
  ShippingStatusKind,
} from "@/lib/shipping-status";
import { cn } from "@/lib/utils";

type StatusResponse = {
  pickup: ShippingStatusItem[];
  delivery: ShippingStatusItem[];
  newCount: number;
  error?: string;
};

function formatResponseTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
  });
}

function addressLine(item: ShippingStatusItem): string | null {
  const address = item.deliveryAddress;
  if (!address) return null;
  return [
    address.street,
    [address.city, address.state, address.zip].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(" · ");
}

function StatusCard({
  item,
  busy,
  onSeen,
  onRemove,
}: {
  item: ShippingStatusItem;
  busy: boolean;
  onSeen: () => void;
  onRemove: () => void;
}) {
  return (
    <article
      className={cn(
        "rounded-xl border p-3 shadow-sm transition sm:p-4",
        item.isNew
          ? "border-amber-300 bg-amber-50 ring-1 ring-amber-200"
          : "border-slate-200 bg-white"
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-100 sm:h-24 sm:w-24">
          {item.artworkUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.artworkUrl}
              alt={`Artwork for ${item.orderNumber}`}
              className="h-full w-full object-contain"
            />
          ) : (
            <ImageIcon className="h-7 w-7 text-slate-300" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-bold text-slate-950">
                  {item.orderNumber}
                </h3>
                {item.isNew ? (
                  <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                    New
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 truncate text-sm text-slate-600">
                {item.customerName ?? "No customer name"}
              </p>
            </div>
            <span className="shrink-0 text-[11px] text-slate-500 sm:text-xs">
              {formatResponseTime(item.respondedAt)}
            </span>
          </div>

          {item.kind === "delivery" ? (
            <div className="mt-3 space-y-1 rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <p className="font-semibold text-slate-800">
                {item.serviceName ?? "FedEx Delivery"}
              </p>
              {item.trackingNumber ? (
                <p className="font-mono text-xs text-slate-700">
                  Tracking: {item.trackingNumber}
                </p>
              ) : (
                <p className="text-xs text-slate-500">
                  Tracking not created yet
                </p>
              )}
              {addressLine(item) ? (
                <p className="text-xs text-slate-600">{addressLine(item)}</p>
              ) : null}
            </div>
          ) : (
            <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
              Customer selected pickup
            </p>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link
          href={`/board?order=${encodeURIComponent(item.orderId)}`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          Open order
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
        {item.isNew ? (
          <button
            type="button"
            disabled={busy}
            onClick={onSeen}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" />
            Mark seen
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={onRemove}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Remove
        </button>
      </div>
    </article>
  );
}

function StatusList({
  items,
  empty,
  busyId,
  onAction,
}: {
  items: ShippingStatusItem[];
  empty: string;
  busyId: string | null;
  onAction: (item: ShippingStatusItem, action: "seen" | "remove") => void;
}) {
  return (
    <section className="min-w-0 rounded-2xl border border-slate-200 bg-slate-100/70 p-3 sm:p-4">
      <div className="space-y-3">
        {items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white/70 px-4 py-10 text-center text-sm text-slate-500">
            {empty}
          </div>
        ) : (
          items.map((item) => (
            <StatusCard
              key={item.id}
              item={item}
              busy={busyId === item.id}
              onSeen={() => onAction(item, "seen")}
              onRemove={() => onAction(item, "remove")}
            />
          ))
        )}
      </div>
    </section>
  );
}

export function ShippingStatusDashboard({
  initialData,
}: {
  initialData?: StatusResponse;
}) {
  const [data, setData] = useState<StatusResponse>(
    initialData ?? {
      pickup: [],
      delivery: [],
      newCount: 0,
    }
  );
  const [loading, setLoading] = useState(!initialData);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeKind, setActiveKind] = useState<ShippingStatusKind>("pickup");
  const [search, setSearch] = useState("");

  const visibleItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    const items = activeKind === "pickup" ? data.pickup : data.delivery;
    if (!query) return items;
    return items.filter((item) =>
      [
        item.orderNumber,
        item.customerName,
        item.serviceName,
        item.trackingNumber,
        addressLine(item),
      ].some((value) => value?.toLowerCase().includes(query))
    );
  }, [activeKind, data.delivery, data.pickup, search]);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      const response = await fetch("/api/shipping-status", {
        cache: "no-store",
      });
      const json = (await response.json().catch(() => ({}))) as StatusResponse;
      if (!response.ok) {
        throw new Error(json.error ?? "Failed to load shipping status");
      }
      setData(json);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load shipping status"
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(Boolean(initialData));
    const interval = window.setInterval(() => void load(true), 15_000);
    const onFocus = () => void load(true);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [initialData, load]);

  async function updateItem(
    item: ShippingStatusItem,
    action: "seen" | "remove"
  ) {
    if (
      action === "remove" &&
      !window.confirm(
        `Remove order ${item.orderNumber} from Shipping Status?`
      )
    ) {
      return;
    }

    setBusyId(item.id);
    setError(null);
    try {
      const response = await fetch(`/api/shipping-status/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(json.error ?? "Failed to update shipping status");
      }
      setData((current) => {
        const update = (items: ShippingStatusItem[]) =>
          action === "remove"
            ? items.filter((row) => row.id !== item.id)
            : items.map((row) =>
                row.id === item.id ? { ...row, isNew: false } : row
              );
        return {
          pickup: update(current.pickup),
          delivery: update(current.delivery),
          newCount: Math.max(0, current.newCount - (item.isNew ? 1 : 0)),
        };
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update shipping status"
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-50">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-slate-950">
                Shipping Status
              </h1>
              {data.newCount > 0 ? (
                <span className="rounded-full bg-amber-500 px-2.5 py-1 text-xs font-bold text-white">
                  {data.newCount} new
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-slate-600">
              Latest customer pickup and FedEx selections.
            </p>
          </div>
          <button
            type="button"
            disabled={refreshing}
            onClick={() => void load(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {refreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Refresh
          </button>
        </div>

        <div className="mb-5 flex flex-col gap-3 sm:flex-row">
          <div
            className="grid grid-cols-2 rounded-xl bg-slate-200 p-1 sm:w-80"
            aria-label="Shipping status type"
          >
            {(
              [
                ["pickup", "Pickup", PackageCheck, data.pickup.length],
                ["delivery", "Delivery", Truck, data.delivery.length],
              ] as const
            ).map(([kind, label, Icon, count]) => (
              <button
                key={kind}
                type="button"
                onClick={() => setActiveKind(kind)}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition",
                  activeKind === kind
                    ? "bg-white text-blue-800 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
                <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">
                  {count}
                </span>
              </button>
            ))}
          </div>

          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Search shipping orders</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search order or customer"
              className="h-full min-h-11 w-full rounded-xl border border-slate-300 bg-white py-2 pl-10 pr-3 text-sm text-slate-900 outline-none ring-blue-500 placeholder:text-slate-400 focus:ring-2"
            />
          </label>
        </div>

        {error ? (
          <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        {loading ? (
          <div className="flex min-h-64 items-center justify-center text-slate-500">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Loading shipping status…
          </div>
        ) : (
          <StatusList
            items={visibleItems}
            empty={
              search.trim()
                ? "No matching orders."
                : activeKind === "pickup"
                  ? "No pickup jobs waiting."
                  : "No FedEx deliveries waiting."
            }
            busyId={busyId}
            onAction={updateItem}
          />
        )}
      </div>
    </div>
  );
}
