/**
 * Send a test shipping portal link for an order (dev / QA).
 *
 * Usage:
 *   npx tsx scripts/test-shipping-send.ts 98-3 +17473780173
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import { buildShippingPortalSmsBody } from "../lib/notification-messages";

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
    process.env[key] = value;
  }
}

function normalizePhone(raw: string): string {
  const value = raw.trim();
  if (value.startsWith("+")) return `+${value.slice(1).replace(/\D/g, "")}`;
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

async function sendSms(to: string, body: string) {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  const from = process.env.TWILIO_PHONE_NUMBER?.trim();
  if (!sid || !token || !from) {
    console.info(`[sms] (not configured) -> ${to}: ${body}`);
    return false;
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
        To: normalizePhone(to),
        Body: body,
      }),
    }
  );
  if (!res.ok) {
    console.error("[twilio]", await res.text());
    return false;
  }
  return true;
}

async function main() {
  loadEnvLocal();

  const orderHint = process.argv[2] ?? "98-3";
  const testPhone = process.argv[3] ?? "+17473780173";

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "http://localhost:3000";

  const admin = createClient(url, key);

  const { data: orders, error: orderError } = await admin
    .from("orders")
    .select("id, title, tenant_id, customers(name, email, phone), tenants(name)")
    .ilike("title", `%${orderHint}%`)
    .limit(5);

  if (orderError || !orders?.length) {
    console.error("Order not found:", orderError?.message ?? orderHint);
    process.exit(1);
  }

  const order = orders.find((o) => o.title.includes("98-3")) ?? orders[0]!;
  const customerRow = Array.isArray(order.customers)
    ? order.customers[0]
    : order.customers;
  const tenantRow = Array.isArray(order.tenants)
    ? order.tenants[0]
    : order.tenants;
  const customer = customerRow as {
    name: string;
    email: string | null;
    phone: string | null;
  } | null;
  const tenant = tenantRow as { name: string } | null;

  console.log(`Order: ${order.title} (${order.id})`);
  console.log(`Customer: ${customer?.name ?? "—"}`);
  console.log(`SMS to: ${testPhone}`);

  await admin.from("shipping_requests").delete().eq("order_id", order.id);

  const boxes = [
    {
      length: 12,
      width: 10,
      height: 6,
      weight: 5.2,
      dimUnit: "in",
      weightUnit: "lbs",
    },
  ];

  const { data: shipReq, error: insertError } = await admin
    .from("shipping_requests")
    .insert({
      tenant_id: order.tenant_id,
      order_id: order.id,
      boxes,
      status: "pending",
      sent_at: new Date().toISOString(),
    })
    .select("token")
    .single();

  if (insertError || !shipReq) {
    console.error("Insert failed:", insertError?.message);
    process.exit(1);
  }

  const portalUrl = `${base}/shipping/${shipReq.token}`;
  const smsBody = buildShippingPortalSmsBody({
    customerName: customer?.name,
    orderNumber: order.title,
    portalUrl,
  });

  const smsSent = await sendSms(testPhone, smsBody);

  console.log("\n--- Result ---");
  console.log("Portal URL:", portalUrl);
  console.log("SMS sent:", smsSent);
  if (!smsSent) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
