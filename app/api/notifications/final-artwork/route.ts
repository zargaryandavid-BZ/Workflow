import { NextResponse, after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notificationBlocksCustomerAssets } from "@/lib/notification-asset-access";
import { skusForRespond } from "@/lib/respond-order";

export const maxDuration = 300;

/**
 * Public (token) proof pictures for /respond. Stored JPEGs first — no Drive
 * walk when pictures already exist. `?prepare=1` rebuilds when the Final PDF
 * on Drive is a new file or a newer revision.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token")?.trim() ?? "";
  const orderId = searchParams.get("order")?.trim() ?? "";
  const prepare = searchParams.get("prepare") === "1";
  if (!token || !orderId) {
    return NextResponse.json(
      { error: "token and order are required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const [{ data: notification }, { data: approval }] = await Promise.all([
    admin
      .from("job_notifications")
      .select("order_id, status, type")
      .eq("token", token)
      .maybeSingle(),
    admin.from("approvals").select("order_id, status").eq("token", token).maybeSingle(),
  ]);

  let allowed = false;
  if (notification) {
    if (notificationBlocksCustomerAssets(notification.status as string)) {
      return NextResponse.json({ error: "Link expired" }, { status: 403 });
    }
    allowed = notification.order_id === orderId;
  } else if (approval) {
    allowed = approval.order_id === orderId;
  }
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: order } = await admin
    .from("orders")
    .select("id, title, tenant_id, specs")
    .eq("id", orderId)
    .maybeSingle();
  if (!order?.tenant_id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const specs = (order.specs ?? {}) as Record<string, unknown>;
  const ticketSkus = skusForRespond(specs);
  const orderRow = {
    id: order.id as string,
    title: String(order.title ?? ""),
    tenant_id: order.tenant_id as string,
    specs,
  };

  const { loadRespondCustomerProof, loadApprovalLayerPreviewsForOrder, isApprovalProofSourceMissing } =
    await import("@/lib/approval-layer-previews");

  const stored = await loadRespondCustomerProof(orderRow, ticketSkus);
  if (!prepare && Object.keys(stored.layerPreviews).length > 0) {
    return NextResponse.json({
      skus: stored.skus,
      bySku: stored.finalPdfs,
      layerPreviews: stored.layerPreviews,
    });
  }

  if (prepare) {
    // Never rasterize inside the customer request — a ~1GB Final PDF would hang
    // the proof link for minutes. Kick the build off in the background and
    // return immediately; the client polls this endpoint and the cron
    // (/api/cron/approval-previews) also builds it, so it appears once ready.
    after(async () => {
      try {
        await loadApprovalLayerPreviewsForOrder(orderRow, {
          generateIfMissing: true,
        });
      } catch (err) {
        if (!isApprovalProofSourceMissing(err)) {
          console.error("[final-artwork] background build failed:", err);
        }
      }
    });
    return NextResponse.json({
      skus: stored.skus,
      bySku: stored.finalPdfs,
      layerPreviews: stored.layerPreviews,
      preparing: Object.keys(stored.layerPreviews).length === 0,
    });
  }

  return NextResponse.json({
    skus: ticketSkus,
    bySku: {},
    layerPreviews: {},
  });
}
