import { OrderReview } from "@/components/respond/order-review";
import {
  buildRespondOrderRows,
  respondCustomerNote,
  skusForRespond,
  type RespondFinalPdf,
} from "@/lib/respond-order";
import type {
  RespondOrderAsset,
  RespondSkuImage,
} from "@/lib/respond-order";
import {
  layerPreviewObjectPath,
  type RespondLayerPreview,
} from "@/lib/approval-layer-preview-paths";
import { createAdminClient } from "@/lib/supabase/admin";
import type { OrderSpecs } from "@/lib/types";

const BUCKET = "order-assets";

/**
 * Build a map of pre-signed Supabase URLs for every layer preview image so the
 * client never has to hit the /api/notifications/asset proxy per-image.
 * Key format: `${fileId}|${rev}|${page}|${layer}` — matched in ProofLayerImages.
 */
async function preSignLayerPreviews(
  layerPreviews: Record<string, RespondLayerPreview>
): Promise<Record<string, string>> {
  const previews = Object.values(layerPreviews);
  if (previews.length === 0) return {};

  try {
    const pathToKey: Array<{ path: string; key: string }> = [];
    for (const p of previews) {
      const layers = ["composite", "base", ...p.layers.map((l) => l.id)];
      for (const layer of layers) {
        pathToKey.push({
          path: layerPreviewObjectPath(p.fileId, p.rev, p.page, layer),
          key: `${p.fileId}|${p.rev}|${p.page}|${layer}`,
        });
      }
    }

    const admin = createAdminClient();
    const { data, error } = await admin.storage
      .from(BUCKET)
      .createSignedUrls(
        pathToKey.map((p) => p.path),
        3600
      );
    if (error) {
      console.error("[respond-proof] createSignedUrls failed:", error);
      return {};
    }

    const keyByPath = new Map(pathToKey.map(({ path, key }) => [path, key]));
    const result: Record<string, string> = {};
    for (const row of data ?? []) {
      if (row.path && row.signedUrl && !row.error) {
        const key = keyByPath.get(row.path);
        if (key) result[key] = row.signedUrl;
      }
    }
    return result;
  } catch (err) {
    console.error("[respond-proof] pre-sign layer URLs failed:", err);
    return {};
  }
}

export function RespondProofFallback() {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-4">
      <p className="text-sm text-slate-500">Loading proof…</p>
    </div>
  );
}

/** SKUs + proof pages from send-time storage, or Drive PDF page map if that is missing. */
export async function RespondProof({
  token,
  orderId,
  description,
  fields,
  specs,
  assets,
  skuImages,
  skipDrivePdf = false,
  pdfProofOnly = false,
  proof,
}: {
  token: string;
  orderId: string;
  description: string | null;
  fields: Record<string, unknown>;
  specs: OrderSpecs | Record<string, unknown>;
  assets: RespondOrderAsset[];
  skuImages: Record<string, RespondSkuImage[]>;
  skipDrivePdf?: boolean;
  pdfProofOnly?: boolean;
  proof?: {
    skus: import("@/lib/skus").SkuItem[];
    finalPdfs: Record<string, RespondFinalPdf>;
    layerPreviews: Record<string, RespondLayerPreview>;
  };
}) {
  const specRecord = (specs ?? {}) as Record<string, unknown>;
  let reviewSkus = skusForRespond(specRecord);
  let finalPdfs: Record<string, RespondFinalPdf> = {};
  let layerPreviews: Record<string, RespondLayerPreview> = {};

  if (proof) {
    reviewSkus = proof.skus;
    finalPdfs = proof.finalPdfs;
    layerPreviews = proof.layerPreviews;
  } else if (orderId) {
    try {
      const { loadRespondCustomerProofForOrderId } = await import(
        "@/lib/approval-layer-previews"
      );
      const loaded = await loadRespondCustomerProofForOrderId(
        orderId,
        reviewSkus
      );
      reviewSkus = loaded.skus;
      finalPdfs = loaded.finalPdfs;
      layerPreviews = loaded.layerPreviews;
    } catch (err) {
      console.error("[respond-proof] proof load failed:", err);
    }
  }

  const haveProofs =
    Object.keys(layerPreviews).length > 0 ||
    Object.keys(finalPdfs).length > 0;

  // Batch-sign all layer preview image URLs so the client can use direct
  // Supabase CDN URLs instead of routing each image through the proxy.
  const preSignedLayerUrls = await preSignLayerPreviews(layerPreviews);

  return (
    <OrderReview
      token={token}
      rows={buildRespondOrderRows(description, fields, specRecord)}
      skus={reviewSkus}
      assets={assets}
      skuImages={skuImages}
      orderId={orderId}
      customerNote={respondCustomerNote(description, specRecord)}
      finalPdfs={finalPdfs}
      layerPreviews={layerPreviews}
      preSignedLayerUrls={preSignedLayerUrls}
      skipDrivePdf={skipDrivePdf || pdfProofOnly || haveProofs}
      pdfProofOnly={pdfProofOnly}
    />
  );
}
