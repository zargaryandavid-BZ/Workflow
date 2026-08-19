import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { hasCatalogV2Schema } from "@/lib/crm-catalog-v2";
import type { IntegrationMode } from "@/lib/types";

function isIntegrationMode(value: unknown): value is IntegrationMode {
  return value === "local" || value === "connected";
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
    integration_mode?: unknown;
    crm_catalog_url?: unknown;
  };

  const patch: Record<string, string | null> = {};

  if (body.crm_catalog_url !== undefined) {
    if (body.crm_catalog_url !== null && typeof body.crm_catalog_url !== "string") {
      return NextResponse.json(
        { error: "crm_catalog_url must be a string" },
        { status: 400 }
      );
    }
    const url =
      typeof body.crm_catalog_url === "string" ? body.crm_catalog_url.trim() : "";
    patch.crm_catalog_url = url || null;
    // Keep the older import-url column in sync so there is only one catalog URL.
    patch.catalog_import_url = url || null;
  }

  if (body.integration_mode !== undefined) {
    if (!isIntegrationMode(body.integration_mode)) {
      return NextResponse.json(
        { error: "integration_mode must be local or connected" },
        { status: 400 }
      );
    }
    patch.integration_mode = body.integration_mode;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const supabase = await createClient();

  if (patch.integration_mode === "connected") {
    const { data: cache } = await supabase
      .from("catalog_cache")
      .select("payload")
      .eq("tenant_id", ctx.tenant.id)
      .maybeSingle();
    if (!cache || !hasCatalogV2Schema(cache.payload)) {
      return NextResponse.json(
        {
          error:
            "Refresh a v2 CRM catalog before switching to Connected mode.",
        },
        { status: 400 }
      );
    }
  }

  const { error } = await supabase
    .from("tenants")
    .update(patch)
    .eq("id", ctx.tenant.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, ...patch });
}
