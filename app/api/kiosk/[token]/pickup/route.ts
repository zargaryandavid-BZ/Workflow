import { NextResponse } from "next/server";
import { resolveKioskTenant } from "@/lib/kiosk-token";
import {
  loadPickupStatus,
  savePickupAndNotifyCustomer,
} from "@/lib/fulfillment-pickup-notify";
import type { PickupConfirmationInput } from "@/lib/fulfillment-pickup";

export const runtime = "nodejs";

/** GET ?order_id= — does the Pickup window need a code / was it picked up already? */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const kiosk = await resolveKioskTenant(token);
  if (!kiosk) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const result = await loadPickupStatus({
    supabase: kiosk.supabase,
    tenantId: kiosk.tenantId,
    orderId: new URL(request.url).searchParams.get("order_id") ?? "",
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result);
}

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
  > & { order_id?: string; pickup_code?: string; confirm_again?: boolean; skip_code?: boolean; skipped_by?: string };
  const result = await savePickupAndNotifyCustomer({
    supabase: kiosk.supabase,
    tenantId: kiosk.tenantId,
    input: {
      orderId: body.order_id ?? body.orderId ?? "",
      firstName: body.firstName ?? "",
      lastName: body.lastName ?? "",
      signatureDataUrl: body.signatureDataUrl ?? "",
      pickupCode: body.pickup_code ?? body.pickupCode ?? "",
      confirmAgain: body.confirm_again === true || body.confirmAgain === true,
      skipCode: body.skip_code === true || body.skipCode === true,
      skippedBy: (body.skipped_by ?? body.skippedBy ?? "").trim(),
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
