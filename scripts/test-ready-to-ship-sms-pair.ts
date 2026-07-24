/**
 * Send two Ready-to-Ship test SMS: one WITH boxes, one WITHOUT.
 * Keeps both portal links active (does not delete prior shipping requests).
 *
 * Usage:
 *   NEXT_PUBLIC_APP_URL=https://workflow-rho-one.vercel.app \
 *     npx tsx scripts/test-ready-to-ship-sms-pair.ts 0282-1 7473780173
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
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
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

  const orderHint = process.argv[2] ?? "0282-1";
  const testPhone = process.argv[3] ?? "7473780173";
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
    "https://workflow-rho-one.vercel.app";

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: orders, error: orderError } = await admin
    .from("orders")
    .select("id, title, tenant_id, customers(name)")
    .ilike("title", `%${orderHint}%`)
    .limit(10);

  if (orderError || !orders?.length) {
    console.error("Order not found:", orderError?.message ?? orderHint);
    process.exit(1);
  }

  const order =
    orders.find((o) => o.title.includes(orderHint)) ?? orders[0]!;
  const customerRow = Array.isArray(order.customers)
    ? order.customers[0]
    : order.customers;
  const customerName = (customerRow as { name?: string } | null)?.name;

  const nowIso = new Date().toISOString();
  const expiresAt = new Date(
    Date.now() + 7 * 24 * 60 * 60 * 1000
  ).toISOString();

  const variants: Array<{
    label: string;
    prefix: string;
    boxes: Array<{
      length: number;
      width: number;
      height: number;
      weight: number;
      dimUnit: string;
      weightUnit: string;
    }>;
  }> = [
    {
      label: "WITH boxes",
      prefix: "[TEST · WITH boxes] ",
      boxes: [
        {
          length: 12,
          width: 10,
          height: 6,
          weight: 5,
          dimUnit: "in",
          weightUnit: "lbs",
        },
      ],
    },
    {
      label: "WITHOUT boxes",
      prefix: "[TEST · NO boxes] ",
      boxes: [],
    },
  ];

  for (const v of variants) {
    const { data: shippingReq, error: shipError } = await admin
      .from("shipping_requests")
      .insert({
        tenant_id: order.tenant_id,
        order_id: order.id,
        boxes: v.boxes,
        status: "pending",
        client_choice: null,
        sent_at: nowIso,
      })
      .select("id, token")
      .single();

    if (shipError || !shippingReq) {
      console.error(v.label, "ship insert failed:", shipError?.message);
      process.exit(1);
    }

    const portalUrl = `${base}/shipping/${shippingReq.token}`;
    const { data: notification } = await admin
      .from("job_notifications")
      .insert({
        tenant_id: order.tenant_id,
        order_id: order.id,
        type: "ready_to_ship",
        channel: "sms",
        token_expires_at: expiresAt,
        status: "pending",
        staff_note: `portal:${shippingReq.token} ${v.label}`,
      })
      .select("id")
      .single();

    const smsBody =
      v.prefix +
      buildShippingPortalSmsBody({
        customerName,
        orderNumber: order.title,
        portalUrl,
      });

    console.log(`--- ${v.label} ---`);
    console.log(smsBody);
    console.log("Link:", portalUrl);

    const ok = await sendSms(testPhone, smsBody);
    if (ok && notification) {
      await admin
        .from("job_notifications")
        .update({ status: "sent" })
        .eq("id", notification.id);
    }
    console.log("SMS sent:", ok);
    if (!ok) process.exit(1);
  }

  console.log("\nDone — both links left active.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
