"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Image as ImageIcon, Layers, Maximize2, X } from "lucide-react";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import type { OptionalContentConfig } from "pdfjs-dist/types/src/display/optional_content_config";
import {
  isUnnamedPdfLayer,
  layersFromOptionalContent,
  mergePdfLayers,
  parsePdfOcgs,
  type PdfLayer,
} from "@/lib/pdf-ocg";
import { cn } from "@/lib/utils";

if (typeof window !== "undefined") {
  GlobalWorkerOptions.workerSrc = "/api/pdf-worker";
}

const PDF_INTENT = "any" as const;

export function PdfOcgFromUrl({
  src,
  fileName,
  onPageCount,
  onPageNumber,
}: {
  src: string;
  fileName: string;
  onPageCount?: (count: number) => void;
  onPageNumber?: (page: number) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [layers, setLayers] = useState<PdfLayer[]>([]);
  const [visibleIds, setVisibleIds] = useState<Set<string>>(() => new Set());
  const [pageCount, setPageCount] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [expanded, setExpanded] = useState(false);
  const [loadSeconds, setLoadSeconds] = useState(0);
  const pagesRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const ocRef = useRef<OptionalContentConfig | null>(null);
  const pageNumberRef = useRef(1);
  const renderTasksRef = useRef<RenderTask[]>([]);
  pageNumberRef.current = pageNumber;

  const cancelRenders = useCallback(() => {
    for (const task of renderTasksRef.current) {
      try {
        task.cancel();
      } catch {
        /* ignore */
      }
    }
    renderTasksRef.current = [];
  }, []);

  const closePdf = useCallback(async () => {
    cancelRenders();
    const pdf = pdfRef.current;
    pdfRef.current = null;
    ocRef.current = null;
    if (pdf) {
      await pdf.cleanup();
      await pdf.loadingTask.destroy();
    }
  }, [cancelRenders]);

  const drawPages = useCallback(async () => {
    const pdf = pdfRef.current;
    const host = pagesRef.current;
    if (!pdf || !host) return;
    const pad = 8;
    const availW = Math.max(host.clientWidth - pad, 1);
    const availH = Math.max(host.clientHeight - pad, 1);
    if (availW < 8 || availH < 8) return;
    cancelRenders();
    host.innerHTML = "";
    const oc = ocRef.current;
    const n = Math.min(Math.max(pageNumberRef.current, 1), pdf.numPages);
    const page: PDFPageProxy = await pdf.getPage(n);
    const unscaled = page.getViewport({ scale: 1 });
    const scale = Math.min(availW / unscaled.width, availH / unscaled.height);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    canvas.style.maxWidth = "100%";
    canvas.style.maxHeight = "100%";
    canvas.className = "rounded border border-slate-200 bg-white shadow-sm";
    host.appendChild(canvas);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const task = page.render({
      canvas,
      canvasContext: ctx,
      viewport,
      intent: PDF_INTENT,
      optionalContentConfigPromise: oc ? Promise.resolve(oc) : undefined,
    });
    renderTasksRef.current.push(task);
    try {
      await task.promise;
    } catch (err) {
      if (
        err &&
        typeof err === "object" &&
        "name" in err &&
        (err as { name: string }).name === "RenderingCancelledException"
      ) {
        return;
      }
      throw err;
    }
  }, [cancelRenders]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      setLayers([]);
      setVisibleIds(new Set());
      setPageCount(0);
      setPageNumber(1);
      pageNumberRef.current = 1;
      await closePdf();
      try {
        const res = await fetch(src);
        if (!res.ok) {
          let message = "Could not load the PDF.";
          try {
            const body = (await res.json()) as { error?: string };
            if (body.error?.trim()) message = body.error.trim();
          } catch {
            /* ignore */
          }
          throw new Error(message);
        }
        const data = await res.arrayBuffer();
        if (cancelled) return;
        const pdf = await getDocument({ data }).promise;
        if (cancelled) {
          await pdf.cleanup();
          await pdf.loadingTask.destroy();
          return;
        }
        pdfRef.current = pdf;
        setPageCount(pdf.numPages);
        const oc = await pdf.getOptionalContentConfig({ intent: PDF_INTENT });
        ocRef.current = oc;
        const fromOc = layersFromOptionalContent(oc);
        const found =
          data.byteLength > 12 * 1024 * 1024
            ? fromOc
            : mergePdfLayers(fromOc, parsePdfOcgs(data));
        setLayers(found);
        setVisibleIds(new Set(found.map((layer) => layer.id)));
        for (const layer of found) oc.setVisibility(layer.id, true, false);
        await drawPages();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not open this PDF.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      void closePdf();
    };
  }, [src, closePdf, drawPages]);

  useEffect(() => {
    const host = pagesRef.current;
    if (!host) return;
    let timer = 0;
    const ro = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (pdfRef.current) void drawPages();
      }, 50);
    });
    ro.observe(host);
    return () => {
      window.clearTimeout(timer);
      ro.disconnect();
    };
  }, [drawPages, expanded]);

  useEffect(() => {
    if (!pdfRef.current) return;
    const id = window.requestAnimationFrame(() => {
      void drawPages();
    });
    return () => window.cancelAnimationFrame(id);
  }, [expanded, pageNumber, drawPages]);

  useEffect(() => {
    onPageCount?.(pageCount);
  }, [pageCount, onPageCount]);

  useEffect(() => {
    onPageNumber?.(pageNumber);
  }, [pageNumber, onPageNumber]);

  useEffect(() => {
    if (!loading) {
      setLoadSeconds(0);
      return;
    }
    setLoadSeconds(1);
    const id = window.setInterval(() => {
      setLoadSeconds((s) => s + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [loading]);

  useEffect(() => {
    if (!expanded) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setExpanded(false);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [expanded]);

  async function applyVisibility(next: Set<string>) {
    const oc = ocRef.current;
    if (!oc) return;
    setVisibleIds(next);
    for (const layer of layers) {
      oc.setVisibility(layer.id, next.has(layer.id), false);
    }
    try {
      await drawPages();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not refresh the PDF.");
    }
  }

  function showAllLayers() {
    void applyVisibility(new Set(layers.map((layer) => layer.id)));
  }

  function toggleLayer(id: string) {
    const next = new Set(visibleIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    void applyVisibility(next);
  }

  const allOn = layers.length > 0 && layers.every((layer) => visibleIds.has(layer.id));
  const namedLayers = layers.filter((layer) => !isUnnamedPdfLayer(layer.name));
  const chip = (on: boolean) =>
    `rounded-md px-3 py-1.5 text-sm font-semibold ${
      on ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700"
    }`;

  const viewer = (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden bg-white",
        expanded
          ? "h-full min-h-0 flex-1 rounded-lg shadow-2xl"
          : "rounded-md border border-slate-200"
      )}
    >
      <div className="shrink-0 space-y-2 border-b border-slate-100 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-sm font-medium text-slate-600">
            {fileName}
          </span>
          <button
            type="button"
            className="ml-auto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            title={expanded ? "Close large view" : "Open large view"}
            aria-label={expanded ? "Close large view" : "Open large view"}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? <X className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>
        {pageCount >= 1 && !loading && !error ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-slate-700">
              <ImageIcon className="h-4 w-4 shrink-0 text-blue-600" aria-hidden />
              Select Image
            </span>
            <div
              className="inline-flex flex-wrap items-center gap-1.5"
              role="group"
              aria-label="Select image"
            >
              {Array.from({ length: pageCount }, (_, i) => {
                const n = i + 1;
                const on = pageNumber === n;
                return (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setPageNumber(n)}
                    className={cn("min-w-[2rem]", chip(on))}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        {!loading && !error ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-slate-700">
              <Layers className="h-4 w-4 shrink-0 text-blue-600" aria-hidden />
              Select Layer
            </span>
            {layers.length > 0 ? (
              <>
                <button
                  type="button"
                  onClick={showAllLayers}
                  className={chip(allOn)}
                >
                  ALL
                </button>
                {namedLayers.map((layer) => (
                  <button
                    key={layer.id}
                    type="button"
                    onClick={() => toggleLayer(layer.id)}
                    className={cn("max-w-[12rem] truncate", chip(visibleIds.has(layer.id)))}
                    title={layer.name}
                  >
                    {layer.name}
                  </button>
                ))}
              </>
            ) : (
              <span className="text-[11px] text-slate-400">No layers in this file</span>
            )}
          </div>
        ) : null}
      </div>
      {error ? (
        <p className="px-2 py-6 text-center text-xs text-red-600">{error}</p>
      ) : (
        <div
          className={cn(
            "relative flex w-full items-center justify-center",
            expanded ? "min-h-0 flex-1" : "h-[min(75vh,40rem)] min-h-[28rem]"
          )}
        >
          {loading ? (
            <div
              className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-slate-50 px-4 text-center"
              role="status"
              aria-live="polite"
            >
              <span
                className="h-8 w-8 animate-spin rounded-full border-[3px] border-slate-200 border-t-blue-600"
                aria-hidden
              />
              <p className="max-w-sm text-base font-semibold text-slate-800">
                Great things take a little wait. Almost there.
              </p>
              <p
                className="text-lg font-semibold tabular-nums text-blue-700"
                aria-label={`Loading ${loadSeconds} seconds`}
              >
                Loading... {loadSeconds}s
              </p>
            </div>
          ) : null}
          <div
            ref={pagesRef}
            title={expanded || loading ? undefined : "Click to open large view"}
            className={cn(
              "flex h-full w-full items-center justify-center p-2",
              !expanded && !loading ? "cursor-zoom-in" : null
            )}
            onClick={() => {
              if (!expanded && !loading) setExpanded(true);
            }}
          />
        </div>
      )}
    </div>
  );

  if (expanded && typeof document !== "undefined") {
    return (
      <>
        <div
          className="h-[min(75vh,40rem)] min-h-[28rem] rounded-md border border-slate-200 bg-slate-50"
          aria-hidden
        />
        {createPortal(
          <div
            className="fixed inset-0 z-[9999] flex flex-col bg-black/85 p-3 sm:p-5"
            onClick={(e) => {
              if (e.target === e.currentTarget) setExpanded(false);
            }}
          >
            {viewer}
          </div>,
          document.body
        )}
      </>
    );
  }

  return viewer;
}
