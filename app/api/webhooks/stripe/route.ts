import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { completeShippingResponse } from "@/lib/shipping-confirm";
import { loadShippingSettings } from "@/lib/shipping-settings";
import { checkoutSessionPaid } from "@/lib/stripe-shipping";
import type { FedExRateOption, ShippingDeliveryAddress } from "@/lib/types";

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const admin = createAdminClient();

  let event: Stripe.Event;
  let tenantId: string | null = null;

  try {
    const parsed = JSON.parse(body) as { data?: { object?: { metadata?: { token?: string } } } };
    const token = parsed.data?.object?.metadata?.token;
    if (token) {
      const { data: shipReq } = await admin
        .from("shipping_requests")
        .select("tenant_id")
        .eq("token", token)
        .maybeSingle();
      tenantId = shipReq?.tenant_id ?? null;
    }
  } catch {
    /* fall through — verify with env secret below */
  }

  const settings = tenantId
    ? await loadShippingSettings(admin, tenantId)
    : null;

  const webhookSecret =
    settings?.stripe_webhook_secret?.trim() ||
    process.env.STRIPE_WEBHOOK_SECRET?.trim();

  if (!webhookSecret) {
    console.error("[stripe-webhook] No webhook secret configured");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }

  const stripeSecret =
    settings?.stripe_secret_key?.trim() || process.env.STRIPE_SECRET_KEY?.trim();
  if (!stripeSecret) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }

  const stripe = new Stripe(stripeSecret, { apiVersion: "2026-06-24.dahlia" });

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid signature";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const token = session.metadata?.token;
    if (!token) {
      return NextResponse.json({ received: true });
    }

    if (!checkoutSessionPaid(session)) {
      return NextResponse.json({ received: true });
    }

    let fedexSelection: FedExRateOption | null = null;
    let deliveryAddress: ShippingDeliveryAddress | null = null;

    try {
      if (session.metadata?.fedexSelection) {
        fedexSelection = JSON.parse(
          session.metadata.fedexSelection
        ) as FedExRateOption;
      }
      if (session.metadata?.deliveryAddress) {
        deliveryAddress = JSON.parse(
          session.metadata.deliveryAddress
        ) as ShippingDeliveryAddress;
      }
    } catch {
      console.error("[stripe-webhook] Failed to parse session metadata");
    }

    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id ?? null;

    await admin
      .from("shipping_requests")
      .update({
        payment_status: "succeeded",
        payment_intent_id: paymentIntentId,
        payment_amount: session.amount_total ?? null,
        payment_currency: session.currency ?? "usd",
      })
      .eq("token", token);

    if (fedexSelection && deliveryAddress) {
      await completeShippingResponse(admin, token, {
        choice: fedexSelection.provider === "curri" ? "curri" : "delivery",
        fedexSelection,
        deliveryAddress,
        checkoutSessionId: session.id,
        paymentIntentId,
        paymentStatus: "succeeded",
        paymentAmount: session.amount_total ?? null,
        paymentCurrency: session.currency ?? "usd",
      });
    }
  }

  if (event.type === "checkout.session.expired") {
    const session = event.data.object as Stripe.Checkout.Session;
    const token = session.metadata?.token;
    if (token) {
      await admin
        .from("shipping_requests")
        .update({ payment_status: "failed" })
        .eq("token", token)
        .eq("checkout_session_id", session.id)
        .neq("status", "client_responded");
    }
  }

  return NextResponse.json({ received: true });
}
