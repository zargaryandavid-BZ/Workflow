import "server-only";

import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  artworkPdfLayerIds,
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
  const layers = preview.layers ?? [];
  // No named OCG layers means there is no reliable Artwork plate to isolate.
  // The composite is the Final PDF page with all of its default-visible
  // content; using base.png here drops artwork from flattened PDFs.
  if (layers.length === 0) {
    const compositePath = layerPreviewObjectPath(
      preview.fileId,
      preview.rev,
      preview.page,
      "composite"
    );
    return (await downloadBytes(admin, compositePath))
      ? compositePath
      : null;
  }

  // Named plates: always rebuild from Artwork (not the green white-ink composite
  // that was previously saved as artwork.jpg).
  if (layers.length > 0) {
    const jpeg = await flattenPrintProofJpeg(admin, preview);
    if (jpeg?.length) {
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
  }

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

  const hasArtworkPlate =
    artworkPdfLayerIds(named.length ? named : preview.layers ?? []).length > 0;

  // When artwork overlay PNGs are available, composite them on a plain white
  // background rather than the base PNG. The base often carries spot-colour
  // artefacts: pdf.js renders White/underprint ink as an arbitrary alternate
  // colour (solid green on Clear PET), making every thumbnail look green.
  // The overlay deltas are already computed relative to the base via
  // ocgOverlayRgba — they are transparent wherever the base has content —
  // so flattening them onto white gives a clean result that matches the
  // SEE LAYERS / Artwork view exactly.
  if (overlays.length > 0) {
    try {
      const first = overlays[0]!;
      const rest = overlays.slice(1);
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
        "[flatten-print-proof] artwork-overlay stack failed:",
        err instanceof Error ? err.message : err
      );
    }
  }

  // No overlay PNGs downloaded (missing or wrong revision) — fall back to
  // the base layer alone if available.
  if (base) {
    try {
      return await sharp(base)
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .jpeg({ quality: 86 })
        .toBuffer();
    } catch (err) {
      console.warn(
        "[flatten-print-proof] base-only stack failed:",
        err instanceof Error ? err.message : err
      );
    }
  }

  // White-ink / cut composite is the green Drive-style mess — never use it
  // when an Artwork plate exists (same as SEE LAYERS / large view).
  if (hasArtworkPlate) return null;

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
