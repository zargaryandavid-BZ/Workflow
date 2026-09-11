import { OrderReview } from "@/components/respond/order-review";
import { PdfLoadingBar } from "@/components/pdf/pdf-loading-bar";
import { buildRespondOrderRows, respondCustomerNote, skusForRespond } from "@/lib/respond-order";
import type {
  RespondOrderAsset,
  RespondSkuImage,
} from "@/lib/respond-order";
import type { OrderSpecs } from "@/lib/types";

export function RespondProofFallback() {
  return (
    <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-3 py-2">
        <span className="text-sm font-medium text-slate-600">Loading proof…</span>
      </div>
      <PdfLoadingBar />
    </div>
  );
}

/** Specs/SKUs only — Drive PDF lookup happens in the browser after first paint. */
export function RespondProof({
  token,
  orderId,
  description,
  fields,
  specs,
  assets,
  skuImages,
  skipDrivePdf = false,
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
  return (
    <OrderReview
      token={token}
      rows={buildRespondOrderRows(description, fields, specRecord)}
      skus={skusForRespond(specRecord)}
      assets={assets}
      skuImages={skuImages}
      orderId={orderId}
      customerNote={respondCustomerNote(description, specRecord)}
      skipDrivePdf={skipDrivePdf}
    />
  );
}
