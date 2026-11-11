import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { requireFulfillmentApi } from "@/lib/fulfillment-access";
import {
  loadPickupStatus,
  savePickupAndNotifyCustomer,
} from "@/lib/fulfillment-pickup-notify";
import type { PickupConfirmationInput } from "@/lib/fulfillment-pickup";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** GET ?order_id= — does the Pickup window need a code / was it picked up already? */
export async function GET(request: Request) {
  const auth = requireFulfillmentApi(await getTenantContext());
  if ("error" in auth) return auth.error;
  const result = await loadPickupStatus({
    supabase: createAdminClient(),
    tenantId: auth.ctx.tenant.id,
    orderId: new URL(request.url).searchParams.get("order_id") ?? "",
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result);
}

export async function POST(request: Request) {
  const auth = requireFulfillmentApi(await getTenantContext());
  if ("error" in auth) return auth.error;

  const body = (await request.json().catch(() => ({}))) as Partial<
    PickupConfirmationInput
  > & { order_id?: string; pickup_code?: string; confirm_again?: boolean; skip_code?: boolean; skipped_by?: string };
  const result = await savePickupAndNotifyCustomer({
    supabase: createAdminClient(),
    tenantId: auth.ctx.tenant.id,
    input: {
      orderId: body.order_id ?? body.orderId ?? "",
      firstName: body.firstName ?? "",
      lastName: body.lastName ?? "",
      signatureDataUrl: body.signatureDataUrl ?? "",
      pickupCode: body.pickup_code ?? body.pickupCode ?? "",
      confirmAgain: body.confirm_again === true || body.confirmAgain === true,
      skipCode: body.skip_code === true || body.skipCode === true,
      skippedBy: (body.skipped_by ?? body.skippedBy ?? "").trim() || auth.ctx.fullName || auth.ctx.email || "",
      skippedByUserId: auth.ctx.userId,
    },
  });
  if ("error" in result) {
    return NextResponse.json(
      { error: result.error, alreadyPickedUp: result.alreadyPickedUp ?? null },
      { status: result.status }
    );
  }
  return NextResponse.json(result);
}
