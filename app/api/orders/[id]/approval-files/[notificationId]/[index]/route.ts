import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { ORDER_ASSETS_BUCKET } from "@/lib/order-assets";
import type { ApprovalSnapshotFile } from "@/lib/approval-snapshot";

/**
 * Staff download of a frozen approval-round file. Redirects to a short-lived
 * signed URL (or the external URL) for approval_files[index] of the given
 * customer_approval notification on this order.
 */
export async function GET(
  _request: Request,
  {
    params,
  }: { params: Promise<{ id: string; notificationId: string; index: string }> }
) {
  const { id: orderId, notificationId, index } = await params;
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();
  const { data: notif } = await supabase
    .from("job_notifications")
    .select("id, order_id, tenant_id, approval_files")
    .eq("id", notificationId)
    .eq("order_id", orderId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  const files = (notif as { approval_files?: ApprovalSnapshotFile[] | null } | null)
    ?.approval_files;
  const file = files?.[Number(index)];
  if (!file) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (file.external_url?.trim()) {
    return NextResponse.redirect(file.external_url);
  }
  if (!file.storage_path) {
    return NextResponse.json({ error: "File has no content" }, { status: 400 });
  }

  const { data: signed, error } = await supabase.storage
    .from(ORDER_ASSETS_BUCKET)
    .createSignedUrl(file.storage_path, 60, { download: file.file_name });
  if (error || !signed) {
    return NextResponse.json(
      { error: error?.message ?? "Could not sign URL" },
      { status: 400 }
    );
  }
  return NextResponse.redirect(signed.signedUrl);
}
