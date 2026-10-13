"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Download,
  EllipsisVertical,
  FileText,
  Loader2,
  Package,
  Printer,
  Search,
  X,
} from "lucide-react";
import {
  filenameFromDisposition,
  triggerBlobDownload,
} from "@/lib/browser-pdf";
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
  product_type: string;
  sku_count: number;
  total_qty: number;
  sku_details: {
    label: string;
    quantity: number | null;
    artwork_url: string | null;
  }[];
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
  const [printing, setPrinting] = useState<{
    id: string;
    kind: "ticket_download" | "ticket_print" | "slip_print";
  } | null>(null);
  const [actionMenuOrderId, setActionMenuOrderId] = useState<string | null>(
    null
  );
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [lightbox, setLightbox] = useState<{
    url: string;
    orderNumber: string;
  } | null>(null);
  const [skuDetailsOrder, setSkuDetailsOrder] =
    useState<ProductionOrder | null>(null);

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

  useEffect(() => {
    if (!actionMenuOrderId) return;
    const close = (event: MouseEvent) => {
      if (!(event.target as Element).closest("[data-action-menu]")) {
        setActionMenuOrderId(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActionMenuOrderId(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [actionMenuOrderId]);

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

  async function runPdfAction(
    order: ProductionOrder,
    kind: "ticket_download" | "ticket_print" | "slip_print"
  ) {
    setPrinting({ id: order.id, kind });
    setRowError((prev) => {
      const next = { ...prev };
      delete next[order.id];
      return next;
    });
    const isTicket = kind !== "slip_print";
    const path = isTicket ? "job-ticket" : "packing-slip";
    const label = isTicket ? "job ticket" : "packing slip";
    try {
      const res = await fetch(`${apiBase}/${order.id}/${path}`, {
        method: "POST",
        signal: AbortSignal.timeout(170_000),
      });
      const contentType = res.headers.get("content-type") ?? "";
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(json.error ?? `Failed to generate ${label}`);
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
      if (kind === "ticket_download") {
        triggerBlobDownload(
          pdf,
          filenameFromDisposition(
            res.headers.get("content-disposition"),
            `job-ticket-${order.order_number}.pdf`
          )
        );
      } else {
        await printPdfBlob(pdf);
      }
    } catch (err) {
      const timedOut =
        err instanceof Error &&
        (err.name === "TimeoutError" || /timed out/i.test(err.message));
      setRowError((prev) => ({
        ...prev,
        [order.id]: timedOut
          ? `${isTicket ? "Job ticket" : "Packing slip"} took too long. Try again.`
          : err instanceof Error
            ? err.message
            : "Print failed",
      }));
    } finally {
      setPrinting(null);
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
                tabIndex={0}
                aria-label={`View SKU details for ${order.order_number}`}
                onClick={(event) => {
                  if (
                    (event.target as Element).closest(
                      "button, [data-action-menu]"
                    )
                  ) {
                    return;
                  }
                  setSkuDetailsOrder(order);
                }}
                onKeyDown={(event) => {
                  if (
                    event.target === event.currentTarget &&
                    (event.key === "Enter" || event.key === " ")
                  ) {
                    event.preventDefault();
                    setSkuDetailsOrder(order);
                  }
                }}
                className="min-w-0 cursor-pointer rounded-md border border-slate-200 bg-white px-2 py-2 hover:border-blue-300 hover:bg-blue-50/30 focus:outline-none focus:ring-2 focus:ring-blue-400 sm:px-3"
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
                      <p className="flex min-w-0 items-center gap-2 font-semibold text-slate-900">
                        <span className="shrink-0 tabular-nums">
                          {order.order_number}
                        </span>
                        <span className="text-slate-300">|</span>
                        <span className="truncate text-sm text-slate-700">
                          {order.product_type}
                        </span>
                      </p>
                      <p className="truncate text-sm text-slate-700">
                        {order.item_title || "—"}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                        <span>
                          SKU Qty:{" "}
                          <strong className="text-slate-800">
                            {order.sku_count.toLocaleString()}
                          </strong>
                        </span>
                        <span>
                          TTL Qty:{" "}
                          <strong className="text-slate-800">
                            {order.total_qty.toLocaleString()}
                          </strong>
                        </span>
                      </div>
                    </div>
                    {rowError[order.id] ? (
                      <p className="mt-0.5 truncate text-xs text-red-600">
                        {rowError[order.id]}
                      </p>
                    ) : null}
                  </div>
                  <div
                    data-action-menu
                    className={`relative shrink-0 rounded-md bg-white p-0.5 ${
                      actionMenuOrderId === order.id ? "z-[100]" : "z-10"
                    }`}
                  >
                    <button
                      type="button"
                      disabled={printing?.id === order.id}
                      onClick={() =>
                        setActionMenuOrderId((current) =>
                          current === order.id ? null : order.id
                        )
                      }
                      title="Actions"
                      aria-label={`Actions for ${order.order_number}`}
                      aria-expanded={actionMenuOrderId === order.id}
                      className="inline-flex size-[2.925rem] items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {printing?.id === order.id ? (
                        <Loader2 className="size-[1.3rem] animate-spin" />
                      ) : (
                        <EllipsisVertical className="size-[1.3rem]" />
                      )}
                    </button>
                    {actionMenuOrderId === order.id ? (
                      <div className="absolute right-0 top-full z-[110] mt-1 w-56 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-xl">
                        <div className="flex items-center justify-between border-b border-slate-200 px-3 py-1.5">
                          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Actions
                          </span>
                          <button
                            type="button"
                            onClick={() => setActionMenuOrderId(null)}
                            title="Close menu"
                            aria-label="Close actions menu"
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setActionMenuOrderId(null);
                            void runPdfAction(order, "ticket_download");
                          }}
                          className="flex w-full items-center gap-3 bg-white px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"
                        >
                          <Download className="h-4 w-4 shrink-0" />
                          Download job ticket
                        </button>
                        <div className="my-1 border-t border-slate-200" />
                        <button
                          type="button"
                          onClick={() => {
                            setActionMenuOrderId(null);
                            void runPdfAction(order, "ticket_print");
                          }}
                          className="flex w-full items-center gap-3 bg-white px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"
                        >
                          <Printer className="h-4 w-4 shrink-0" />
                          Print job ticket
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setActionMenuOrderId(null);
                            void runPdfAction(order, "slip_print");
                          }}
                          className="flex w-full items-center gap-3 bg-white px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"
                        >
                          <FileText className="h-4 w-4 shrink-0" />
                          Print packing slip
                        </button>
                      </div>
                    ) : null}
                  </div>
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

      {skuDetailsOrder ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-6"
          onClick={() => setSkuDetailsOrder(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`SKU details ${skuDetailsOrder.order_number}`}
            className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-base font-semibold tabular-nums text-slate-900">
                  {skuDetailsOrder.order_number}
                </p>
                <p className="truncate text-sm text-slate-500">
                  {skuDetailsOrder.product_type} ·{" "}
                  {skuDetailsOrder.sku_count.toLocaleString()} SKU ·{" "}
                  {skuDetailsOrder.total_qty.toLocaleString()} total qty
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSkuDetailsOrder(null)}
                title="Close"
                aria-label="Close"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {skuDetailsOrder.sku_details.length > 0 ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {skuDetailsOrder.sku_details.map((sku) => (
                    <div
                      key={sku.label}
                      className="flex min-w-0 items-center gap-3 rounded-lg border border-slate-200 p-3"
                    >
                      <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded border border-slate-200 bg-slate-50">
                        {sku.artwork_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={sku.artwork_url}
                            alt={`Artwork ${sku.label}`}
                            className="h-full w-full object-contain"
                          />
                        ) : (
                          <Package className="h-7 w-7 text-slate-300" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900">
                          {sku.label}
                        </p>
                        <p className="text-sm text-slate-500">
                          Qty{" "}
                          <span className="font-semibold tabular-nums text-slate-800">
                            {sku.quantity?.toLocaleString() ?? "—"}
                          </span>
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-8 text-center text-sm text-slate-400">
                  No SKU details available
                </p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
