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
import { alignSkusToPdfPages } from "@/lib/shared-pdf-pages";

export function RespondProofFallback() {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-4">
      <p className="text-sm text-slate-500">Loading proof…</p>
    </div>
  );
}

/** SKUs immediately; web-preview images from send-time storage (no Drive). */
export async function RespondProof({
  token,
  orderId,
  description,
  fields,
  specs,
  assets,
  skuImages,
  skipDrivePdf: _skipDrivePdf = false,
}: {
  token: string;
  orderId: string;
  description: string | null;
  fields: Record<string, unknown>;
  specs: OrderSpecs | Record<string, unknown>;
  assets: RespondOrderAsset[];
  skuImages: Record<string, RespondSkuImage[]>;
  skipDrivePdf?: boolean;
}) {
  const specRecord = (specs ?? {}) as Record<string, unknown>;
  let reviewSkus = skusForRespond(specRecord);
  let finalPdfs: Record<string, RespondFinalPdf> = {};
  let layerPreviews: Record<string, RespondLayerPreview> = {};

  if (orderId) {
    try {
      const {
        loadRespondPreviewIndex,
        expandRespondPreviewIndex,
        respondProofFromIndex,
      } = await import("@/lib/approval-layer-previews");
      const index = await loadRespondPreviewIndex(orderId);
      if (index) {
        const expanded = expandRespondPreviewIndex(index, reviewSkus);
        reviewSkus = alignSkusToPdfPages(reviewSkus, expanded.pages.length);
        const proof = respondProofFromIndex(expanded);
        finalPdfs = proof.finalPdfs;
        layerPreviews = proof.layerPreviews;
      }
    } catch (err) {
      console.error("[respond-proof] preview index failed:", err);
    }
  }

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
      skipDrivePdf
    />
  );
}
