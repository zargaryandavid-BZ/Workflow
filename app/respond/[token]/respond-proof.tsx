import { OrderReview } from "@/components/respond/order-review";
import { PdfLoadingBar } from "@/components/pdf/pdf-loading-bar";
import { fetchRespondArtworkPack } from "@/lib/respond-final-pdf";
import { buildRespondOrderRows, skusForRespond } from "@/lib/respond-order";
import type {
  RespondOrderAsset,
  RespondOrderRow,
  RespondSkuImage,
} from "@/lib/respond-order";
import { createAdminClient } from "@/lib/supabase/admin";
import type { OrderSpecs } from "@/lib/types";
import type { SkuItem } from "@/lib/skus";

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

/** Drive listing is slow; keep it off the main RSC so Turbopack does not abort. */
export async function RespondProof({
  token,
  orderId,
  description,
  fields,
  specs,
  assets,
  skuImages,
}: {
  token: string;
  orderId: string;
  description: string | null;
  fields: Record<string, unknown>;
  specs: OrderSpecs | Record<string, unknown>;
  assets: RespondOrderAsset[];
  skuImages: Record<string, RespondSkuImage[]>;
}) {
  const specRecord = (specs ?? {}) as Record<string, unknown>;
  const rows: RespondOrderRow[] = buildRespondOrderRows(
    description,
    fields,
    specRecord
  );
  let reviewSkus: SkuItem[] = skusForRespond(specRecord);
  let finalPdfs: Record<string, Awaited<
    ReturnType<typeof fetchRespondArtworkPack>
  >["bySku"][string]> = {};

  try {
    const admin = createAdminClient();
    const { data: orderRow } = await admin
      .from("orders")
      .select("id, title, tenant_id, specs")
      .eq("id", orderId)
      .maybeSingle();
    if (orderRow?.tenant_id) {
      const pack = await fetchRespondArtworkPack(
        admin,
        orderRow.tenant_id as string,
        {
          id: orderRow.id as string,
          title: String(orderRow.title ?? ""),
          specs: (orderRow.specs ?? {}) as Record<string, unknown>,
        },
        reviewSkus
      );
      finalPdfs = pack.bySku;
      if (Object.keys(pack.bySku).length > 0) reviewSkus = pack.skus;
    }
  } catch {
    // Drive lookup is optional
  }

  return (
    <OrderReview
      token={token}
      rows={rows}
      skus={reviewSkus}
      assets={assets}
      skuImages={skuImages}
      orderId={orderId}
      finalPdfs={finalPdfs}
    />
  );
}
