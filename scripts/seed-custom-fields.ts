/**
 * One-time (re-runnable) seed for Product and Materials custom field dropdowns.
 *
 * Usage:
 *   npx tsx scripts/seed-custom-fields.ts
 *   SEED_TENANT_SLUG=bazaarprinting npx tsx scripts/seed-custom-fields.ts
 *   SEED_TENANT_ID=<uuid> npx tsx scripts/seed-custom-fields.ts
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { MATERIALS, PRODUCTS } from "../lib/product-data";

const FIELD_TARGETS: { name: string; options: string[] }[] = [
  { name: "Product", options: [...PRODUCTS] },
  { name: "Materials", options: [...MATERIALS] },
];

function loadEnvLocal() {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // .env.local optional if vars are already exported
  }
}

function parseOptions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

function mergeOptions(existingOptions: string[], seedOptions: string[]): string[] {
  return Array.from(new Set([...existingOptions, ...seedOptions]));
}

async function resolveTenantId(
  supabase: SupabaseClient,
  slug: string | undefined,
  tenantId: string | undefined
): Promise<{ id: string; name: string; slug: string }> {
  if (tenantId) {
    const { data, error } = await supabase
      .from("tenants")
      .select("id, name, slug")
      .eq("id", tenantId)
      .maybeSingle();
    if (error || !data) {
      throw new Error(error?.message ?? `Tenant not found for id ${tenantId}`);
    }
    return data;
  }

  const targetSlug = slug ?? "bazaarprinting";
  const { data, error } = await supabase
    .from("tenants")
    .select("id, name, slug")
    .eq("slug", targetSlug)
    .maybeSingle();

  if (error || !data) {
    throw new Error(
      error?.message ??
        `Tenant not found for slug "${targetSlug}". Set SEED_TENANT_SLUG or SEED_TENANT_ID.`
    );
  }

  return data;
}

async function nextFieldPosition(
  supabase: SupabaseClient,
  tenantId: string
): Promise<number> {
  const { data } = await supabase
    .from("custom_fields")
    .select("position")
    .eq("tenant_id", tenantId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  return ((data as { position: number } | null)?.position ?? -1) + 1;
}

async function upsertFieldOptions(
  supabase: SupabaseClient,
  tenantId: string,
  field: { name: string; options: string[] }
): Promise<void> {
  const { data: rows, error: lookupError } = await supabase
    .from("custom_fields")
    .select("id, name, options")
    .eq("tenant_id", tenantId)
    .ilike("name", field.name);

  if (lookupError) {
    throw new Error(`Failed to look up "${field.name}": ${lookupError.message}`);
  }

  const existing = (rows ?? []).find(
    (row) =>
      typeof row.name === "string" &&
      row.name.toLowerCase() === field.name.toLowerCase()
  ) as { id: string; options: unknown } | undefined;

  if (existing) {
    const existingOptions = parseOptions(existing.options);
    const merged = mergeOptions(existingOptions, field.options);
    const added = merged.length - existingOptions.length;

    const { error } = await supabase
      .from("custom_fields")
      .update({ options: merged })
      .eq("id", existing.id);

    if (error) {
      throw new Error(`Failed to update "${field.name}": ${error.message}`);
    }

    console.log(
      `✓ Updated "${field.name}" — ${merged.length} options (${added} new)`
    );
    return;
  }

  const position = await nextFieldPosition(supabase, tenantId);
  const { error } = await supabase.from("custom_fields").insert({
    tenant_id: tenantId,
    name: field.name,
    field_type: "select",
    options: field.options,
    required: true,
    position,
  });

  if (error) {
    throw new Error(`Failed to create "${field.name}": ${error.message}`);
  }

  console.log(`✓ Created "${field.name}" — ${field.options.length} options`);
}

async function main() {
  loadEnvLocal();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
    );
    process.exit(1);
  }

  const supabase = createClient(url, key);
  const tenant = await resolveTenantId(
    supabase,
    process.env.SEED_TENANT_SLUG,
    process.env.SEED_TENANT_ID
  );

  console.log(
    `Seeding custom fields for tenant: ${tenant.name} (${tenant.slug}, ${tenant.id})`
  );

  for (const field of FIELD_TARGETS) {
    await upsertFieldOptions(supabase, tenant.id, field);
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error("Seed failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
