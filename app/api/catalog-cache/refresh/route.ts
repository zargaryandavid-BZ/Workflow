import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  DEFAULT_CRM_CATALOG_URL,
  fetchCatalogJson,
} from "@/lib/import-catalog-fetch";
import {
  CRM_V2_SCHEMA_ERROR,
  catalogProductCount,
  parseCatalogV2,
} from "@/lib/crm-catalog-v2";

export const maxDuration = 60;

export async function POST(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { url?: string };
  const typedUrl =
    typeof body.url === "string" && body.url.trim() ? body.url.trim() : "";

  const supabase = await createClient();
  const tenantId = ctx.tenant.id;

  const { data: tenantRow } = await supabase
    .from("tenants")
    .select("crm_catalog_url, catalog_import_url")
    .eq("id", tenantId)
    .maybeSingle();

  const storedUrl =
    (typeof (tenantRow as { crm_catalog_url?: string | null } | null)
      ?.crm_catalog_url === "string"
      ? (tenantRow as { crm_catalog_url: string }).crm_catalog_url.trim()
      : "") ||
    (typeof (tenantRow as { catalog_import_url?: string | null } | null)
      ?.catalog_import_url === "string"
      ? (tenantRow as { catalog_import_url: string }).catalog_import_url.trim()
      : "");
  const resolvedUrl = typedUrl || storedUrl || DEFAULT_CRM_CATALOG_URL;

  if (typedUrl && typedUrl !== storedUrl) {
    const { error: urlError } = await supabase
      .from("tenants")
      .update({
        crm_catalog_url: typedUrl,
        catalog_import_url: typedUrl,
      })
      .eq("id", tenantId);
    if (urlError) {
      return NextResponse.json({ error: urlError.message }, { status: 500 });
    }
  }

  let payload: unknown;
  try {
    payload = await fetchCatalogJson(resolvedUrl);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch catalog";
    const status =
      message.includes("not allowed") || message.includes("Invalid")
        ? 400
        : 502;
    return NextResponse.json({ error: message }, { status });
  }

  try {
    parseCatalogV2(payload);
  } catch (e) {
    const message = e instanceof Error ? e.message : CRM_V2_SCHEMA_ERROR;
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const cachedAt = new Date().toISOString();
  const { error } = await supabase.from("catalog_cache").upsert(
    {
      tenant_id: tenantId,
      cached_at: cachedAt,
      payload,
    },
    { onConflict: "tenant_id" }
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    cached_at: cachedAt,
    product_count: catalogProductCount(payload),
  });
}
