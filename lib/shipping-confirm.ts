import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  FedExRateOption,
  ShippingClientChoice,
  ShippingDeliveryAddress,
} from "@/lib/types";

function normalizeAddress(
  addr: ShippingDeliveryAddress
): ShippingDeliveryAddress {
  return {
    street: addr.street.trim(),
    city: addr.city.trim(),
    state: addr.state.trim().toUpperCase(),
    zip: addr.zip.trim(),
    country: (addr.country ?? "US").trim().toUpperCase() || "US",
  };
}

export async function completeShippingResponse(
  admin: SupabaseClient,
  token: string,
  args: {
    choice: ShippingClientChoice;
    fedexSelection?: FedExRateOption | null;
    deliveryAddress?: ShippingDeliveryAddress | null;
    deliveryNotes?: string | null;
    checkoutSessionId?: string | null;
    paymentIntentId?: string | null;
    paymentStatus?: "succeeded" | null;
    paymentAmount?: number | null;
    paymentCurrency?: string | null;
  }
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const { data: existing, error: findError } = await admin
    .from("shipping_requests")
    .select("id, status")
    .eq("token", token)
    .maybeSingle();

  if (findError || !existing) {
    return { ok: false, status: 404, error: "Shipping link not found" };
  }

  if (existing.status === "client_responded") {
    return {
      ok: false,
      status: 409,
      error: "This shipping request was already confirmed.",
    };
  }

  const needsAddress = args.choice === "delivery" || args.choice === "uber";
  const deliveryAddress =
    needsAddress && args.deliveryAddress
      ? normalizeAddress(args.deliveryAddress)
      : null;

  const deliveryNotes = args.deliveryNotes?.trim() || null;

  const { error: updateError } = await admin
    .from("shipping_requests")
    .update({
      client_choice: args.choice,
      fedex_selection:
        args.choice === "delivery" ? (args.fedexSelection ?? null) : null,
      delivery_address: deliveryAddress,
      delivery_notes: deliveryNotes,
      checkout_session_id: args.checkoutSessionId ?? null,
      payment_intent_id: args.paymentIntentId ?? null,
      payment_status: args.paymentStatus ?? null,
      payment_amount: args.paymentAmount ?? null,
      payment_currency: args.paymentCurrency ?? "usd",
      status: "client_responded",
      responded_at: new Date().toISOString(),
    })
    .eq("token", token);

  if (updateError) {
    console.error("[shipping-confirm]", updateError);
    return {
      ok: false,
      status: 500,
      error: updateError.message ?? "Failed to save choice",
    };
  }

  return { ok: true };
}
