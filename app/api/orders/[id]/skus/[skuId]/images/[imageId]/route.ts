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

  if (img) {
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

  // Webhook artwork is stored on `assets` and merged into the gallery UI.
  const { data: asset } = await supabase
    .from("assets")
    .select("id, storage_path, sku_key")
    .eq("id", imageId)
    .eq("order_id", orderId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  if (!asset) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (asset.sku_key && asset.sku_key !== skuId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (asset.storage_path) {
    await supabase.storage
      .from(ORDER_ASSETS_BUCKET)
      .remove([asset.storage_path as string]);
  }

  const { error } = await supabase.from("assets").delete().eq("id", imageId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
