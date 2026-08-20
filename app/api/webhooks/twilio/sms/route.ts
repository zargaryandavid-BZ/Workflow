import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeSmsPhone } from "@/lib/sms";
import {
  findOrderForInboundSms,
  findPendingComboStockOrderForPhone,
  insertOrderSmsMessage,
  validateTwilioSignature,
} from "@/lib/order-sms";
import { addOrderTag } from "@/lib/order-tags";
import { logActivity } from "@/lib/automation";
import {
  comboStockCardTag,
  getComboStock,
  parseStockReply,
  withComboStock,
  type ComboStock,
} from "@/lib/combo-stock";

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
  const signatureUrls = twilioWebhookUrls(request);
  const signatureOk = signatureUrls.some((url) =>
    validateTwilioSignature({
      authToken,
      signature,
      url,
      params,
    })
  );

  if (process.env.NODE_ENV === "production" && !signatureOk) {
    console.error("[twilio-sms] invalid signature", {
      tried: signatureUrls,
    });
    return new NextResponse("Forbidden", { status: 403 });
  }

  const from = params.From?.trim() ?? "";
  const body = params.Body?.trim() ?? "";
  const sid = params.MessageSid?.trim() || null;

  if (!from || !body) {
    return twimlOk();
  }

  const admin = createAdminClient();
  const reply = parseStockReply(body);
  const match = reply
    ? ((await findPendingComboStockOrderForPhone(admin, from)) ??
      (await findOrderForInboundSms(admin, from)))
    : await findOrderForInboundSms(admin, from);
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

  // Combo stock check: if this order is awaiting a warehouse reply and the body
  // is 1/2/3, apply it (1 = in stock, 2 = ordered, 3 = can't get).
  if (reply) {
    const { data: order } = await admin
      .from("orders")
      .select("specs")
      .eq("id", match.orderId)
      .maybeSingle();
    const prev = order ? getComboStock(order) : null;
    if (prev && prev.status === "pending") {
      const stock: ComboStock = {
        ...prev,
        status: reply,
        answered_at: new Date().toISOString(),
      };
      let nextSpecs = withComboStock(
        (order?.specs as Record<string, unknown> | null) ?? null,
        stock
      );
      if (reply === "in_stock" || reply === "ordered") {
        nextSpecs = {
          ...nextSpecs,
          warehouse_stock_confirmed: true,
          warehouse_stock_confirmed_at: new Date().toISOString(),
          warehouse_stock_confirmed_by: "combo_stock_sms",
        };
      }
      await addOrderTag(
        admin,
        match.orderId,
        match.tenantId,
        comboStockCardTag(reply),
        nextSpecs
      );
      await logActivity(admin, {
        tenantId: match.tenantId,
        orderId: match.orderId,
        actor: null,
        action: "combo_stock_reply",
        metadata: { status: reply, source: "twilio_inbound" },
      });
    }
  }

  return twimlOk();
}

function twilioWebhookUrls(request: Request): string[] {
  const path = "/api/webhooks/twilio/sms";
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const host =
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    "";
  const urls = new Set<string>();
  if (host) {
    urls.add(`${proto}://${host}${path}`);
    urls.add(`${proto}://${host}${path}/`);
  }
  const app = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
  if (app) {
    urls.add(`${app}${path}`);
    urls.add(`${app}${path}/`);
  }
  urls.add(`https://workflow-rho-one.vercel.app${path}`);
  return [...urls];
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
