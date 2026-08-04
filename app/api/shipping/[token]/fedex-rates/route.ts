import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchFedExRates } from "@/lib/fedex";
import { applyShippingMarkup } from "@/lib/shipping-markup";
import { normalizeDeliveryAddress } from "@/lib/shipping-address";
import { loadShippingSettings } from "@/lib/shipping-settings";
import type {
  FedExRateOption,
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
    .select("id, status, boxes, tenant_id, expires_at")
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

  const boxes = (shipReq.boxes ?? []) as ShippingBox[];
  if (boxes.length === 0) {
    return NextResponse.json(
      { error: "No box details found for this shipment." },
      { status: 422 }
    );
  }

  const settings = await loadShippingSettings(admin, shipReq.tenant_id);
  if (settings?.offer_fedex === false) {
    return NextResponse.json({ rates: [], paymentEnabled: false });
  }

  const deliveryAddress = normalizeDeliveryAddress(addr);

  try {
    const baseRates = await fetchFedExRates({
      boxes,
      deliveryAddress,
      settings,
    });

    const paymentEnabled = settings?.payment_enabled ?? false;
    const markupPercent = settings?.markup_percent ?? 0;

    const rates: FedExRateOption[] = baseRates.map((rate) => {
      const tagged = { ...rate, provider: "fedex" as const };
      const base = tagged.totalCharge;
      // Client price = FedEx API rate + percent markup only (no fixed fee).
      if (!paymentEnabled || base == null || markupPercent === 0) {
        return tagged;
      }
      const withMarkup = applyShippingMarkup(base, 0, markupPercent);
      return {
        ...tagged,
        fedexBaseCharge: base,
        totalCharge: withMarkup,
      };
    });

    return NextResponse.json({
      rates,
      paymentEnabled,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to fetch FedEx rates";
    console.error("[fedex-rates]", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
