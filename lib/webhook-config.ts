import { randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WebhookConfig } from "@/lib/types";
import { parseBazaarPortalInboundKeys } from "@/lib/bazaar-portal-keys";
import {
  DEFAULT_WEBHOOK_SOURCE_STYLES,
  ensurePortalSourceStyle,
  normalizeWebhookSourceStyles,
} from "@/lib/webhook-source-styles";

type Client = SupabaseClient;

function asWebhookConfig(row: Record<string, unknown>): WebhookConfig {
  const parsedKeys = parseBazaarPortalInboundKeys(row.bazaar_portal_inbound_keys);
  return {
    ...(row as unknown as WebhookConfig),
    excluded_products: Array.isArray(row.excluded_products)
      ? (row.excluded_products as string[])
      : [],
    source_styles: ensurePortalSourceStyle(
      normalizeWebhookSourceStyles(
        row.source_styles ?? DEFAULT_WEBHOOK_SOURCE_STYLES
      )
    ),
    bazaar_api_url:
      typeof row.bazaar_api_url === "string" ? row.bazaar_api_url : null,
    bazaar_portal_inbound_keys: parsedKeys.keys,
    bazaar_portal_partner_labels: parsedKeys.labels,
    bazaar_portal_sync_enabled: row.bazaar_portal_sync_enabled === true,
  };
}

function sourceStylesMissingPortal(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return true;
  const sources = (raw as { sources?: unknown }).sources;
  if (!Array.isArray(sources)) return true;
  return !sources.some(
    (s) =>
      s &&
      typeof s === "object" &&
      typeof (s as { key?: unknown }).key === "string" &&
      String((s as { key: string }).key).trim().toLowerCase() === "portal"
  );
}

const SECRET_PREFIX = "wh_live_";
const SECRET_RANDOM_LENGTH = 32;
const ALPHANUM =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export function generateWebhookSecret(): string {
  const bytes = randomBytes(SECRET_RANDOM_LENGTH);
  let suffix = "";
  for (let i = 0; i < SECRET_RANDOM_LENGTH; i++) {
    suffix += ALPHANUM[bytes[i]! % ALPHANUM.length];
  }
  return `${SECRET_PREFIX}${suffix}`;
}

export async function ensureWebhookConfig(
  client: Client,
  tenantId: string
): Promise<WebhookConfig> {
  const { data: existing } = await client
    .from("webhook_configs")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (existing) {
    const row = existing as Record<string, unknown>;
    // Persist Portal source label once if missing (migration 0083 + runtime backfill).
    if (sourceStylesMissingPortal(row.source_styles)) {
      const nextStyles = ensurePortalSourceStyle(
        normalizeWebhookSourceStyles(
          row.source_styles ?? DEFAULT_WEBHOOK_SOURCE_STYLES
        )
      );
      const { data: updated, error: updateError } = await client
        .from("webhook_configs")
        .update({ source_styles: nextStyles })
        .eq("id", row.id as string)
        .select("*")
        .single();
      if (!updateError && updated) {
        return asWebhookConfig(updated as Record<string, unknown>);
      }
    }
    return asWebhookConfig(row);
  }

  const { data: created, error } = await client
    .from("webhook_configs")
    .insert({
      tenant_id: tenantId,
      secret_key: generateWebhookSecret(),
    })
    .select("*")
    .single();

  if (error) {
    // Race: another request may have inserted first.
    const { data: retry } = await client
      .from("webhook_configs")
      .select("*")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (retry) return asWebhookConfig(retry as Record<string, unknown>);
    throw new Error(error.message);
  }

  return asWebhookConfig(created as Record<string, unknown>);
}

export async function regenerateWebhookSecret(
  client: Client,
  tenantId: string
): Promise<WebhookConfig> {
  await ensureWebhookConfig(client, tenantId);

  const { data, error } = await client
    .from("webhook_configs")
    .update({ secret_key: generateWebhookSecret() })
    .eq("tenant_id", tenantId)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to regenerate webhook secret");
  }

  return asWebhookConfig(data as Record<string, unknown>);
}

export async function findWebhookConfigBySecret(
  client: Client,
  secretKey: string
): Promise<WebhookConfig | null> {
  const { data } = await client
    .from("webhook_configs")
    .select("*")
    .eq("secret_key", secretKey)
    .maybeSingle();

  if (!data) return null;
  return asWebhookConfig(data as Record<string, unknown>);
}

export async function touchWebhookLastUsed(
  client: Client,
  configId: string
): Promise<void> {
  await client
    .from("webhook_configs")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", configId);
}
