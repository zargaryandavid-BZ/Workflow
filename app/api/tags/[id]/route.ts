import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { normalizeTagNotifyRecipients } from "@/lib/tag-notify-config";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    color?: string;
    description?: string | null;
    position?: number;
    notify_enabled?: boolean;
    notify_send_email?: boolean;
    notify_send_sms?: boolean;
    notify_recipients?: unknown;
    notify_custom_email?: string | null;
    notify_custom_phone?: string | null;
    notify_email_subject?: string | null;
    notify_email_body?: string | null;
    notify_sms_body?: string | null;
  };

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.color !== undefined) updates.color = body.color;
  if (body.description !== undefined) updates.description = body.description;
  if (body.position !== undefined) updates.position = body.position;
  if (body.notify_enabled !== undefined)
    updates.notify_enabled = Boolean(body.notify_enabled);
  if (body.notify_send_email !== undefined)
    updates.notify_send_email = Boolean(body.notify_send_email);
  if (body.notify_send_sms !== undefined)
    updates.notify_send_sms = Boolean(body.notify_send_sms);
  if (body.notify_recipients !== undefined)
    updates.notify_recipients = normalizeTagNotifyRecipients(
      body.notify_recipients
    );
  if (body.notify_custom_email !== undefined)
    updates.notify_custom_email = body.notify_custom_email?.trim() || null;
  if (body.notify_custom_phone !== undefined)
    updates.notify_custom_phone = body.notify_custom_phone?.trim() || null;
  if (body.notify_email_subject !== undefined)
    updates.notify_email_subject = body.notify_email_subject?.trim() || null;
  if (body.notify_email_body !== undefined)
    updates.notify_email_body = body.notify_email_body?.trim() || null;
  if (body.notify_sms_body !== undefined)
    updates.notify_sms_body = body.notify_sms_body?.trim() || null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tags")
    .update(updates)
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ tag: data });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("tags")
    .delete()
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
