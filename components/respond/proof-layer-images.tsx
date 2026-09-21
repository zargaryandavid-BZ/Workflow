"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Layers, Maximize2, X } from "lucide-react";
import { isPdfCutLineLayer, isUnnamedPdfLayer } from "@/lib/pdf-ocg";
import {
  respondLayerPreviewUrl,
  type RespondLayerPreview,
} from "@/lib/approval-layer-preview-paths";
import { OnRollPreview } from "@/components/respond/on-roll-preview";
import type { RollDirectionValue } from "@/lib/roll-direction";
import { cn } from "@/lib/utils";

type LayerPic = {
  id: string;
  name: string;
  layer: string;
};

/**
 * Build the lookup key matching what respond-proof.tsx writes into
 * preSignedLayerUrls: `${fileId}|${rev}|${page}|${layer}`.
 */
function preSignKey(
  preview: RespondLayerPreview,
  layer: string
): string {
  return `${preview.fileId}|${preview.rev}|${preview.page}|${layer}`;
}

export function ProofLayerImages({
  token,
  orderId,
  preview,
  fileName,
  rollDirection = null,
  labelWidthIn = null,
  labelHeightIn = null,
  preSignedLayerUrls,
  onReady,
}: {
  token: string;
  orderId: string;
  preview: RespondLayerPreview;
  fileName: string;
  rollDirection?: RollDirectionValue | null;
  labelWidthIn?: number | null;
  labelHeightIn?: number | null;
  /** Pre-signed Supabase URLs keyed by `${fileId}|${rev}|${page}|${layer}`. */
  preSignedLayerUrls?: Record<string, string>;
  onReady?: () => void;
}) {
  const namedLayers = useMemo(
    () => preview.layers.filter((layer) => !isUnnamedPdfLayer(layer.name)),
    [preview.layers]
  );
  const printLayerIds = useMemo(
    () =>
      namedLayers
        .filter((layer) => !isPdfCutLineLayer(layer.name))
        .map((layer) => layer.id),
    [namedLayers]
  );
  const [visibleIds, setVisibleIds] = useState<Set<string>>(
    () => new Set(printLayerIds)
  );
  const [stackOpen, setStackOpen] = useState(false);
  const [onRoll, setOnRoll] = useState(false);

  useEffect(() => {
    setVisibleIds(new Set(printLayerIds));
  }, [preview.fileId, preview.page, preview.rev, printLayerIds.join("|")]);

  useEffect(() => {
    onReady?.();
  }, [preview.fileId, preview.page, preview.rev]);

  const pics = useMemo<LayerPic[]>(() => {
    if (namedLayers.length === 0) {
      return [{ id: "composite", name: "Proof", layer: "composite" }];
    }
    return namedLayers
      .filter((layer) => visibleIds.has(layer.id))
      // Cut/dieline layers render LAST so they sit on top of the print art —
      // otherwise the artwork (which bleeds to the trim edge) covers the thin
      // cut line and the dieline looks like it disappeared.
      .slice()
      .sort(
        (a, b) =>
          Number(isPdfCutLineLayer(a.name)) - Number(isPdfCutLineLayer(b.name))
      )
      .map((layer) => ({
        id: layer.id,
        name: layer.name,
        layer: layer.id,
      }));
  }, [namedLayers, visibleIds]);

  const allOn =
    namedLayers.length > 0 &&
    namedLayers.every((layer) => visibleIds.has(layer.id));
  const printAllOn =
    printLayerIds.length > 0 &&
    printLayerIds.every((id) => visibleIds.has(id));
  const cutOn = namedLayers.some(
    (layer) => isPdfCutLineLayer(layer.name) && visibleIds.has(layer.id)
  );
  const useComposite =
    namedLayers.length === 0 || (printAllOn && !cutOn);

  function setAllLayers(on: boolean) {
    setVisibleIds(on ? new Set(namedLayers.map((layer) => layer.id)) : new Set());
  }

  function toggleLayer(id: string) {
    setVisibleIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function layerSrc(layer: string) {
    return (
      preSignedLayerUrls?.[preSignKey(preview, layer)] ??
      respondLayerPreviewUrl(token, orderId, preview, layer)
    );
  }

  const compositeSrc = layerSrc("composite");

  const stack = (
    <ProofLayerStack
      useComposite={useComposite}
      compositeSrc={compositeSrc}
      pics={pics}
      srcFor={layerSrc}
      className="max-h-[22rem]"
    />
  );

  return (
    <div className="flex min-h-[16rem] flex-col overflow-hidden rounded-md border border-slate-200 bg-white">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
        <span className="min-w-0 truncate text-sm font-medium text-slate-600">
          {fileName}
          {preview.page ? ` · page ${preview.page}` : ""}
        </span>
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
        ) : (
          <button
            type="button"
            className="rounded p-1 text-slate-400 hover:bg-slate-50 hover:text-slate-700"
            title="Large view"
            onClick={() => setStackOpen(true)}
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        )}
      </div>

      {namedLayers.length > 0 && !(onRoll && rollDirection) ? (
        <div className="flex flex-col gap-2 border-b border-slate-100 px-3 py-2">
          <p className="flex items-start gap-1.5 text-xs text-slate-600">
            <Layers className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-600" aria-hidden />
            <span>
              This SKU is one PDF page. SEE LAYERS stacks print plates on
              the same proof — they are not separate pictures.
            </span>
          </p>
          <div
            className="flex flex-wrap items-center gap-x-3 gap-y-2"
            role="group"
            aria-label="Print layers"
          >
            <span className="animate-see-layers inline-flex shrink-0 items-center gap-1 text-xs font-semibold uppercase tracking-wide">
              SEE LAYERS
              <Layers className="h-3.5 w-3.5" aria-hidden />
            </span>
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={allOn}
                onChange={(e) => setAllLayers(e.target.checked)}
                className="h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span>ALL</span>
            </label>
            {namedLayers.map((layer) => {
              const on = visibleIds.has(layer.id);
              return (
                <label
                  key={layer.id}
                  className="inline-flex max-w-[12rem] cursor-pointer items-center gap-1.5 text-sm font-medium text-slate-700"
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggleLayer(layer.id)}
                    className="h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="truncate">{layer.name}</span>
                </label>
              );
            })}
          </div>
        </div>
      ) : null}

      {onRoll && rollDirection ? (
        <OnRollPreview
          artworkSrc={compositeSrc}
          direction={rollDirection}
          labelWidthIn={labelWidthIn}
          labelHeightIn={labelHeightIn}
        />
      ) : pics.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-slate-500">
          Turn on a layer to preview this SKU.
        </p>
      ) : (
        <div className="p-4">
          <button
            type="button"
            onClick={() => setStackOpen(true)}
            className="mx-auto flex w-full max-w-xl items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-[linear-gradient(45deg,#e5e7eb_25%,transparent_25%,transparent_75%,#e5e7eb_75%),linear-gradient(45deg,#e5e7eb_25%,transparent_25%,transparent_75%,#e5e7eb_75%)] bg-[length:16px_16px] bg-[position:0_0,8px_8px] bg-white"
            title="Open large view"
          >
            {stack}
          </button>
        </div>
      )}

      {stackOpen && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[80] flex flex-col bg-white">
              <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-2">
                <span className="truncate text-sm font-medium text-slate-700">
                  {useComposite
                    ? "Proof"
                    : pics.map((p) => p.name).join(" + ") || "Proof"}
                </span>
                <button
                  type="button"
                  className="rounded p-1 text-slate-500 hover:bg-slate-100"
                  onClick={() => setStackOpen(false)}
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-slate-50 p-6">
                <ProofLayerStack
                  useComposite={useComposite}
                  compositeSrc={compositeSrc}
                  pics={pics}
                  srcFor={layerSrc}
                  className="max-h-full max-w-full"
                />
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

function ProofLayerStack({
  useComposite,
  compositeSrc,
  pics,
  srcFor,
  className,
}: {
  useComposite: boolean;
  compositeSrc: string;
  pics: LayerPic[];
  srcFor: (layer: string) => string;
  className?: string;
}) {
  if (useComposite || pics.length <= 1) {
    const src = useComposite ? compositeSrc : srcFor(pics[0]?.layer ?? "composite");
    const alt = useComposite ? "Proof" : pics[0]?.name ?? "Proof";
    return (
      <img
        src={src}
        alt={alt}
        className={cn("mx-auto w-auto object-contain", className)}
        draggable={false}
      />
    );
  }

  return (
    <div className={cn("relative mx-auto inline-block w-auto bg-white", className)}>
      {pics.map((pic, i) => (
        <img
          key={pic.id}
          src={srcFor(pic.layer)}
          alt={pic.name}
          className={cn(
            "w-auto object-contain",
            className,
            i === 0 ? "relative block" : "absolute inset-0 h-full"
          )}
          draggable={false}
        />
      ))}
    </div>
  );
}
