/** Storage + public URL helpers for customer proof layer images (not the print PDF). */

export const LAYER_PREVIEW_BUCKET_PREFIX = "approval-layer-previews";

export function sanitizeLayerPreviewRev(modifiedTime: string): string {
  const t = modifiedTime.trim() || "unknown";
  return t.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 64);
}

export function sanitizeLayerPreviewKey(id: string): string {
  const t = id.trim() || "layer";
  return t.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
}

export function layerPreviewCachePrefix(fileId: string, rev: string): string {
  return `${LAYER_PREVIEW_BUCKET_PREFIX}/${sanitizeLayerPreviewKey(fileId)}/${sanitizeLayerPreviewRev(rev)}`;
}

export function layerPreviewManifestPath(fileId: string, rev: string): string {
  return `${layerPreviewCachePrefix(fileId, rev)}/manifest.json`;
}

export function layerPreviewPageDir(
  fileId: string,
  rev: string,
  page: number
): string {
  return `${layerPreviewCachePrefix(fileId, rev)}/p${page}`;
}

export function layerPreviewObjectPath(
  fileId: string,
  rev: string,
  page: number,
  layer: string
): string {
  const dir = layerPreviewPageDir(fileId, rev, page);
  if (layer === "composite") return `${dir}/composite.jpg`;
  if (layer === "base") return `${dir}/base.png`;
  return `${dir}/${sanitizeLayerPreviewKey(layer)}.png`;
}

/** Fast /respond lookup — written when staff send the approval. */
export function respondPreviewIndexPath(orderId: string): string {
  return `${LAYER_PREVIEW_BUCKET_PREFIX}/orders/${sanitizeLayerPreviewKey(orderId)}/latest.json`;
}

export type LayerPreviewKind = "composite" | "base" | string;

export type LayerPreviewManifest = {
  fileId: string;
  fileName: string;
  modifiedTime: string;
  layers: { id: string; name: string }[];
  pages: number[];
};

export type RespondLayerPreview = {
  fileId: string;
  fileName: string;
  page: number;
  rev: string;
  layers: { id: string; name: string }[];
};

/** Same pictures as /respond SEE LAYERS — named OCGs, or composite if none. */
export function layerPicsForJobTicket(
  preview: Pick<RespondLayerPreview, "layers">
): { layer: string; name: string }[] {
  const named = preview.layers.filter(
    (l) => !/^layer\s+\d+$/i.test(l.name.trim())
  );
  if (named.length === 0) {
    return [{ layer: "composite", name: "Proof" }];
  }
  return named.map((l) => ({
    layer: l.id,
    name: l.name.trim() || "Layer",
  }));
}

export function respondLayerPreviewUrl(
  token: string,
  orderId: string,
  preview: Pick<RespondLayerPreview, "fileId" | "rev" | "page">,
  layer: LayerPreviewKind
): string {
  const q = new URLSearchParams({
    token,
    order: orderId,
    id: preview.fileId,
    type: "layer_preview",
    rev: preview.rev,
    page: String(preview.page),
    layer: layer === "composite" || layer === "base" ? layer : sanitizeLayerPreviewKey(layer),
  });
  return `/api/notifications/asset?${q.toString()}`;
}
