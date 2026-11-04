import { NextResponse } from "next/server";
import { resolveKioskTenant } from "@/lib/kiosk-token";
import { jobTicketPdfResponse } from "@/lib/job-ticket-response.server";

export const runtime = "nodejs";
export const maxDuration = 180;

/** Kiosk Sent history job ticket. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const kiosk = await resolveKioskTenant(token);
  if (!kiosk) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return jobTicketPdfResponse(
    kiosk.supabase,
    kiosk.tenantId,
    new URL(request.url).searchParams.get("order_id")
  );
}
