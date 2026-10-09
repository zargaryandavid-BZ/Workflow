"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Printer, Search, X } from "lucide-react";
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

export function FulfillmentProductionPage({
  apiBase = "/api/fulfillment/production",
}: {
  apiBase?: string;
}) {
  const [orders, setOrders] = useState<ProductionOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [printingId, setPrintingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [lightbox, setLightbox] = useState<{
    url: string;
    orderNumber: string;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiBase, { cache: "no-store" });
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
  }, [apiBase]);

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
      const res = await fetch(`${apiBase}/${order.id}/job-ticket`, {
        method: "POST",
        signal: AbortSignal.timeout(170_000),
      });
      const contentType = res.headers.get("content-type") ?? "";
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(json.error ?? "Failed to generate job ticket");
      }
      const blob = await res.blob();
      if (
        !blob.size ||
        contentType.includes("text/html") ||
        contentType.includes("application/json")
      ) {
        throw new Error("Server returned an error instead of a PDF");
      }
      const pdf = new Blob([blob], { type: "application/pdf" });
      await printPdfBlob(pdf);
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
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-white">
      <div className="flex shrink-0 items-center gap-2 px-3 py-2 sm:gap-3 sm:px-4">
        <label className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="h-9 w-full rounded-md border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-300"
          />
        </label>
        <span className="shrink-0 text-sm tabular-nums text-slate-600">
          qty{" "}
          <span className="font-semibold text-slate-900">{visible.length}</span>
          {query.trim() && visible.length !== orders.length ? (
            <span className="text-slate-400"> / {orders.length} ttl</span>
          ) : (
            <span className="text-slate-400"> ttl</span>
          )}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 sm:px-3">
        {loading ? (
          <p className="px-2 py-8 text-sm text-slate-400">Loading…</p>
        ) : error ? (
          <p className="px-2 py-8 text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : visible.length === 0 ? (
          <p className="px-2 py-8 text-sm text-slate-400">
            No jobs in production
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {visible.map((order) => (
              <li
                key={order.id}
                className="min-w-0 rounded-md border border-slate-200 bg-white px-2 py-2 sm:px-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <button
                    type="button"
                    disabled={!order.thumbnail_url}
                    onClick={() =>
                      order.thumbnail_url &&
                      setLightbox({
                        url: order.thumbnail_url,
                        orderNumber: order.order_number,
                      })
                    }
                    className="h-24 w-24 shrink-0 overflow-hidden rounded border border-slate-200 bg-slate-100 sm:h-28 sm:w-28 disabled:cursor-default"
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
                    <div className="min-w-0">
                      <p className="font-semibold tabular-nums text-slate-900">
                        {order.order_number}
                      </p>
                      <p className="truncate text-sm text-slate-700">
                        {order.item_title || "—"}
                      </p>
                    </div>
                    {rowError[order.id] ? (
                      <p className="mt-0.5 truncate text-xs text-red-600">
                        {rowError[order.id]}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    disabled={printingId === order.id}
                    onClick={() => void printTicket(order)}
                    title="Print job ticket"
                    aria-label="Print job ticket"
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {printingId === order.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Printer className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {lightbox ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 sm:p-6"
          onClick={() => setLightbox(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Artwork ${lightbox.orderNumber}`}
            className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-3 py-2">
              <p className="truncate text-base font-semibold tabular-nums text-slate-900">
                {lightbox.orderNumber}
              </p>
              <button
                type="button"
                onClick={() => setLightbox(null)}
                title="Close"
                aria-label="Close"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-50 p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={lightbox.url}
                alt={`Artwork ${lightbox.orderNumber}`}
                className="max-h-[min(80vh,40rem)] max-w-full object-contain"
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
