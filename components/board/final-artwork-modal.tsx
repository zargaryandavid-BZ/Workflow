"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { Layers, X } from "lucide-react";
import { fetchWithAuth } from "@/lib/fetch-with-auth";
import { cn } from "@/lib/utils";
import { PdfLoadingBar } from "@/components/pdf/pdf-loading-bar";

const PdfOcgFromUrl = dynamic(
  () =>
    import("@/components/pdf/pdf-ocg-from-url").then((m) => m.PdfOcgFromUrl),
  {
    ssr: false,
    loading: () => <PdfLoadingBar />,
  }
);

type FinalPdfFile = { fileId: string; fileName: string };

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
  const [files, setFiles] = useState<FinalPdfFile[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetchWithAuth(
          `/api/orders/${orderId}/final-artwork`
        );
        const json = (await res.json().catch(() => ({}))) as {
          files?: FinalPdfFile[];
          error?: string;
        };
        if (!res.ok) {
          throw new Error(json.error?.trim() || "Could not load artwork.");
        }
        if (cancelled) return;
        const list = Array.isArray(json.files) ? json.files : [];
        setFiles(list);
        setActive(0);
        if (list.length === 0) {
          setError("No PDF in the Final production folder.");
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Could not load artwork."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
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

  const file = files[active];

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
              Pages and layers from Final production
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
        {files.length > 1 ? (
          <div className="flex shrink-0 flex-wrap gap-1.5 border-b border-slate-100 px-4 py-2">
            {files.map((item, i) => (
              <button
                key={item.fileId}
                type="button"
                onClick={() => setActive(i)}
                className={cn(
                  "max-w-[16rem] truncate rounded-md px-2.5 py-1 text-xs font-semibold",
                  i === active
                    ? "bg-blue-600 text-white"
                    : "bg-slate-100 text-slate-700"
                )}
                title={item.fileName}
              >
                {item.fileName}
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-2">
          {loading ? (
            <PdfLoadingBar />
          ) : error ? (
            <p className="py-10 text-center text-sm text-red-600">{error}</p>
          ) : file ? (
            <PdfOcgFromUrl
              src={`/api/orders/${orderId}/final-artwork?fileId=${encodeURIComponent(file.fileId)}`}
              fileName={file.fileName}
              layout="single"
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
