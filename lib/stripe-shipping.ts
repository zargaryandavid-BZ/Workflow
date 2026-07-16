import "server-only";

import Stripe from "stripe";
import { resolveStripeSecretKey } from "@/lib/shipping-settings";
import type { ShippingSettings } from "@/lib/types";

export function getStripeClient(settings: ShippingSettings | null): Stripe {
  const secretKey = resolveStripeSecretKey(settings);
  if (!secretKey) {
    throw new Error("Stripe is not configured. Add keys in Shipping settings.");
  }
  return new Stripe(secretKey, { apiVersion: "2026-06-24.dahlia" });
}

export async function retrieveCheckoutSession(
  settings: ShippingSettings | null,
  sessionId: string
) {
  const stripe = getStripeClient(settings);
  return stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["payment_intent"],
  });
}

export function checkoutSessionPaid(session: Stripe.Checkout.Session): boolean {
  return session.payment_status === "paid";
}
