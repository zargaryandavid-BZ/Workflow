import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notificationBlocksCustomerAssets } from "@/lib/notification-asset-access";
import { fetchRespondArtworkPack } from "@/lib/respond-final-pdf";
import { skusForRespond } from "@/lib/respond-order";

export const maxDuration = 300;

/**
 * Public (token) Drive file map for /respond. Kept off the HTML request so
 * the page can show a proof spinner before Google Drive listing finishes.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token")?.trim() ?? "";
  const orderId = searchParams.get("order")?.trim() ?? "";
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
  const pack = await fetchRespondArtworkPack(
    admin,
    order.tenant_id as string,
    {
      id: order.id as string,
      title: String(order.title ?? ""),
      specs,
    },
    skusForRespond(specs)
  );

  let layerPreviews: Record<string, unknown> = {};
  try {
    const { loadApprovalLayerPreviewsForOrder } = await import(
      "@/lib/approval-layer-previews"
    );
    layerPreviews = await loadApprovalLayerPreviewsForOrder(
      {
        id: order.id as string,
        title: String(order.title ?? ""),
        tenant_id: order.tenant_id as string,
        specs,
      },
      // Generate on demand if the background rasterization (scheduleLayerPreviews)
      // hasn't completed yet — e.g. in local dev, or if it failed silently.
      // This endpoint has maxDuration=180 and is fetched in the background after
      // the page renders, so the customer sees a spinner then images appear.
      { generateIfMissing: true }
    );
  } catch (err) {
    console.error("[approval-layer-previews] load failed:", err);
  }

  return NextResponse.json({ skus: pack.skus, bySku: pack.bySku, layerPreviews });
}
