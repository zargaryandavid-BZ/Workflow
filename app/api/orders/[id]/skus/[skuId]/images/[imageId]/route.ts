import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { ORDER_ASSETS_BUCKET } from "@/lib/order-assets";

export async function DELETE(
  _request: Request,
  {
    params,
  }: { params: Promise<{ id: string; skuId: string; imageId: string }> }
) {
  const { id: orderId, skuId, imageId } = await params;
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createClient();
  const { data: img } = await supabase
    .from("order_sku_images")
    .select("storage_path")
    .eq("id", imageId)
    .eq("sku_id", skuId)
    .eq("order_id", orderId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  if (!img) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (img.storage_path) {
    await supabase.storage
      .from(ORDER_ASSETS_BUCKET)
      .remove([img.storage_path as string]);
  }

  const { error } = await supabase
    .from("order_sku_images")
    .delete()
    .eq("id", imageId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
