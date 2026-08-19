import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { FieldsSettingsClient } from "./fields-settings-client";
import type { CustomField, IntegrationMode } from "@/lib/types";

export default async function FieldsSettingsPage() {
  const ctx = await getTenantContext();
  if (!ctx) return null;
  if (ctx.role !== "admin") redirect("/board");

  const supabase = await createClient();
  const [{ data }, { data: tenantRow }, { data: cacheRow }] = await Promise.all([
    supabase
      .from("custom_fields")
      .select("*")
      .eq("tenant_id", ctx.tenant.id)
      .order("position", { ascending: true }),
    supabase
      .from("tenants")
      .select("catalog_import_url, crm_catalog_url, integration_mode")
      .eq("id", ctx.tenant.id)
      .maybeSingle(),
    supabase
      .from("catalog_cache")
      .select("cached_at")
      .eq("tenant_id", ctx.tenant.id)
      .maybeSingle(),
  ]);

  const row = tenantRow as {
    catalog_import_url?: string | null;
    crm_catalog_url?: string | null;
    integration_mode?: IntegrationMode | null;
  } | null;

  const savedCatalogUrl =
    (typeof row?.crm_catalog_url === "string" ? row.crm_catalog_url.trim() : "") ||
    (typeof row?.catalog_import_url === "string"
      ? row.catalog_import_url.trim()
      : "");
  const integrationMode: IntegrationMode =
    row?.integration_mode === "connected" ? "connected" : "local";
  const catalogCachedAt =
    typeof (cacheRow as { cached_at?: string } | null)?.cached_at === "string"
      ? (cacheRow as { cached_at: string }).cached_at
      : null;

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-800">Custom Fields</h1>
      <p className="mb-5 text-sm text-slate-500">
        Capture print-specific metadata on every job (e.g. Pantone color, bleed,
        finish). These appear on each job&apos;s detail view.
      </p>
      <FieldsSettingsClient
        initialFields={(data ?? []) as CustomField[]}
        catalogUrl={savedCatalogUrl}
        integrationMode={integrationMode}
        catalogCachedAt={catalogCachedAt}
      />
    </div>
  );
}
