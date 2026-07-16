import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dollarsToCents } from "@/lib/shipping-markup";
import {
  isStripeConfiguredFromSettings,
  loadShippingSettings,
  resolveStripePublishableKey,
} from "@/lib/shipping-settings";
import { getStripeClient } from "@/lib/stripe-shipping";
import type {
  FedExRateOption,
  ShippingDeliveryAddress,
} from "@/lib/types";

function appBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "http://localhost:3000"
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!token) {
    return NextResponse.json({ error: "Token required" }, { status: 422 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    fedexSelection?: FedExRateOption;
    deliveryAddress?: ShippingDeliveryAddress;
  };

  const fedexSelection = body.fedexSelection;
  const deliveryAddress = body.deliveryAddress;

  if (!fedexSelection?.serviceType || fedexSelection.totalCharge == null) {
    return NextResponse.json(
      { error: "Select a delivery option with a valid price." },
      { status: 422 }
    );
  }

  if (
    !deliveryAddress?.street?.trim() ||
    !deliveryAddress?.city?.trim() ||
    !deliveryAddress?.state?.trim() ||
    !deliveryAddress?.zip?.trim()
  ) {
    return NextResponse.json(
      { error: "Delivery address is required." },
      { status: 422 }
    );
  }

  const admin = createAdminClient();
  const { data: shipReq, error } = await admin
    .from("shipping_requests")
    .select("id, status, tenant_id, order_id")
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
  if (!settings?.payment_enabled) {
    return NextResponse.json(
      { error: "Online payment is not enabled for this shop." },
      { status: 400 }
    );
  }
  if (!isStripeConfiguredFromSettings(settings)) {
    return NextResponse.json(
      { error: "Stripe is not configured. Add keys in Shipping settings." },
      { status: 503 }
    );
  }

  const publishableKey = resolveStripePublishableKey(settings);
  if (!publishableKey) {
    return NextResponse.json(
      { error: "Stripe publishable key is missing." },
      { status: 503 }
    );
  }

  const amountCents = dollarsToCents(fedexSelection.totalCharge);
  if (amountCents < 50) {
    return NextResponse.json(
      { error: "Shipping total must be at least $0.50." },
      { status: 422 }
    );
  }

  const { data: order } = await admin
    .from("orders")
    .select("title")
    .eq("id", shipReq.order_id)
    .maybeSingle();

  const base = appBaseUrl();

  let stripe;
  try {
    stripe = getStripeClient(settings);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Stripe client failed";
    return NextResponse.json({ error: message }, { status: 503 });
  }

  const normalizedAddress = {
    street: deliveryAddress.street.trim(),
    city: deliveryAddress.city.trim(),
    state: deliveryAddress.state.trim().toUpperCase(),
    zip: deliveryAddress.zip.trim(),
    country: (deliveryAddress.country ?? "US").trim().toUpperCase() || "US",
  };

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: (fedexSelection.currency ?? "usd").toLowerCase(),
            unit_amount: amountCents,
            product_data: {
              name: `Shipping — ${fedexSelection.serviceName}`,
              description: order?.title
                ? `Order ${order.title} · ${fedexSelection.serviceName}`
                : fedexSelection.serviceName,
            },
          },
        },
      ],
      success_url: `${base}/shipping/${token}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/shipping/${token}?payment=cancelled`,
      metadata: {
        token,
        serviceType: fedexSelection.serviceType,
        deliveryAddress: JSON.stringify(normalizedAddress),
        fedexSelection: JSON.stringify(fedexSelection),
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create checkout session";
    console.error("[create-checkout-session]", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null;

  const { error: updateError } = await admin
    .from("shipping_requests")
    .update({
      status: "payment_pending",
      checkout_session_id: session.id,
      payment_intent_id: paymentIntentId,
      payment_status: "pending",
      payment_amount: amountCents,
      payment_currency: (fedexSelection.currency ?? "usd").toLowerCase(),
      delivery_address: normalizedAddress,
      fedex_selection: fedexSelection,
      client_choice: "delivery",
    })
    .eq("token", token);

  if (updateError) {
    console.error("[create-checkout-session] update failed", updateError);
    return NextResponse.json(
      {
        error:
          updateError.message ??
          "Failed to save payment session. Please try again.",
      },
      { status: 500 }
    );
  }

  if (!session.url) {
    return NextResponse.json(
      { error: "Failed to create checkout session" },
      { status: 500 }
    );
  }

  return NextResponse.json({ url: session.url, sessionId: session.id });
}
