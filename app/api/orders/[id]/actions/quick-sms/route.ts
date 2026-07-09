import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { sendSms, isSmsConfigured, normalizeSmsPhone, validateSmsRecipient } from "@/lib/sms";
import { addOrderTag } from "@/lib/order-tags";
import { logActivity } from "@/lib/automation";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await params;
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isSmsConfigured()) {
    return NextResponse.json(
      { error: "SMS is not configured on this account. Add Twilio credentials in your environment." },
      { status: 503 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    phone?: string;
    body?: string;
  };

  if (!body.phone?.trim()) {
    return NextResponse.json({ error: "Phone number is required" }, { status: 422 });
  }
  if (!body.body?.trim()) {
    return NextResponse.json({ error: "Message body is required" }, { status: 422 });
  }

  const phoneError = validateSmsRecipient(body.phone);
  if (phoneError) {
    return NextResponse.json({ error: phoneError }, { status: 422 });
  }

  const supabase = await createClient();

  const { data: order } = await supabase
    .from("orders")
    .select("id, tenant_id, specs")
    .eq("id", orderId)
    .eq("tenant_id", ctx.tenant.id)
    .is("removed_at", null)
    .maybeSingle();

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const phone = normalizeSmsPhone(body.phone);
  const result = await sendSms({ to: phone, body: body.body });

  if (!result.sent) {
    return NextResponse.json(
      { error: result.error ?? "Failed to send SMS" },
      { status: 502 }
    );
  }

  await addOrderTag(
    supabase,
    orderId,
    ctx.tenant.id,
    "Texted",
    (order.specs ?? {}) as Record<string, unknown>
  );

  await logActivity(supabase, {
    tenantId: ctx.tenant.id,
    orderId,
    actor: ctx.userId,
    action: "texted",
    metadata: {
      phone,
      messageBody: body.body,
      source: "quick_sms",
    },
  });

  return NextResponse.json({ ok: true });
}
