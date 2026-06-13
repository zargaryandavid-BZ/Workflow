import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { saveAllExternalArtwork } from "@/lib/save-external-artwork";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await params;
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();
  const { data: order } = await supabase
    .from("orders")
    .select("id")
    .eq("id", orderId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  try {
    const admin = createAdminClient();
    const result = await saveAllExternalArtwork({
      admin,
      tenantId: ctx.tenant.id,
      orderId,
    });

    if (result.saved === 0 && result.failed === 0) {
      return NextResponse.json({
        success: true,
        saved: 0,
        failed: 0,
        message: "No external artwork to save",
      });
    }

    return NextResponse.json({
      success: true,
      saved: result.saved,
      failed: result.failed,
      results: result.results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Save failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
