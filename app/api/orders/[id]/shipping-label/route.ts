import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { ensureFedExLabel } from "@/lib/fedex-label";
import { ORDER_ASSETS_BUCKET } from "@/lib/order-assets";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { ShippingRequest } from "@/lib/types";

export const runtime = "nodejs";

async function loadLatestShippingRequest(
  orderId: string,
  tenantId: string
): Promise<ShippingRequest | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shipping_requests")
    .select("*")
    .eq("order_id", orderId)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data as ShippingRequest;
}

/** Create or retry FedEx label for this order's latest shipping request. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await params;
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const shipReq = await loadLatestShippingRequest(orderId, ctx.tenant.id);
  if (!shipReq) {
    return NextResponse.json(
      { error: "No shipping request for this order" },
      { status: 404 }
    );
  }

  if (shipReq.client_choice !== "delivery") {
    return NextResponse.json(
      { error: "FedEx labels are only available for FedEx delivery." },
      { status: 400 }
    );
  }
  if (shipReq.fedex_selection?.provider === "curri") {
    return NextResponse.json(
      { error: "FedEx labels are not used for Curri deliveries." },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const result = await ensureFedExLabel(admin, shipReq.id, { force: true });

  const refreshed = await loadLatestShippingRequest(orderId, ctx.tenant.id);

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        shipping_request: refreshed,
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    tracking_number: result.trackingNumber,
    status: result.status,
    shipping_request: refreshed,
  });
}

/** Download / reprint the stored FedEx label PDF (or zip for multi-package). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await params;
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const shipReq = await loadLatestShippingRequest(orderId, ctx.tenant.id);
  if (!shipReq) {
    return NextResponse.json(
      { error: "No shipping request for this order" },
      { status: 404 }
    );
  }

  if (
    shipReq.fedex_shipment_status !== "created" ||
    !shipReq.fedex_label_storage_path
  ) {
    return NextResponse.json(
      { error: "No FedEx label available yet. Create or retry the label first." },
      { status: 404 }
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(ORDER_ASSETS_BUCKET)
    .download(shipReq.fedex_label_storage_path);

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to download label" },
      { status: 500 }
    );
  }

  const path = shipReq.fedex_label_storage_path;
  const isZip = path.toLowerCase().endsWith(".zip");
  const tracking =
    shipReq.fedex_tracking_number?.replace(/[^a-zA-Z0-9_-]/g, "") || "label";
  const filename = isZip
    ? `fedex-labels-${tracking}.zip`
    : `fedex-label-${tracking}.pdf`;

  const bytes = Buffer.from(await data.arrayBuffer());

  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "Content-Type": isZip ? "application/zip" : "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
