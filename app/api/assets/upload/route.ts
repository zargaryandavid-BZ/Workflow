import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { logActivity } from "@/lib/automation";
import {
  ORDER_ASSETS_BUCKET,
  orderAssetStoragePath,
  ORDER_ARTWORK_MAX_BYTES,
  skuAssetStoragePath,
  uploadSizeError,
} from "@/lib/order-assets";

export async function POST(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const form = await request.formData();
  const file = form.get("file");
  const orderId = form.get("orderId");
  const skuKey =
    typeof form.get("skuKey") === "string" ? form.get("skuKey") : null;

  if (!(file instanceof File) || typeof orderId !== "string") {
    return NextResponse.json(
      { error: "file and orderId are required" },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  // Confirm the order belongs to the active tenant (RLS-backed).
  const { data: order } = await supabase
    .from("orders")
    .select("id, tenant_id")
    .eq("id", orderId)
    .maybeSingle();
  if (!order || order.tenant_id !== ctx.tenant.id) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const sizeError = uploadSizeError(file.size, ORDER_ARTWORK_MAX_BYTES);
  if (sizeError) {
    return NextResponse.json({ error: sizeError }, { status: 422 });
  }

  const skuKeyTrimmed =
    typeof skuKey === "string" && skuKey.trim() ? skuKey.trim() : null;

  // One artwork file per SKU: replace any existing asset for this sku_key.
  if (skuKeyTrimmed) {
    const { data: existing } = await supabase
      .from("assets")
      .select("id, storage_path")
      .eq("order_id", orderId)
      .eq("sku_key", skuKeyTrimmed);
    for (const row of existing ?? []) {
      if (row.storage_path) {
        await supabase.storage.from(ORDER_ASSETS_BUCKET).remove([row.storage_path]);
      }
      await supabase.from("assets").delete().eq("id", row.id);
    }
  }

  const path = skuKeyTrimmed
    ? skuAssetStoragePath(ctx.tenant.id, orderId, skuKeyTrimmed, file.name)
    : orderAssetStoragePath(ctx.tenant.id, orderId, file.name);

  const { error: uploadError } = await supabase.storage
    .from(ORDER_ASSETS_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 400 });
  }

  const { data: asset, error } = await supabase
    .from("assets")
    .insert({
      tenant_id: ctx.tenant.id,
      order_id: orderId,
      sku_key: skuKeyTrimmed,
      file_name: file.name,
      storage_path: path,
      mime_type: file.type || null,
      size: file.size,
      uploaded_by: ctx.userId,
    })
    .select("*")
    .single();

  if (error) {
    await supabase.storage.from(ORDER_ASSETS_BUCKET).remove([path]);
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  await logActivity(supabase, {
    tenantId: ctx.tenant.id,
    orderId,
    actor: ctx.userId,
    action: "asset_uploaded",
    metadata: {
      file: file.name,
      skuKey: skuKeyTrimmed ?? undefined,
    },
  });

  return NextResponse.json({ asset });
}
