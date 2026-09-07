import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ensureWebhookConfig } from "@/lib/webhook-config";
import {
  serializeBazaarPortalInboundKeys,
  parseBazaarPortalInboundKeys,
  parseConnectModeValue,
} from "@/lib/bazaar-portal-keys";
import { notifyBazaarPortalDisconnect } from "@/lib/bazaar-portal-sync";
import { normalizeWebhookSourceStyles } from "@/lib/webhook-source-styles";

function parseOskKeyMap(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return {};
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }

  const asEntries = Array.isArray(raw)
    ? (raw as Array<Record<string, unknown>>).map((r) => ({
        brokerId: String(r.brokerId ?? r.id ?? ""),
        osk: String(r.osk ?? r.key ?? ""),
        label: String(r.label ?? ""),
        mode: parseConnectModeValue(r.mode),
      }))
    : raw && typeof raw === "object"
      ? Object.entries(raw as Record<string, unknown>).map(([brokerId, v]) => {
          if (typeof v === "string") {
            return { brokerId, osk: v, label: "" };
          }
          if (v && typeof v === "object" && !Array.isArray(v)) {
            const o = v as Record<string, unknown>;
            return {
              brokerId,
              osk: String(o.osk ?? o.key ?? ""),
              label: String(o.label ?? ""),
              mode: parseConnectModeValue(o.mode),
            };
          }
          return { brokerId, osk: "", label: "" };
        })
      : null;

  if (!asEntries) return null;
  return serializeBazaarPortalInboundKeys(asEntries);
}

function isAllowedBazaarApiUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === "https:") return true;
    if (
      u.protocol === "http:" &&
      (u.hostname === "localhost" || u.hostname === "127.0.0.1")
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const supabase = await createClient();
  try {
    const config = await ensureWebhookConfig(supabase, ctx.tenant.id);
    return NextResponse.json({ config });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load config";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    enabled?: boolean;
    excluded_products?: unknown;
    source_styles?: unknown;
    label?: unknown;
    bazaar_api_url?: unknown;
    bazaar_portal_inbound_keys?: unknown;
    bazaar_portal_sync_enabled?: unknown;
    bazaar_connect_secret?: unknown;
  };

  const hasBazaarUpdate =
    body.bazaar_api_url !== undefined ||
    body.bazaar_portal_inbound_keys !== undefined ||
    body.bazaar_portal_sync_enabled !== undefined ||
    body.bazaar_connect_secret !== undefined;

  const isExclusionUpdate =
    body.enabled === undefined &&
    Array.isArray(body.excluded_products) &&
    body.source_styles === undefined &&
    !hasBazaarUpdate;
  const isSourceStylesUpdate =
    body.enabled === undefined &&
    body.excluded_products === undefined &&
    body.source_styles !== undefined &&
    !hasBazaarUpdate;

  if (
    !isExclusionUpdate &&
    !isSourceStylesUpdate &&
    !hasBazaarUpdate &&
    typeof body.enabled !== "boolean"
  ) {
    return NextResponse.json(
      { error: "enabled must be a boolean" },
      { status: 400 }
    );
  }

  const updates: Record<string, unknown> = {};
  if (typeof body.enabled === "boolean") updates.enabled = body.enabled;
  if (Array.isArray(body.excluded_products)) {
    updates.excluded_products = (body.excluded_products as unknown[]).filter(
      (v) => typeof v === "string"
    );
  }
  if (body.source_styles !== undefined) {
    updates.source_styles = normalizeWebhookSourceStyles(body.source_styles);
  }

  if (body.bazaar_api_url !== undefined) {
    if (body.bazaar_api_url === null || body.bazaar_api_url === "") {
      updates.bazaar_api_url = null;
    } else if (typeof body.bazaar_api_url === "string") {
      const url = body.bazaar_api_url.trim().replace(/\/$/, "");
      if (!isAllowedBazaarApiUrl(url)) {
        return NextResponse.json(
          {
            error:
              "bazaar_api_url must be https://… or http://localhost (local portal tests)",
          },
          { status: 400 }
        );
      }
      updates.bazaar_api_url = url;
    } else {
      return NextResponse.json(
        { error: "bazaar_api_url must be a string or null" },
        { status: 400 }
      );
    }
  }

  if (body.bazaar_portal_inbound_keys !== undefined) {
    const map = parseOskKeyMap(body.bazaar_portal_inbound_keys);
    if (map == null) {
      return NextResponse.json(
        {
          error:
            "bazaar_portal_inbound_keys must be an object of brokerId → osk_… (or { osk, label })",
        },
        { status: 400 }
      );
    }
    updates.bazaar_portal_inbound_keys = map;
  }

  if (body.bazaar_portal_sync_enabled !== undefined) {
    if (typeof body.bazaar_portal_sync_enabled !== "boolean") {
      return NextResponse.json(
        { error: "bazaar_portal_sync_enabled must be a boolean" },
        { status: 400 }
      );
    }
    updates.bazaar_portal_sync_enabled = body.bazaar_portal_sync_enabled;
  }

  if (body.bazaar_connect_secret !== undefined) {
    if (body.bazaar_connect_secret === null || body.bazaar_connect_secret === "") {
      updates.bazaar_connect_secret = null;
    } else if (typeof body.bazaar_connect_secret === "string") {
      const secret = body.bazaar_connect_secret.trim();
      updates.bazaar_connect_secret = secret || null;
    } else {
      return NextResponse.json(
        { error: "bazaar_connect_secret must be a string or null" },
        { status: 400 }
      );
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "No valid fields to update" },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  await ensureWebhookConfig(supabase, ctx.tenant.id);

  if (updates.bazaar_portal_inbound_keys !== undefined) {
    const { data: existing } = await supabase
      .from("webhook_configs")
      .select("bazaar_portal_inbound_keys, bazaar_api_url")
      .eq("tenant_id", ctx.tenant.id)
      .maybeSingle();
    const prev = parseBazaarPortalInboundKeys(
      existing?.bazaar_portal_inbound_keys
    );
    const next = parseBazaarPortalInboundKeys(
      updates.bazaar_portal_inbound_keys
    );
    const apiUrl =
      typeof updates.bazaar_api_url === "string"
        ? updates.bazaar_api_url
        : typeof existing?.bazaar_api_url === "string"
          ? existing.bazaar_api_url
          : "";
    for (const [id, osk] of Object.entries(prev.keys)) {
      if (next.keys[id] || !osk.startsWith("osk_") || !apiUrl.trim()) continue;
      await notifyBazaarPortalDisconnect({
        bazaarApiUrl: apiUrl,
        oskKey: osk,
      });
    }
  }

  let { data, error } = await supabase
    .from("webhook_configs")
    .update(updates)
    .eq("tenant_id", ctx.tenant.id)
    .select("*")
    .single();

  if (
    error &&
    updates.bazaar_connect_secret !== undefined &&
    /bazaar_connect_secret/i.test(error.message)
  ) {
    delete updates.bazaar_connect_secret;
    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        {
          error:
            "Apply migration 0098_bazaar_connect_secret.sql to save the handshake secret. Paste sync still works.",
        },
        { status: 400 }
      );
    }
    const retry = await supabase
      .from("webhook_configs")
      .update(updates)
      .eq("tenant_id", ctx.tenant.id)
      .select("*")
      .single();
    data = retry.data;
    error = retry.error;
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const row = data as Record<string, unknown>;
  const parsedKeys = parseBazaarPortalInboundKeys(row.bazaar_portal_inbound_keys);
  return NextResponse.json({
    config: {
      ...row,
      bazaar_portal_inbound_keys: parsedKeys.keys,
      bazaar_portal_partner_labels: parsedKeys.labels,
      bazaar_portal_partner_modes: parsedKeys.modes,
      bazaar_portal_sync_enabled: row.bazaar_portal_sync_enabled === true,
      bazaar_connect_secret:
        typeof row.bazaar_connect_secret === "string" &&
        row.bazaar_connect_secret.trim()
          ? row.bazaar_connect_secret
          : null,
    },
  });
}
