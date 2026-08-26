// POST /api/orders/[id]/sync-proofs
// Pull the finished files from this order's Drive "Proofs" folder (and any
// files sitting in the designer folder root) and fill the matching SKU gallery
// images automatically. Idempotent: skips SKUs that already have an image.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { syncOrderProofs } from "@/lib/sync-order-proofs";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await params;
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createClient();
  const result = await syncOrderProofs(supabase, ctx.tenant.id, orderId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result);
}
