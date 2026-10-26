"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Check,
  ExternalLink,
  Loader2,
  PackageCheck,
  RefreshCw,
  Trash2,
  Truck,
} from "lucide-react";
import type { ShippingStatusItem } from "@/lib/shipping-status";
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
        "rounded-xl border p-4 shadow-sm transition",
        item.isNew
          ? "border-amber-300 bg-amber-50 ring-1 ring-amber-200"
          : "border-slate-200 bg-white"
      )}
    >
      <div className="flex items-start justify-between gap-3">
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
          {item.customerName ? (
            <p className="mt-0.5 truncate text-sm text-slate-600">
              {item.customerName}
            </p>
          ) : null}
        </div>
        <span className="shrink-0 text-xs text-slate-500">
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
            <p className="text-xs text-slate-500">Tracking not created yet</p>
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

function StatusColumn({
  title,
  items,
  icon: Icon,
  empty,
  busyId,
  onAction,
}: {
  title: string;
  items: ShippingStatusItem[];
  icon: typeof PackageCheck;
  empty: string;
  busyId: string | null;
  onAction: (item: ShippingStatusItem, action: "seen" | "remove") => void;
}) {
  return (
    <section className="min-w-0 rounded-2xl border border-slate-200 bg-slate-100/70 p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
          <Icon className="h-5 w-5 text-blue-700" />
          {title}
        </h2>
        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-slate-700 shadow-sm">
          {items.length}
        </span>
      </div>
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

export function ShippingStatusDashboard() {
  const [data, setData] = useState<StatusResponse>({
    pickup: [],
    delivery: [],
    newCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    void load();
    const interval = window.setInterval(() => void load(true), 15_000);
    const onFocus = () => void load(true);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

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
          <div className="grid items-start gap-5 lg:grid-cols-2">
            <StatusColumn
              title="Pickup Jobs"
              items={data.pickup}
              icon={PackageCheck}
              empty="No pickup jobs waiting."
              busyId={busyId}
              onAction={updateItem}
            />
            <StatusColumn
              title="FedEx Deliveries"
              items={data.delivery}
              icon={Truck}
              empty="No FedEx deliveries waiting."
              busyId={busyId}
              onAction={updateItem}
            />
          </div>
        )}
      </div>
    </div>
  );
}
