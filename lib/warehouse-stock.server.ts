import "server-only";

import { randomUUID, timingSafeEqual } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSmsConfigured, sendSms } from "@/lib/sms";
import { insertOrderSmsMessage } from "@/lib/order-sms";
import { logActivity } from "@/lib/automation";
import { ensureShortCustomerUrl, appOrigin } from "@/lib/short-link";
import type { WarehouseStockSpecs } from "@/lib/warehouse-stock";

type Client = SupabaseClient;

/** Env var holding the warehouse phone that receives stock-confirmation texts. */
export const WAREHOUSE_SMS_ENV = "WAREHOUSE_SMS_PHONE";

export function warehouseSmsRecipient(): string | null {
  const raw = process.env.WAREHOUSE_SMS_PHONE?.trim();
  return raw || null;
}

function appBaseUrl(): string {
  return appOrigin();
}

function asRecord(specs: unknown): Record<string, unknown> {
  if (!specs || typeof specs !== "object") return {};
  return { ...(specs as Record<string, unknown>) };
}

/** Public no-login confirm path. Token = `${orderId}~${secret}`. */
export function warehouseConfirmPath(orderId: string, secret: string): string {
  return `/warehouse-confirm/${orderId}~${secret}`;
}

export function warehouseConfirmUrl(orderId: string, secret: string): string {
  return `${appBaseUrl()}${warehouseConfirmPath(orderId, secret)}`;
}

export function parseWarehouseConfirmToken(
  token: string
): { orderId: string; secret: string } | null {
  const raw = decodeURIComponent(token ?? "").trim();
  const sep = raw.indexOf("~");
  if (sep <= 0) return null;
  const orderId = raw.slice(0, sep).trim();
  const secret = raw.slice(sep + 1).trim();
  if (!orderId || !secret) return null;
  return { orderId, secret };
}

function secretsMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  try {
    return timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

interface OrderStockRow {
  id: string;
  tenant_id: string;
  title: string;
  specs: Record<string, unknown>;
}

/**
 * Ensure a confirm secret exists and text the warehouse (once) asking them to
 * confirm the containers are in stock. Idempotent: skips the text if one was
 * already sent unless `force` is true. Persists the secret + sent-timestamp on
 * `orders.specs` (additive jsonb write — no other columns touched).
 */
export async function requestWarehouseStockConfirmation(
  client: Client,
  opts: {
    orderId: string;
    tenantId: string;
    title: string;
    specs: unknown;
    orderNumber?: string | null;
    tenantName: string;
    actorUserId?: string | null;
    force?: boolean;
  }
): Promise<{ smsSent: boolean; alreadySent: boolean; error?: string }> {
  const specs = asRecord(opts.specs) as Record<string, unknown> &
    WarehouseStockSpecs;

  const alreadySent = Boolean(specs.warehouse_stock_sms_sent_at);

  let secret =
    typeof specs.warehouse_stock_confirm_secret === "string" &&
    specs.warehouse_stock_confirm_secret.trim()
      ? specs.warehouse_stock_confirm_secret.trim()
      : "";
  const hadSecret = Boolean(secret);
  if (!secret) {
    secret = randomUUID();
    specs.warehouse_stock_confirm_secret = secret;
  }

  if (alreadySent && !opts.force) {
    // Persist a freshly-minted secret even when we don't re-text.
    if (!hadSecret) {
      await persistSpecs(client, opts.orderId, opts.tenantId, specs);
    }
    return { smsSent: false, alreadySent: true };
  }

  const to = warehouseSmsRecipient();
  const label =
    opts.orderNumber?.trim() || opts.title?.trim() || "an order";
  const url = await ensureShortCustomerUrl(
    client,
    opts.tenantId,
    warehouseConfirmPath(opts.orderId, secret)
  );
  const bodyText =
    `${opts.tenantName}: Combo order ${label} needs application and is heading to ` +
    `Ready-to-Ship. Confirm the containers are in stock before we release it: ${url}`;

  let smsSent = false;
  let error: string | undefined;

  if (!to) {
    error = `Warehouse phone not configured — set ${WAREHOUSE_SMS_ENV}.`;
    console.warn(`[warehouse-stock] ${error}`);
  } else if (!isSmsConfigured()) {
    error = "SMS not configured (Twilio env missing).";
    console.info(`[warehouse-stock] would text ${to}: ${bodyText}`);
  } else {
    const res = await sendSms({ to, body: bodyText });
    smsSent = res.sent;
    if (!res.sent) error = res.error;
    if (res.sent) {
      try {
        await insertOrderSmsMessage(client, {
          tenantId: opts.tenantId,
          orderId: opts.orderId,
          direction: "outbound",
          phone: to,
          body: bodyText,
          twilioSid: res.sid ?? null,
          actorUserId: opts.actorUserId ?? null,
        });
      } catch {
        /* thread logging is non-fatal */
      }
    }
  }

  // Mark as sent even on a soft failure so we don't hammer Twilio on every drag;
  // staff can force a resend from the confirm-stock action.
  specs.warehouse_stock_sms_sent_at = new Date().toISOString();
  await persistSpecs(client, opts.orderId, opts.tenantId, specs);

  try {
    await logActivity(client, {
      tenantId: opts.tenantId,
      orderId: opts.orderId,
      actor: opts.actorUserId ?? null,
      action: "warehouse_stock_requested",
      metadata: { to: to ?? null, smsSent, url, error: error ?? null },
    });
  } catch {
    /* non-fatal */
  }

  return { smsSent, alreadySent: false, error };
}

async function persistSpecs(
  client: Client,
  orderId: string,
  tenantId: string,
  specs: Record<string, unknown>
): Promise<void> {
  await client
    .from("orders")
    .update({ specs })
    .eq("id", orderId)
    .eq("tenant_id", tenantId);
}

/** Read-only lookup for the public confirm page. Validates the token. */
export async function loadWarehouseStockOrderByToken(
  client: Client,
  token: string
): Promise<
  | {
      ok: true;
      order: {
        id: string;
        tenantId: string;
        title: string;
        confirmed: boolean;
        confirmedAt: string | null;
        confirmedBy: string | null;
      };
    }
  | { ok: false; error: string }
> {
  const parsed = parseWarehouseConfirmToken(token);
  if (!parsed) return { ok: false, error: "Invalid link." };

  const { data } = await client
    .from("orders")
    .select("id, tenant_id, title, specs")
    .eq("id", parsed.orderId)
    .maybeSingle();

  const row = data as OrderStockRow | null;
  if (!row) return { ok: false, error: "This confirmation link is no longer valid." };

  const specs = asRecord(row.specs) as WarehouseStockSpecs;
  const secret =
    typeof specs.warehouse_stock_confirm_secret === "string"
      ? specs.warehouse_stock_confirm_secret
      : "";
  if (!secret || !secretsMatch(secret, parsed.secret)) {
    return { ok: false, error: "This confirmation link is invalid or has expired." };
  }

  return {
    ok: true,
    order: {
      id: row.id,
      tenantId: row.tenant_id,
      title: row.title,
      confirmed: specs.warehouse_stock_confirmed === true,
      confirmedAt: specs.warehouse_stock_confirmed_at ?? null,
      confirmedBy: specs.warehouse_stock_confirmed_by ?? null,
    },
  };
}

/**
 * Mark warehouse stock confirmed via the no-login token link. Idempotent.
 * Only flips the additive specs flags — never moves the card.
 */
export async function confirmWarehouseStockByToken(
  client: Client,
  token: string,
  confirmedBy: string
): Promise<
  | { ok: true; alreadyConfirmed: boolean; orderTitle: string }
  | { ok: false; error: string }
> {
  const parsed = parseWarehouseConfirmToken(token);
  if (!parsed) return { ok: false, error: "Invalid link." };

  const { data } = await client
    .from("orders")
    .select("id, tenant_id, title, specs")
    .eq("id", parsed.orderId)
    .maybeSingle();

  const row = data as OrderStockRow | null;
  if (!row) return { ok: false, error: "Order not found." };

  const specs = asRecord(row.specs) as Record<string, unknown> &
    WarehouseStockSpecs;
  const secret =
    typeof specs.warehouse_stock_confirm_secret === "string"
      ? specs.warehouse_stock_confirm_secret
      : "";
  if (!secret || !secretsMatch(secret, parsed.secret)) {
    return { ok: false, error: "This confirmation link is invalid or has expired." };
  }

  if (specs.warehouse_stock_confirmed === true) {
    return { ok: true, alreadyConfirmed: true, orderTitle: row.title };
  }

  specs.warehouse_stock_confirmed = true;
  specs.warehouse_stock_confirmed_at = new Date().toISOString();
  specs.warehouse_stock_confirmed_by = confirmedBy?.trim() || "warehouse-sms";

  await persistSpecs(client, row.id, row.tenant_id, specs);

  try {
    await logActivity(client, {
      tenantId: row.tenant_id,
      orderId: row.id,
      actor: null,
      action: "warehouse_stock_confirmed",
      metadata: { confirmedBy: specs.warehouse_stock_confirmed_by, source: "sms_link" },
    });
  } catch {
    /* non-fatal */
  }

  return { ok: true, alreadyConfirmed: false, orderTitle: row.title };
}

/**
 * Mark warehouse stock confirmed by an authenticated staff member (in-app).
 * Caller has already verified tenant access.
 */
export async function confirmWarehouseStockInApp(
  client: Client,
  opts: {
    orderId: string;
    tenantId: string;
    specs: unknown;
    confirmedBy: string;
    actorUserId?: string | null;
  }
): Promise<{ ok: true; alreadyConfirmed: boolean }> {
  const specs = asRecord(opts.specs) as Record<string, unknown> &
    WarehouseStockSpecs;
  if (specs.warehouse_stock_confirmed === true) {
    return { ok: true, alreadyConfirmed: true };
  }

  specs.warehouse_stock_confirmed = true;
  specs.warehouse_stock_confirmed_at = new Date().toISOString();
  specs.warehouse_stock_confirmed_by = opts.confirmedBy?.trim() || "warehouse";

  await persistSpecs(client, opts.orderId, opts.tenantId, specs);

  try {
    await logActivity(client, {
      tenantId: opts.tenantId,
      orderId: opts.orderId,
      actor: opts.actorUserId ?? null,
      action: "warehouse_stock_confirmed",
      metadata: {
        confirmedBy: specs.warehouse_stock_confirmed_by,
        source: "in_app",
      },
    });
  } catch {
    /* non-fatal */
  }

  return { ok: true, alreadyConfirmed: false };
}
