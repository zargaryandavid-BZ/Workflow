"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Printer, Search } from "lucide-react";
import { printPdfBlob } from "@/lib/print-pdf-blob";
import {
  formatShortOrderNumber,
  orderMatchesNumberSearch,
} from "@/lib/order-number-tokens";

interface ProductionOrder {
  id: string;
  title: string;
  specs?: Record<string, unknown> | null;
  order_number: string;
  item_title: string;
  thumbnail_url: string | null;
}

export function FulfillmentProductionPage() {
  const [orders, setOrders] = useState<ProductionOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [printingId, setPrintingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/fulfillment/production", {
        cache: "no-store",
      });
      const data = (await res.json()) as {
        orders?: ProductionOrder[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Failed to load production");
      setOrders(data.orders ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load production");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((order) => {
      if (orderMatchesNumberSearch(order, q)) return true;
      if (formatShortOrderNumber(order.title).toLowerCase().includes(q)) {
        return true;
      }
      if (order.item_title.toLowerCase().includes(q)) return true;
      return order.order_number.toLowerCase().includes(q);
    });
  }, [orders, query]);

  async function printTicket(order: ProductionOrder) {
    setPrintingId(order.id);
    setRowError((prev) => {
      const next = { ...prev };
      delete next[order.id];
      return next;
    });
    try {
      const res = await fetch(
        `/api/fulfillment/production/${order.id}/job-ticket`,
        {
          method: "POST",
          signal: AbortSignal.timeout(170_000),
        }
      );
      const contentType = res.headers.get("content-type") ?? "";
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(json.error ?? "Failed to generate job ticket");
      }
      const blob = await res.blob();
      if (!blob.size || contentType.includes("text/html")) {
        throw new Error("Server returned an error instead of a PDF");
      }
      await printPdfBlob(blob);
    } catch (err) {
      const timedOut =
        err instanceof Error &&
        (err.name === "TimeoutError" || /timed out/i.test(err.message));
      setRowError((prev) => ({
        ...prev,
        [order.id]: timedOut
          ? "Job ticket took too long. Try again."
          : err instanceof Error
            ? err.message
            : "Print failed",
      }));
    } finally {
      setPrintingId(null);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-slate-50">
      <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-3 py-2 md:px-4">
        <label className="relative flex min-w-0 flex-1 items-center">
          <Search className="pointer-events-none absolute left-2.5 h-4 w-4 text-slate-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search order # or item"
            className="h-9 w-full rounded-md border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-300"
          />
        </label>
        <span className="shrink-0 text-sm tabular-nums text-slate-500">
          {visible.length}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <p className="px-4 py-8 text-sm text-slate-400">Loading…</p>
        ) : error ? (
          <p className="px-4 py-8 text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : visible.length === 0 ? (
          <p className="px-4 py-8 text-sm text-slate-400">
            No jobs in production
          </p>
        ) : (
          <ul className="divide-y divide-slate-200 bg-white">
            {visible.map((order) => (
              <li key={order.id} className="px-3 py-2 md:px-4">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    disabled={!order.thumbnail_url}
                    onClick={() =>
                      order.thumbnail_url &&
                      setLightboxUrl(order.thumbnail_url)
                    }
                    className="h-16 w-16 shrink-0 overflow-hidden rounded border border-slate-200 bg-slate-100 disabled:cursor-default"
                    title="Artwork"
                  >
                    {order.thumbnail_url ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={order.thumbnail_url}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="font-semibold tabular-nums text-slate-900">
                        {order.order_number}
                      </span>
                      <span className="text-slate-300">|</span>
                      <span className="min-w-0 truncate text-sm text-slate-700">
                        {order.item_title || "—"}
                      </span>
                    </div>
                    {rowError[order.id] ? (
                      <p className="mt-0.5 text-xs text-red-600">
                        {rowError[order.id]}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    disabled={printingId === order.id}
                    onClick={() => void printTicket(order)}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {printingId === order.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Printer className="h-4 w-4" />
                    )}
                    Print job ticket
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {lightboxUrl ? (
        <button
          type="button"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
          onClick={() => setLightboxUrl(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightboxUrl}
            alt="Artwork"
            className="max-h-full max-w-full rounded object-contain"
          />
        </button>
      ) : null}
    </div>
  );
}
