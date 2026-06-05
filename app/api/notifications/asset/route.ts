import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "order-assets";

/** Token-gated download for order artwork on client respond / approve pages. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");
  const assetId = searchParams.get("id");

  if (!token || !assetId) {
    return NextResponse.json(
      { error: "token and id are required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  const { data: asset } = await admin
    .from("assets")
    .select("id, order_id, file_name, storage_path, notification_id")
    .eq("id", assetId)
    .maybeSingle();

  if (!asset) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (asset.notification_id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [{ data: notification }, { data: approval }] = await Promise.all([
    admin
      .from("job_notifications")
      .select("order_id, status, token_expires_at")
      .eq("token", token)
      .maybeSingle(),
    admin
      .from("approvals")
      .select("order_id, status")
      .eq("token", token)
      .maybeSingle(),
  ]);

  const orderId = notification?.order_id ?? approval?.order_id ?? null;
  if (!orderId || orderId !== asset.order_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (notification) {
    const expiredByDate =
      notification.token_expires_at != null &&
      new Date(notification.token_expires_at).getTime() < Date.now();
    if (
      notification.status === "expired" ||
      (expiredByDate && notification.status !== "responded")
    ) {
      return NextResponse.json({ error: "Link expired" }, { status: 403 });
    }
  }

  const { data: signed, error } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(asset.storage_path, 3600, {
      download: asset.file_name,
    });

  if (error || !signed) {
    return NextResponse.json(
      { error: error?.message ?? "Could not sign URL" },
      { status: 400 }
    );
  }

  return NextResponse.redirect(signed.signedUrl);
}
