import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  clientFedExAccountFromSelection,
  isClientFedExSelection,
} from "@/lib/client-fedex";
import { normalizeDeliveryAddress } from "@/lib/shipping-address";
import type {
  FedExRateOption,
  ShippingClientChoice,
  ShippingDeliveryAddress,
} from "@/lib/types";

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
): Promise<
  | { ok: true; shippingRequestId: string }
  | { ok: false; status: number; error: string }
> {
  const { data: existing, error: findError } = await admin
    .from("shipping_requests")
    .select("id, status, order_id, tenant_id")
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

  const needsAddress =
    args.choice === "delivery" ||
    args.choice === "uber" ||
    args.choice === "curri";
  const deliveryAddress =
    needsAddress && args.deliveryAddress
      ? normalizeDeliveryAddress(args.deliveryAddress)
      : null;

  const deliveryNotes = args.deliveryNotes?.trim() || null;

  const { error: updateError } = await admin
    .from("shipping_requests")
    .update({
      client_choice: args.choice,
      // Rate quote (FedEx or Curri) — both live under fedex_selection jsonb.
      fedex_selection:
        args.choice === "delivery" || args.choice === "curri"
          ? (args.fedexSelection ?? null)
          : null,
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

  if (isClientFedExSelection(args.fedexSelection)) {
    const account = clientFedExAccountFromSelection(args.fedexSelection);
    if (account) {
      const { data: order } = await admin
        .from("orders")
        .select("customer_id")
        .eq("id", existing.order_id)
        .maybeSingle();
      const customerId =
        order && typeof order.customer_id === "string"
          ? order.customer_id
          : null;
      if (customerId) {
        const { error: stampErr } = await admin
          .from("customers")
          .update({ fedex_account_number: account })
          .eq("id", customerId)
          .eq("tenant_id", existing.tenant_id);
        if (
          stampErr &&
          stampErr.code !== "42703" &&
          !/fedex_account_number/i.test(stampErr.message)
        ) {
          console.error("[shipping-confirm] stamp client FedEx:", stampErr);
        }
      }
    }
  }

  return { ok: true, shippingRequestId: existing.id };
}
