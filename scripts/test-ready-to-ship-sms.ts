/**
 * Send a Ready-to-Ship SMS for an order (dev / QA).
 *
 * Usage:
 *   NEXT_PUBLIC_APP_URL=https://workflow-rho-one.vercel.app \
 *     npx tsx scripts/test-ready-to-ship-sms.ts 0282-1 7473780173
 *
 * Optional 4th arg: "pickup" for pickup-ready copy (no choose link wording).
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import {
  buildPickupReadySmsBody,
  buildShippingPortalSmsBody,
} from "../lib/notification-messages";
import {
  formatReadyToShipGroupLabel,
  listOrderGroupMembers,
} from "../lib/ready-to-ship-group";

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
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
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

  const orderHint = process.argv[2] ?? "0282-1";
  const testPhone = process.argv[3] ?? "7473780173";
  const fulfillment = process.argv[4] === "pickup" ? "pickup" : "choose";

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
    "http://localhost:3000";

  const admin = createClient(url, key);

  const { data: orders, error: orderError } = await admin
    .from("orders")
    .select(
      "id, title, tenant_id, column_id, description, specs, customers(name, email, phone), tenants(name)"
    )
    .ilike("title", `%${orderHint}%`)
    .limit(10);

  if (orderError || !orders?.length) {
    console.error("Order not found:", orderError?.message ?? orderHint);
    process.exit(1);
  }

  const exact = orders.find(
    (o) =>
      o.title === orderHint ||
      o.title.endsWith(`-${orderHint}`) ||
      o.title.includes(orderHint)
  );
  const order = exact ?? orders[0]!;
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

  let orderLabel = order.title;
  try {
    const members = await listOrderGroupMembers(admin, order.tenant_id, {
      id: order.id,
      title: order.title,
      column_id: order.column_id,
      description: order.description,
      specs: (order.specs ?? {}) as Record<string, unknown>,
    });
    if (members.length > 1) {
      orderLabel = formatReadyToShipGroupLabel(members);
    }
  } catch {
    // keep single-order title
  }

  // Replace any prior shipping request for this order (same as ship API).
  await admin
    .from("shipping_requests")
    .delete()
    .eq("tenant_id", order.tenant_id)
    .eq("order_id", order.id);

  const nowIso = new Date().toISOString();
  const pickupOnly = fulfillment === "pickup";
  // Choose-mode links must carry box details or the portal can't quote delivery.
  const boxes = pickupOnly
    ? []
    : [
        {
          length: 12,
          width: 10,
          height: 6,
          weight: 5,
          dimUnit: "in",
          weightUnit: "lbs",
        },
      ];
  const { data: shippingReq, error: shipError } = await admin
    .from("shipping_requests")
    .insert({
      tenant_id: order.tenant_id,
      order_id: order.id,
      boxes,
      status: pickupOnly ? "client_responded" : "pending",
      client_choice: pickupOnly ? "pickup" : null,
      sent_at: nowIso,
      responded_at: pickupOnly ? nowIso : null,
    })
    .select("id, token")
    .single();

  if (shipError || !shippingReq) {
    console.error("Shipping request insert failed:", shipError?.message);
    process.exit(1);
  }

  const portalUrl = `${base}/shipping/${shippingReq.token}`;

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: notification, error: insertError } = await admin
    .from("job_notifications")
    .insert({
      tenant_id: order.tenant_id,
      order_id: order.id,
      type: "ready_to_ship",
      channel: "sms",
      token_expires_at: expiresAt,
      status: "pending",
      staff_note: `portal:${shippingReq.token}`,
    })
    .select("id, token")
    .single();

  if (insertError || !notification) {
    console.error("Notification insert failed:", insertError?.message);
    process.exit(1);
  }

  let smsBody: string;
  if (pickupOnly) {
    smsBody = buildPickupReadySmsBody({
      customerName: customer?.name,
      orderNumber: orderLabel,
      portalUrl,
      pickupLocation: "306 Boyd St, Los Angeles, CA 90013",
      pickupHours:
        "Available for pickup: Mon–Fri 9:30 AM – 5:30 PM, Sat until 4:00 PM",
    });
  } else {
    smsBody = buildShippingPortalSmsBody({
      customerName: customer?.name,
      orderNumber: orderLabel,
      portalUrl,
    });
  }

  console.log(`Order: ${order.title} (${order.id})`);
  console.log(`Label: ${orderLabel}`);
  console.log(`Customer: ${customer?.name ?? "—"}`);
  console.log(`Fulfillment: ${fulfillment}`);
  console.log(`SMS to: ${normalizePhone(testPhone)}`);
  console.log(`Link: ${portalUrl}`);
  console.log(`Body:\n${smsBody}\n`);

  const smsSent = await sendSms(testPhone, smsBody);
  if (smsSent) {
    await admin
      .from("job_notifications")
      .update({ status: "sent", channel: "sms" })
      .eq("id", notification.id);
  }

  console.log("--- Result ---");
  console.log("SMS sent:", smsSent);
  if (!smsSent) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
