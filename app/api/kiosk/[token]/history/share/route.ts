import { NextResponse } from "next/server";
import { resolveKioskTenant } from "@/lib/kiosk-token";
import { sentHistoryShareResponse } from "@/lib/sent-history-share.server";

/** Kiosk: share link for Sent history. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const kiosk = await resolveKioskTenant(token);
  if (!kiosk) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return sentHistoryShareResponse(request, kiosk.tenantId);
}
