import { NextResponse } from "next/server";
import { resolveFloorTenant } from "@/lib/kiosk-token";
import {
  loadPickupStatus,
  savePickupAndNotifyCustomer,
} from "@/lib/fulfillment-pickup-notify";
import type { PickupConfirmationInput } from "@/lib/fulfillment-pickup";

export const runtime = "nodejs";

/** GET ?order_id= — does the Pickup window need a code / was it picked up already? */
export async function GET(request: Request) {
  const floor = await resolveFloorTenant();
  if (!floor) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const result = await loadPickupStatus({
    supabase: floor.supabase,
    tenantId: floor.tenantId,
    orderId: new URL(request.url).searchParams.get("order_id") ?? "",
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result);
}

export async function POST(request: Request) {
  const floor = await resolveFloorTenant();
  if (!floor) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as Partial<
    PickupConfirmationInput
  > & { order_id?: string; pickup_code?: string; confirm_again?: boolean };
  const result = await savePickupAndNotifyCustomer({
    supabase: floor.supabase,
    tenantId: floor.tenantId,
    input: {
      orderId: body.order_id ?? body.orderId ?? "",
      firstName: body.firstName ?? "",
      lastName: body.lastName ?? "",
      signatureDataUrl: body.signatureDataUrl ?? "",
      pickupCode: body.pickup_code ?? body.pickupCode ?? "",
      confirmAgain: body.confirm_again === true || body.confirmAgain === true,
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
