import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCurriConfigured } from "@/lib/curri";
import { quoteCurriCustomerRates } from "@/lib/shipping-quote.server";
import { normalizeDeliveryAddress } from "@/lib/shipping-address";
import { loadShippingSettings } from "@/lib/shipping-settings";
import type {
  ShippingBox,
  ShippingDeliveryAddress,
} from "@/lib/types";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!token) {
    return NextResponse.json({ error: "Token required" }, { status: 422 });
  }

  // Outside service area / missing credentials → empty rates (not an error).
  if (!isCurriConfigured()) {
    return NextResponse.json({ rates: [], paymentEnabled: false });
  }

  const body = (await request.json().catch(() => ({}))) as {
    deliveryAddress?: ShippingDeliveryAddress;
  };

  const addr = body.deliveryAddress;
  if (
    !addr?.street?.trim() ||
    !addr?.city?.trim() ||
    !addr?.state?.trim() ||
    !addr?.zip?.trim()
  ) {
    return NextResponse.json(
      { error: "Street, city, state, and ZIP are required." },
      { status: 422 }
    );
  }

  const admin = createAdminClient();
  const { data: shipReq, error } = await admin
    .from("shipping_requests")
    .select("id, status, boxes, tenant_id")
    .eq("token", token)
    .maybeSingle();

  if (error || !shipReq) {
    return NextResponse.json({ error: "Shipping link not found" }, { status: 404 });
  }

  if (shipReq.status === "client_responded") {
    return NextResponse.json(
      { error: "This shipping request was already confirmed." },
      { status: 409 }
    );
  }

  const settings = await loadShippingSettings(admin, shipReq.tenant_id);
  if (settings?.offer_curri === false) {
    return NextResponse.json({ rates: [], paymentEnabled: false });
  }

  const rates = await quoteCurriCustomerRates({
    boxes: (shipReq.boxes ?? []) as ShippingBox[],
    deliveryAddress: normalizeDeliveryAddress(addr),
    settings,
  });
  const paymentEnabled = settings?.payment_enabled ?? false;

  return NextResponse.json({ rates, paymentEnabled });
}
