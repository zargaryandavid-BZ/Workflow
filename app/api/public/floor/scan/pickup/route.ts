import { NextResponse } from "next/server";
import { resolveFloorTenant } from "@/lib/kiosk-token";
import { savePickupAndNotifyCustomer } from "@/lib/fulfillment-pickup-notify";
import type { PickupConfirmationInput } from "@/lib/fulfillment-pickup";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const floor = await resolveFloorTenant();
  if (!floor) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as Partial<
    PickupConfirmationInput
  > & { order_id?: string };
  const result = await savePickupAndNotifyCustomer({
    supabase: floor.supabase,
    tenantId: floor.tenantId,
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
