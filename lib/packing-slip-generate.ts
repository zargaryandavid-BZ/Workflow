import { createAdminClient } from "@/lib/supabase/admin";
import {
  loadOrderExportData,
  type OrderExportData,
  type OrderExportSkuRow,
} from "@/lib/button-automation-order-data";
import {
  generatePackingSlipPdf,
  generateThermalBoxSlipPdf,
  packingSlipOrderLabel,
  type ThermalSlipBox,
} from "@/lib/packing-slip-pdf";
import type { SkuItem } from "@/lib/skus";
import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "order-assets";

export function normalizeSlipBoxes(
  raw: { boxNumber?: number; lines?: { skuId?: string; qty?: number }[] }[] | undefined
): ThermalSlipBox[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const boxes = raw
    .map((box, index) => ({
      boxNumber:
        typeof box?.boxNumber === "number" && box.boxNumber > 0
          ? Math.floor(box.boxNumber)
          : index + 1,
      lines: (Array.isArray(box?.lines) ? box.lines : [])
        .map((line) => ({
          skuId: typeof line?.skuId === "string" ? line.skuId.trim() : "",
          qty:
            typeof line?.qty === "number" && Number.isFinite(line.qty)
              ? Math.max(0, Math.floor(line.qty))
              : 0,
        }))
        .filter((line) => line.skuId && line.qty > 0),
    }))
    .filter((box) => box.boxNumber > 0);
  return boxes.length > 0 ? boxes : undefined;
}

export function packingSlipPartFromOrderNumber(orderNumber: string): number {
  const m = String(orderNumber).trim().match(/-(\d+)\s*$/);
  if (!m) return 1;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/**
 * Stacked print JPEG (Artwork + foil / Spot UV) for the packing slip.
 *
 * Returns BOTH the composite URL map AND the expanded SKU list from the proof
 * system. When the production PDF has more pages than specs.skus (e.g. 15-page
 * PDF for a 1-SKU order), expandedSkus has one entry per PDF page, which lets
 * the caller build one packing-slip cell per page.
 */
export async function loadPackingSlipCompositePreviewUrls(
  orderId: string,
  skus: SkuItem[]
): Promise<{ compositeUrls: Map<string, string>; expandedSkus: SkuItem[] }> {
  const compositeUrls = new Map<string, string>();
  if (skus.length === 0) return { compositeUrls, expandedSkus: skus };

  try {
    const { loadRespondCustomerProofForOrderId, generateApprovalLayerPreviewsForOrder } = await import(
      "@/lib/approval-layer-previews"
    );
    const { ensurePrintProofJpeg } = await import("@/lib/flatten-print-proof");

    // Ensure layer previews exist for this order before loading them.
    // Job-ticket does this; packing slip was missing it — so multi-SKU orders
    // that hadn't been through the approval send flow had no artwork at all.
    const adminForGen = createAdminClient();
    const { data: order } = await adminForGen
      .from("orders")
      .select("id, title, tenant_id, specs")
      .eq("id", orderId)
      .maybeSingle();
    if (order?.tenant_id) {
      await generateApprovalLayerPreviewsForOrder({
        id: order.id as string,
        title: String(order.title ?? ""),
        tenant_id: order.tenant_id as string,
        specs: (order.specs ?? {}) as never,
      }).catch((err) =>
        console.warn(
          "[packing-slip] generate layer previews failed:",
          err instanceof Error ? err.message : err
        )
      );
    }

    const proof = await loadRespondCustomerProofForOrderId(
      orderId,
      skus as never
    );
    // proof.skus is already aligned to PDF page count via alignSkusToPdfPages:
    // for a 15-page PDF with 1 SKU in specs, proof.skus has 15 entries
    // (1 real + 14 synthetic __pdf_page_N__).
    const expandedSkus = (proof.skus as SkuItem[]).length > 0
      ? (proof.skus as SkuItem[])
      : skus;

    const previews = proof.layerPreviews as Record<
      string,
      {
        fileId: string;
        rev: string;
        page: number;
        layers: { id: string; name: string }[];
      }
    >;
    if (Object.keys(previews).length === 0) {
      return { compositeUrls, expandedSkus };
    }

    const admin = createAdminClient();
    const pathToSku = new Map<string, string>();

    // Parallelize artwork JPEG generation — for a 15-SKU order serial calls
    // would take 30-45 s and likely time out. Run all pages concurrently.
    await Promise.all(
      Object.entries(previews).map(async ([skuId, p]) => {
        const path = await ensurePrintProofJpeg(admin, p);
        if (path) pathToSku.set(path, skuId);
      })
    );
    if (pathToSku.size > 0) {
      const { data: signed } = await admin.storage
        .from(BUCKET)
        .createSignedUrls([...pathToSku.keys()], 180);

      for (const row of signed ?? []) {
        if (row.path && row.signedUrl && !row.error) {
          const skuId = pathToSku.get(row.path);
          if (skuId) compositeUrls.set(skuId, row.signedUrl);
        }
      }
    }

    return { compositeUrls, expandedSkus };
  } catch (err) {
    console.error("[generate-packing-slip] composite preview load", err);
  }

  return { compositeUrls, expandedSkus: skus };
}

export async function generatePackingSlipPdfFromExport(
  exportData: OrderExportData,
  opts: {
    part: number;
    totalParts: number;
    blind?: boolean;
    poNumber?: string;
    /** Only include these SKU IDs (undefined / empty = all). */
    selectedSkuIds?: string[];
    /** Per-SKU qty overrides from the modal's "Copy QTY" column. */
    copyQties?: Record<string, number>;
    /** "one_per_slip" forces SKU_PER_PAGE = 1 inside the PDF generator. */
    layout?: "multiple" | "one_per_slip";
    /** Total boxes — pre-fills the BOX section on the slip. */
    boxCount?: number;
    /** Sender thermal labels. Letter size stays the default. */
    pageSize?: "letter" | "4x6";
    boxes?: ThermalSlipBox[];
  }
): Promise<{ buffer: Buffer }> {
  // Load composite artwork URLs from the proof/layer-preview system.
  // For a 15-page PDF with 1 SKU in specs, compositeUrls has 15 entries
  // (one per page) and expandedSkus has 15 items (1 real + 14 synthetic).
  const { compositeUrls, expandedSkus } =
    await loadPackingSlipCompositePreviewUrls(exportData.order.id, exportData.skus);

  const specs = (exportData.order.specs ?? {}) as Record<string, unknown>;
  const configuredSkuQty = Math.floor(Number(specs.sku_qty ?? 0));

  // "Multi-page single-SKU" pattern: production PDF has more pages than
  // specs.skus entries (e.g. 15-page PDF for a 1-SKU order). The expanded
  // SKU list from the proof system gives us one entry per PDF page.
  // Rule (per user): SKU count = PDF page count. Per-SKU qty = totalQty ÷
  // sku_qty when configured, otherwise show totalQty on each cell.
  const isMultiPageSingleSku = expandedSkus.length > exportData.skus.length;

  let pdfData: OrderExportData;

  if (isMultiPageSingleSku) {
    const baseRow = exportData.skuRows[0]; // the one real SKU row (may have gallery images)
    const galleryImages = baseRow?.imageFiles ?? [];

    // Per-cell qty: divide total by the larger of sku_qty spec or PDF page count.
    const divisor =
      configuredSkuQty >= expandedSkus.length
        ? configuredSkuQty
        : expandedSkus.length;
    const perQty =
      exportData.totalQty != null
        ? Math.round(exportData.totalQty / divisor)
        : null;

    const skuRows: OrderExportSkuRow[] = expandedSkus.map((sku, i) => {
      const compositeUrl = compositeUrls.get(sku.id);
      // Gallery images are sorted by position; assume position i → PDF page i+1.
      const galleryImg = galleryImages[i];
      const imageLinks = [compositeUrl, galleryImg?.url].filter(
        (u): u is string => Boolean(u)
      );
      // Prefer gallery image file name (e.g. "Sour Diesel") as the SKU label;
      // fall back to the sku name from specs or a generic "SKU N".
      const name = galleryImg
        ? galleryImg.name.replace(/\.\w+$/, "").trim()
        : sku.name.trim();
      return {
        id: sku.id,
        index: i + 1,
        name: name || `SKU ${i + 1}`,
        // Per user rule: "if no qty mention for each SKU just set total"
        qty: perQty ?? exportData.totalQty,
        imageLinks,
        imageFiles: galleryImg ? [galleryImg] : [],
      };
    });

    pdfData = {
      ...exportData,
      skuRows,
      // Update skus so the header shows the correct SKU count (15, not 1).
      // totalQty stays unchanged — it's the total across all cells.
      skus: skuRows.map((r) => ({ id: r.id, name: r.name, qty: r.qty })),
    };
  } else {
    // Normal path: map composite URLs to existing skuRows.
    const skuRows: OrderExportSkuRow[] = exportData.skuRows.map((row) => {
      const compositeUrl = compositeUrls.get(row.id);
      if (compositeUrl) return { ...row, imageLinks: [compositeUrl] };
      return row;
    });
    pdfData = { ...exportData, skuRows };
  }

  // ── Apply modal selections ───────────────────────────────────────────────
  // 1. Filter to selected SKUs only (if the user deselected some).
  // 2. Override each SKU's qty with the Copy QTY the user typed.
  const { selectedSkuIds, copyQties } = opts;

  if (selectedSkuIds && selectedSkuIds.length > 0) {
    const keepSet = new Set(selectedSkuIds);
    pdfData = {
      ...pdfData,
      skuRows: pdfData.skuRows.filter((r) => keepSet.has(r.id)),
      skus: pdfData.skus.filter((s) => keepSet.has(s.id)),
    };
  }

  if (copyQties && Object.keys(copyQties).length > 0) {
    pdfData = {
      ...pdfData,
      skuRows: pdfData.skuRows.map((r) =>
        copyQties[r.id] != null ? { ...r, qty: copyQties[r.id] } : r
      ),
      skus: pdfData.skus.map((s) =>
        copyQties[s.id] != null ? { ...s, qty: copyQties[s.id] } : s
      ),
    };
  }

  // Recalculate totalQty from (possibly filtered + overridden) SKUs.
  const newTotal = pdfData.skus.reduce(
    (sum, s) => sum + (typeof s.qty === "number" ? s.qty : 0),
    0
  );
  if (newTotal > 0) {
    pdfData = { ...pdfData, totalQty: newTotal };
  }

  if (opts.pageSize === "4x6" && opts.boxes && opts.boxes.length > 0) {
    const orderLabel = opts.blind
      ? (opts.poNumber?.trim() || "Order")
      : packingSlipOrderLabel(
          pdfData.orderNumberDisplay || pdfData.orderNumber,
          pdfData.orderNumber,
          opts.totalParts
        );
    const buffer = await generateThermalBoxSlipPdf({
      orderLabel,
      customerName:
        pdfData.customerName && pdfData.customerName !== "—"
          ? pdfData.customerName
          : "",
      skus: pdfData.skuRows.flatMap((row, index) => {
        const sku = {
          id: row.id,
          name: row.name,
          imageUrl: row.imageLinks[0] ?? null,
        };
        const pageId = `__pdf_page_${index + 1}__`;
        return row.id === pageId ? [sku] : [sku, { ...sku, id: pageId }];
      }),
      boxes: opts.boxes,
      layout: opts.layout === "one_per_slip" ? "one_per_slip" : "multiple",
    });
    return { buffer };
  }

  const { buffer } = await generatePackingSlipPdf(pdfData, {
    part: opts.part,
    totalParts: opts.totalParts,
    blind: Boolean(opts.blind),
    poNumber: opts.poNumber,
    oneSkuPerSlip: opts.layout === "one_per_slip",
    boxCount: opts.boxCount,
  });
  return { buffer };
}

export async function generatePackingSlipPdfBuffer(
  supabase: SupabaseClient,
  orderId: string,
  tenantId: string,
  tenantName: string
): Promise<
  { buffer: Buffer; orderNumber: string; part: number; totalParts: number } | {
    error: string;
    status: number;
  }
> {
  let exportData: OrderExportData | null;
  try {
    exportData = await loadOrderExportData(
      supabase,
      orderId,
      tenantId,
      tenantName
    );
  } catch (err) {
    console.error("[generate-packing-slip] loadOrderExportData", err);
    return { error: "Failed to load order data for packing slip", status: 500 };
  }
  if (!exportData) {
    return { error: "Order not found", status: 404 };
  }

  const groupSize =
    exportData.groupSize != null && exportData.groupSize >= 1
      ? exportData.groupSize
      : 1;
  const part = Math.min(
    packingSlipPartFromOrderNumber(exportData.orderNumber),
    groupSize
  );
  const totalParts = groupSize;

  try {
    const { buffer } = await generatePackingSlipPdfFromExport(exportData, {
      part,
      totalParts,
    });
    if (!buffer?.length) {
      return { error: "Packing slip PDF was empty", status: 500 };
    }
    return { buffer, orderNumber: exportData.orderNumber, part, totalParts };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to generate packing slip";
    console.error("[generate-packing-slip]", err);
    return { error: message, status: 500 };
  }
}

/** No-login Sender print. Same PDF options as the staff generate route. */
export async function generateFloorPackingSlip(
  supabase: SupabaseClient,
  orderId: string,
  tenantId: string,
  tenantName: string,
  body: {
    part?: number;
    totalParts?: number;
    layout?: "multiple" | "one_per_slip";
    pageSize?: "letter" | "4x6";
    boxes?: { boxNumber?: number; lines?: { skuId?: string; qty?: number }[] }[];
  }
): Promise<
  { buffer: Buffer; orderNumber: string; part: number; totalParts: number } | {
    error: string;
    status: number;
  }
> {
  let exportData: OrderExportData | null;
  try {
    exportData = await loadOrderExportData(
      supabase,
      orderId,
      tenantId,
      tenantName
    );
  } catch (err) {
    console.error("[floor-packing-slip] loadOrderExportData", err);
    return { error: "Failed to load order data for packing slip", status: 500 };
  }
  if (!exportData) {
    return { error: "Order not found", status: 404 };
  }

  const groupSize =
    exportData.groupSize != null && exportData.groupSize >= 1
      ? exportData.groupSize
      : 1;
  const requestedPart =
    typeof body.part === "number" && body.part >= 1 ? Math.floor(body.part) : 1;
  const requestedTotal =
    typeof body.totalParts === "number" && body.totalParts >= 1
      ? Math.floor(body.totalParts)
      : groupSize;
  const totalParts = Math.max(requestedTotal, requestedPart, groupSize);
  const part = Math.min(requestedPart, totalParts);

  try {
    const { buffer } = await generatePackingSlipPdfFromExport(exportData, {
      part,
      totalParts,
      layout: body.layout === "one_per_slip" ? "one_per_slip" : "multiple",
      pageSize: body.pageSize === "4x6" ? "4x6" : "letter",
      boxes: normalizeSlipBoxes(body.boxes),
    });
    if (!buffer?.length) {
      return { error: "Packing slip PDF was empty", status: 500 };
    }
    return { buffer, orderNumber: exportData.orderNumber, part, totalParts };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to generate packing slip";
    console.error("[floor-packing-slip]", err);
    return { error: message, status: 500 };
  }
}
