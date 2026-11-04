import { NextResponse } from "next/server";
import { resolveFloorTenant } from "@/lib/kiosk-token";
import { jobTicketPdfResponse } from "@/lib/job-ticket-response.server";

export const runtime = "nodejs";
export const maxDuration = 180;

/** No-login floor Sent history job ticket. */
export async function GET(request: Request) {
  const floor = await resolveFloorTenant();
  if (!floor) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return jobTicketPdfResponse(
    floor.supabase,
    floor.tenantId,
    new URL(request.url).searchParams.get("order_id")
  );
}
