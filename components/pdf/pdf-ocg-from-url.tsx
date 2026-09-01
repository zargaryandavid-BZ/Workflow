"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import type { OptionalContentConfig } from "pdfjs-dist/types/src/display/optional_content_config";
import {
  layersFromOptionalContent,
  mergePdfLayers,
  parsePdfOcgs,
  type PdfLayer,
} from "@/lib/pdf-ocg";

if (typeof window !== "undefined") {
  GlobalWorkerOptions.workerSrc = "/api/pdf-worker";
}

const PDF_INTENT = "any" as const;

export function PdfOcgFromUrl({
  src,
  fileName,
}: {
  src: string;
  fileName: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [layers, setLayers] = useState<PdfLayer[]>([]);
  const [activeLayer, setActiveLayer] = useState<"all" | string>("all");
  const [pageCount, setPageCount] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
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
    cancelRenders();
    host.innerHTML = "";
    const oc = ocRef.current;
    const pad = 8;
    const availW = Math.max(host.clientWidth - pad, 1);
    const availH = Math.max(host.clientHeight - pad, 1);
    if (availW < 8 || availH < 8) return;
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
      setActiveLayer("all");
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
        const found = mergePdfLayers(
          layersFromOptionalContent(oc),
          parsePdfOcgs(data)
        );
        setLayers(found);
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
  }, [drawPages]);

  useEffect(() => {
    if (pdfRef.current) void drawPages();
  }, [pageNumber, drawPages]);

  async function showOnly(which: "all" | string) {
    const oc = ocRef.current;
    if (!oc) return;
    setActiveLayer(which);
    for (const layer of layers) {
      oc.setVisibility(layer.id, which === "all" || layer.id === which, false);
    }
    try {
      await drawPages();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not refresh the PDF.");
    }
  }

  return (
    <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-2 py-1.5">
        <span className="truncate text-[11px] font-medium text-slate-500">
          {fileName}
        </span>
        {layers.length > 0 ? (
          <>
            <span className="text-slate-300">|</span>
            <button
              type="button"
              onClick={() => void showOnly("all")}
              className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                activeLayer === "all"
                  ? "bg-blue-600 text-white"
                  : "bg-slate-100 text-slate-600"
              }`}
            >
              ALL
            </button>
            {layers.map((layer) => (
              <button
                key={layer.id}
                type="button"
                onClick={() => void showOnly(layer.id)}
                className={`max-w-[10rem] truncate rounded px-2 py-0.5 text-[11px] font-semibold ${
                  activeLayer === layer.id
                    ? "bg-blue-600 text-white"
                    : "bg-slate-100 text-slate-600"
                }`}
                title={layer.name}
              >
                {layer.name}
              </button>
            ))}
          </>
        ) : !loading && !error ? (
          <span className="text-[11px] text-slate-400">No layers in this file</span>
        ) : null}
        {pageCount > 1 ? (
          <span className="ml-auto inline-flex items-center gap-0.5">
            <button
              type="button"
              disabled={pageNumber <= 1}
              onClick={() => setPageNumber((n) => Math.max(1, n - 1))}
              className="rounded p-0.5 text-slate-500 disabled:opacity-30"
              aria-label="Previous page"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="text-[11px] text-slate-500">
              {pageNumber}/{pageCount}
            </span>
            <button
              type="button"
              disabled={pageNumber >= pageCount}
              onClick={() => setPageNumber((n) => Math.min(pageCount, n + 1))}
              className="rounded p-0.5 text-slate-500 disabled:opacity-30"
              aria-label="Next page"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </span>
        ) : null}
      </div>
      {error ? (
        <p className="px-2 py-6 text-center text-xs text-red-600">{error}</p>
      ) : null}
      {loading ? (
        <p className="px-2 py-6 text-center text-xs text-slate-400">Opening PDF…</p>
      ) : null}
      {error ? null : (
        <div ref={pagesRef} className="flex h-72 w-full items-center justify-center p-2" />
      )}
    </div>
  );
}
