import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import {
  CATALOG_FIELD_TARGETS,
  mergeFieldOptions,
} from "@/lib/import-catalog";
import { fetchCatalogLists } from "@/lib/import-catalog-fetch";

export const maxDuration = 15;

/**
 * Legacy one-shot import (auto-merge). Prefer analyze → apply for review UI.
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

  let lists;
  try {
    lists = await fetchCatalogLists(body.url);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch catalog";
    const status =
      message.includes("not allowed") || message.includes("Invalid")
        ? 400
        : 502;
    return NextResponse.json({ error: message }, { status });
  }

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

  const result = {
    ok: true as const,
    categories: 0,
    products: 0,
    materials: 0,
    categoriesAdded: 0,
    productsAdded: 0,
    materialsAdded: 0,
    categoriesOverwritten: 0,
    productsOverwritten: 0,
    materialsOverwritten: 0,
    created: [] as string[],
    updated: [] as string[],
  };

  for (const target of CATALOG_FIELD_TARGETS) {
    const incoming = lists[target.key];
    if (incoming.length === 0) continue;

    const match = fields.find((f) =>
      target.aliases.includes(f.name.trim().toLowerCase())
    );

    if (match) {
      if (match.field_type !== "select") {
        return NextResponse.json(
          {
            error: `Field “${match.name}” exists but is not a dropdown — change its type or rename it before importing.`,
          },
          { status: 400 }
        );
      }
      const { options, added, overwritten } = mergeFieldOptions(
        match.options,
        incoming
      );
      const { error } = await supabase
        .from("custom_fields")
        .update({ options })
        .eq("id", match.id)
        .eq("tenant_id", tenantId);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      result.updated.push(match.name);
      if (target.key === "categories") {
        result.categories = options.length;
        result.categoriesAdded = added;
        result.categoriesOverwritten = overwritten;
      } else if (target.key === "products") {
        result.products = options.length;
        result.productsAdded = added;
        result.productsOverwritten = overwritten;
      } else {
        result.materials = options.length;
        result.materialsAdded = added;
        result.materialsOverwritten = overwritten;
      }
      continue;
    }

    const { options, added } = mergeFieldOptions([], incoming);
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
    result.created.push(target.createName);
    if (target.key === "categories") {
      result.categories = options.length;
      result.categoriesAdded = added;
    } else if (target.key === "products") {
      result.products = options.length;
      result.productsAdded = added;
    } else {
      result.materials = options.length;
      result.materialsAdded = added;
    }
  }

  return NextResponse.json(result);
}
