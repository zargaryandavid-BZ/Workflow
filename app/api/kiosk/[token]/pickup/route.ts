import { NextResponse } from "next/server";
import { resolveKioskTenant } from "@/lib/kiosk-token";
import { savePickupAndNotifyCustomer } from "@/lib/fulfillment-pickup-notify";
import type { PickupConfirmationInput } from "@/lib/fulfillment-pickup";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const kiosk = await resolveKioskTenant(token);
  if (!kiosk) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as Partial<
    PickupConfirmationInput
  > & { order_id?: string };
  const result = await savePickupAndNotifyCustomer({
    supabase: kiosk.supabase,
    tenantId: kiosk.tenantId,
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
