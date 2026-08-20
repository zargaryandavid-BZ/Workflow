import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "crypto";
import { normalizeSmsPhone } from "@/lib/sms";
import type { OrderSmsMessage, SmsDirection } from "@/lib/order-sms-types";
import { getComboStock } from "@/lib/combo-stock";

export type { OrderSmsMessage, SmsDirection } from "@/lib/order-sms-types";

type Client = SupabaseClient;

export async function insertOrderSmsMessage(
  client: Client,
  input: {
    tenantId: string;
    orderId: string;
    direction: SmsDirection;
    phone: string;
    body: string;
    twilioSid?: string | null;
    actorUserId?: string | null;
  }
): Promise<OrderSmsMessage | null> {
  const phone = normalizeSmsPhone(input.phone);
  const body = input.body.trim();
  if (!body) return null;

  const twilioSid = input.twilioSid?.trim() || null;

  const { data, error } = await client
    .from("order_sms_messages")
    .insert({
      tenant_id: input.tenantId,
      order_id: input.orderId,
      direction: input.direction,
      phone,
      body,
      twilio_sid: twilioSid,
      actor_user_id: input.actorUserId ?? null,
    })
    .select(
      "id, tenant_id, order_id, direction, phone, body, twilio_sid, actor_user_id, created_at"
    )
    .maybeSingle();

  if (error) {
    // Idempotent re-delivery from Twilio
    if (error.code === "23505" && twilioSid) {
      const { data: existing } = await client
        .from("order_sms_messages")
        .select(
          "id, tenant_id, order_id, direction, phone, body, twilio_sid, actor_user_id, created_at"
        )
        .eq("twilio_sid", twilioSid)
        .maybeSingle();
      return (existing as OrderSmsMessage | null) ?? null;
    }
    console.error("[order-sms] insert failed:", error.message);
    return null;
  }

  return data as OrderSmsMessage;
}

export async function listOrderSmsMessages(
  client: Client,
  orderId: string,
  tenantId: string
): Promise<OrderSmsMessage[]> {
  const { data, error } = await client
    .from("order_sms_messages")
    .select(
      "id, tenant_id, order_id, direction, phone, body, twilio_sid, actor_user_id, created_at"
    )
    .eq("order_id", orderId)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[order-sms] list failed:", error.message);
    return [];
  }

  const rows = (data ?? []) as OrderSmsMessage[];
  const actorIds = [
    ...new Set(
      rows
        .map((r) => r.actor_user_id)
        .filter((id): id is string => Boolean(id))
    ),
  ];

  if (actorIds.length === 0) return rows;

  const { data: profiles } = await client
    .from("profiles")
    .select("id, full_name")
    .in("id", actorIds);

  const nameById = new Map<string, string>();
  for (const p of profiles ?? []) {
    const row = p as { id: string; full_name: string | null };
    if (row.full_name?.trim()) nameById.set(row.id, row.full_name.trim());
  }

  return rows.map((r) => ({
    ...r,
    actor_name: r.actor_user_id
      ? (nameById.get(r.actor_user_id) ?? null)
      : null,
  }));
}

/**
 * A 1/2/3 warehouse reply should land on the latest *pending* combo-stock
 * check sent to this phone, not whatever outbound SMS was last (proof, RTS, …).
 */
export async function findPendingComboStockOrderForPhone(
  client: Client,
  fromPhone: string
): Promise<{ tenantId: string; orderId: string } | null> {
  const phone = normalizeSmsPhone(fromPhone);
  const { data: outs } = await client
    .from("order_sms_messages")
    .select("tenant_id, order_id")
    .eq("direction", "outbound")
    .eq("phone", phone)
    .ilike("body", "%stock check%")
    .order("created_at", { ascending: false })
    .limit(25);

  for (const row of outs ?? []) {
    const rec = row as { tenant_id: string; order_id: string };
    const { data: order } = await client
      .from("orders")
      .select("id, tenant_id, specs")
      .eq("id", rec.order_id)
      .maybeSingle();
    if (!order) continue;
    const stock = getComboStock({
      specs: (order as { specs?: Record<string, unknown> | null }).specs,
    });
    if (stock?.status === "pending") {
      return { tenantId: rec.tenant_id, orderId: rec.order_id };
    }
  }
  return null;
}

/**
 * Resolve which order an inbound SMS belongs to.
 * Prefer the most recent outbound SMS to that phone, then customer match.
 */
export async function findOrderForInboundSms(
  client: Client,
  fromPhone: string
): Promise<{ tenantId: string; orderId: string } | null> {
  const phone = normalizeSmsPhone(fromPhone);

  const { data: recentOut } = await client
    .from("order_sms_messages")
    .select("tenant_id, order_id")
    .eq("direction", "outbound")
    .eq("phone", phone)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (recentOut) {
    return {
      tenantId: (recentOut as { tenant_id: string }).tenant_id,
      orderId: (recentOut as { order_id: string }).order_id,
    };
  }

  // Match customers.phone — prefer exact E.164 / common variants, then digit suffix.
  // Do NOT load an arbitrary first-N customers (breaks tenants with >500 customers).
  const digits = phone.replace(/\D/g, "");
  const last10 = digits.slice(-10);
  if (last10.length < 10) return null;

  const area = last10.slice(0, 3);
  const mid = last10.slice(3, 6);
  const end = last10.slice(6);
  const phoneCandidates = Array.from(
    new Set([
      phone,
      `+1${last10}`,
      `1${last10}`,
      last10,
      `+${last10}`,
    ])
  );

  const orParts = [
    ...phoneCandidates.map((p) => `phone.eq."${p.replace(/"/g, "")}"`),
    // Consecutive digits (covers +18185551234 and similar)
    `phone.ilike."%${last10}%"`,
    // Common US display formats still present in older rows
    `phone.ilike."%${area}-${mid}-${end}%"`,
    `phone.ilike."%(${area})%${mid}%${end}%"`,
  ];

  const { data: customers } = await client
    .from("customers")
    .select("id, tenant_id, phone")
    .or(orParts.join(","))
    .limit(50);

  const matched = (customers ?? []).filter((c) => {
    const p = String((c as { phone?: string | null }).phone ?? "").replace(
      /\D/g,
      ""
    );
    if (!p) return false;
    return p.endsWith(last10) || last10.endsWith(p.slice(-10));
  }) as { id: string; tenant_id: string; phone: string | null }[];

  if (matched.length === 0) return null;

  const customerIds = matched.map((c) => c.id);
  const { data: order } = await client
    .from("orders")
    .select("id, tenant_id, customer_id")
    .in("customer_id", customerIds)
    .is("removed_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!order) return null;

  const orderRow = order as {
    id: string;
    tenant_id: string;
    customer_id: string;
  };
  const owner = matched.find((c) => c.id === orderRow.customer_id);
  if (!owner || owner.tenant_id !== orderRow.tenant_id) return null;

  return {
    tenantId: orderRow.tenant_id,
    orderId: orderRow.id,
  };
}

/** Validate Twilio request signature (X-Twilio-Signature). */
export function validateTwilioSignature(opts: {
  authToken: string;
  signature: string;
  url: string;
  params: Record<string, string>;
}): boolean {
  const { authToken, signature, url, params } = opts;
  if (!authToken || !signature) return false;

  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) {
    data += key + params[key];
  }

  const expected = createHmac("sha1", authToken).update(data, "utf8").digest("base64");
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
