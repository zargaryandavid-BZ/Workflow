/**
 * Remap stored Product values to the linked CRM catalog name (e.g. Labels (Roll)
 * → Roll Labels) and persist SET_SIZE from Width × Height.
 *
 * Usage:
 *   npx tsx scripts/remap-linked-catalog-products.ts
 *   npx tsx scripts/remap-linked-catalog-products.ts --apply
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  findMatchingSetSizeOption,
  formatSetSizeValue,
  isSetSizeKey,
  nestedFieldOptions,
  normalizeSpecSelectOptions,
  preferLinkedCatalogName,
  sameSetSizeValue,
  type SpecSelectOption,
} from "../lib/product-spec-options.ts";

const APPLY = process.argv.includes("--apply");
const PAGE = 200;
const TENANT_NAME = "BazaarPrinting";

function loadEnvLocal() {
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
}

function asStr(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "object" && !Array.isArray(v) && v && "value" in v) {
    return asStr((v as { value: unknown }).value);
  }
  return String(v).trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function fetchAll<T>(
  loadPage: (from: number, to: number) => Promise<T[]>
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const rows = await loadPage(from, from + PAGE - 1);
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

async function catalogProducts(catalogUrl: string): Promise<{
  names: string[];
  setSizeByProduct: Record<string, { key: string; options: SpecSelectOption[] }>;
}> {
  const res = await fetch(catalogUrl, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`catalog ${res.status}`);
  const payload = (await res.json()) as { products?: unknown[] };
  const names: string[] = [];
  const setSizeByProduct: Record<
    string,
    { key: string; options: SpecSelectOption[] }
  > = {};
  for (const raw of payload.products ?? []) {
    if (!isRecord(raw)) continue;
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (!name) continue;
    names.push(name);
    const fo = nestedFieldOptions(raw);
    if (!fo) continue;
    const key = Object.keys(fo).find((k) => isSetSizeKey(k));
    if (!key) continue;
    const options = normalizeSpecSelectOptions(fo[key]);
    if (options.length) setSizeByProduct[name] = { key, options };
  }
  return { names, setSizeByProduct };
}

async function main() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("missing supabase env");
  const sb: SupabaseClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: tenant, error: tErr } = await sb
    .from("tenants")
    .select("id, name, crm_catalog_url, catalog_import_url")
    .eq("name", TENANT_NAME)
    .maybeSingle();
  if (tErr) throw tErr;
  if (!tenant) throw new Error(`tenant ${TENANT_NAME} not found`);

  const catalogUrl =
    (typeof tenant.crm_catalog_url === "string"
      ? tenant.crm_catalog_url.trim()
      : "") ||
    (typeof tenant.catalog_import_url === "string"
      ? tenant.catalog_import_url.trim()
      : "");
  if (!catalogUrl) throw new Error("tenant has no linked catalog URL");

  const { names, setSizeByProduct } = await catalogProducts(catalogUrl);
  console.log(
    APPLY ? "APPLY" : "DRY RUN",
    tenant.name,
    "catalog products",
    names.length,
    "with SET_SIZE",
    Object.keys(setSizeByProduct).length
  );

  const { data: fields, error: fErr } = await sb
    .from("custom_fields")
    .select("id, name, options")
    .eq("tenant_id", tenant.id);
  if (fErr) throw fErr;
  const productField = (fields ?? []).find(
    (f) => String(f.name).toLowerCase() === "product"
  );
  const widthField = (fields ?? []).find(
    (f) => String(f.name).toLowerCase() === "width"
  );
  const heightField = (fields ?? []).find(
    (f) => String(f.name).toLowerCase() === "height"
  );
  if (!productField) throw new Error("Product field missing");

  const productOptions = Array.isArray(productField.options)
    ? productField.options.map((o) => String(o))
    : [];
  const nextProductOptions = productOptions.map(
    (o) => preferLinkedCatalogName(o, names) ?? o
  );
  const optionsChanged =
    JSON.stringify(productOptions) !== JSON.stringify(nextProductOptions);
  if (optionsChanged) {
    console.log("Product field options remap", {
      from: productOptions.filter((o, i) => o !== nextProductOptions[i]),
      to: nextProductOptions.filter((o, i) => o !== productOptions[i]),
    });
    if (APPLY) {
      const { error } = await sb
        .from("custom_fields")
        .update({ options: nextProductOptions })
        .eq("id", productField.id);
      if (error) throw error;
    }
  }

  const { data: productLinks } = await sb
    .from("field_links")
    .select("id")
    .eq("tenant_id", tenant.id)
    .eq("target_field_id", productField.id);
  const linkIds = (productLinks ?? []).map((l) => l.id);
  if (linkIds.length) {
    const mappings = await fetchAll(async (from, to) => {
      const { data, error } = await sb
        .from("field_link_mappings")
        .select("id, link_id, source_value, target_value")
        .in("link_id", linkIds)
        .range(from, to);
      if (error) throw error;
      return data ?? [];
    });
    let mappingUpdates = 0;
    for (const m of mappings) {
      const next = preferLinkedCatalogName(m.target_value, names);
      if (!next || next === m.target_value) continue;
      mappingUpdates += 1;
      if (!APPLY) continue;
      const { error } = await sb
        .from("field_link_mappings")
        .update({ target_value: next })
        .eq("id", m.id);
      if (error) {
        // Unique collision: mapping already exists with catalog name.
        await sb.from("field_link_mappings").delete().eq("id", m.id);
      }
    }
    console.log("field_link_mappings remapped", mappingUpdates);
  }

  const productVals = await fetchAll(async (from, to) => {
    const { data, error } = await sb
      .from("custom_field_values")
      .select("id, order_id, value")
      .eq("custom_field_id", productField.id)
      .range(from, to);
    if (error) throw error;
    return data ?? [];
  });

  const productByOrder = new Map<string, { id: string; value: string }>();
  let productRemaps = 0;
  const remapCounts: Record<string, number> = {};
  for (const row of productVals) {
    const stored = asStr(row.value);
    const next = preferLinkedCatalogName(stored, names);
    productByOrder.set(row.order_id, { id: row.id, value: stored });
    if (!next || next === stored) continue;
    productRemaps += 1;
    const key = `${stored} → ${next}`;
    remapCounts[key] = (remapCounts[key] ?? 0) + 1;
    if (APPLY) {
      const { error } = await sb
        .from("custom_field_values")
        .update({ value: next })
        .eq("id", row.id);
      if (error) throw error;
      productByOrder.set(row.order_id, { id: row.id, value: next });
    } else {
      productByOrder.set(row.order_id, { id: row.id, value: next });
    }
  }
  console.log("product remaps", productRemaps, remapCounts);

  const widthByOrder = new Map<string, string>();
  const heightByOrder = new Map<string, string>();
  if (widthField) {
    const rows = await fetchAll(async (from, to) => {
      const { data, error } = await sb
        .from("custom_field_values")
        .select("order_id, value")
        .eq("custom_field_id", widthField.id)
        .range(from, to);
      if (error) throw error;
      return data ?? [];
    });
    for (const row of rows) widthByOrder.set(row.order_id, asStr(row.value));
  }
  if (heightField) {
    const rows = await fetchAll(async (from, to) => {
      const { data, error } = await sb
        .from("custom_field_values")
        .select("order_id, value")
        .eq("custom_field_id", heightField.id)
        .range(from, to);
      if (error) throw error;
      return data ?? [];
    });
    for (const row of rows) heightByOrder.set(row.order_id, asStr(row.value));
  }

  const orders = await fetchAll(async (from, to) => {
    const { data, error } = await sb
      .from("orders")
      .select("id, title, specs, integration_mode")
      .eq("tenant_id", tenant.id)
      .range(from, to);
    if (error) throw error;
    return data ?? [];
  });

  let setSizeWrites = 0;
  const setSizeSamples: string[] = [];
  for (const order of orders) {
    if (order.integration_mode === "connected") continue;
    const productName =
      productByOrder.get(order.id)?.value ?? "";
    const catalogProduct = preferLinkedCatalogName(productName, names);
    if (!catalogProduct) continue;
    const sizeDef = setSizeByProduct[catalogProduct];
    if (!sizeDef) continue;
    const fromSize = formatSetSizeValue(
      widthByOrder.get(order.id),
      heightByOrder.get(order.id)
    );
    if (!fromSize) continue;
    const matched = findMatchingSetSizeOption(sizeDef.options, fromSize);
    const nextValue = matched?.value ?? fromSize;
    const specs =
      order.specs && typeof order.specs === "object" && !Array.isArray(order.specs)
        ? { ...(order.specs as Record<string, unknown>) }
        : {};
    const selRaw = specs.spec_selections;
    const sel =
      selRaw && typeof selRaw === "object" && !Array.isArray(selRaw)
        ? { ...(selRaw as Record<string, unknown>) }
        : {};
    const current = asStr(sel[sizeDef.key]);
    if (current && sameSetSizeValue(current, nextValue)) continue;
    sel[sizeDef.key] = nextValue;
    specs.spec_selections = sel;
    setSizeWrites += 1;
    if (setSizeSamples.length < 8) {
      setSizeSamples.push(
        `${order.title}: ${productName} ${current || "—"} → ${nextValue}`
      );
    }
    if (APPLY) {
      const { error } = await sb
        .from("orders")
        .update({ specs })
        .eq("id", order.id);
      if (error) throw error;
    }
  }
  console.log("SET_SIZE writes", setSizeWrites, setSizeSamples);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
