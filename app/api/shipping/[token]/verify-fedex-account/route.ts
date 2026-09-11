import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyFedExAccountNumber } from "@/lib/fedex";
import {
  maskFedExAccountNumber,
  normalizeFedExAccountNumber,
} from "@/lib/client-fedex";
import { loadShippingSettings } from "@/lib/shipping-settings";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!token) {
    return NextResponse.json({ error: "Token required" }, { status: 422 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    accountNumber?: string;
  };
  const account = normalizeFedExAccountNumber(body.accountNumber);
  if (!account) {
    return NextResponse.json(
      { error: "Enter a valid FedEx account number (8–12 digits)." },
      { status: 422 }
    );
  }

  const admin = createAdminClient();
  const { data: shipReq, error } = await admin
    .from("shipping_requests")
    .select("id, tenant_id, status")
    .eq("token", token)
    .maybeSingle();

  if (error || !shipReq) {
    return NextResponse.json({ error: "Shipping link not found" }, { status: 404 });
  }
  if (shipReq.status === "client_responded") {
    return NextResponse.json(
      { error: "This shipping request was already confirmed." },
      { status: 409 }
    );
  }

  const settings = await loadShippingSettings(admin, shipReq.tenant_id);
  const check = await verifyFedExAccountNumber(account, settings);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    accountMasked: maskFedExAccountNumber(account),
  });
}
