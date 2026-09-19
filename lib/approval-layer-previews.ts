import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { Order } from "@/lib/types";
import { ORDER_ASSETS_BUCKET } from "@/lib/order-assets";
import { ensureGdriveSettings } from "@/lib/gdrive-settings";
import {
  downloadDriveFileBytes,
  fetchPreviewBytes,
  getDriveFileMeta,
  proofsDriveClient,
} from "@/lib/gdrive-proofs";
import { fetchRespondArtworkPack } from "@/lib/respond-final-pdf";
import { pdfPageCount } from "@/lib/append-pdf";
import { skusForRespond } from "@/lib/respond-order";
import { rasterizePdfLayerPreviews } from "@/lib/pdf-layer-preview";
import { isWaitingApprovalColumn } from "@/lib/waiting-approval-column";
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
import {
  approvalPreviewIsStale,
  drivePdfFingerprint,
  indexHasLayerPictures,
  proofRasterRev,
  shouldRebuildStoredProofs,
} from "@/lib/approval-preview-freshness";
import { findLatestPdfInFolders } from "@/lib/google-drive";
import { skuImageStoragePath } from "@/lib/sku-images";
import type { GdriveSettings } from "@/lib/types";
import {
  PRODUCTION_CARD_FILES,
  productionCardImageMeta,
} from "@/lib/production-card-image";

const CARD_PDF_REV_SPEC = "card_pdf_rev";

/** Print PDFs can exceed 800 MB; we only keep small PNG/JPEGs. */
const SOURCE_MAX_BYTES = 2 * 1024 * 1024 * 1024;

export class ApprovalProofSourceMissingError extends Error {
  readonly orderId: string;
  constructor(orderId: string, title: string) {
    super(`No Final PDF on Drive for ${title}`);
    this.name = "ApprovalProofSourceMissingError";
    this.orderId = orderId;
  }
}

export function isApprovalProofSourceMissing(err: unknown): boolean {
  return (
    err instanceof ApprovalProofSourceMissingError ||
    (typeof err === "object" &&
      err !== null &&
      "name" in err &&
      (err as { name: string }).name === "ApprovalProofSourceMissingError")
  );
}

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

async function upsertProductionCardImage(
  admin: ReturnType<typeof createAdminClient>,
  order: Pick<Order, "id" | "tenant_id" | "specs">,
  image: Buffer,
  fingerprint: string
): Promise<void> {
  const specs = (order.specs ?? {}) as Record<string, unknown>;
  const skuId = skusForRespond(specs)[0]?.id?.trim();
  if (!skuId) return;

  const { fileName, contentType } = productionCardImageMeta(image);
  const storagePath = skuImageStoragePath(
    order.tenant_id,
    order.id,
    skuId,
    0,
    fileName
  );
  const { error: upErr } = await admin.storage
    .from(ORDER_ASSETS_BUCKET)
    .upload(storagePath, image, {
      contentType,
      upsert: true,
    });
  if (upErr) {
    console.warn("[approval-layer-previews] card image upload failed:", upErr.message);
    return;
  }

  const { data: existing } = await admin
    .from("order_sku_images")
    .select("id, storage_path")
    .eq("order_id", order.id)
    .in("file_name", [...PRODUCTION_CARD_FILES])
    .limit(1)
    .maybeSingle();

  let imageId = typeof existing?.id === "string" ? existing.id : null;
  const oldPath =
    typeof existing?.storage_path === "string" ? existing.storage_path : "";

  if (imageId) {
    const { error } = await admin
      .from("order_sku_images")
      .update({
        storage_path: storagePath,
        file_name: fileName,
        file_size: image.byteLength,
        mime_type: contentType,
      })
      .eq("id", imageId);
    if (error) {
      console.warn("[approval-layer-previews] card image row update failed:", error.message);
      return;
    }
    if (oldPath && oldPath !== storagePath) {
      await admin.storage.from(ORDER_ASSETS_BUCKET).remove([oldPath]);
    }
  } else {
    const { data: inserted, error } = await admin
      .from("order_sku_images")
      .insert({
        tenant_id: order.tenant_id,
        order_id: order.id,
        sku_id: skuId,
        file_name: fileName,
        file_size: image.byteLength,
        mime_type: contentType,
        storage_path: storagePath,
        position: 0,
      })
      .select("id")
      .maybeSingle();
    if (error || !inserted?.id) {
      console.warn(
        "[approval-layer-previews] card image insert failed:",
        error?.message ?? "no id"
      );
      return;
    }
    imageId = inserted.id as string;
  }

  await admin
    .from("orders")
    .update({
      specs: {
        ...specs,
        card_image: { source: "sku_image", id: imageId },
        [CARD_PDF_REV_SPEC]: fingerprint,
      },
    })
    .eq("id", order.id)
    .eq("tenant_id", order.tenant_id);
}

async function applyStoredCompositeToCard(
  admin: ReturnType<typeof createAdminClient>,
  order: Pick<Order, "id" | "tenant_id" | "specs">,
  fileId: string,
  rev: string,
  page: number,
  fingerprint: string
): Promise<void> {
  const path = `${layerPreviewPageDir(fileId, rev, page)}/composite.jpg`;
  const { data, error } = await admin.storage
    .from(ORDER_ASSETS_BUCKET)
    .download(path);
  if (error || !data) return;
  const bytes = Buffer.from(await data.arrayBuffer());
  if (bytes.length === 0) return;
  await upsertProductionCardImage(admin, order, bytes, fingerprint);
}

const generatingByOrderId = new Map<
  string,
  Promise<Record<string, RespondLayerPreview>>
>();

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
 * Call this before email/SMS when entering Waiting Approval.
 */
export async function generateApprovalLayerPreviewsIfWaitingColumn(
  order: Pick<Order, "id" | "title" | "tenant_id" | "specs">,
  column: { kind?: string | null; name?: string | null } | null | undefined
): Promise<Record<string, RespondLayerPreview> | null> {
  if (!isWaitingApprovalColumn(column)) return null;
  return generateApprovalLayerPreviewsForOrder(order);
}

export async function generateApprovalLayerPreviewsForOrder(
  order: Pick<Order, "id" | "title" | "tenant_id" | "specs">
): Promise<Record<string, RespondLayerPreview>> {
  const inflight = generatingByOrderId.get(order.id);
  if (inflight) return inflight;
  const work = generateApprovalLayerPreviewsForOrderUncached(order).finally(
    () => generatingByOrderId.delete(order.id)
  );
  generatingByOrderId.set(order.id, work);
  return work;
}

async function generateApprovalLayerPreviewsForOrderUncached(
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
    skusForRespond(specs),
    { skipCache: true }
  );
  const pdfs = Object.values(pack.bySku);
  if (pdfs.length === 0) {
    throw new ApprovalProofSourceMissingError(order.id, String(order.title ?? ""));
  }

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
    const mb = Math.round(meta.size / (1024 * 1024));
    throw new Error(
      `Final PDF is ${mb} MB — too large to convert into proof pictures.`
    );
  }

  const modifiedTime = await driveModifiedTime(drive, fileId);
  const rev = proofRasterRev(
    modifiedTime === "unknown" ? String(meta.size) : modifiedTime
  );
  const fingerprint = drivePdfFingerprint(fileId, rev);
  const already = await loadRespondPreviewIndex(order.id);
  if (!approvalPreviewIsStale(already, { fileId, rev })) {
    return respondProofFromIndex(already!).layerPreviews;
  }

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
    await applyStoredCompositeToCard(
      admin,
      order,
      fileId,
      rev,
      existing.pages[0] ?? 1,
      fingerprint
    );
    return previews;
  }

  const downloaded = await downloadDriveFileBytes(drive, fileId);
  if (!downloaded?.buffer?.length) {
    throw new Error("Could not download the Final PDF from Drive.");
  }

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
  if (raster.pages.length === 0) {
    throw new Error("Could not convert the Final PDF into proof pictures.");
  }
  const pageNums = raster.pages.map((p) => p.page);

  for (const page of raster.pages) {
    const dir = layerPreviewPageDir(fileId, rev, page.page);
    await uploadBytes(
      admin,
      `${dir}/composite.jpg`,
      page.compositeJpg,
      "image/png"
    );
    if (page.basePng.length > 0) {
      await uploadBytes(admin, `${dir}/base.png`, page.basePng, "image/png");
    }
    for (const [layerId, png] of Object.entries(page.layerPngs)) {
      await uploadBytes(
        admin,
        `${dir}/${sanitizeLayerPreviewKey(layerId)}.png`,
        png,
        "image/png"
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
  const firstPage = raster.pages.find((p) => p.page === 1) ?? raster.pages[0];
  if (firstPage?.compositeJpg?.length) {
    await upsertProductionCardImage(
      admin,
      order,
      firstPage.compositeJpg,
      fingerprint
    ).catch((err) =>
      console.warn(
        "[approval-layer-previews] card image update failed:",
        err instanceof Error ? err.message : err
      )
    );
  }
  return packFromManifest(packBySku, manifest, rev);
}

export async function loadApprovalLayerPreviewsForOrder(
  order: Pick<Order, "id" | "title" | "tenant_id" | "specs">,
  opts?: { generateIfMissing?: boolean }
): Promise<Record<string, RespondLayerPreview>> {
  if (opts?.generateIfMissing) {
    try {
      return await generateApprovalLayerPreviewsForOrder(order);
    } catch (err) {
      if (isApprovalProofSourceMissing(err)) throw err;
      console.error("[approval-layer-previews] generate failed:", err);
      return {};
    }
  }

  const stored = await loadRespondPreviewIndex(order.id);
  if (stored && indexHasLayerPictures(stored)) {
    return respondProofFromIndex(stored).layerPreviews;
  }
  return {};
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
  if (stored && indexHasLayerPictures(stored)) {
    const expanded = expandRespondPreviewIndex(stored, ticketSkus);
    const proof = respondProofFromIndex(expanded);
    return {
      skus: alignSkusToPdfPages(ticketSkus, expanded.pages.length),
      finalPdfs: proof.finalPdfs,
      layerPreviews: proof.layerPreviews,
    };
  }

  // Pictures missing: keep the page fast. /api/notifications/final-artwork
  // generates in the background and the client retries.
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

export type WaitingApprovalPreviewResult = {
  orderId: string;
  title: string;
  skus: number;
  error?: string;
};

/**
 * Rasterize Final PDFs for every live card in Waiting Approval, plus any
 * order with an open customer_approval notification.
 */
export async function generateApprovalLayerPreviewsForWaitingOrders(
  tenantId?: string
): Promise<WaitingApprovalPreviewResult[]> {
  const admin = createAdminClient();
  let colQuery = admin
    .from("board_columns")
    .select("id, tenant_id, name, kind");
  if (tenantId) colQuery = colQuery.eq("tenant_id", tenantId);
  const { data: cols, error: colErr } = await colQuery;
  if (colErr) throw new Error(colErr.message);

  const waitingColIds = (cols ?? [])
    .filter((c) =>
      isWaitingApprovalColumn({
        kind: (c as { kind?: string }).kind,
        name: (c as { name?: string }).name,
      })
    )
    .map((c) => c.id as string);

  const byId = new Map<
    string,
    { id: string; title: string; tenant_id: string; specs: unknown }
  >();

  if (waitingColIds.length > 0) {
    let oq = admin
      .from("orders")
      .select("id, title, tenant_id, specs")
      .is("removed_at", null)
      .in("column_id", waitingColIds);
    if (tenantId) oq = oq.eq("tenant_id", tenantId);
    const { data: waitingOrders, error } = await oq;
    if (error) throw new Error(error.message);
    for (const row of waitingOrders ?? []) {
      byId.set(row.id as string, row as never);
    }
  }

  let noteQuery = admin
    .from("job_notifications")
    .select("order_id, tenant_id")
    .eq("type", "customer_approval")
    .in("status", ["pending", "sent"]);
  if (tenantId) noteQuery = noteQuery.eq("tenant_id", tenantId);
  const { data: notes, error: noteErr } = await noteQuery;
  if (noteErr) throw new Error(noteErr.message);

  const extraIds = [
    ...new Set(
      (notes ?? [])
        .map((n) => n.order_id as string)
        .filter((id) => id && !byId.has(id))
    ),
  ];
  if (extraIds.length > 0) {
    let extraQ = admin
      .from("orders")
      .select("id, title, tenant_id, specs")
      .is("removed_at", null)
      .in("id", extraIds);
    if (tenantId) extraQ = extraQ.eq("tenant_id", tenantId);
    const { data: extraOrders, error } = await extraQ;
    if (error) throw new Error(error.message);
    for (const row of extraOrders ?? []) {
      byId.set(row.id as string, row as never);
    }
  }

  const results: WaitingApprovalPreviewResult[] = [];
  for (const order of byId.values()) {
    try {
      const previews = await generateApprovalLayerPreviewsForOrder({
        id: order.id,
        title: String(order.title ?? ""),
        tenant_id: order.tenant_id,
        specs: (order.specs ?? {}) as Order["specs"],
      });
      results.push({
        orderId: order.id,
        title: String(order.title ?? ""),
        skus: Object.keys(previews).length,
      });
      console.info(
        `[approval-layer-previews] waiting ${order.title} → ${Object.keys(previews).length} SKUs`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[approval-layer-previews] waiting ${order.title} failed:`,
        message
      );
      results.push({
        orderId: order.id,
        title: String(order.title ?? ""),
        skus: 0,
        error: message,
      });
    }
  }
  return results;
}

/**
 * When the Final PDF on Drive changes, rebuild stored approval pictures and
 * the cardboard main picture. No-ops when nothing stored yet or the PDF is unchanged.
 */
export async function refreshProofsIfDrivePdfChanged(
  order: Pick<Order, "id" | "title" | "tenant_id" | "specs">,
  settings: GdriveSettings,
  finalFolderIds: string[]
): Promise<void> {
  const latest = await findLatestPdfInFolders(settings, finalFolderIds);
  if (!latest?.id) return;
  const rev = proofRasterRev(latest.modifiedTime.trim() || "unknown");
  const fingerprint = drivePdfFingerprint(latest.id, rev);
  const index = await loadRespondPreviewIndex(order.id);
  if (shouldRebuildStoredProofs(index, { fileId: latest.id, rev })) {
    await generateApprovalLayerPreviewsForOrder(order);
    return;
  }

  const specs = (order.specs ?? {}) as Record<string, unknown>;
  const cardRev =
    typeof specs[CARD_PDF_REV_SPEC] === "string"
      ? specs[CARD_PDF_REV_SPEC].trim()
      : "";
  if (cardRev === fingerprint) return;

  try {
    const client = proofsDriveClient(settings);
    const preview = await fetchPreviewBytes(client, {
      id: latest.id,
      name: latest.name,
      mimeType: "application/pdf",
      thumbnailLink: null,
    });
    if (!preview?.buffer?.length) return;
    const admin = createAdminClient();
    await upsertProductionCardImage(admin, order, preview.buffer, fingerprint);
  } catch (err) {
    console.warn(
      "[approval-layer-previews] card thumbnail refresh failed:",
      err instanceof Error ? err.message : err
    );
  }
}
