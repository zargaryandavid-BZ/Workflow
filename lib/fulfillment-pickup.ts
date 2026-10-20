import type { SupabaseClient } from "@supabase/supabase-js";
import { ORDER_ASSETS_BUCKET } from "./order-assets.ts";

export type PickupConfirmationInput = {
  orderId: string;
  firstName: string;
  lastName: string;
  signatureDataUrl: string;
};

export type PickupConfirmation = {
  first_name: string;
  last_name: string;
  picked_up_at: string;
  signature_path: string;
};

const MAX_SIGNATURE_BYTES = 750_000;

export function formatPickupDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
  });
}

export function pickupRecipientName(firstName: string, lastName: string): string {
  return [firstName.trim(), lastName.trim()].filter(Boolean).join(" ");
}

export function decodePickupSignaturePng(dataUrl: string): Buffer | null {
  const match = dataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  const bytes = Buffer.from(match[1]!, "base64");
  if (bytes.length === 0 || bytes.length > MAX_SIGNATURE_BYTES) return null;
  const pngMagic = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < pngMagic.length || !bytes.subarray(0, 8).equals(pngMagic)) {
    return null;
  }
  return bytes;
}

export async function savePickupConfirmation(args: {
  supabase: SupabaseClient;
  tenantId: string;
  input: PickupConfirmationInput;
}): Promise<
  { confirmation: PickupConfirmation } | { error: string; status: number }
> {
  const orderId = args.input.orderId.trim();
  const firstName = args.input.firstName.trim().slice(0, 100);
  const lastName = args.input.lastName.trim().slice(0, 100);
  if (!orderId || !firstName || !lastName) {
    return {
      error: "Order, first name, and last name are required",
      status: 400,
    };
  }

  const signature = decodePickupSignaturePng(args.input.signatureDataUrl);
  if (!signature) {
    return { error: "A valid signature is required", status: 400 };
  }

  const { data: order, error: orderError } = await args.supabase
    .from("orders")
    .select("id, specs")
    .eq("id", orderId)
    .eq("tenant_id", args.tenantId)
    .is("removed_at", null)
    .maybeSingle();
  if (orderError || !order) {
    return { error: "Order not found", status: 404 };
  }

  const pickedUpAt = new Date().toISOString();
  const signaturePath = `${args.tenantId}/${orderId}/pickup/${pickedUpAt.replace(
    /[:.]/g,
    "-"
  )}.png`;
  const { error: uploadError } = await args.supabase.storage
    .from(ORDER_ASSETS_BUCKET)
    .upload(signaturePath, signature, {
      contentType: "image/png",
      upsert: false,
    });
  if (uploadError) {
    return { error: uploadError.message, status: 500 };
  }

  const confirmation: PickupConfirmation = {
    first_name: firstName,
    last_name: lastName,
    picked_up_at: pickedUpAt,
    signature_path: signaturePath,
  };
  const specs =
    order.specs && typeof order.specs === "object" && !Array.isArray(order.specs)
      ? (order.specs as Record<string, unknown>)
      : {};
  const { error: updateError } = await args.supabase
    .from("orders")
    .update({
      specs: {
        ...specs,
        pickup_confirmation: confirmation,
      },
    })
    .eq("id", orderId)
    .eq("tenant_id", args.tenantId);
  if (updateError) {
    await args.supabase.storage
      .from(ORDER_ASSETS_BUCKET)
      .remove([signaturePath]);
    return { error: updateError.message, status: 500 };
  }

  return { confirmation };
}
