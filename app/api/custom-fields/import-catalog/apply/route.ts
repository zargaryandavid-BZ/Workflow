import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { CATALOG_FIELD_TARGETS } from "@/lib/import-catalog";
import {
  applyCatalogReviewToOptions,
  type CatalogFieldKey,
} from "@/lib/import-catalog-review";

export const maxDuration = 30;

type ApplyBody = {
  groups?: {
    fieldKey: CatalogFieldKey;
    ours: string[];
    catalog: string[];
    keep: string[];
  }[];
  add?: { fieldKey: CatalogFieldKey; value: string }[];
};

/**
 * Apply user-reviewed catalog import decisions to Category / Product / Materials.
 */
export async function POST(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as ApplyBody;
  const groups = Array.isArray(body.groups) ? body.groups : [];
  const add = Array.isArray(body.add) ? body.add : [];

  const supabase = await createClient();
  const tenantId = ctx.tenant.id;

  const { data: existingFields, error: listError } = await supabase
    .from("custom_fields")
    .select("id, name, field_type, options, position")
    .eq("tenant_id", tenantId);

  if (listError) {
    return NextResponse.json({ error: listError.message }, { status: 400 });
  }

  const fields = (existingFields ?? []) as {
    id: string;
    name: string;
    field_type: string;
    options: string[] | null;
    position: number;
  }[];

  let nextPosition =
    fields.reduce((max, f) => Math.max(max, f.position), -1) + 1;

  const summary: Record<
    CatalogFieldKey,
    { total: number; created: boolean }
  > = {
    categories: { total: 0, created: false },
    products: { total: 0, created: false },
    materials: { total: 0, created: false },
  };

  for (const target of CATALOG_FIELD_TARGETS) {
    const fieldGroups = groups.filter((g) => g.fieldKey === target.key);
    const fieldAdd = add
      .filter((a) => a.fieldKey === target.key)
      .map((a) => a.value);

    if (fieldGroups.length === 0 && fieldAdd.length === 0) continue;

    const match = fields.find((f) =>
      target.aliases.includes(f.name.trim().toLowerCase())
    );

    if (match && match.field_type !== "select") {
      return NextResponse.json(
        {
          error: `Field “${match.name}” exists but is not a dropdown — change its type or rename it before importing.`,
        },
        { status: 400 }
      );
    }

    const existing = [...(match?.options ?? [])]
      .map((o) => o.trim())
      .filter(Boolean);

    const options = applyCatalogReviewToOptions({
      existing,
      groups: fieldGroups.map((g) => ({
        ours: g.ours,
        catalog: g.catalog,
        keep: g.keep,
      })),
      add: fieldAdd,
    });

    if (match) {
      const { error } = await supabase
        .from("custom_fields")
        .update({ options })
        .eq("id", match.id)
        .eq("tenant_id", tenantId);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
    } else {
      const { error } = await supabase.from("custom_fields").insert({
        tenant_id: tenantId,
        name: target.createName,
        field_type: "select",
        options,
        required: target.key === "products",
        position: nextPosition++,
      });
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      summary[target.key].created = true;
    }

    summary[target.key].total = options.length;
  }

  return NextResponse.json({
    ok: true,
    categories: summary.categories.total,
    products: summary.products.total,
    materials: summary.materials.total,
    created: Object.entries(summary)
      .filter(([, v]) => v.created)
      .map(([k]) => k),
  });
}
