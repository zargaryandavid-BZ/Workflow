import { NextResponse } from "next/server";
import { resolveFloorTenant } from "@/lib/kiosk-token";
import {
  handlePublicReadyToShip,
  tenantNameFor,
} from "@/lib/ready-to-ship-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ready-to-Ship popup on the no-login floor scan page (shop iPad). */
async function handle(
  method: "GET" | "POST",
  request: Request,
  params: Promise<{ action: string }>
) {
  const { action } = await params;
  const floor = await resolveFloorTenant();
  if (!floor) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return handlePublicReadyToShip(
    {
      supabase: floor.supabase,
      tenantId: floor.tenantId,
      tenantName: await tenantNameFor(floor.supabase, floor.tenantId),
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
  { params }: { params: Promise<{ action: string }> }
) {
  return handle("GET", request, params);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ action: string }> }
) {
  return handle("POST", request, params);
}
