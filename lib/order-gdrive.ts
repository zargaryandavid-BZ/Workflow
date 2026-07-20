import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { ARTWORK_FIELD_NAME, CUSTOMER_NAME_FIELD_NAME } from "@/lib/constants";
import {
  ensureGdriveSettings,
  isGdriveConfigured,
} from "@/lib/gdrive-settings";
import { ensureOrderDriveFolders } from "@/lib/google-drive";

type Client = SupabaseClient;

/** Full order key used to derive the short Drive code (e.g. ORD-2026-0098). */
function orderKeyFromOrder(order: {
  title: string;
  specs?: Record<string, unknown> | null;
}): string {
  const webhook =
    typeof order.specs?.webhook_order_number === "string"
      ? order.specs.webhook_order_number.trim()
      : "";
  if (webhook) return webhook;

  // e.g. "ORD-2026-0098-1" or "0098-1" → drop trailing part index
  const match = order.title.trim().match(/^(.+)-(\d+)$/);
  if (match) return match[1];

  return order.title.trim() || "Untitled order";
}

async function resolveCustomerName(
  client: Client,
  tenantId: string,
  order: {
    id: string;
    customer_id?: string | null;
    title?: string;
  }
): Promise<string> {
  if (order.customer_id) {
    const { data } = await client
      .from("customers")
      .select("name")
      .eq("id", order.customer_id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    const name = (data as { name?: string } | null)?.name?.trim();
    if (name) return name;
  }

  const { data: field } = await client
    .from("custom_fields")
    .select("id")
    .eq("tenant_id", tenantId)
    .ilike("name", CUSTOMER_NAME_FIELD_NAME)
    .maybeSingle();
  const fieldId = (field as { id: string } | null)?.id;
  if (fieldId) {
    const { data: valueRow } = await client
      .from("custom_field_values")
      .select("value")
      .eq("order_id", order.id)
      .eq("custom_field_id", fieldId)
      .maybeSingle();
    const raw = (valueRow as { value?: unknown } | null)?.value;
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }

  return "Unknown Customer";
}

async function upsertArtworkLink(
  client: Client,
  tenantId: string,
  orderIds: string[],
  url: string
): Promise<void> {
  const { data: field } = await client
    .from("custom_fields")
    .select("id")
    .eq("tenant_id", tenantId)
    .ilike("name", ARTWORK_FIELD_NAME)
    .maybeSingle();
  const fieldId = (field as { id: string } | null)?.id;
  if (!fieldId) {
    console.warn(
      `[gdrive] custom field "${ARTWORK_FIELD_NAME}" not found for tenant ${tenantId}`
    );
    return;
  }

  const rows = orderIds.map((orderId) => ({
    order_id: orderId,
    custom_field_id: fieldId,
    value: url,
  }));

  const { error } = await client
    .from("custom_field_values")
    .upsert(rows, { onConflict: "order_id,custom_field_id" });
  if (error) {
    console.error("[gdrive] failed to save Artwork link", error);
  }
}

export type AttachGdriveResult = {
  linkUrl: string;
  openOnCreate: boolean;
  warning?: string;
};

/**
 * Create `{code}_{Customer}` / `{code}_Final for Prod` and save the link on each card.
 * No-ops when GDrive is disabled or not configured.
 */
export async function attachGdriveFoldersToOrders(
  client: Client,
  tenantId: string,
  orders: Array<{
    id: string;
    title: string;
    customer_id?: string | null;
    specs?: Record<string, unknown> | null;
  }>
): Promise<AttachGdriveResult | null> {
  if (orders.length === 0) return null;

  let settings;
  try {
    settings = await ensureGdriveSettings(client, tenantId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      message.includes("gdrive_settings") ||
      message.includes("schema cache") ||
      message.includes("does not exist")
    ) {
      return null;
    }
    console.error("[gdrive] load settings failed", err);
    return null;
  }

  if (!settings.enabled || !isGdriveConfigured(settings)) {
    return null;
  }

  const primary = orders[0];
  const customerName = await resolveCustomerName(client, tenantId, primary);
  const orderKey = orderKeyFromOrder(primary);

  try {
    const refs = await ensureOrderDriveFolders(
      settings,
      customerName,
      orderKey
    );
    await upsertArtworkLink(
      client,
      tenantId,
      orders.map((o) => o.id),
      refs.linkUrl
    );
    return {
      linkUrl: refs.linkUrl,
      openOnCreate: settings.open_on_create,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[gdrive] folder create failed", message);
    return {
      linkUrl: "",
      openOnCreate: false,
      warning: `Google Drive folder could not be created: ${message}`,
    };
  }
}
