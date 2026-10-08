/**
 * Bazaar portal Order Sync — status callbacks when a portal card moves column.
 * Fire-and-forget; never throws into the move path.
 * Gated by webhook_configs.bazaar_portal_sync_enabled (default false).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Order, OrderSpecs } from "@/lib/types";
import { parseBazaarPortalInboundKeys } from "@/lib/bazaar-portal-keys";
import { canonicalizeWebhookSourceKey } from "@/lib/webhook-source-styles";
import {
  buildBazaarPortalStatusPayload,
  sanitizeApprovalUrl,
} from "@/lib/bazaar-portal-status-payload";
import { isWaitingApprovalColumn } from "@/lib/waiting-approval-column";

export type { BazaarPortalStatusPayload } from "@/lib/bazaar-portal-status-payload";
export { buildBazaarPortalStatusPayload } from "@/lib/bazaar-portal-status-payload";

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

const BAZAAR_ORDER_NUMBER_RE = /^BZ-\d+/i;

/** Hard cap on the outbound status POST so it can never hang a request. */
const BAZAAR_STATUS_POST_TIMEOUT_MS = 10_000;

export function parseBazaarOrderNumber(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return BAZAAR_ORDER_NUMBER_RE.test(value) ? value : null;
}

export function pickBazaarOrderNumber(...candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    const parsed = parseBazaarOrderNumber(candidate);
    if (parsed) return parsed;
  }
  return null;
}

function withLineSuffix(
  parent: string,
  specs: Record<string, unknown>
): string {
  if (/^BZ-\d+-\S+/i.test(parent)) return parent;
  const idx = specs.webhook_item_index;
  if (typeof idx === "number" && Number.isFinite(idx) && idx >= 0) {
    return `${parent}-${idx + 1}`;
  }
  return parent;
}

/**
 * Bazaar accepts BZ-{alias}, BZ-{alias}-{lineIndex}, BZ-{alias}-{orderItemId}.
 * Prefer specs.bazaar_order_number (CRM portal-intake). Never ORD-….
 */
export function resolveBazaarStatusOrderNumber(
  order: BazaarPortalStatusOrder
): string | null {
  const specs = specsRecord(order.specs);
  const fromStamp = parseBazaarOrderNumber(specs.bazaar_order_number);
  if (fromStamp) return withLineSuffix(fromStamp, specs);

  const title = String(order.title ?? "").trim();
  if (BAZAAR_ORDER_NUMBER_RE.test(title)) return title;

  const parent =
    typeof specs.webhook_order_number === "string"
      ? specs.webhook_order_number.trim()
      : "";
  if (!parent || !BAZAAR_ORDER_NUMBER_RE.test(parent)) return null;
  return withLineSuffix(parent, specs);
}

/**
 * After a column move: notify Bazaar for portal-sourced cards only.
 */
export async function notifyBazaarPortalStatus(args: {
  client: Client;
  tenantId: string;
  order: BazaarPortalStatusOrder | Pick<Order, "id" | "title" | "webhook_source" | "specs">;
  columnName: string;
  /** ISO timestamp of the move; defaults to now when omitted. */
  movedAt?: string;
  /**
   * Customer proof-approval page for this card. Optional + additive: when
   * given it is sent as `approval_url` in the same POST. When omitted and the
   * card is entering a Waiting Approval column, a still-live approval link
   * (if one exists) is looked up and attached.
   */
  approvalUrl?: string | null;
  /** Board column kind (e.g. "approval"); helps detect the approval column. */
  columnKind?: string | null;
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

    // Additive: attach the customer approval link when we have one. Never
    // blocks or fails the status POST — a lookup problem just omits the link.
    let approvalUrl = sanitizeApprovalUrl(args.approvalUrl);
    if (
      !approvalUrl &&
      isWaitingApprovalColumn({ kind: args.columnKind, name: args.columnName })
    ) {
      try {
        const { findActiveApprovalUrl } = await import(
          "@/lib/bazaar-portal-approval-link"
        );
        approvalUrl = await findActiveApprovalUrl({
          tenantId: args.tenantId,
          orderId: order.id,
        });
      } catch {
        approvalUrl = null;
      }
    }

    const url = `${cfg.bazaar_api_url}/api/v1/production/status`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-webhook-secret": osk,
      },
      body: JSON.stringify(
        buildBazaarPortalStatusPayload({
          orderNumber,
          columnName: args.columnName,
          movedAt: args.movedAt,
          approvalUrl,
        })
      ),
      // Never let a slow Bazaar API hold the caller open.
      signal: AbortSignal.timeout(BAZAAR_STATUS_POST_TIMEOUT_MS),
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

/**
 * A card counts as Bazaar-portal sourced when it was ingested as
 * `source: "portal"` or carries a `specs.bazaar_broker_id` stamp. Same test
 * `notifyBazaarPortalStatus` applies; exposed so callers can bail out cheaply.
 */
export function isBazaarPortalCard(
  order: Pick<BazaarPortalStatusOrder, "webhook_source" | "specs">
): boolean {
  if (canonicalizeWebhookSourceKey(order.webhook_source) === "portal") {
    return true;
  }
  const brokerId = specsRecord(order.specs).bazaar_broker_id;
  return typeof brokerId === "string" && brokerId.trim().length > 0;
}

/**
 * A customer approval link was just created/sent for these cards: tell the
 * Bazaar portal so it can show the "Open" proof-approval action right away
 * (the link normally does not exist yet at the moment the card is dropped
 * into Waiting Approval, so the column-move POST cannot carry it).
 *
 * Reads the card's CURRENT column from the DB (never trusts a stale caller
 * copy, so this POST can't drag the portal's status backwards), then reuses
 * `notifyBazaarPortalStatus` — same Bazaar-sourced guard, same per-partner
 * osk_ key, same BZ-* order_number, same opt-in flag. No-op for non-portal
 * cards, cards without a live link, or when sync is off.
 * Fire-and-forget: never throws.
 */
export async function notifyBazaarPortalApprovalLinks(args: {
  tenantId: string;
  orderIds: string[];
}): Promise<void> {
  const ids = Array.from(new Set(args.orderIds.filter(Boolean)));
  if (ids.length === 0) return;
  try {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const client = createAdminClient();
    const { findActiveApprovalUrl } = await import(
      "@/lib/bazaar-portal-approval-link"
    );

    for (const orderId of ids) {
      try {
        const { data: row } = await client
          .from("orders")
          .select(
            "id, title, tenant_id, webhook_source, specs, column_id, last_moved_at"
          )
          .eq("id", orderId)
          .eq("tenant_id", args.tenantId)
          .maybeSingle();
        if (!row) continue;
        const order: BazaarPortalStatusOrder = {
          id: row.id as string,
          title: row.title as string,
          webhook_source: (row.webhook_source as string | null) ?? null,
          specs: (row.specs as Record<string, unknown> | null) ?? {},
        };
        if (!isBazaarPortalCard(order)) continue;

        const columnId =
          typeof row.column_id === "string" ? row.column_id : "";
        if (!columnId) continue;
        const { data: col } = await client
          .from("board_columns")
          .select("name, kind")
          .eq("id", columnId)
          .eq("tenant_id", args.tenantId)
          .maybeSingle();
        const columnName =
          typeof col?.name === "string" ? col.name.trim() : "";
        if (!columnName) continue;

        const approvalUrl = await findActiveApprovalUrl({
          tenantId: args.tenantId,
          orderId,
        });
        if (!approvalUrl) continue;

        await notifyBazaarPortalStatus({
          client,
          tenantId: args.tenantId,
          order,
          columnName,
          columnKind: typeof col?.kind === "string" ? col.kind : null,
          movedAt:
            typeof row.last_moved_at === "string"
              ? row.last_moved_at
              : undefined,
          approvalUrl,
        });
      } catch (err) {
        console.error(
          "[bazaar-portal-sync] approval link notify failed:",
          err instanceof Error ? err.message : err
        );
      }
    }
  } catch (err) {
    console.error(
      "[bazaar-portal-sync] approval link notify failed:",
      err instanceof Error ? err.message : err
    );
  }
}

/**
 * Tell Admin this partner was disconnected from Workflow Settings.
 * POST before dropping osk_ — after a successful call that key is dead.
 * Bazaar will not call our /disconnect (no loop).
 */
export async function notifyBazaarPortalDisconnect(args: {
  bazaarApiUrl: string;
  oskKey: string;
}): Promise<{ ok: boolean; message: string }> {
  const base = args.bazaarApiUrl.trim().replace(/\/$/, "");
  const key = args.oskKey.trim();
  if (!base || !key.startsWith("osk_")) {
    return { ok: false, message: "Missing Bazaar API URL or osk_" };
  }

  try {
    const res = await fetch(`${base}/api/v1/production/status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-webhook-secret": key,
      },
      body: JSON.stringify({
        event: "integration_disconnected",
      }),
    });
    await res.text().catch(() => "");
    if (res.status === 401) {
      return { ok: false, message: "Admin rejected the disconnect notice (401)" };
    }
    return { ok: true, message: "Admin notified" };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Could not reach Admin",
    };
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
