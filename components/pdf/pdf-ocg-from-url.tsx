"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Fragment } from "react";
import { Info, Layers, Maximize2, X } from "lucide-react";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import type { OptionalContentConfig } from "pdfjs-dist/types/src/display/optional_content_config";
import { PDFJS_WORKER_SRC } from "@/lib/pdfjs-map-polyfill";
import {
  isUnnamedPdfLayer,
  isPdfArtworkLayer,
  layersFromOptionalContent,
  mergePdfLayers,
  parsePdfOcgs,
  type PdfLayer,
} from "@/lib/pdf-ocg";
import { cn } from "@/lib/utils";
import { OnRollPreview } from "@/components/respond/on-roll-preview";
import type { RollDirectionValue } from "@/lib/roll-direction";
import { PdfLoadingBar } from "@/components/pdf/pdf-loading-bar";

if (typeof window !== "undefined") {
  GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;
}

const PDF_INTENT = "any" as const;
const PDF_OPEN_MS = 20_000;
/** Inline SKU proof (expand still uses the full pane). */
const INLINE_PROOF_MAX_W = 420;

async function fetchPdfBuffer(src: string): Promise<ArrayBuffer> {
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
  return res.arrayBuffer();
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(t);
        resolve(value);
      },
      (err) => {
        window.clearTimeout(t);
        reject(err);
      }
    );
  });
}

export function PdfOcgFromUrl({
  src,
  fileName,
  onPageCount,
  onPageNumber,
  layout = "single",
  page: lockedPage,
  renderPageActions,
  rollDirection = null,
  fillHost = false,
}: {
  src: string;
  fileName: string;
  onPageCount?: (count: number) => void;
  onPageNumber?: (page: number) => void;
  /** `grid` draws every page (PDF multilayer = one picture per page). */
  layout?: "single" | "grid";
  /** When set, only this 1-based page is shown (SKU 1 → page 1). */
  page?: number;
  renderPageActions?: (page: number) => ReactNode;
  /** When set, customers can place the artwork layer onto a roll (one label). */
  rollDirection?: RollDirectionValue | null;
  /** Fill the parent and scale the page to the available width and height. */
  fillHost?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [layers, setLayers] = useState<PdfLayer[]>([]);
  const [visibleIds, setVisibleIds] = useState<Set<string>>(() => new Set());
  const [pageCount, setPageCount] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [expanded, setExpanded] = useState(false);
  const expandedRef = useRef(false);
  expandedRef.current = expanded;
  const [onRoll, setOnRoll] = useState(false);
  const [proofBitmap, setProofBitmap] = useState<string | null>(null);
  const [loadSeconds, setLoadSeconds] = useState(0);
  const [pageActionMounts, setPageActionMounts] = useState<
    { page: number; el: HTMLElement }[]
  >([]);
  const pagesRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const lockedPageRef = useRef(lockedPage);
  lockedPageRef.current = lockedPage;
  const onRollRef = useRef(onRoll);
  onRollRef.current = onRoll;
  const rollDirectionRef = useRef(rollDirection);
  rollDirectionRef.current = rollDirection;
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const visibleIdsRef = useRef(visibleIds);
  visibleIdsRef.current = visibleIds;
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const ocRef = useRef<OptionalContentConfig | null>(null);
  const pageNumberRef = useRef(1);
  const renderTasksRef = useRef<RenderTask[]>([]);
  const lastDrawWidthRef = useRef(0);
  const lastDrawHeightRef = useRef(0);
  const fillHostRef = useRef(fillHost);
  fillHostRef.current = fillHost;
  const onPageCountRef = useRef(onPageCount);
  const onPageNumberRef = useRef(onPageNumber);
  onPageCountRef.current = onPageCount;
  onPageNumberRef.current = onPageNumber;
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
    if (onRollRef.current && rollDirectionRef.current) return;
    const pad = 8;
    const rawW = Math.max(host.clientWidth - pad, 1);
    const availW =
      expandedRef.current || fillHostRef.current
        ? rawW
        : Math.min(rawW, INLINE_PROOF_MAX_W);
    if (availW < 8) return;
    lastDrawWidthRef.current = Math.round(host.clientWidth);
    cancelRenders();
    host.innerHTML = "";
    setPageActionMounts([]);
    const oc = ocRef.current;
    const dpr = window.devicePixelRatio || 1;
    const grid = layoutRef.current === "grid" && lockedPageRef.current == null;

    async function paintPage(
      pageIndex: number,
      boxW: number,
      boxH: number | null,
      parent: HTMLElement
    ) {
      const page: PDFPageProxy = await pdf!.getPage(pageIndex);
      const unscaled = page.getViewport({ scale: 1 });
      const scale = boxH
        ? Math.min(boxW / unscaled.width, boxH / unscaled.height)
        : boxW / unscaled.width;
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      canvas.style.maxWidth = "100%";
      canvas.style.maxHeight = boxH ? "100%" : "none";
      canvas.className = "rounded border border-slate-200 bg-white shadow-sm";
      parent.appendChild(canvas);
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
    }

    if (grid) {
      const nPages = pdf.numPages;
      const cols = Math.min(nPages, availW >= 640 ? 3 : 2);
      const cellW =
        nPages === 1
          ? availW
          : Math.max((availW - 8 * Math.max(cols - 1, 0)) / cols, 40);
      // Width-fit so a single proof fills the SKU box instead of letterboxing.
      const cellH = null;
      const mounts: { page: number; el: HTMLElement }[] = [];
      for (let i = 1; i <= nPages; i++) {
        const wrap = document.createElement("div");
        wrap.className =
          "flex min-w-0 flex-col items-center gap-1.5";
        wrap.style.flex = nPages === 1 ? "1 1 100%" : `1 1 calc(${100 / cols}% - 8px)`;
        wrap.style.maxWidth = nPages === 1 ? "100%" : `${Math.ceil(cellW)}px`;
        const canvasHold = document.createElement("div");
        canvasHold.className =
          "flex w-full cursor-zoom-in items-center justify-center";
        canvasHold.addEventListener("click", (e) => {
          e.stopPropagation();
          setPageNumber(i);
          setExpanded(true);
        });
        wrap.appendChild(canvasHold);
        const actions = document.createElement("div");
        actions.dataset.pageActions = String(i);
        actions.className = "w-full";
        wrap.appendChild(actions);
        host.appendChild(wrap);
        await paintPage(i, cellW, cellH, canvasHold);
        mounts.push({ page: i, el: actions });
      }
      setPageActionMounts(mounts);
      return;
    }

    const availH = Math.max(host.clientHeight - pad, 1);
    if (availH < 8 && grid) return;
    const locked = lockedPageRef.current;
    const n =
      locked != null
        ? Math.min(Math.max(locked, 1), pdf.numPages)
        : Math.min(Math.max(pageNumberRef.current, 1), pdf.numPages);
    await paintPage(
      n,
      availW,
      fillHostRef.current ? availH : null,
      host
    );
  }, [cancelRenders]);

  const captureRollBitmap = useCallback(async () => {
    const pdf = pdfRef.current;
    const oc = ocRef.current;
    if (!pdf || !onRollRef.current || !rollDirectionRef.current) {
      setProofBitmap(null);
      return;
    }
    const locked = lockedPageRef.current;
    const n =
      locked != null
        ? Math.min(Math.max(locked, 1), pdf.numPages)
        : Math.min(Math.max(pageNumberRef.current, 1), pdf.numPages);
    const page = await pdf.getPage(n);
    const unscaled = page.getViewport({ scale: 1 });
    const scale = 720 / unscaled.width;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const list = layersRef.current;
    const art = list.find((layer) => isPdfArtworkLayer(layer.name));
    if (oc) {
      for (const layer of list) {
        oc.setVisibility(layer.id, art ? layer.id === art.id : true, false);
      }
    }
    try {
      await page.render({
        canvas,
        canvasContext: ctx,
        viewport,
        intent: PDF_INTENT,
        optionalContentConfigPromise: oc ? Promise.resolve(oc) : undefined,
      }).promise;
      setProofBitmap(canvas.toDataURL("image/png"));
    } catch {
      /* ignore cancelled */
    } finally {
      if (oc) {
        const vis = visibleIdsRef.current;
        for (const layer of list) {
          oc.setVisibility(layer.id, vis.has(layer.id), false);
        }
      }
    }
  }, []);

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
      lastDrawWidthRef.current = 0;
      lastDrawHeightRef.current = 0;
      await closePdf();
      try {
        const data = await fetchPdfBuffer(src);
        if (cancelled) return;
        const loadingTask = getDocument({
          data,
          disableAutoFetch: true,
          disableStream: true,
        });
        const pdf = await withTimeout(
          loadingTask.promise,
          PDF_OPEN_MS,
          "The PDF preview is taking too long. Open the file below, or uncheck PDF multilayer to see the artwork."
        );
        if (cancelled) {
          await pdf.cleanup();
          await pdf.loadingTask.destroy();
          return;
        }
        pdfRef.current = pdf;
        setPageCount(pdf.numPages);
        if (lockedPage != null && lockedPage > pdf.numPages) {
          throw new Error("This SKU has no matching page in the PDF.");
        }
        const startPage = lockedPage ?? 1;
        setPageNumber(startPage);
        pageNumberRef.current = startPage;
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
        if (!cancelled) setLoading(false);
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
  }, [src, closePdf, drawPages, lockedPage]);

  useEffect(() => {
    const host = pagesRef.current;
    if (!host) return;
    let timer = 0;
    const ro = new ResizeObserver((entries) => {
      if (onRollRef.current) return;
      const w = Math.round(entries[0]?.contentRect.width ?? host.clientWidth);
      const h = Math.round(entries[0]?.contentRect.height ?? host.clientHeight);
      if (fillHostRef.current) {
        if (w === lastDrawWidthRef.current && h === lastDrawHeightRef.current) {
          return;
        }
        lastDrawHeightRef.current = h;
      } else if (w === lastDrawWidthRef.current) {
        return;
      }
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
  }, [drawPages, expanded, fillHost]);

  useEffect(() => {
    if (!pdfRef.current) return;
    const id = window.requestAnimationFrame(() => {
      void drawPages();
    });
    return () => window.cancelAnimationFrame(id);
  }, [expanded, pageNumber, drawPages, layout, lockedPage, onRoll, fillHost]);

  useEffect(() => {
    if (loading || !onRoll || !rollDirection) {
      setProofBitmap(null);
      return;
    }
    void captureRollBitmap();
  }, [
    loading,
    onRoll,
    rollDirection,
    pageNumber,
    lockedPage,
    captureRollBitmap,
  ]);

  useEffect(() => {
    onPageCountRef.current?.(lockedPage != null ? 1 : pageCount);
  }, [pageCount, lockedPage]);

  useEffect(() => {
    onPageNumberRef.current?.(pageNumber);
  }, [pageNumber]);

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
        e.stopPropagation();
        e.stopImmediatePropagation();
        setExpanded(false);
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey, true);
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
        "flex flex-col overflow-hidden bg-white",
        expanded || fillHost
          ? "h-full min-h-0 flex-1 rounded-lg shadow-2xl"
          : "rounded-md border border-slate-200"
      )}
    >
      <div className="shrink-0 space-y-2 border-b border-slate-100 px-3 py-2">
        {pageCount >= 2 && lockedPage == null && !loading && !error ? (
          <div className="flex items-center gap-1.5 rounded-md bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800">
            <Info className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Please review all {pageCount} sides before approving.
          </div>
        ) : null}
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-sm font-medium text-slate-600">
            {fileName}
            {lockedPage != null && pageCount >= 1
              ? ` · Page ${lockedPage}`
              : ""}
          </span>
          <button
            type="button"
            className={cn(
              "ml-auto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800",
              fillHost && !expanded ? "hidden" : null
            )}
            title={expanded ? "Close large view" : "Open large view"}
            aria-label={expanded ? "Close large view" : "Open large view"}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? <X className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>
        {pageCount >= 1 &&
        !loading &&
        !error &&
        layout !== "grid" &&
        lockedPage == null &&
        !(onRoll && rollDirection) ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Image
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
                    className={chip(on)}
                  >
                    Side {n} of {pageCount}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        {!loading && !error ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {!(onRoll && rollDirection) ? (
              <>
            <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Layer
              <Layers className="h-3.5 w-3.5" aria-hidden />
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
                    className={cn(
                      "max-w-[12rem] truncate",
                      chip(visibleIds.has(layer.id))
                    )}
                    title={layer.name}
                  >
                    {layer.name}
                  </button>
                ))}
              </>
            ) : (
              <span className="text-[11px] text-slate-400">No layers in this file</span>
            )}
              </>
            ) : (
              <span className="text-xs font-medium text-slate-500">
                Artwork only · one label
              </span>
            )}
            {rollDirection ? (
              <div className="ml-auto flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Roll preview
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={onRoll}
                  onClick={() => setOnRoll((v) => !v)}
                  className={cn(
                    "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors",
                    onRoll ? "bg-blue-600" : "bg-slate-200"
                  )}
                >
                  <span className="sr-only">Show artwork on roll</span>
                  <span
                    className={cn(
                      "inline-block h-5 w-5 rounded-full bg-white shadow transition-transform",
                      onRoll ? "translate-x-6" : "translate-x-1"
                    )}
                  />
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {error ? (
        <div className="space-y-2 px-3 py-6 text-center">
          <p className="text-xs text-red-600">{error}</p>
          <a
            href={src}
            target="_blank"
            rel="noreferrer"
            className="inline-block text-xs font-medium text-blue-600 underline"
          >
            Open {fileName} in a new tab
          </a>
        </div>
      ) : (
        <div
          className={cn(
            "relative flex w-full flex-col items-stretch",
            expanded
              ? "min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable]"
              : fillHost
                ? "min-h-0 flex-1 overflow-hidden"
              : loading
                ? "min-h-[16rem] overflow-hidden"
                : "overflow-hidden"
          )}
        >
          {loading ? (
            <PdfLoadingBar seconds={loadSeconds} />
          ) : null}
          <div
            ref={pagesRef}
            title={
              expanded || loading || layout === "grid"
                ? undefined
                : "Click to open large view"
            }
            className={cn(
              "w-full p-1",
              onRoll && rollDirection && !loading
                ? "hidden"
                : layout === "grid"
                ? "flex min-h-full w-full flex-wrap content-start items-start justify-center gap-2"
                : "flex min-h-full items-start justify-center",
              !onRoll && !expanded && !loading && !fillHost
                ? layout === "grid"
                  ? "min-h-[20rem]"
                  : "min-h-[20rem] cursor-zoom-in"
                : !onRoll && !loading && layout !== "grid" && !fillHost
                  ? "min-h-[20rem]"
                  : layout === "grid" && loading
                    ? "min-h-[16rem]"
                    : fillHost
                      ? "h-full min-h-0"
                      : null
            )}
            onClick={() => {
              if (!fillHost && !expanded && !loading && layout !== "grid" && !onRoll)
                setExpanded(true);
            }}
          />
          {onRoll && rollDirection && !loading && proofBitmap ? (
            <OnRollPreview
              artworkSrc={proofBitmap}
              direction={rollDirection}
            />
          ) : onRoll && rollDirection && !loading ? (
            <p className="px-3 py-8 text-center text-sm text-slate-500">
              Building roll preview…
            </p>
          ) : null}
          {renderPageActions && !(onRoll && rollDirection)
            ? pageActionMounts.map(({ page, el }) =>
                el.isConnected ? (
                  <Fragment key={page}>
                    {createPortal(
                      <div className="space-y-1">
                        <p className="text-center text-[11px] text-slate-500">
                          Side {page} of {pageCount}
                        </p>
                        {renderPageActions(page)}
                      </div>,
                      el
                    )}
                  </Fragment>
                ) : null
              )
            : null}
        </div>
      )}
    </div>
  );

  if (expanded && typeof document !== "undefined") {
    return (
      <>
        <div
          className="h-[min(90vh,56rem)] min-h-[36rem] rounded-md border border-slate-200 bg-slate-50"
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
