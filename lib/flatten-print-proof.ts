import "server-only";

import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  defaultVisiblePdfLayerIds,
  isUnnamedPdfLayer,
} from "@/lib/pdf-ocg";
import {
  layerPreviewObjectPath,
  type RespondLayerPreview,
} from "@/lib/approval-layer-preview-paths";
import { ORDER_ASSETS_BUCKET } from "@/lib/order-assets";

const BUCKET = ORDER_ASSETS_BUCKET;

async function downloadBytes(
  admin: SupabaseClient,
  path: string
): Promise<Buffer | null> {
  const { data, error } = await admin.storage.from(BUCKET).download(path);
  if (error || !data) return null;
  const buf = Buffer.from(await data.arrayBuffer());
  return buf.length > 0 ? buf : null;
}

/**
 * Board card / job ticket / packing slip picture: the Artwork plate only
 * (same as clicking Artwork with Artwork checked, Spot UV off).
 */
export async function ensurePrintProofJpeg(
  admin: SupabaseClient,
  preview: Pick<RespondLayerPreview, "fileId" | "rev" | "page" | "layers">
): Promise<string | null> {
  const artPath = layerPreviewObjectPath(
    preview.fileId,
    preview.rev,
    preview.page,
    "artwork"
  );
  const existing = await downloadBytes(admin, artPath);
  if (existing) return artPath;

  const jpeg = await flattenPrintProofJpeg(admin, preview);
  if (!jpeg?.length) return null;

  const { error } = await admin.storage.from(BUCKET).upload(artPath, jpeg, {
    contentType: "image/jpeg",
    upsert: true,
  });
  if (error) {
    console.warn("[flatten-print-proof] upload failed:", error.message);
    return null;
  }
  return artPath;
}

export async function flattenPrintProofJpeg(
  admin: SupabaseClient,
  preview: Pick<RespondLayerPreview, "fileId" | "rev" | "page" | "layers">
): Promise<Buffer | null> {
  const named = (preview.layers ?? []).filter(
    (layer) => !isUnnamedPdfLayer(layer.name)
  );
  const onIds = new Set(defaultVisiblePdfLayerIds(named.length ? named : preview.layers ?? []));
  const onLayers = (preview.layers ?? []).filter((layer) => onIds.has(layer.id));

  const base = await downloadBytes(
    admin,
    layerPreviewObjectPath(preview.fileId, preview.rev, preview.page, "base")
  );
  const overlays: Buffer[] = [];
  for (const layer of onLayers) {
    const png = await downloadBytes(
      admin,
      layerPreviewObjectPath(
        preview.fileId,
        preview.rev,
        preview.page,
        layer.id
      )
    );
    if (png) overlays.push(png);
  }

  if (base || overlays.length > 0) {
    try {
      const first = base ?? overlays[0]!;
      const rest = base ? overlays : overlays.slice(1);
      let pipeline = sharp(first).ensureAlpha();
      if (rest.length > 0) {
        pipeline = pipeline.composite(
          rest.map((input) => ({ input, blend: "over" as const }))
        );
      }
      return await pipeline
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .jpeg({ quality: 86 })
        .toBuffer();
    } catch (err) {
      console.warn(
        "[flatten-print-proof] stack failed:",
        err instanceof Error ? err.message : err
      );
    }
  }

  return downloadBytes(
    admin,
    layerPreviewObjectPath(
      preview.fileId,
      preview.rev,
      preview.page,
      "composite"
    )
  );
}
