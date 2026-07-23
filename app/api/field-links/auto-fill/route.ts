import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PRODUCT_CATEGORIES } from "@/lib/product-data";
import { findSelectFieldByName } from "@/lib/field-links";
import type { CustomField } from "@/lib/types";

/** Seed catalog for Product → Materials (intersected with field options). */
const PRODUCT_MATERIALS: Record<string, string[]> = {
  "Roll Labels": ["White BOPP", "Clear BOPP", "Silver BOPP", "Holo BOPP"],
  "Business Cards": ["14pt C1S", "16pt C1S", "18pt C1S"],
  "Vinyl Banners": [
    "13oz Vinyl Banner (Gloss)",
    "13oz Vinyl Banner (Matte)",
  ],
  "Stand Up Pouches": ["Clear PET", "MET PET"],
  "Die Cut Stickers": [
    "White BOPP",
    "Clear BOPP",
    "Gloss Label Sheet",
    "Matte Label Sheet",
  ],
  Flyers: ["100lb Cover", "100lb Text"],
  "Tuck end box": ["14pt C1S", "16pt C1S", "18pt C1S"],
  "Window Decals": [
    "8mil Opaque Window Vinyl (Gloss)",
    "8mil Opaque Window Vinyl (Matte)",
  ],
  "Lay Flat Pouches": ["Clear PET", "MET PET"],
  "Sticker Sheets": ["Gloss Label Sheet", "Matte Label Sheet"],
  Postcards: ["14pt C1S", "16pt C1S"],
  "Folding Cartons / Boxes": ["14pt C1S", "16pt C1S", "18pt C1S"],
};

/** Seed catalog for Product → Finishing (intersected with field options). */
const PRODUCT_FINISHING: Record<string, string[]> = {
  "Business Cards": [
    "Matte Lamination",
    "Gloss Lamination",
    "Soft Touch Lamination",
  ],
  Flyers: ["Matte Lamination", "Gloss Lamination"],
  Postcards: ["Matte Lamination", "Gloss Lamination"],
  "Tuck end box": [
    "Matte Lamination",
    "Gloss Lamination",
    "Soft Touch Lamination",
    "Rainbow Holographic Lamination",
  ],
  "Folding Cartons / Boxes": [
    "Matte Lamination",
    "Gloss Lamination",
    "Soft Touch Lamination",
  ],
  "Roll Labels": ["None"],
  "Stand Up Pouches": ["None"],
  "Die Cut Stickers": ["None"],
  "Sticker Sheets": ["None"],
  "Window Decals": ["None"],
  "Vinyl Banners": ["None"],
  "Lay Flat Pouches": ["None"],
};

async function ensureLink(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  sourceFieldId: string,
  targetFieldId: string
): Promise<string | null> {
  const { data: existing } = await supabase
    .from("field_links")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("source_field_id", sourceFieldId)
    .eq("target_field_id", targetFieldId)
    .maybeSingle();

  if (existing?.id) return existing.id as string;

  const { data, error } = await supabase
    .from("field_links")
    .insert({
      tenant_id: tenantId,
      source_field_id: sourceFieldId,
      target_field_id: targetFieldId,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      const { data: again } = await supabase
        .from("field_links")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("source_field_id", sourceFieldId)
        .eq("target_field_id", targetFieldId)
        .maybeSingle();
      return (again?.id as string | undefined) ?? null;
    }
    throw new Error(error.message);
  }

  return (data?.id as string | undefined) ?? null;
}

async function insertMissingMappings(
  supabase: Awaited<ReturnType<typeof createClient>>,
  linkId: string,
  catalog: Record<string, string[]>,
  sourceOptions: Set<string>,
  targetOptions: Set<string>
): Promise<number> {
  const rows: { link_id: string; source_value: string; target_value: string }[] =
    [];

  for (const [sourceValue, targets] of Object.entries(catalog)) {
    if (!sourceOptions.has(sourceValue)) continue;
    for (const targetValue of targets) {
      if (!targetOptions.has(targetValue)) continue;
      rows.push({
        link_id: linkId,
        source_value: sourceValue,
        target_value: targetValue,
      });
    }
  }

  if (rows.length === 0) return 0;

  const { data, error } = await supabase
    .from("field_link_mappings")
    .upsert(rows, {
      onConflict: "link_id,source_value,target_value",
      ignoreDuplicates: true,
    })
    .select("id");

  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

export async function POST() {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data: fieldsData, error: fieldsError } = await supabase
    .from("custom_fields")
    .select("*")
    .eq("tenant_id", ctx.tenant.id)
    .eq("field_type", "select");

  if (fieldsError) {
    return NextResponse.json({ error: fieldsError.message }, { status: 500 });
  }

  const fields = (fieldsData ?? []) as CustomField[];
  const category = findSelectFieldByName(fields, "Category");
  const product = findSelectFieldByName(fields, "Product");
  const materials = findSelectFieldByName(fields, "Materials");
  const finishing = findSelectFieldByName(fields, "Finishing");

  if (!product) {
    return NextResponse.json(
      { error: 'No dropdown field named "Product" found' },
      { status: 400 }
    );
  }

  let inserted = 0;
  const productOptions = new Set(product.options ?? []);

  try {
    if (category) {
      const linkId = await ensureLink(
        supabase,
        ctx.tenant.id,
        category.id,
        product.id
      );
      if (linkId) {
        const catalog: Record<string, string[]> = {};
        for (const [cat, products] of Object.entries(PRODUCT_CATEGORIES)) {
          catalog[cat] = [...products];
        }
        inserted += await insertMissingMappings(
          supabase,
          linkId,
          catalog,
          new Set(category.options ?? []),
          productOptions
        );
      }
    }

    if (materials) {
      const linkId = await ensureLink(
        supabase,
        ctx.tenant.id,
        product.id,
        materials.id
      );
      if (linkId) {
        inserted += await insertMissingMappings(
          supabase,
          linkId,
          PRODUCT_MATERIALS,
          productOptions,
          new Set(materials.options ?? [])
        );
      }
    }

    if (finishing) {
      const linkId = await ensureLink(
        supabase,
        ctx.tenant.id,
        product.id,
        finishing.id
      );
      if (linkId) {
        inserted += await insertMissingMappings(
          supabase,
          linkId,
          PRODUCT_FINISHING,
          productOptions,
          new Set(finishing.options ?? [])
        );
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Auto-fill failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ inserted });
}
