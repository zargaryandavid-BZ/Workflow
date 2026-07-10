import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { ORDER_ASSETS_BUCKET, SKU_IMAGE_MAX_BYTES, uploadSizeError } from "@/lib/order-assets";
import {
  attachSignedUrlsToSkuImages,
  MAX_SKU_IMAGES,
  skuImageStoragePath,
} from "@/lib/sku-images";
import type { OrderSkuImage } from "@/lib/types";

async function verifySkuOnOrder(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orderId: string,
  skuId: string,
  tenantId: string
): Promise<boolean> {
  const { data: order } = await supabase
    .from("orders")
    .select("specs")
    .eq("id", orderId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!order) return false;
  const skus = (order.specs as { skus?: { id?: string }[] } | null)?.skus ?? [];
  return skus.some((s) => s.id === skuId);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; skuId: string }> }
) {
  const { id: orderId, skuId } = await params;
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createClient();
  const { data: images, error } = await supabase
    .from("order_sku_images")
    .select("*")
    .eq("order_id", orderId)
    .eq("sku_id", skuId)
    .eq("tenant_id", ctx.tenant.id)
    .order("position", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const withUrls = await attachSignedUrlsToSkuImages(
    supabase,
    (images ?? []) as OrderSkuImage[]
  );
  return NextResponse.json({ images: withUrls });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; skuId: string }> }
) {
  const { id: orderId, skuId } = await params;
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Images only" }, { status: 400 });
  }
  const sizeError = uploadSizeError(file.size, SKU_IMAGE_MAX_BYTES);
  if (sizeError) {
    return NextResponse.json({ error: sizeError }, { status: 422 });
  }

  const supabase = await createClient();

  const { data: order } = await supabase
    .from("orders")
    .select("tenant_id")
    .eq("id", orderId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const skuValid = await verifySkuOnOrder(
    supabase,
    orderId,
    skuId,
    ctx.tenant.id
  );
  if (!skuValid) {
    return NextResponse.json({ error: "SKU not found on order" }, { status: 404 });
  }

  const { count } = await supabase
    .from("order_sku_images")
    .select("id", { count: "exact", head: true })
    .eq("sku_id", skuId)
    .eq("order_id", orderId);

  if ((count ?? 0) >= MAX_SKU_IMAGES) {
    return NextResponse.json(
      { error: `Maximum ${MAX_SKU_IMAGES} images per SKU` },
      { status: 422 }
    );
  }

  const position = count ?? 0;
  const storagePath = skuImageStoragePath(
    ctx.tenant.id,
    orderId,
    skuId,
    position,
    file.name
  );

  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: uploadError } = await supabase.storage
    .from(ORDER_ASSETS_BUCKET)
    .upload(storagePath, buffer, {
      contentType: file.type || "image/jpeg",
      upsert: false,
    });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { data: image, error: dbError } = await supabase
    .from("order_sku_images")
    .insert({
      tenant_id: ctx.tenant.id,
      order_id: orderId,
      sku_id: skuId,
      file_name: file.name,
      file_size: file.size,
      mime_type: file.type || "image/jpeg",
      storage_path: storagePath,
      position,
    })
    .select("*")
    .single();

  if (dbError) {
    await supabase.storage.from(ORDER_ASSETS_BUCKET).remove([storagePath]);
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  const [withUrl] = await attachSignedUrlsToSkuImages(supabase, [
    image as OrderSkuImage,
  ]);
  return NextResponse.json({ success: true, image: withUrl });
}
