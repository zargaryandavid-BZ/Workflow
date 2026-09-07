/**
 * Bazaar Admin one-click handshake. Writes the same webhook_configs columns
 * as Settings → paste. Does not touch ingest or notifyBazaarPortalStatus.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "crypto";
import { configuredAppUrl } from "@/lib/app-url";
import { parseBazaarPortalInboundKeys } from "@/lib/bazaar-portal-keys";
import { ensureWebhookConfig } from "@/lib/webhook-config";
import {
  DEFAULT_WEBHOOK_SOURCE_STYLES,
  ensurePortalSourceStyle,
  normalizeWebhookSourceStyles,
} from "@/lib/webhook-source-styles";
import {
  BAZAAR_CONNECT_HEADER,
  BazaarConnectError,
  answersTenantId,
  isAllowedBazaarConnectUrl,
  parseBrokerId,
  parseConnectIntent,
  parseConnectMode,
  partnerLabelFromBody,
  removePartnerKey,
  resolveConnectTenant,
  upsertPartnerKeyMap,
  type ConnectNeedField,
  type TenantResolve,
} from "@/lib/bazaar-connect-core";

export {
  BAZAAR_CONNECT_HEADER,
  BazaarConnectError,
  connectJsonError,
  isAllowedBazaarConnectUrl,
  parseBrokerId,
  parseConnectIntent,
  parseConnectMode,
  removePartnerKey,
  resolveConnectTenant,
  upsertPartnerKeyMap,
} from "@/lib/bazaar-connect-core";
export type {
  ConnectMode,
  ConnectNeedField,
  TenantResolve,
} from "@/lib/bazaar-connect-core";

type Client = SupabaseClient;

export function generateBazaarConnectSecret(): string {
  const bytes = randomBytes(24);
  return `bcs_${bytes.toString("base64url")}`;
}

export function outboundWebhookUrl(): string {
  const base =
    configuredAppUrl() ||
    (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(
      /\/$/,
      ""
    );
  return `${base || "http://localhost:3000"}/api/webhook/orders`;
}

async function loadResolveInputs(client: Client): Promise<{
  tenantSecrets: Array<{ tenantId: string; secret: string | null }>;
  tenants: Array<{ id: string; name: string }>;
}> {
  const [{ data: rows }, { data: tenants }] = await Promise.all([
    client.from("webhook_configs").select("tenant_id, bazaar_connect_secret"),
    client.from("tenants").select("id, name").order("name"),
  ]);

  return {
    tenantSecrets: (rows ?? []).map((row) => ({
      tenantId: String((row as { tenant_id: string }).tenant_id),
      secret:
        typeof (row as { bazaar_connect_secret?: unknown })
          .bazaar_connect_secret === "string"
          ? (row as { bazaar_connect_secret: string }).bazaar_connect_secret
          : null,
    })),
    tenants: (tenants ?? []).map((t) => ({
      id: String((t as { id: string }).id),
      name:
        typeof (t as { name?: unknown }).name === "string" &&
        (t as { name: string }).name.trim()
          ? (t as { name: string }).name.trim()
          : "Board",
    })),
  };
}

export async function resolveHandshakeTenant(
  client: Client,
  providedSecret: string
): Promise<TenantResolve> {
  const { tenantSecrets, tenants } = await loadResolveInputs(client);
  return resolveConnectTenant({
    providedSecret,
    tenantSecrets,
    envSecret: process.env.BAZAAR_CONNECT_SECRET ?? null,
    tenants,
  });
}

function requireResolvedTenant(
  resolved: TenantResolve,
  body: unknown
): string {
  if (resolved.kind === "unauthorized") {
    throw new BazaarConnectError(401, "unauthorized");
  }
  if (resolved.kind === "tenant") return resolved.tenantId;

  const picked = answersTenantId(body);
  if (!picked || !resolved.tenants.some((t) => t.id === picked)) {
    throw new BazaarConnectError(400, "missing_tenant");
  }
  return picked;
}

export async function handleBazaarConnectBegin(
  client: Client,
  providedSecret: string,
  body: unknown
): Promise<{ needs: ConnectNeedField[]; alreadyConnected?: boolean }> {
  parseConnectIntent(body);
  parseConnectMode(body);
  const resolved = await resolveHandshakeTenant(client, providedSecret);

  if (resolved.kind === "unauthorized") {
    throw new BazaarConnectError(401, "unauthorized");
  }

  if (resolved.kind === "picker") {
    return {
      needs: [
        {
          id: "tenantId",
          label: "Workflow board / tenant",
          type: "select",
          required: true,
          options: resolved.tenants.map((t) => ({
            value: t.id,
            label: t.name,
          })),
        },
      ],
    };
  }

  const brokerId = parseBrokerId(body);
  const cfg = await ensureWebhookConfig(client, resolved.tenantId);
  const already =
    brokerId.length > 0 && Boolean(cfg.bazaar_portal_inbound_keys?.[brokerId]);

  return already ? { needs: [], alreadyConnected: true } : { needs: [] };
}

export async function handleBazaarConnectComplete(
  client: Client,
  providedSecret: string,
  body: unknown
): Promise<
  { ok: true } | { ok: true; outboundUrl: string; outboundSecret: string }
> {
  parseConnectIntent(body);
  const mode = parseConnectMode(body);
  const resolved = await resolveHandshakeTenant(client, providedSecret);
  const tenantId = requireResolvedTenant(resolved, body);

  const brokerId = parseBrokerId(body);
  const inboundKey =
    body && typeof body === "object"
      ? (body as { inboundKey?: unknown }).inboundKey
      : undefined;
  const key = typeof inboundKey === "string" ? inboundKey.trim() : "";
  if (!brokerId || !key.startsWith("osk_")) {
    throw new BazaarConnectError(400, "invalid_inbound_key");
  }

  const rawUrl =
    body && typeof body === "object"
      ? (body as { bazaarApiUrl?: unknown }).bazaarApiUrl
      : undefined;
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    throw new BazaarConnectError(400, "invalid_bazaar_url");
  }
  const bazaarApiUrl = rawUrl.trim().replace(/\/$/, "");
  if (!isAllowedBazaarConnectUrl(bazaarApiUrl)) {
    throw new BazaarConnectError(400, "invalid_bazaar_url");
  }

  const cfg = await ensureWebhookConfig(client, tenantId);
  const { data: row } = await client
    .from("webhook_configs")
    .select("id, bazaar_portal_inbound_keys, source_styles")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const nextKeys = upsertPartnerKeyMap(
    row?.bazaar_portal_inbound_keys,
    brokerId,
    key,
    partnerLabelFromBody(body),
    mode
  );
  const nextStyles = ensurePortalSourceStyle(
    normalizeWebhookSourceStyles(
      row?.source_styles ?? cfg.source_styles ?? DEFAULT_WEBHOOK_SOURCE_STYLES
    )
  );

  const { error } = await client
    .from("webhook_configs")
    .update({
      bazaar_portal_inbound_keys: nextKeys,
      bazaar_api_url: bazaarApiUrl,
      bazaar_portal_sync_enabled: true,
      source_styles: nextStyles,
    })
    .eq("tenant_id", tenantId);

  if (error) {
    throw new Error(error.message);
  }

  if (mode === "receive_only") {
    return { ok: true };
  }

  return {
    ok: true,
    outboundUrl: outboundWebhookUrl(),
    outboundSecret: cfg.secret_key,
  };
}

export async function handleBazaarConnectDisconnect(
  client: Client,
  providedSecret: string,
  body: unknown
): Promise<{ ok: true }> {
  parseConnectIntent(body);
  const resolved = await resolveHandshakeTenant(client, providedSecret);
  if (resolved.kind === "unauthorized") {
    throw new BazaarConnectError(401, "unauthorized");
  }

  const tenantId =
    resolved.kind === "picker"
      ? requireResolvedTenant(resolved, body)
      : resolved.tenantId;

  const brokerId = parseBrokerId(body);
  await removePartnerFromTenant(client, tenantId, brokerId);
  return { ok: true };
}

export async function removePartnerFromTenant(
  client: Client,
  tenantId: string,
  brokerId: string
): Promise<{
  empty: boolean;
  osk: string | null;
  bazaarApiUrl: string | null;
}> {
  const id = brokerId.trim();
  const { data: row } = await client
    .from("webhook_configs")
    .select("bazaar_portal_inbound_keys, bazaar_api_url")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!row || !id) {
    return { empty: true, osk: null, bazaarApiUrl: null };
  }

  const parsed = parseBazaarPortalInboundKeys(row.bazaar_portal_inbound_keys);
  const osk = parsed.keys[id] ?? null;
  const { next, empty } = removePartnerKey(row.bazaar_portal_inbound_keys, id);

  const updates: Record<string, unknown> = {
    bazaar_portal_inbound_keys: next,
  };
  if (empty) {
    updates.bazaar_portal_sync_enabled = false;
  }

  const { error } = await client
    .from("webhook_configs")
    .update(updates)
    .eq("tenant_id", tenantId);

  if (error) {
    throw new Error(error.message);
  }

  return {
    empty,
    osk,
    bazaarApiUrl:
      typeof row.bazaar_api_url === "string" && row.bazaar_api_url.trim()
        ? row.bazaar_api_url.trim()
        : null,
  };
}

export function readConnectSecret(request: Request): string {
  return request.headers.get(BAZAAR_CONNECT_HEADER)?.trim() ?? "";
}
