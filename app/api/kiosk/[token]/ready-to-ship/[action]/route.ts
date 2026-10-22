import { NextResponse } from "next/server";
import { resolveKioskTenant } from "@/lib/kiosk-token";
import {
  handlePublicReadyToShip,
  tenantNameFor,
} from "@/lib/ready-to-ship-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ready-to-Ship popup on a kiosk-token scan page. */
async function handle(
  method: "GET" | "POST",
  request: Request,
  params: Promise<{ token: string; action: string }>
) {
  const { token, action } = await params;
  const kiosk = await resolveKioskTenant(token);
  if (!kiosk) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return handlePublicReadyToShip(
    {
      supabase: kiosk.supabase,
      tenantId: kiosk.tenantId,
      tenantName: await tenantNameFor(kiosk.supabase, kiosk.tenantId),
      userId: null,
      publicMode: true,
    },
    method,
    action,
    request
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string; action: string }> }
) {
  return handle("GET", request, params);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string; action: string }> }
) {
  return handle("POST", request, params);
}
