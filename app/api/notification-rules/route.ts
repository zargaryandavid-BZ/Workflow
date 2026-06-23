import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import {
  DEFAULT_NOTIFICATION_EMAIL_BODY,
  DEFAULT_NOTIFICATION_EMAIL_SUBJECT,
  DEFAULT_NOTIFICATION_SMS_BODY,
  normalizeNotificationRuleRecipient,
  normalizeNotificationRuleTrigger,
  validateNotificationRuleInput,
} from "@/lib/notification-rules";
import {
  loadNotificationRulesWithStatus,
  notificationRulesMigrationMessage,
} from "@/lib/notification-rules.server";
import { normalizeVisibilityMode } from "@/lib/check-visibility";

export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createClient();
  const { rules, migrationRequired } = await loadNotificationRulesWithStatus(
    supabase,
    ctx.tenant.id
  );

  if (migrationRequired) {
    return NextResponse.json({ rules: [], migrationRequired: true });
  }
  return NextResponse.json({ rules });
}

export async function POST(request: Request) {
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
    recipient?: string;
    email_subject?: string;
    email_body?: string;
    sms_body?: string;
    sms_to_phone?: string;
    enabled?: boolean;
    recipient_mode?: string;
    recipient_roles?: string[];
    recipient_users?: string[];
  };

  const validationError = validateNotificationRuleInput(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 422 });
  }

  const supabase = await createClient();
  const { migrationRequired } = await loadNotificationRulesWithStatus(
    supabase,
    ctx.tenant.id
  );
  if (migrationRequired) {
    return NextResponse.json(
      { error: notificationRulesMigrationMessage() },
      { status: 503 }
    );
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

  const { data: last } = await supabase
    .from("notification_rules")
    .select("position")
    .eq("tenant_id", ctx.tenant.id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const trigger = normalizeNotificationRuleTrigger(body.trigger);
  const sendEmail = body.send_email !== false;
  const sendSms = body.send_sms === true;
  const recipientMode = normalizeVisibilityMode(body.recipient_mode);

  const { data, error } = await supabase
    .from("notification_rules")
    .insert({
      tenant_id: ctx.tenant.id,
      name: body.name!.trim(),
      trigger,
      column_id: trigger === "on_job_created" ? null : (body.column_id ?? null),
      send_email: sendEmail,
      send_sms: sendSms,
      recipient: normalizeNotificationRuleRecipient(body.recipient),
      email_subject: body.email_subject?.trim() || DEFAULT_NOTIFICATION_EMAIL_SUBJECT,
      email_body: body.email_body?.trim() || DEFAULT_NOTIFICATION_EMAIL_BODY,
      sms_body: body.sms_body?.trim() || DEFAULT_NOTIFICATION_SMS_BODY,
      sms_to_phone: body.sms_to_phone?.trim() ?? "",
      enabled: body.enabled ?? true,
      position: ((last as { position: number } | null)?.position ?? -1) + 1,
      recipient_mode: recipientMode,
      recipient_roles: body.recipient_roles ?? [],
      recipient_users: body.recipient_users ?? [],
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rule: data });
}
