"use client";

import {
  isPdfArtworkLayer,
  isPdfCutLineLayer,
  isPdfWhiteInkLayer,
  isUnnamedPdfLayer,
} from "@/lib/pdf-ocg";
import {
  respondLayerPreviewUrl,
  type RespondLayerPreview,
} from "@/lib/approval-layer-preview-paths";

/** Fetch as a blob first so canvas reads (toDataURL) never hit a CORS taint. */
export async function loadImageViaBlob(src: string): Promise<{
  img: HTMLImageElement;
  objectUrl: string | null;
}> {
  let objectUrl: string | null = null;
  let loadSrc = src;
  if (!src.startsWith("data:") && !src.startsWith("blob:")) {
    try {
      const res = await fetch(src);
      if (res.ok) {
        objectUrl = URL.createObjectURL(await res.blob());
        loadSrc = objectUrl;
      }
    } catch {
      // fall through with the original src
    }
  }
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = loadSrc;
  });
  return { img, objectUrl };
}

/** Flatten every image (already in stacking order) onto one canvas, no rotation. */
export function paintFlattened(imgs: HTMLImageElement[]): string {
  const nw = imgs[0].naturalWidth;
  const nh = imgs[0].naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, nw);
  canvas.height = Math.max(1, nh);
  const ctx = canvas.getContext("2d");
  if (!ctx) return imgs[0].src;
  for (const img of imgs) {
    ctx.drawImage(img, 0, 0);
  }
  return canvas.toDataURL("image/png");
}

/** Same named-layer list/order proof-layer-images.tsx uses for its tiles. */
function namedLayersFor(preview: Pick<RespondLayerPreview, "layers">) {
  return preview.layers
    .filter((layer) => !isUnnamedPdfLayer(layer.name))
    .slice()
    .sort((a, b) => {
      const rank = (name: string) =>
        isPdfArtworkLayer(name) ? 0 : isPdfCutLineLayer(name) ? 2 : 1;
      return rank(a.name) - rank(b.name);
    });
}

/** Design + finishes, skipping White ink and the Cut/dieline — the default customer-facing view. */
export function defaultVisibleLayerIds(
  preview: Pick<RespondLayerPreview, "layers">
): string[] {
  return namedLayersFor(preview)
    .filter((l) => !isPdfCutLineLayer(l.name) && !isPdfWhiteInkLayer(l.name))
    .map((l) => l.id);
}

/**
 * Flatten a proof's base + a chosen set of visible layer ids into one PNG data
 * URL. Pass the live visibleIds from the SEE LAYERS checkboxes to match
 * exactly what's on screen, or defaultVisibleLayerIds(preview) for a
 * standalone "download all" that has no per-SKU toggle state to read from.
 */
export async function flattenVisibleProof(
  token: string,
  orderId: string,
  preview: RespondLayerPreview,
  visibleIds: Set<string>
): Promise<{ dataUrl: string; cleanup: () => void }> {
  const named = namedLayersFor(preview);
  const objectUrls: string[] = [];
  if (named.length === 0) {
    const src = respondLayerPreviewUrl(token, orderId, preview, "composite");
    const { img, objectUrl } = await loadImageViaBlob(src);
    if (objectUrl) objectUrls.push(objectUrl);
    return {
      dataUrl: paintFlattened([img]),
      cleanup: () => objectUrls.forEach((u) => URL.revokeObjectURL(u)),
    };
  }

  const cutFirst = named
    .slice()
    .sort((a, b) => Number(isPdfCutLineLayer(a.name)) - Number(isPdfCutLineLayer(b.name)));
  const srcs = [
    respondLayerPreviewUrl(token, orderId, preview, "base"),
    ...cutFirst
      .filter((l) => visibleIds.has(l.id))
      .map((l) => respondLayerPreviewUrl(token, orderId, preview, l.id)),
  ];
  const loaded = await Promise.all(srcs.map((s) => loadImageViaBlob(s)));
  for (const l of loaded) {
    if (l.objectUrl) objectUrls.push(l.objectUrl);
  }
  return {
    dataUrl: paintFlattened(loaded.map((l) => l.img)),
    cleanup: () => objectUrls.forEach((u) => URL.revokeObjectURL(u)),
  };
}

/** Flatten + trigger a browser download in one call. */
export async function downloadFlattenedProof(
  token: string,
  orderId: string,
  preview: RespondLayerPreview,
  visibleIds: Set<string>,
  fileName: string
): Promise<void> {
  const { dataUrl, cleanup } = await flattenVisibleProof(
    token,
    orderId,
    preview,
    visibleIds
  );
  try {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = fileName || "proof";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    cleanup();
  }
}
