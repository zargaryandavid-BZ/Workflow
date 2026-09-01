"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileText, FolderOpen, Info } from "lucide-react";
import { GlobalWorkerOptions, getDocument, version } from "pdfjs-dist";
import type {
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
} from "pdfjs-dist";
import type { OptionalContentConfig } from "pdfjs-dist/types/src/display/optional_content_config";
import {
  layersFromOptionalContent,
  mergePdfLayers,
  parsePdfOcgs,
  type PdfLayer,
} from "@/lib/pdf-ocg";

if (typeof window !== "undefined") {
  GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${version}/build/pdf.worker.min.mjs`;
}

type LayerBtn = PdfLayer;

/** Must match on getOptionalContentConfig and page.render. */
const PDF_INTENT = "any" as const;

export function PdfLayerViewer() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [layers, setLayers] = useState<LayerBtn[]>([]);
  const [activeLayer, setActiveLayer] = useState<"all" | string>("all");
  const [pageCount, setPageCount] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const fileRef = useRef<HTMLInputElement>(null);
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

    const n = Math.min(
      Math.max(pageNumberRef.current, 1),
      pdf.numPages
    );
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
    canvas.className =
      "rounded border border-slate-200 bg-white shadow-sm";
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
    return () => {
      void closePdf();
    };
  }, [closePdf]);

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

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("Please select a PDF file.");
      return;
    }
    setError(null);
    setLoading(true);
    setLayers([]);
    setActiveLayer("all");
    setPageCount(0);
    setPageNumber(1);
    pageNumberRef.current = 1;
    await closePdf();

    try {
      const data = await file.arrayBuffer();
      const pdf = await getDocument({ data }).promise;
      pdfRef.current = pdf;
      setFileName(file.name);
      setPageCount(pdf.numPages);
      setPageNumber(1);
      pageNumberRef.current = 1;

      const oc = await pdf.getOptionalContentConfig({ intent: PDF_INTENT });
      ocRef.current = oc;
      const found = mergePdfLayers(
        layersFromOptionalContent(oc),
        parsePdfOcgs(data)
      );
      setLayers(found);
      setActiveLayer("all");
      for (const layer of found) oc.setVisibility(layer.id, true, false);

      await drawPages();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || "Could not open this PDF.");
      setFileName(null);
      setPageCount(0);
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

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
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || "Could not refresh the PDF.");
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50">
      <div className="flex shrink-0 items-center gap-4 border-b border-slate-200 bg-white px-6 py-3 shadow-sm">
        <h1 className="sr-only">PDF</h1>
        <label className="group relative inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-blue-400 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100">
          Upload PDF
          <Info className="h-3.5 w-3.5 shrink-0 text-blue-500" aria-hidden />
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={handleFileChange}
          />
          <span
            role="tooltip"
            className="pointer-events-none invisible absolute left-0 top-full z-50 mt-2 w-80 rounded-md border border-slate-200 bg-white px-3 py-2 text-left text-xs font-normal leading-relaxed text-slate-600 shadow-lg group-hover:visible"
          >
            Use PDF/X-4 (or PDF 1.6 / 1.7, High Quality Print) with{" "}
            <span className="font-semibold text-slate-800">
              Create Acrobat Layers from Top-Level Layers
            </span>{" "}
            turned on in Illustrator. Press Quality / PDF/X-1a flattens layers.
          </span>
        </label>
        {fileName ? (
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto text-sm">
            <span className="inline-flex shrink-0 items-center gap-1 font-medium text-slate-700">
              <FileText className="h-4 w-4 shrink-0" aria-hidden />
              {fileName}
            </span>
            {layers.length > 0 ? (
              <>
                <span className="shrink-0 text-slate-300">|</span>
                <button
                  type="button"
                  onClick={() => void showOnly("all")}
                  className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-semibold ${
                    activeLayer === "all"
                      ? "bg-blue-600 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  ALL
                </button>
                {layers.map((layer) => (
                  <span key={layer.id} className="inline-flex shrink-0 items-center gap-2">
                    <span className="text-slate-300">|</span>
                    <button
                      type="button"
                      onClick={() => void showOnly(layer.id)}
                      className={`max-w-[12rem] truncate rounded-md px-2.5 py-1 text-xs font-semibold ${
                        activeLayer === layer.id
                          ? "bg-blue-600 text-white"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                      title={layer.name}
                    >
                      {layer.name}
                    </button>
                  </span>
                ))}
              </>
            ) : (
              <>
                <span className="shrink-0 text-slate-300">|</span>
                <span className="shrink-0 text-xs text-slate-400">
                  No layers in this file
                </span>
              </>
            )}
          </div>
        ) : null}
        {pageCount > 1 ? (
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <button
              type="button"
              aria-label="Previous page"
              disabled={pageNumber <= 1}
              onClick={() =>
                setPageNumber((n) => Math.max(1, n - 1))
              }
              className="rounded-md p-1 text-slate-600 hover:bg-slate-100 disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[4.5rem] text-center text-xs font-medium text-slate-500">
              {pageNumber} / {pageCount}
            </span>
            <button
              type="button"
              aria-label="Next page"
              disabled={pageNumber >= pageCount}
              onClick={() =>
                setPageNumber((n) => Math.min(pageCount, n + 1))
              }
              className="rounded-md p-1 text-slate-600 hover:bg-slate-100 disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        ) : null}
        {loading ? (
          <span className="shrink-0 text-sm text-slate-500">Opening…</span>
        ) : null}
        {error ? (
          <span className="max-w-md shrink-0 text-sm font-medium text-red-600">
            {error}
          </span>
        ) : null}
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {!fileName && !loading ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-400">
            <FolderOpen className="h-12 w-12" aria-hidden />
            <p className="text-base font-medium">Upload a PDF</p>
            <p className="text-sm">
              Layer buttons appear next to the file name
            </p>
          </div>
        ) : null}
        <div
          ref={pagesRef}
          className="flex h-full w-full items-center justify-center overflow-hidden p-3"
        />
      </div>
    </div>
  );
}
