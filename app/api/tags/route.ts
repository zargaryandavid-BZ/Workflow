import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { normalizeTagNotifyRecipients } from "@/lib/tag-notify-config";

export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tags")
    .select("*")
    .eq("tenant_id", ctx.tenant.id)
    .order("position", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tags: data });
}

export async function POST(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    color?: string;
    description?: string | null;
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
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 422 });
  }

  const supabase = await createClient();
  const { data: last } = await supabase
    .from("tags")
    .select("position")
    .eq("tenant_id", ctx.tenant.id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("tags")
    .insert({
      tenant_id: ctx.tenant.id,
      name: body.name.trim(),
      color: body.color ?? "#6366f1",
      description: body.description ?? null,
      position: ((last as { position: number } | null)?.position ?? -1) + 1,
      notify_enabled: Boolean(body.notify_enabled),
      notify_send_email: Boolean(body.notify_send_email),
      notify_send_sms: Boolean(body.notify_send_sms),
      notify_recipients: normalizeTagNotifyRecipients(body.notify_recipients),
      notify_custom_email: body.notify_custom_email?.trim() || null,
      notify_custom_phone: body.notify_custom_phone?.trim() || null,
      notify_email_subject: body.notify_email_subject?.trim() || null,
      notify_email_body: body.notify_email_body?.trim() || null,
      notify_sms_body: body.notify_sms_body?.trim() || null,
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tag: data });
}
