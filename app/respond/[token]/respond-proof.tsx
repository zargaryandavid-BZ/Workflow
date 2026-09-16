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
import type { RespondLayerPreview } from "@/lib/approval-layer-preview-paths";
import type { OrderSpecs } from "@/lib/types";

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
      skipDrivePdf={haveProofs}
      pdfProofOnly={pdfProofOnly}
    />
  );
}
