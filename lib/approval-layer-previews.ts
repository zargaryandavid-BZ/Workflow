import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { Order } from "@/lib/types";
import { ORDER_ASSETS_BUCKET } from "@/lib/order-assets";
import { ensureGdriveSettings } from "@/lib/gdrive-settings";
import {
  downloadDriveFileBytes,
  getDriveFileMeta,
  proofsDriveClient,
} from "@/lib/gdrive-proofs";
import { fetchRespondArtworkPack } from "@/lib/respond-final-pdf";
import { pdfPageCount } from "@/lib/append-pdf";
import { skusForRespond } from "@/lib/respond-order";
import { rasterizePdfLayerPreviews } from "@/lib/pdf-layer-preview";
import {
  layerPreviewManifestPath,
  layerPreviewPageDir,
  respondPreviewIndexPath,
  sanitizeLayerPreviewKey,
  type LayerPreviewManifest,
  type RespondLayerPreview,
} from "@/lib/approval-layer-preview-paths";
import { alignSkusToPdfPages, sharedPdfPagesForSkus } from "@/lib/shared-pdf-pages";
import type { RespondFinalPdf } from "@/lib/respond-order";

/** Print PDFs can be hundreds of MB; we only keep small PNG/JPEGs. */
const SOURCE_MAX_BYTES = 800 * 1024 * 1024;

async function driveModifiedTime(
  client: ReturnType<typeof proofsDriveClient>,
  fileId: string
): Promise<string> {
  try {
    const res = await client.drive.files.get({
      fileId,
      fields: "modifiedTime",
      supportsAllDrives: true,
    });
    return String(res.data.modifiedTime ?? "").trim() || "unknown";
  } catch {
    return "unknown";
  }
}

async function readManifest(
  admin: ReturnType<typeof createAdminClient>,
  path: string
): Promise<LayerPreviewManifest | null> {
  const { data, error } = await admin.storage
    .from(ORDER_ASSETS_BUCKET)
    .download(path);
  if (error || !data) return null;
  try {
    const text = await data.text();
    const parsed = JSON.parse(text) as LayerPreviewManifest;
    if (!parsed?.fileId || !Array.isArray(parsed.layers)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function uploadBytes(
  admin: ReturnType<typeof createAdminClient>,
  path: string,
  body: Buffer,
  contentType: string
) {
  const { error } = await admin.storage.from(ORDER_ASSETS_BUCKET).upload(path, body, {
    contentType,
    upsert: true,
  });
  if (error) throw new Error(error.message);
}

function packFromManifest(
  bySku: Record<string, { fileId: string; fileName: string; page?: number }>,
  manifest: LayerPreviewManifest,
  rev: string
): Record<string, RespondLayerPreview> {
  const out: Record<string, RespondLayerPreview> = {};
  const pageSet = new Set(manifest.pages);
  for (const [skuId, pdf] of Object.entries(bySku)) {
    if (pdf.fileId !== manifest.fileId) continue;
    const page = pdf.page ?? 1;
    if (!pageSet.has(page)) continue;
    out[skuId] = {
      fileId: manifest.fileId,
      fileName: manifest.fileName,
      page,
      rev,
      layers: manifest.layers,
    };
  }
  return out;
}

export type RespondPreviewIndex = {
  fileId: string;
  fileName: string;
  rev: string;
  layers: { id: string; name: string }[];
  pages: number[];
  bySku: Record<string, { fileId: string; fileName: string; page?: number }>;
};

async function writeRespondPreviewIndex(
  admin: ReturnType<typeof createAdminClient>,
  orderId: string,
  index: RespondPreviewIndex
) {
  await uploadBytes(
    admin,
    respondPreviewIndexPath(orderId),
    Buffer.from(JSON.stringify(index)),
    "application/json"
  );
}

export async function loadRespondPreviewIndex(
  orderId: string
): Promise<RespondPreviewIndex | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(ORDER_ASSETS_BUCKET)
    .download(respondPreviewIndexPath(orderId));
  if (error || !data) return null;
  try {
    const parsed = JSON.parse(await data.text()) as RespondPreviewIndex;
    if (!parsed?.fileId || !parsed.rev || !parsed.bySku) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function expandRespondPreviewIndex(
  index: RespondPreviewIndex,
  ticketSkus: { id: string; name: string; qty: number | null }[]
): RespondPreviewIndex {
  const n = index.pages?.length ?? 0;
  if (n < 1) return index;
  if (Object.keys(index.bySku).length >= n) return index;
  const skus = alignSkusToPdfPages(ticketSkus, n);
  return {
    ...index,
    bySku: sharedPdfPagesForSkus(skus, {
      id: index.fileId,
      name: index.fileName,
    }),
  };
}

export function respondProofFromIndex(index: RespondPreviewIndex): {
  layerPreviews: Record<string, RespondLayerPreview>;
  finalPdfs: Record<string, RespondFinalPdf>;
} {
  const manifest: LayerPreviewManifest = {
    fileId: index.fileId,
    fileName: index.fileName,
    modifiedTime: index.rev,
    layers: index.layers ?? [],
    pages: index.pages ?? [],
  };
  const layerPreviews = packFromManifest(index.bySku, manifest, index.rev);
  const finalPdfs: Record<string, RespondFinalPdf> = {};
  for (const [skuId, pdf] of Object.entries(index.bySku)) {
    finalPdfs[skuId] = {
      fileId: pdf.fileId,
      fileName: pdf.fileName,
      page: pdf.page,
    };
  }
  return { layerPreviews, finalPdfs };
}

function previewIndexFromPack(
  packBySku: Record<string, { fileId: string; fileName: string; page?: number }>,
  manifest: LayerPreviewManifest,
  rev: string
): RespondPreviewIndex {
  return {
    fileId: manifest.fileId,
    fileName: manifest.fileName,
    rev,
    layers: manifest.layers,
    pages: manifest.pages,
    bySku: packBySku,
  };
}

/**
 * Build (or reuse) small per-layer proof images for the order's Final PDF.
 * Print PDF on Drive is unchanged. Failures are thrown to the caller.
 */
export async function generateApprovalLayerPreviewsForOrder(
  order: Pick<Order, "id" | "title" | "tenant_id" | "specs">
): Promise<Record<string, RespondLayerPreview>> {
  const admin = createAdminClient();
  const specs = (order.specs ?? {}) as Record<string, unknown>;
  const pack = await fetchRespondArtworkPack(
    admin,
    order.tenant_id,
    {
      id: order.id,
      title: String(order.title ?? ""),
      specs,
    },
    skusForRespond(specs)
  );
  const pdfs = Object.values(pack.bySku);
  if (pdfs.length === 0) return {};

  const fileId = pdfs[0]!.fileId;
  const fileName = pdfs[0]!.fileName;
  const pages = [
    ...new Set(pdfs.map((p) => p.page ?? 1).filter((n) => n >= 1)),
  ].sort((a, b) => a - b);

  const settings = await ensureGdriveSettings(admin, order.tenant_id);
  const drive = proofsDriveClient(settings);
  const meta = await getDriveFileMeta(drive, fileId);
  if (!meta) return {};
  if (meta.size > SOURCE_MAX_BYTES) {
    console.warn(
      `[approval-layer-previews] skip ${fileName}: ${meta.size} bytes over cap`
    );
    return {};
  }

  const modifiedTime = await driveModifiedTime(drive, fileId);
  const rev =
    modifiedTime === "unknown"
      ? String(meta.size)
      : modifiedTime;
  const manifestPath = layerPreviewManifestPath(fileId, rev);
  const existing = await readManifest(admin, manifestPath);
  if (existing && existing.pages.length > 0) {
    const aligned = alignSkusToPdfPages(
      skusForRespond(specs),
      existing.pages.length
    );
    const packBySku = sharedPdfPagesForSkus(aligned, {
      id: fileId,
      name: fileName,
    });
    const previews = packFromManifest(packBySku, existing, rev);
    await writeRespondPreviewIndex(
      admin,
      order.id,
      previewIndexFromPack(packBySku, existing, rev)
    );
    return previews;
  }

  const downloaded = await downloadDriveFileBytes(drive, fileId);
  if (!downloaded?.buffer?.length) return {};

  const counted = await pdfPageCount([downloaded.buffer]);
  const pagesToRaster =
    counted >= 1
      ? Array.from({ length: counted }, (_, i) => i + 1)
      : pages;
  const alignedSkus = alignSkusToPdfPages(
    skusForRespond(specs),
    pagesToRaster.length
  );
  const packBySku = sharedPdfPagesForSkus(alignedSkus, {
    id: fileId,
    name: fileName,
  });

  const raster = await rasterizePdfLayerPreviews(
    downloaded.buffer,
    pagesToRaster
  );
  const pageNums = raster.pages.map((p) => p.page);

  for (const page of raster.pages) {
    const dir = layerPreviewPageDir(fileId, rev, page.page);
    await uploadBytes(
      admin,
      `${dir}/composite.jpg`,
      page.compositeJpg,
      "image/jpeg"
    );
    if (page.basePng.length > 0) {
      await uploadBytes(admin, `${dir}/base.png`, page.basePng, "image/png");
    }
    for (const [layerId, png] of Object.entries(page.layerPngs)) {
      await uploadBytes(
        admin,
        `${dir}/${sanitizeLayerPreviewKey(layerId)}.png`,
        png,
        "image/jpeg"
      );
    }
  }

  const manifest: LayerPreviewManifest = {
    fileId,
    fileName,
    modifiedTime: rev,
    layers: raster.layers,
    pages: pageNums,
  };
  await uploadBytes(
    admin,
    manifestPath,
    Buffer.from(JSON.stringify(manifest)),
    "application/json"
  );
  await writeRespondPreviewIndex(
    admin,
    order.id,
    previewIndexFromPack(packBySku, manifest, rev)
  );
  return packFromManifest(packBySku, manifest, rev);
}

export async function loadApprovalLayerPreviewsForOrder(
  order: Pick<Order, "id" | "title" | "tenant_id" | "specs">,
  opts?: { generateIfMissing?: boolean }
): Promise<Record<string, RespondLayerPreview>> {
  const stored = await loadRespondPreviewIndex(order.id);
  if (stored) {
    return respondProofFromIndex(stored).layerPreviews;
  }

  if (!opts?.generateIfMissing) return {};
  try {
    return await generateApprovalLayerPreviewsForOrder(order);
  } catch (err) {
    console.error("[approval-layer-previews] generate failed:", err);
    return {};
  }
}

/**
 * Customer /respond proof: JPEG index when send already rasterized it,
 * otherwise SKU → PDF page from Drive so a 10-page file still shows 10 SKUs.
 */
export async function loadRespondCustomerProof(
  order: Pick<Order, "id" | "title" | "tenant_id" | "specs">,
  ticketSkus: { id: string; name: string; qty: number | null }[]
): Promise<{
  skus: { id: string; name: string; qty: number | null }[];
  finalPdfs: Record<string, RespondFinalPdf>;
  layerPreviews: Record<string, RespondLayerPreview>;
}> {
  const stored = await loadRespondPreviewIndex(order.id);
  if (stored) {
    const expanded = expandRespondPreviewIndex(stored, ticketSkus);
    const proof = respondProofFromIndex(expanded);
    return {
      skus: alignSkusToPdfPages(ticketSkus, expanded.pages.length),
      finalPdfs: proof.finalPdfs,
      layerPreviews: proof.layerPreviews,
    };
  }

  // Do not list Drive during the HTML request — that closed the Next.js
  // stream ("Connection closed"). The client loads `/api/notifications/final-artwork`.
  return {
    skus: ticketSkus,
    finalPdfs: {},
    layerPreviews: {},
  };
}

export async function loadRespondCustomerProofForOrderId(
  orderId: string,
  ticketSkus: { id: string; name: string; qty: number | null }[]
): Promise<{
  skus: { id: string; name: string; qty: number | null }[];
  finalPdfs: Record<string, RespondFinalPdf>;
  layerPreviews: Record<string, RespondLayerPreview>;
}> {
  const admin = createAdminClient();
  const { data: order } = await admin
    .from("orders")
    .select("id, title, tenant_id, specs")
    .eq("id", orderId)
    .maybeSingle();
  if (!order?.tenant_id) {
    return { skus: ticketSkus, finalPdfs: {}, layerPreviews: {} };
  }
  return loadRespondCustomerProof(
    {
      id: order.id as string,
      title: String(order.title ?? ""),
      tenant_id: order.tenant_id as string,
      specs: (order.specs ?? {}) as Order["specs"],
    },
    ticketSkus
  );
}
