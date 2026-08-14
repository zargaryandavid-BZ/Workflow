import { NextResponse } from "next/server";

/**
 * GET /api/crm-catalog — proxies + reshapes the CRM's live product catalog
 * (prod-bazaar-crm /api/catalog) so the order card renders the SAME per-product
 * options as the CRM. Cached server-side; CRM stays the single source of truth,
 * so CRM catalog changes flow through automatically.
 */
export const revalidate = 300;

const CRM_CATALOG_URL =
  process.env.CRM_CATALOG_URL || "https://prod-bazaar-crm.vercel.app/api/catalog";

type CrmMaterial = { name?: string };
type CrmGroup = { materials?: CrmMaterial[] };
type CrmProduct = {
  name?: string;
  category_id?: number | null;
  material_groups?: CrmGroup[];
  field_options?: Record<string, unknown>;
};
type CrmCategory = {
  id?: number;
  name?: string;
  sort_order?: number;
  parent_id?: number | null;
};

export async function GET() {
  try {
    const headers: Record<string, string> = {};
    if (process.env.CATALOG_FEED_TOKEN) {
      headers.authorization = `Bearer ${process.env.CATALOG_FEED_TOKEN}`;
    }
    const res = await fetch(CRM_CATALOG_URL, { headers, next: { revalidate: 300 } });
    if (!res.ok) {
      return NextResponse.json({ error: `crm ${res.status}` }, { status: 502 });
    }
    const data = (await res.json()) as {
      categories?: CrmCategory[];
      products?: CrmProduct[];
    };

    const catById = new Map<number, string>();
    for (const c of data.categories ?? []) {
      if (typeof c.id === "number" && c.name) catById.set(c.id, c.name);
    }
    // Ordered like the CRM picker: top-level categories by sort_order, each
    // immediately followed by its sub-categories (Apparel → Tees & Polos, …).
    const bySort = (a: CrmCategory, b: CrmCategory) =>
      (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
      (a.name ?? "").localeCompare(b.name ?? "");
    const all = data.categories ?? [];
    const childrenOf = (pid: number) =>
      all.filter((c) => c.parent_id === pid).sort(bySort);
    const categories: string[] = [];
    for (const parent of all.filter((c) => c.parent_id == null).sort(bySort)) {
      if (parent.name) categories.push(parent.name);
      if (typeof parent.id === "number") {
        for (const child of childrenOf(parent.id)) {
          if (child.name) categories.push(child.name);
        }
      }
    }

    const productsByCategory: Record<string, string[]> = {};
    const materialsByProduct: Record<string, string[]> = {};
    const fieldOptionsByProduct: Record<string, Record<string, unknown>> = {};

    for (const p of data.products ?? []) {
      if (!p.name) continue;
      const cat =
        typeof p.category_id === "number" ? catById.get(p.category_id) : undefined;
      if (cat) (productsByCategory[cat] ??= []).push(p.name);
      const mats: string[] = [];
      for (const g of p.material_groups ?? []) {
        for (const m of g.materials ?? []) {
          if (m.name && !mats.includes(m.name)) mats.push(m.name);
        }
      }
      materialsByProduct[p.name] = mats;
      if (p.field_options) fieldOptionsByProduct[p.name] = p.field_options;
    }
    for (const k of Object.keys(productsByCategory)) {
      productsByCategory[k].sort((a, b) => a.localeCompare(b));
    }

    return NextResponse.json(
      { version: 1, categories, productsByCategory, materialsByProduct, fieldOptionsByProduct },
      { headers: { "Cache-Control": "public, max-age=120, stale-while-revalidate=600" } },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "crm_catalog_failed" },
      { status: 500 },
    );
  }
}
