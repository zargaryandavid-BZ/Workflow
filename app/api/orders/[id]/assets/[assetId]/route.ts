import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import {
  isOrderLevelAsset,
  ORDER_ASSETS_BUCKET,
} from "@/lib/order-assets";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; assetId: string }> }
) {
  const { id: orderId, assetId } = await params;
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();
  const { data: asset } = await supabase
    .from("assets")
    .select("*")
    .eq("id", assetId)
    .eq("order_id", orderId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  if (!asset) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!isOrderLevelAsset(asset)) {
    return NextResponse.json(
      { error: "Only general order assets can be deleted here" },
      { status: 400 }
    );
  }

  if (asset.storage_path) {
    await supabase.storage
      .from(ORDER_ASSETS_BUCKET)
      .remove([asset.storage_path]);
  }

  const { error } = await supabase.from("assets").delete().eq("id", assetId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
