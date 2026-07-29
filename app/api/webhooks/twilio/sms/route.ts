import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeSmsPhone } from "@/lib/sms";
import {
  findOrderForInboundSms,
  insertOrderSmsMessage,
  validateTwilioSignature,
} from "@/lib/order-sms";
import { logActivity } from "@/lib/automation";

export const runtime = "nodejs";

/**
 * Twilio inbound SMS webhook.
 * Configure Messaging → webhook URL to:
 *   POST https://your-domain/api/webhooks/twilio/sms
 */
export async function POST(request: Request) {
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!authToken) {
    return new NextResponse(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      {
        status: 503,
        headers: { "Content-Type": "text/xml" },
      }
    );
  }

  const form = await request.formData();
  const params: Record<string, string> = {};
  form.forEach((value, key) => {
    if (typeof value === "string") params[key] = value;
  });

  const signature = request.headers.get("x-twilio-signature") ?? "";
  const url = (() => {
    const proto = request.headers.get("x-forwarded-proto") ?? "https";
    const host =
      request.headers.get("x-forwarded-host") ??
      request.headers.get("host") ??
      "";
    return `${proto}://${host}/api/webhooks/twilio/sms`;
  })();

  if (
    process.env.NODE_ENV === "production" &&
    !validateTwilioSignature({
      authToken,
      signature,
      url,
      params,
    })
  ) {
    console.error("[twilio-sms] invalid signature");
    return new NextResponse("Forbidden", { status: 403 });
  }

  const from = params.From?.trim() ?? "";
  const body = params.Body?.trim() ?? "";
  const sid = params.MessageSid?.trim() || null;

  if (!from || !body) {
    return twimlOk();
  }

  const admin = createAdminClient();
  const match = await findOrderForInboundSms(admin, from);
  if (!match) {
    console.warn("[twilio-sms] no order for phone", normalizeSmsPhone(from));
    return twimlOk();
  }

  await insertOrderSmsMessage(admin, {
    tenantId: match.tenantId,
    orderId: match.orderId,
    direction: "inbound",
    phone: from,
    body,
    twilioSid: sid,
    actorUserId: null,
  });

  await logActivity(admin, {
    tenantId: match.tenantId,
    orderId: match.orderId,
    actor: null,
    action: "customer_replied",
    metadata: {
      channel: "sms",
      phone: normalizeSmsPhone(from),
      messageBody: body,
      source: "twilio_inbound",
      twilioSid: sid,
    },
  });

  return twimlOk();
}

function twimlOk() {
  return new NextResponse(
    '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
    {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    }
  );
}
