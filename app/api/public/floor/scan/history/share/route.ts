import { NextResponse } from "next/server";
import { resolveFloorTenant } from "@/lib/kiosk-token";
import { sentHistoryShareResponse } from "@/lib/sent-history-share.server";

/** No-login floor: share link for Sent history. */
export async function GET(request: Request) {
  const floor = await resolveFloorTenant();
  if (!floor) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return sentHistoryShareResponse(request, floor.tenantId);
}
