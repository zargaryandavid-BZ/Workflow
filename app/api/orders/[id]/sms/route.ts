import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import {
  isSmsConfigured,
  normalizeSmsPhone,
  sendSms,
  validateSmsRecipient,
} from "@/lib/sms";
import { addOrderTag } from "@/lib/order-tags";
import { logActivity } from "@/lib/automation";
import {
  insertOrderSmsMessage,
  listOrderSmsMessages,
} from "@/lib/order-sms";

/** GET — SMS thread for this order. */
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

  const messages = await listOrderSmsMessages(
    supabase,
    orderId,
    ctx.tenant.id
  );

  return NextResponse.json({
    messages,
    smsConfigured: isSmsConfigured(),
  });
}

/** POST — send a manual SMS and append to the thread. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await params;
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isSmsConfigured()) {
    return NextResponse.json(
      {
        error:
          "SMS is not configured. Add Twilio credentials in your environment.",
      },
      { status: 503 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    phone?: string;
    body?: string;
  };

  if (!body.phone?.trim()) {
    return NextResponse.json(
      { error: "Phone number is required" },
      { status: 422 }
    );
  }
  if (!body.body?.trim()) {
    return NextResponse.json(
      { error: "Message body is required" },
      { status: 422 }
    );
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
  const messageBody = body.body.trim();
  const result = await sendSms({ to: phone, body: messageBody });

  if (!result.sent) {
    return NextResponse.json(
      { error: result.error ?? "Failed to send SMS" },
      { status: 502 }
    );
  }

  const message = await insertOrderSmsMessage(supabase, {
    tenantId: ctx.tenant.id,
    orderId,
    direction: "outbound",
    phone,
    body: messageBody,
    twilioSid: result.sid ?? null,
    actorUserId: ctx.userId,
  });

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
      messageBody,
      source: "manual_sms",
      twilioSid: result.sid ?? null,
    },
  });

  return NextResponse.json({ ok: true, message });
}
