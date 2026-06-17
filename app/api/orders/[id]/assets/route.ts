import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { logActivity } from "@/lib/automation";
import {
  attachSignedUrls,
  listOrderLevelAssets,
  uploadOrderLevelAsset,
} from "@/lib/order-assets";

export async function GET(
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
    const assets = await listOrderLevelAssets(supabase, orderId);
    const assetsWithUrls = await attachSignedUrls(supabase, assets);
    return NextResponse.json({ assets: assetsWithUrls });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await params;
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
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
    const asset = await uploadOrderLevelAsset(supabase, {
      tenantId: ctx.tenant.id,
      userId: ctx.userId,
      orderId,
      file,
    });

    await logActivity(supabase, {
      tenantId: ctx.tenant.id,
      orderId,
      actor: ctx.userId,
      action: "asset_uploaded",
      metadata: { file: file.name },
    });

    const [withUrl] = await attachSignedUrls(supabase, [asset]);
    return NextResponse.json({ success: true, asset: withUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
