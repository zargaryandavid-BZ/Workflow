import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import {
  DEFAULT_CRM_CATALOG_URL,
  fetchCatalogLists,
} from "@/lib/import-catalog-fetch";
import { buildCatalogImportReview } from "@/lib/import-catalog-review";

export const maxDuration = 60;

/**
 * Fetch catalog + compare to tenant fields.
 * On success, remembers the catalog URL on the tenant for next visit.
 */
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
  const resolvedUrl = typedUrl || DEFAULT_CRM_CATALOG_URL;

  let lists;
  try {
    lists = await fetchCatalogLists(typedUrl || null);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch catalog";
    const status =
      message.includes("not allowed") || message.includes("Invalid")
        ? 400
        : 502;
    return NextResponse.json({ error: message }, { status });
  }

  const supabase = await createClient();
  const { data: existingFields, error: listError } = await supabase
    .from("custom_fields")
    .select("id, name, field_type, options, position")
    .eq("tenant_id", ctx.tenant.id);

  if (listError) {
    return NextResponse.json({ error: listError.message }, { status: 400 });
  }

  const review = await buildCatalogImportReview({
    lists,
    fields: (existingFields ?? []) as {
      id: string;
      name: string;
      field_type: string;
      options: string[] | null;
    }[],
  });

  const blocked = review.snapshots.filter((s) => !s.fieldTypeOk);
  if (blocked.length > 0) {
    return NextResponse.json(
      {
        error: `Field “${blocked[0]!.fieldName}” exists but is not a dropdown — change its type or rename it before importing.`,
      },
      { status: 400 }
    );
  }

  // Remember successful URL so the field is pre-filled next time.
  const { error: saveUrlError } = await supabase
    .from("tenants")
    .update({ catalog_import_url: resolvedUrl })
    .eq("id", ctx.tenant.id);
  if (saveUrlError) {
    console.warn(
      "catalog_import_url save failed (run migration 0075?):",
      saveUrlError.message
    );
  }

  return NextResponse.json({
    ok: true,
    aiUsed: review.aiUsed,
    aiConfigured: review.aiConfigured,
    catalogUrl: resolvedUrl,
    catalogUrlSaved: !saveUrlError,
    snapshots: review.snapshots,
    duplicates: review.duplicates,
    additions: review.additions,
  });
}
