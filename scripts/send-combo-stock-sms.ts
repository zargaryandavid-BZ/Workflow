/**
 * Send the 0592-1 combo stock-check SMS to a test phone.
 *
 *   npx tsx scripts/send-combo-stock-sms.ts 7473780173
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import { buildComboStockSms } from "../lib/combo-stock.ts";
import { normalizeSmsPhone } from "../lib/sms.ts";

function loadEnvLocal() {
  const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

async function sendSms(to: string, body: string) {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  const from = process.env.TWILIO_PHONE_NUMBER?.trim();
  if (!sid || !token || !from) {
    console.info(`[sms] (not configured) -> ${to}: ${body}`);
    return { sent: false, sid: null as string | null };
  }
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        From: from,
        To: normalizeSmsPhone(to),
        Body: body,
      }),
    }
  );
  if (!res.ok) {
    console.error("[twilio]", await res.text());
    return { sent: false, sid: null as string | null };
  }
  const json = (await res.json()) as { sid?: string };
  return { sent: true, sid: json.sid?.trim() || null };
}

async function main() {
  loadEnvLocal();
  const to = process.argv[2] ?? "7473780173";
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("missing supabase env");
  const sb = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: order, error } = await sb
    .from("orders")
    .select("id, title, tenant_id, specs")
    .eq("title", "0592-1")
    .is("removed_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!order) throw new Error("0592-1 not found");

  const specs = (order.specs ?? {}) as Record<string, unknown>;
  const product =
    typeof specs.webhook_item_title === "string"
      ? specs.webhook_item_title
      : "";
  const body = buildComboStockSms(order.title as string, product);
  const phone = normalizeSmsPhone(to);
  console.log("sending to", phone);
  console.log(body);

  const result = await sendSms(phone, body);
  if (!result.sent) {
    console.error("send failed");
    process.exit(1);
  }

  const { error: insertError } = await sb.from("order_sms_messages").insert({
    tenant_id: order.tenant_id,
    order_id: order.id,
    direction: "outbound",
    phone,
    body,
    twilio_sid: result.sid,
    actor_user_id: null,
  });
  if (insertError) console.error("log failed", insertError.message);
  console.log("sent", result.sid);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
