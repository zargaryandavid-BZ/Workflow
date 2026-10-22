import { NextResponse } from "next/server";
import { isClientFedExSelection } from "@/lib/client-fedex";
import { ORDER_ASSETS_BUCKET } from "@/lib/order-assets";
import { createAdminClient } from "@/lib/supabase/admin";
import type { FedExRateOption } from "@/lib/types";

export const runtime = "nodejs";

/** Download the label generated for a customer-confirmed shipping request. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!token) {
    return NextResponse.json({ error: "Token required" }, { status: 422 });
  }

  const admin = createAdminClient();
  const { data: request, error: findError } = await admin
    .from("shipping_requests")
    .select(
      "status, fedex_selection, fedex_tracking_number, fedex_label_storage_path, fedex_shipment_status"
    )
    .eq("token", token)
    .maybeSingle();

  if (findError || !request) {
    return NextResponse.json(
      { error: "Shipping link not found" },
      { status: 404 }
    );
  }
  if (
    request.status !== "client_responded" ||
    !isClientFedExSelection(
      request.fedex_selection as FedExRateOption | null
    ) ||
    request.fedex_shipment_status !== "created" ||
    !request.fedex_label_storage_path
  ) {
    return NextResponse.json(
      { error: "The shipping label is not ready yet." },
      { status: 404 }
    );
  }

  const { data, error } = await admin.storage
    .from(ORDER_ASSETS_BUCKET)
    .download(request.fedex_label_storage_path);
  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to download label" },
      { status: 500 }
    );
  }

  const isZip = request.fedex_label_storage_path
    .toLowerCase()
    .endsWith(".zip");
  const tracking =
    request.fedex_tracking_number?.replace(/[^a-zA-Z0-9_-]/g, "") ||
    "label";
  const filename = isZip
    ? `fedex-labels-${tracking}.zip`
    : `fedex-label-${tracking}.pdf`;

  return new NextResponse(Buffer.from(await data.arrayBuffer()), {
    headers: {
      "Content-Type": isZip ? "application/zip" : "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
