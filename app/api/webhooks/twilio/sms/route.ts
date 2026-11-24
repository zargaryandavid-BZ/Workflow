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
import {
  parseSmsCheck,
  readSmsCheckState,
  SMS_CHECK_ASK_JOB_TEXT,
  SMS_CHECK_MENU_TEXT,
  smsCheckJobText,
  smsCheckPhoneOrdersText,
  smsCheckStateCookie,
  SMS_CHECK_NOT_FOUND_TEXT,
  SMS_CHECK_UNKNOWN_TEXT,
  twimlMessage,
  type SmsCheckState,
} from "@/lib/sms-status-check";
import {
  smsCheckOrdersForJob,
  smsCheckOrdersForPhone,
  smsCheckTenantIds,
} from "@/lib/sms-status-check.server";

export const runtime = "nodejs";

/**
 * Twilio inbound SMS webhook.
 * Configure Messaging → webhook URL to:
 *   POST https://your-domain/api/webhooks/twilio/sms
 */
export async function POST(request: Request) {
  let clearCheckCookie = false;
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

  // Client status line: "START" / "CHECK" → menu → 1 (orders under this phone) / 2 (job ticket number).
  // Runs before the normal reply handling so a menu "1"/"2" is never read as a warehouse stock reply,
  // and the conversation is not logged on a card as a customer reply.
  const checkState = readSmsCheckState(request.headers.get("cookie"));
  const check = parseSmsCheck(body, checkState);
  // Menu open but the text is not 1 / 2: answer "Command not found", close the menu,
  // and still handle the text as a normal client reply (it may be a real message for staff).
  const unknownReply = check.kind === "unknown" ? SMS_CHECK_UNKNOWN_TEXT : null;
  if (check.kind !== "none" && check.kind !== "unknown") {
    try {
      return await handleStatusCheck(admin, from, check);
    } catch (error) {
      console.error("[twilio-sms] status check failed", error);
      return twimlReply("Sorry, we could not check your order right now. Please try again later.", null);
    }
  }
  if (checkState) {
    // Client left the CHECK flow — close it and handle this text normally.
    clearCheckCookie = true;
  }
  const reply = parseStockReply(body);
  const match = reply
    ? ((await findPendingComboStockOrderForPhone(admin, from)) ??
      (await findOrderForInboundSms(admin, from)))
    : await findOrderForInboundSms(admin, from);
  if (!match) {
    console.warn("[twilio-sms] no order for phone", normalizeSmsPhone(from));
    return twimlOk(clearCheckCookie, unknownReply);
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

  return twimlOk(clearCheckCookie, unknownReply);
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

function twimlOk(clearCheckCookie = false, reply: string | null = null) {
  const headers: Record<string, string> = { "Content-Type": "text/xml" };
  if (clearCheckCookie) headers["Set-Cookie"] = smsCheckStateCookie(null);
  return new NextResponse(twimlMessage(reply), { status: 200, headers });
}

/** TwiML reply to the client, setting (or clearing) the CHECK step cookie Twilio sends back next time. */
function twimlReply(text: string, nextState: SmsCheckState | null) {
  return new NextResponse(twimlMessage(text), {
    status: 200,
    headers: {
      "Content-Type": "text/xml",
      "Set-Cookie": smsCheckStateCookie(nextState),
    },
  });
}

async function handleStatusCheck(
  admin: ReturnType<typeof createAdminClient>,
  from: string,
  check: Exclude<ReturnType<typeof parseSmsCheck>, { kind: "none" } | { kind: "unknown" }>
) {
  switch (check.kind) {
    case "menu":
      return twimlReply(SMS_CHECK_MENU_TEXT, "menu");
    case "ask_job":
      return twimlReply(SMS_CHECK_ASK_JOB_TEXT, "job");
    case "bad_job":
      return twimlReply(SMS_CHECK_NOT_FOUND_TEXT, "job");
    case "by_phone": {
      const lines = await smsCheckOrdersForPhone(admin, from);
      // Nothing under this phone → keep the menu open so "2" still works.
      return twimlReply(smsCheckPhoneOrdersText(lines), lines.length ? null : "menu");
    }
    case "job": {
      const tenantIds = await smsCheckTenantIds(admin, from);
      const lines = await smsCheckOrdersForJob(admin, tenantIds, check.jobNumber);
      // Not found → stay on the job step so the client can send another code.
      return twimlReply(smsCheckJobText(lines), lines.length ? null : "job");
    }
  }
}
