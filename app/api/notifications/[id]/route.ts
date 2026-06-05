import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { logActivity } from "@/lib/automation";

const BUCKET = "order-assets";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    staffNote?: string;
  };
  const staffNote = body.staffNote?.trim();
  if (!staffNote) {
    return NextResponse.json({ error: "Note is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: notification } = await supabase
    .from("job_notifications")
    .select("id, tenant_id, status")
    .eq("id", id)
    .maybeSingle();
  if (!notification || notification.tenant_id !== ctx.tenant.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (notification.status === "responded") {
    return NextResponse.json(
      { error: "Cannot edit a note after the customer responded." },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from("job_notifications")
    .update({ staff_note: staffNote })
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data: notification } = await supabase
    .from("job_notifications")
    .select("id, tenant_id, order_id, type, staff_note")
    .eq("id", id)
    .maybeSingle();

  if (!notification || notification.tenant_id !== ctx.tenant.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (notification.type !== "missing_info") {
    return NextResponse.json(
      { error: "Only missing info notes can be deleted here." },
      { status: 400 }
    );
  }

  const { data: linkedAssets } = await supabase
    .from("assets")
    .select("id, storage_path")
    .eq("notification_id", id);

  const paths = (linkedAssets ?? [])
    .map((a) => a.storage_path as string)
    .filter(Boolean);
  if (paths.length > 0) {
    await supabase.storage.from(BUCKET).remove(paths);
    await supabase.from("assets").delete().eq("notification_id", id);
  }

  const { error } = await supabase
    .from("job_notifications")
    .delete()
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  await logActivity(supabase, {
    tenantId: ctx.tenant.id,
    orderId: notification.order_id as string,
    actor: ctx.userId,
    action: "missing_info_deleted",
    metadata: { notificationId: id },
  });

  return NextResponse.json({ ok: true });
}
