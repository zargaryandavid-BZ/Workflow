/**
 * Bazaar portal Order Sync — status callbacks when a portal card moves column.
 * Fire-and-forget; never throws into the move path.
 * Gated by webhook_configs.bazaar_portal_sync_enabled (default false).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Order, OrderSpecs } from "@/lib/types";
import { parseBazaarPortalInboundKeys } from "@/lib/bazaar-portal-keys";
import { canonicalizeWebhookSourceKey } from "@/lib/webhook-source-styles";

type Client = SupabaseClient;

export type BazaarPortalSyncConfig = {
  bazaar_api_url: string | null;
  bazaar_portal_inbound_keys: Record<string, string>;
  bazaar_portal_sync_enabled: boolean;
};

export type BazaarPortalStatusOrder = {
  id: string;
  title: string;
  webhook_source: string | null;
  specs: OrderSpecs | Record<string, unknown> | null | undefined;
};

export function parseBazaarPortalSyncFields(
  row: Record<string, unknown> | null | undefined
): BazaarPortalSyncConfig {
  return {
    bazaar_api_url:
      typeof row?.bazaar_api_url === "string" && row.bazaar_api_url.trim()
        ? row.bazaar_api_url.trim().replace(/\/$/, "")
        : null,
    bazaar_portal_inbound_keys: parseBazaarPortalInboundKeys(
      row?.bazaar_portal_inbound_keys
    ).keys,
    bazaar_portal_sync_enabled: row?.bazaar_portal_sync_enabled === true,
  };
}

function envBazaarApiUrl(): string | null {
  const raw = process.env.BAZAAR_API_URL?.trim();
  return raw ? raw.replace(/\/$/, "") : null;
}

function envInboundKeys(): Record<string, string> {
  const raw = process.env.BAZAAR_PORTAL_INBOUND_KEYS?.trim();
  if (!raw) return {};
  try {
    return parseBazaarPortalInboundKeys(JSON.parse(raw)).keys;
  } catch {
    return {};
  }
}

export async function loadBazaarPortalSyncConfig(
  client: Client,
  tenantId: string
): Promise<BazaarPortalSyncConfig> {
  const { data } = await client
    .from("webhook_configs")
    .select("bazaar_api_url, bazaar_portal_inbound_keys, bazaar_portal_sync_enabled")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const fromDb = parseBazaarPortalSyncFields(
    (data as Record<string, unknown> | null) ?? null
  );
  // DB wins when set; env fills empty URL/keys for local testing.
  // Enable flag stays DB-only — never silently enable from env.
  const envKeys = envInboundKeys();
  return {
    bazaar_api_url: fromDb.bazaar_api_url || envBazaarApiUrl(),
    bazaar_portal_inbound_keys:
      Object.keys(fromDb.bazaar_portal_inbound_keys).length > 0
        ? fromDb.bazaar_portal_inbound_keys
        : envKeys,
    bazaar_portal_sync_enabled: fromDb.bazaar_portal_sync_enabled,
  };
}

function specsRecord(
  specs: BazaarPortalStatusOrder["specs"]
): Record<string, unknown> {
  return specs && typeof specs === "object" ? (specs as Record<string, unknown>) : {};
}

function brokerIdFromOrder(order: BazaarPortalStatusOrder): string | null {
  const id = specsRecord(order.specs).bazaar_broker_id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

/**
 * Bazaar accepts BZ-{alias}, BZ-{alias}-{lineIndex}, BZ-{alias}-{orderItemId}.
 * Prefer the card title when it is a BZ ref; otherwise fall back to specs.
 */
export function resolveBazaarStatusOrderNumber(
  order: BazaarPortalStatusOrder
): string | null {
  const title = String(order.title ?? "").trim();
  if (/^BZ-\d+/i.test(title)) return title;

  const specs = specsRecord(order.specs);
  const parent =
    typeof specs.webhook_order_number === "string"
      ? specs.webhook_order_number.trim()
      : "";
  if (!parent || !/^BZ-\d+/i.test(parent)) return null;

  const idx = specs.webhook_item_index;
  if (typeof idx === "number" && Number.isFinite(idx) && idx >= 0) {
    return `${parent}-${idx + 1}`;
  }
  return parent;
}

/**
 * After a column move: notify Bazaar for portal-sourced cards only.
 */
export async function notifyBazaarPortalStatus(args: {
  client: Client;
  tenantId: string;
  order: BazaarPortalStatusOrder | Pick<Order, "id" | "title" | "webhook_source" | "specs">;
  columnName: string;
}): Promise<void> {
  try {
    const order: BazaarPortalStatusOrder = {
      id: args.order.id,
      title: args.order.title,
      webhook_source: args.order.webhook_source,
      specs: args.order.specs ?? {},
    };
    const source = canonicalizeWebhookSourceKey(order.webhook_source);
    const inferredPortal =
      typeof specsRecord(order.specs).bazaar_broker_id === "string" &&
      String(specsRecord(order.specs).bazaar_broker_id).trim();
    if (source !== "portal" && !inferredPortal) return;

    const cfg = await loadBazaarPortalSyncConfig(args.client, args.tenantId);
    if (!cfg.bazaar_portal_sync_enabled) return;
    if (!cfg.bazaar_api_url) {
      console.warn("[bazaar-portal-sync] enabled but bazaar_api_url is empty");
      return;
    }

    const brokerId = brokerIdFromOrder(order);
    if (!brokerId) {
      console.warn(
        "[bazaar-portal-sync] portal card missing specs.bazaar_broker_id",
        { orderId: order.id }
      );
      return;
    }

    const osk = cfg.bazaar_portal_inbound_keys[brokerId];
    if (!osk) {
      console.warn("[bazaar-portal-sync] no osk_ for brokerId", { brokerId });
      return;
    }

    const orderNumber = resolveBazaarStatusOrderNumber(order);
    if (!orderNumber) {
      console.warn("[bazaar-portal-sync] no BZ-* order_number", {
        orderId: order.id,
        title: order.title,
      });
      return;
    }

    const url = `${cfg.bazaar_api_url}/api/v1/production/status`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-webhook-secret": osk,
      },
      body: JSON.stringify({
        event: "job_status_update",
        order_number: orderNumber,
        column_name: args.columnName,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[bazaar-portal-sync] status POST failed", {
        status: res.status,
        orderNumber,
        body: text.slice(0, 300),
      });
    }
  } catch (err) {
    console.error(
      "[bazaar-portal-sync] notify failed:",
      err instanceof Error ? err.message : err
    );
  }
}

/** Auth check for Settings → Test connection (does not require a real order). */
export async function testBazaarPortalSyncConnection(args: {
  bazaarApiUrl: string;
  oskKey: string;
}): Promise<{ ok: boolean; status: number; message: string }> {
  const base = args.bazaarApiUrl.trim().replace(/\/$/, "");
  const key = args.oskKey.trim();
  if (!base || !key.startsWith("osk_")) {
    return { ok: false, status: 0, message: "Need Bazaar API URL and an osk_ key" };
  }

  try {
    const res = await fetch(`${base}/api/v1/production/status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-webhook-secret": key,
      },
      body: JSON.stringify({
        event: "job_status_update",
        order_number: "BZ-0-CONNECTION-TEST",
        column_name: "Start",
      }),
    });
    await res.text().catch(() => "");
    // 401 = bad key. Any other response means the key was accepted by auth.
    if (res.status === 401) {
      return {
        ok: false,
        status: 401,
        message: "Unauthorized — check the osk_ key for this partner",
      };
    }
    // Auth passed. 400/404 are expected for the synthetic test order_number.
    return {
      ok: true,
      status: res.status,
      message:
        "Connection OK — osk_ key accepted. You can enable sync and Save.",
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: err instanceof Error ? err.message : "Request failed",
    };
  }
}
