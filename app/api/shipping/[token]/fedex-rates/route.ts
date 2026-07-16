import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchFedExRates } from "@/lib/fedex";
import { applyShippingMarkup } from "@/lib/shipping-markup";
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

  const deliveryAddress = {
    street: addr.street.trim(),
    city: addr.city.trim(),
    state: addr.state.trim().toUpperCase(),
    zip: addr.zip.trim(),
    country: (addr.country ?? "US").trim().toUpperCase() || "US",
  };

  try {
    const baseRates = await fetchFedExRates({
      boxes,
      deliveryAddress,
      settings,
    });

    const paymentEnabled = settings?.payment_enabled ?? false;
    const markupFixed = settings?.markup_fixed_cents ?? 0;
    const markupPercent = settings?.markup_percent ?? 0;

    const rates: FedExRateOption[] = baseRates.map((rate) => {
      const base = rate.totalCharge;
      if (!paymentEnabled || base == null) {
        return rate;
      }
      const withMarkup = applyShippingMarkup(base, markupFixed, markupPercent);
      return {
        ...rate,
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
