import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { requireFulfillmentApi } from "@/lib/fulfillment-access";
import { savePickupAndNotifyCustomer } from "@/lib/fulfillment-pickup-notify";
import type { PickupConfirmationInput } from "@/lib/fulfillment-pickup";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = requireFulfillmentApi(await getTenantContext());
  if ("error" in auth) return auth.error;

  const body = (await request.json().catch(() => ({}))) as Partial<
    PickupConfirmationInput
  > & { order_id?: string };
  const result = await savePickupAndNotifyCustomer({
    supabase: createAdminClient(),
    tenantId: auth.ctx.tenant.id,
    input: {
      orderId: body.order_id ?? body.orderId ?? "",
      firstName: body.firstName ?? "",
      lastName: body.lastName ?? "",
      signatureDataUrl: body.signatureDataUrl ?? "",
    },
  });
  if ("error" in result) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status }
    );
  }
  return NextResponse.json(result);
}
