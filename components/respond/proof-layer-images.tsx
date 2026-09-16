"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2, X } from "lucide-react";
import { isUnnamedPdfLayer } from "@/lib/pdf-ocg";
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

export function ProofLayerImages({
  token,
  orderId,
  preview,
  fileName,
  rollDirection = null,
  labelWidthIn = null,
  labelHeightIn = null,
  onReady,
}: {
  token: string;
  orderId: string;
  preview: RespondLayerPreview;
  fileName: string;
  rollDirection?: RollDirectionValue | null;
  labelWidthIn?: number | null;
  labelHeightIn?: number | null;
  onReady?: () => void;
}) {
  const namedLayers = useMemo(
    () => preview.layers.filter((layer) => !isUnnamedPdfLayer(layer.name)),
    [preview.layers]
  );
  const pics = useMemo<LayerPic[]>(() => {
    const layers = namedLayers.map((layer) => ({
      id: layer.id,
      name: layer.name,
      layer: layer.id,
    }));
    if (layers.length === 0) {
      return [{ id: "composite", name: "Proof", layer: "composite" }];
    }
    return [
      { id: "composite", name: "All layers", layer: "composite" },
      ...layers,
    ];
  }, [namedLayers]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [onRoll, setOnRoll] = useState(false);

  useEffect(() => {
    onReady?.();
  }, [preview.fileId, preview.page, preview.rev]);

  const compositeSrc = respondLayerPreviewUrl(
    token,
    orderId,
    preview,
    "composite"
  );
  const expanded = pics.find((p) => p.id === expandedId) ?? null;

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
            onClick={() => setExpandedId(pics[0]?.id ?? null)}
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        )}
      </div>

      {onRoll && rollDirection ? (
        <OnRollPreview
          artworkSrc={compositeSrc}
          direction={rollDirection}
          labelWidthIn={labelWidthIn}
          labelHeightIn={labelHeightIn}
        />
      ) : (
        <ul
          className={
            pics.length === 1
              ? "mx-auto flex w-full max-w-xl flex-col gap-3 p-4"
              : "grid grid-cols-1 gap-3 p-4 sm:grid-cols-2"
          }
        >
          {pics.map((pic) => {
            const src = respondLayerPreviewUrl(
              token,
              orderId,
              preview,
              pic.layer
            );
            return (
              <li key={pic.id} className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => setExpandedId(pic.id)}
                  className="flex w-full items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-[linear-gradient(45deg,#e5e7eb_25%,transparent_25%,transparent_75%,#e5e7eb_75%),linear-gradient(45deg,#e5e7eb_25%,transparent_25%,transparent_75%,#e5e7eb_75%)] bg-[length:16px_16px] bg-[position:0_0,8px_8px] bg-white"
                  title={`Open ${pic.name}`}
                >
                  <img
                    src={src}
                    alt={pic.name}
                    className="mx-auto max-h-[22rem] w-auto max-w-full object-contain"
                    draggable={false}
                  />
                </button>
                <p className="truncate text-center text-[11px] font-medium text-slate-600">
                  {pic.name}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {expanded && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[80] flex flex-col bg-white">
              <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-2">
                <span className="truncate text-sm font-medium text-slate-700">
                  {expanded.name}
                </span>
                <button
                  type="button"
                  className="rounded p-1 text-slate-500 hover:bg-slate-100"
                  onClick={() => setExpandedId(null)}
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-slate-50 p-6">
                <img
                  src={respondLayerPreviewUrl(
                    token,
                    orderId,
                    preview,
                    expanded.layer
                  )}
                  alt={expanded.name}
                  className="max-h-full max-w-full object-contain"
                  draggable={false}
                />
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
