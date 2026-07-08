import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import {
  normalizeNotificationRuleRecipient,
  normalizeNotificationRuleTrigger,
  validateNotificationRuleInput,
} from "@/lib/notification-rules";
import { normalizeVisibilityMode } from "@/lib/check-visibility";

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
    trigger?: string;
    column_id?: string | null;
    send_email?: boolean;
    send_sms?: boolean;
    send_webhook?: boolean;
    recipient?: string;
    email_subject?: string;
    email_body?: string;
    sms_body?: string;
    sms_to_phone?: string;
    webhook_url?: string;
    webhook_body_template?: string;
    webhook_headers?: Record<string, string>;
    enabled?: boolean;
    recipient_mode?: string;
    recipient_roles?: string[];
    recipient_users?: string[];
    require_all_group_items?: boolean;
  };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("notification_rules")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const merged = {
    name: body.name ?? existing.name,
    send_email: body.send_email ?? existing.send_email,
    send_sms: body.send_sms ?? existing.send_sms,
    send_webhook: body.send_webhook ?? existing.send_webhook,
    email_subject: body.email_subject ?? existing.email_subject,
    email_body: body.email_body ?? existing.email_body,
    sms_body: body.sms_body ?? existing.sms_body,
    webhook_url: body.webhook_url ?? existing.webhook_url,
    recipient: body.recipient ?? existing.recipient,
  };

  const validationError = validateNotificationRuleInput(merged);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 422 });
  }

  if (body.column_id) {
    const { data: column } = await supabase
      .from("board_columns")
      .select("id")
      .eq("id", body.column_id)
      .eq("tenant_id", ctx.tenant.id)
      .maybeSingle();
    if (!column) {
      return NextResponse.json({ error: "Column not found" }, { status: 404 });
    }
  }

  const updates: Record<string, unknown> = {};
  if (body.trigger !== undefined) {
    updates.trigger = normalizeNotificationRuleTrigger(body.trigger);
    if (updates.trigger === "on_job_created") updates.column_id = null;
  }
  if (body.name !== undefined) updates.name = body.name.trim();
  if (body.column_id !== undefined) updates.column_id = body.column_id;
  if (body.send_email !== undefined) updates.send_email = body.send_email;
  if (body.send_sms !== undefined) updates.send_sms = body.send_sms;
  if (body.recipient !== undefined) {
    updates.recipient = normalizeNotificationRuleRecipient(body.recipient);
  }
  if (body.email_subject !== undefined) {
    updates.email_subject = body.email_subject.trim();
  }
  if (body.email_body !== undefined) updates.email_body = body.email_body.trim();
  if (body.sms_body !== undefined) updates.sms_body = body.sms_body.trim();
  if (body.sms_to_phone !== undefined) updates.sms_to_phone = body.sms_to_phone.trim();
  if (body.send_webhook !== undefined) updates.send_webhook = body.send_webhook;
  if (body.webhook_url !== undefined) updates.webhook_url = body.webhook_url.trim();
  if (body.webhook_body_template !== undefined) updates.webhook_body_template = body.webhook_body_template.trim();
  if (body.webhook_headers !== undefined) updates.webhook_headers = body.webhook_headers;
  if (body.enabled !== undefined) updates.enabled = body.enabled;
  if (body.recipient_mode !== undefined)
    updates.recipient_mode = normalizeVisibilityMode(body.recipient_mode);
  if (body.recipient_roles !== undefined) updates.recipient_roles = body.recipient_roles;
  if (body.recipient_users !== undefined) updates.recipient_users = body.recipient_users;
  if (body.require_all_group_items !== undefined)
    updates.require_all_group_items = body.require_all_group_items;

  const { data, error } = await supabase
    .from("notification_rules")
    .update(updates)
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ rule: data });
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
    .from("notification_rules")
    .delete()
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
