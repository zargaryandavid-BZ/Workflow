import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { completeShippingResponse } from "@/lib/shipping-confirm";
import { dollarsToCents } from "@/lib/shipping-markup";
import {
  isShippingChoiceOffered,
  isStripeConfiguredFromSettings,
  loadShippingSettings,
} from "@/lib/shipping-settings";
import {
  checkoutSessionPaid,
  retrieveCheckoutSession,
} from "@/lib/stripe-shipping";
import type {
  FedExRateOption,
  ShippingClientChoice,
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
    choice?: ShippingClientChoice;
    fedexSelection?: FedExRateOption | null;
    deliveryAddress?: ShippingDeliveryAddress | null;
    deliveryNotes?: string | null;
    checkoutSessionId?: string | null;
  };

  if (
    body.choice !== "pickup" &&
    body.choice !== "delivery" &&
    body.choice !== "uber" &&
    body.choice !== "curri"
  ) {
    return NextResponse.json(
      {
        error: "choice must be 'pickup', 'delivery', 'uber', or 'curri'",
      },
      { status: 422 }
    );
  }

  const admin = createAdminClient();
  const { data: shipReq, error: findError } = await admin
    .from("shipping_requests")
    .select("id, status, tenant_id")
    .eq("token", token)
    .maybeSingle();

  if (findError || !shipReq) {
    return NextResponse.json({ error: "Shipping link not found" }, { status: 404 });
  }

  const settings = await loadShippingSettings(admin, shipReq.tenant_id);
  if (!isShippingChoiceOffered(settings, body.choice)) {
    return NextResponse.json(
      { error: "That delivery option is not available." },
      { status: 403 }
    );
  }
  const paymentRequired =
    (body.choice === "delivery" || body.choice === "curri") &&
    Boolean(body.fedexSelection?.serviceType) &&
    (settings?.payment_enabled ?? false);

  if (body.choice === "delivery" || body.choice === "curri") {
    const hasRate = Boolean(body.fedexSelection?.serviceType);
    // Unquoted delivery is allowed when staff did not enter box sizes —
    // customer submits an address and the shop follows up with a quote.
    if (!hasRate && body.choice === "curri") {
      return NextResponse.json(
        { error: "Select a Curri delivery option." },
        { status: 422 }
      );
    }
    if (
      hasRate &&
      body.choice === "curri" &&
      body.fedexSelection?.provider != null &&
      body.fedexSelection.provider !== "curri"
    ) {
      return NextResponse.json(
        { error: "Select a Curri delivery option." },
        { status: 422 }
      );
    }
    const addr = body.deliveryAddress;
    if (
      !addr?.street?.trim() ||
      !addr?.city?.trim() ||
      !addr?.state?.trim() ||
      !addr?.zip?.trim()
    ) {
      return NextResponse.json(
        { error: "Delivery address is required." },
        { status: 422 }
      );
    }
  }

  if (body.choice === "uber") {
    const addr = body.deliveryAddress;
    if (
      !addr?.street?.trim() ||
      !addr?.city?.trim() ||
      !addr?.state?.trim() ||
      !addr?.zip?.trim()
    ) {
      return NextResponse.json(
        { error: "Delivery address is required." },
        { status: 422 }
      );
    }
  }

  let checkoutSessionId = body.checkoutSessionId?.trim() || null;
  let paymentIntentId: string | null = null;
  let paymentAmount: number | null = null;
  let paymentCurrency = "usd";

  if (paymentRequired) {
    if (!checkoutSessionId) {
      return NextResponse.json(
        { error: "Payment is required before confirming delivery." },
        { status: 402 }
      );
    }
    if (!isStripeConfiguredFromSettings(settings)) {
      return NextResponse.json(
        { error: "Stripe is not configured for this shop." },
        { status: 503 }
      );
    }

    try {
      const session = await retrieveCheckoutSession(settings, checkoutSessionId);
      if (session.metadata?.token && session.metadata.token !== token) {
        return NextResponse.json({ error: "Invalid payment session" }, { status: 400 });
      }
      if (!checkoutSessionPaid(session)) {
        return NextResponse.json(
          { error: "Payment not completed" },
          { status: 402 }
        );
      }
      paymentIntentId =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id ?? null;
      paymentAmount = session.amount_total ?? null;
      paymentCurrency = session.currency ?? "usd";
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to verify payment";
      return NextResponse.json({ error: message }, { status: 402 });
    }
  } else if (
    (body.choice === "delivery" || body.choice === "curri") &&
    body.fedexSelection?.totalCharge != null
  ) {
    paymentAmount = dollarsToCents(body.fedexSelection.totalCharge);
  }

  const deliveryAddress =
    (body.choice === "delivery" ||
      body.choice === "uber" ||
      body.choice === "curri") &&
    body.deliveryAddress
      ? {
          street: body.deliveryAddress.street.trim(),
          city: body.deliveryAddress.city.trim(),
          state: body.deliveryAddress.state.trim().toUpperCase(),
          zip: body.deliveryAddress.zip.trim(),
          country:
            (body.deliveryAddress.country ?? "US").trim().toUpperCase() || "US",
        }
      : null;

  const deliveryNotes =
    body.choice === "uber" || body.choice === "curri"
      ? body.deliveryNotes?.trim() || null
      : null;

  const result = await completeShippingResponse(admin, token, {
    choice: body.choice,
    fedexSelection:
      body.choice === "delivery" || body.choice === "curri"
        ? (body.fedexSelection ?? null)
        : null,
    deliveryAddress,
    deliveryNotes,
    checkoutSessionId,
    paymentIntentId,
    paymentStatus: paymentRequired ? "succeeded" : null,
    paymentAmount,
    paymentCurrency,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true });
}
