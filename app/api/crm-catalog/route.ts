import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { fetchCatalogJson } from "@/lib/import-catalog-fetch";
import { nestedFieldOptions } from "@/lib/product-spec-options";

/**
 * GET /api/crm-catalog — proxies the tenant's linked CRM catalog URL
 * (Settings → Fields) so Product / Materials / SET SIZE share one feed.
 */
export const revalidate = 0;

type CrmMaterial = { name?: string };
type CrmGroup = { materials?: CrmMaterial[] };
type CrmToggle = { key?: string; label?: string };
type CrmCategoryRef = { id?: number; name?: string; parent_id?: number | null };
type CrmProduct = {
  id?: string;
  slug?: string;
  name?: string;
  category_id?: number | null;
  category?: CrmCategoryRef | string | null;
  material_groups?: CrmGroup[];
  materials?: Array<string | CrmMaterial>;
  field_options?: Record<string, unknown>;
  options?: {
    field_options?: Record<string, unknown>;
    option_toggles?: CrmToggle[];
  };
  option_toggles?: CrmToggle[];
};
type CrmCategory = {
  id?: number;
  name?: string;
  sort_order?: number;
  parent_id?: number | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function productCategoryName(
  p: CrmProduct,
  catById: Map<number, string>
): string | undefined {
  if (typeof p.category_id === "number") {
    return catById.get(p.category_id) ?? undefined;
  }
  if (typeof p.category === "string" && p.category.trim()) return p.category.trim();
  if (p.category && typeof p.category === "object" && p.category.name) {
    return p.category.name.trim() || undefined;
  }
  return undefined;
}

function productMaterials(p: CrmProduct): string[] {
  const mats: string[] = [];
  for (const g of p.material_groups ?? []) {
    for (const m of g.materials ?? []) {
      if (m.name && !mats.includes(m.name)) mats.push(m.name);
    }
  }
  if (mats.length > 0) return mats;
  for (const m of p.materials ?? []) {
    const name = typeof m === "string" ? m.trim() : m?.name?.trim();
    if (name && !mats.includes(name)) mats.push(name);
  }
  return mats;
}

function productToggles(p: CrmProduct): { key: string; label: string }[] {
  const raw = Array.isArray(p.option_toggles)
    ? p.option_toggles
    : Array.isArray(p.options?.option_toggles)
      ? p.options.option_toggles
      : [];
  return raw
    .filter((t) => t && t.key && t.label)
    .map((t) => ({ key: String(t.key), label: String(t.label) }));
}

function indexByProduct<T>(
  map: Record<string, T>,
  p: CrmProduct,
  value: T
) {
  if (!p.name) return;
  map[p.name] = value;
  if (p.id && p.id !== p.name) map[p.id] = value;
  if (p.slug && p.slug !== p.name && p.slug !== p.id) map[p.slug] = value;
}

export async function GET() {
  try {
    const ctx = await getTenantContext();
    const linkedUrl =
      (typeof ctx?.tenant.crm_catalog_url === "string"
        ? ctx.tenant.crm_catalog_url.trim()
        : "") ||
      (typeof ctx?.tenant.catalog_import_url === "string"
        ? ctx.tenant.catalog_import_url.trim()
        : "") ||
      null;

    const payload = await fetchCatalogJson(linkedUrl);
    const data = (
      isRecord(payload) ? payload : {}
    ) as {
      categories?: CrmCategory[];
      products?: CrmProduct[];
    };

    const catById = new Map<number, string>();
    for (const c of data.categories ?? []) {
      if (typeof c.id === "number" && c.name) catById.set(c.id, c.name);
    }
    const bySort = (a: CrmCategory, b: CrmCategory) =>
      (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
      (a.name ?? "").localeCompare(b.name ?? "");
    const all = data.categories ?? [];
    const childrenOf = (pid: number) =>
      all.filter((c) => c.parent_id === pid).sort(bySort);
    const categories: string[] = [];
    if (all.length > 0) {
      for (const parent of all.filter((c) => c.parent_id == null).sort(bySort)) {
        if (parent.name) categories.push(parent.name);
        if (typeof parent.id === "number") {
          for (const child of childrenOf(parent.id)) {
            if (child.name) categories.push(child.name);
          }
        }
      }
    }

    const productsByCategory: Record<string, string[]> = {};
    const materialsByProduct: Record<string, string[]> = {};
    const fieldOptionsByProduct: Record<string, Record<string, unknown>> = {};
    const optionTogglesByProduct: Record<string, { key: string; label: string }[]> =
      {};

    for (const p of data.products ?? []) {
      if (!p.name) continue;
      const cat = productCategoryName(p, catById);
      if (cat) {
        (productsByCategory[cat] ??= []).push(p.name);
        if (!categories.includes(cat)) categories.push(cat);
      }
      indexByProduct(materialsByProduct, p, productMaterials(p));
      const fieldOptions = nestedFieldOptions(p as Record<string, unknown>);
      if (fieldOptions) {
        indexByProduct(fieldOptionsByProduct, p, fieldOptions);
      }
      const toggles = productToggles(p);
      if (toggles.length) {
        indexByProduct(optionTogglesByProduct, p, toggles);
      }
    }
    for (const k of Object.keys(productsByCategory)) {
      productsByCategory[k].sort((a, b) => a.localeCompare(b));
    }

    return NextResponse.json(
      {
        version: 1,
        categories,
        productsByCategory,
        materialsByProduct,
        fieldOptionsByProduct,
        optionTogglesByProduct,
      },
      { headers: { "Cache-Control": "private, max-age=60" } }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "crm_catalog_failed" },
      { status: 500 }
    );
  }
}
