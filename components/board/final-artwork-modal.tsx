"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { Layers, X } from "lucide-react";
import { fetchWithAuth } from "@/lib/fetch-with-auth";
import { cn } from "@/lib/utils";
import { finalPdfOcgView } from "@/lib/shared-pdf-pages";
import { PdfLoadingBar } from "@/components/pdf/pdf-loading-bar";

const PdfOcgFromUrl = dynamic(
  () =>
    import("@/components/pdf/pdf-ocg-from-url").then((m) => m.PdfOcgFromUrl),
  {
    ssr: false,
    loading: () => <PdfLoadingBar />,
  }
);

type FinalPdfItem = {
  skuId: string;
  skuLabel: string;
  fileId: string;
  fileName: string;
  page: number | null;
};

function looksLikePdf(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 5) return false;
  const head = new Uint8Array(buf.slice(0, 5));
  return (
    head[0] === 0x25 &&
    head[1] === 0x50 &&
    head[2] === 0x44 &&
    head[3] === 0x46
  );
}

function suppressClickThrough() {
  const suppress = (ev: Event) => {
    ev.preventDefault();
    ev.stopPropagation();
  };
  document.addEventListener("click", suppress, true);
  document.addEventListener("mouseup", suppress, true);
  window.setTimeout(() => {
    document.removeEventListener("click", suppress, true);
    document.removeEventListener("mouseup", suppress, true);
  }, 350);
}

export function FinalArtworkModal({
  orderId,
  orderTitle,
  onClose,
}: {
  orderId: string;
  orderTitle: string;
  onClose: () => void;
}) {
  const [items, setItems] = useState<FinalPdfItem[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loadSeconds, setLoadSeconds] = useState(0);

  useEffect(() => {
    if (!loading) {
      setLoadSeconds(0);
      return;
    }
    const started = Date.now();
    setLoadSeconds(0);
    const id = window.setInterval(() => {
      setLoadSeconds(Math.floor((Date.now() - started) / 1000));
    }, 250);
    return () => window.clearInterval(id);
  }, [loading]);

  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();
    const timeout = window.setTimeout(() => ac.abort(), 90_000);
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetchWithAuth(
          `/api/orders/${orderId}/final-artwork`,
          { signal: ac.signal }
        );
        const json = (await res.json().catch(() => ({}))) as {
          items?: FinalPdfItem[];
          files?: { fileId: string; fileName: string }[];
          error?: string;
        };
        if (!res.ok) {
          throw new Error(json.error?.trim() || "Could not load artwork.");
        }
        if (cancelled) return;
        const list =
          Array.isArray(json.items) && json.items.length > 0
            ? json.items
            : (json.files ?? []).map((f, i) => ({
                skuId: f.fileId,
                skuLabel: f.fileName || `File ${i + 1}`,
                fileId: f.fileId,
                fileName: f.fileName,
                page: null,
              }));
        setItems(list);
        setActive(0);
        if (list.length === 0) {
          setError(
            "No PDF in Final production or the Designer folder. Workflow reads Drive with the service account in Settings → Google Drive — sharing the folder with your login is not enough."
          );
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          const aborted =
            err instanceof Error && err.name === "AbortError";
          setError(
            aborted
              ? "Artwork is taking too long to load. Close and try again."
              : err instanceof Error
                ? err.message
                : "Could not load artwork."
          );
          setLoading(false);
        }
      } finally {
        window.clearTimeout(timeout);
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
      window.clearTimeout(timeout);
    };
  }, [orderId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const item = items[active];
  const view = item ? finalPdfOcgView(item) : null;

  useEffect(() => {
    if (!item) {
      setBlobUrl(null);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    const ac = new AbortController();
    const timeout = window.setTimeout(() => ac.abort(), 90_000);
    setLoading(true);
    setBlobUrl(null);
    void (async () => {
      try {
        const res = await fetchWithAuth(
          `/api/orders/${orderId}/final-artwork?fileId=${encodeURIComponent(item.fileId)}`,
          { signal: ac.signal }
        );
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(json.error?.trim() || "Could not load artwork.");
        }
        const buf = await res.arrayBuffer();
        if (!looksLikePdf(buf)) {
          throw new Error(
            "Could not open this PDF. It is loaded through Workflow, not your Google account."
          );
        }
        const url = URL.createObjectURL(
          new Blob([buf], { type: "application/pdf" })
        );
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setBlobUrl(url);
      } catch (err) {
        if (!cancelled) {
          const aborted =
            err instanceof Error && err.name === "AbortError";
          setBlobUrl(null);
          setError(
            aborted
              ? "Artwork is taking too long to load. Close and try again."
              : err instanceof Error
                ? err.message
                : "Could not load artwork."
          );
        }
      } finally {
        window.clearTimeout(timeout);
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
      window.clearTimeout(timeout);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [orderId, item?.fileId]);

  function close() {
    suppressClickThrough();
    onClose();
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex bg-black/70 p-2 sm:p-3"
      onPointerDown={(e) => {
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        e.stopPropagation();
        close();
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              Artwork
            </p>
            <p className="truncate text-sm font-semibold text-slate-800">
              {orderTitle}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {item
                ? `${item.skuLabel}${item.fileName ? ` · ${item.fileName}` : ""}`
                : "PDF pages and layers"}
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            aria-label="Close artwork"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {items.length > 1 ? (
          <div className="flex shrink-0 flex-wrap gap-1.5 border-b border-slate-100 px-4 py-2">
            {items.map((row, i) => (
              <button
                key={`${row.skuId}-${row.fileId}-${row.page ?? "all"}`}
                type="button"
                onClick={() => setActive(i)}
                className={cn(
                  "max-w-[16rem] truncate rounded-md px-2.5 py-1 text-xs font-semibold",
                  i === active
                    ? "bg-blue-600 text-white"
                    : "bg-slate-100 text-slate-700"
                )}
                title={
                  row.page != null
                    ? `${row.skuLabel} · page ${row.page}`
                    : row.fileName
                }
              >
                {row.skuLabel}
                {row.page != null ? ` · p.${row.page}` : ""}
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-2">
          {loading ? (
            <PdfLoadingBar seconds={loadSeconds} />
          ) : error ? (
            <p className="py-10 text-center text-sm text-red-600">{error}</p>
          ) : item && view && blobUrl ? (
            <PdfOcgFromUrl
              src={blobUrl}
              fileName={item.fileName}
              layout={view.layout}
              page={view.page}
              fillHost
            />
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
}

export function SeeArtworkButton({
  onClick,
}: {
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className="flex w-full items-center justify-center gap-1 border-t border-slate-200 bg-slate-50 px-1 py-1.5 text-[11px] font-medium leading-none text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
      aria-label="Open artwork pages and layers"
    >
      <Layers className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
      <span>Artwork</span>
    </button>
  );
}
