import type {
  CrmSpec,
  CrmSpecOption,
  CrmSpecType,
  CrmSnapshot,
} from "./types.ts";
import { productCatalogAliases } from "./product-spec-options.ts";

export const CRM_V2_SCHEMA_ERROR =
  "CRM catalog does not support v2 schema. Upgrade CRM first.";

export const CRM_SPEC_TYPES: readonly CrmSpecType[] = [
  "text",
  "number",
  "select",
  "multi_select",
  "dimensions",
  "boolean",
];

export type CatalogV2SpecDef = {
  key: string;
  label: string;
  type: CrmSpecType;
  options?: CrmSpecOption[];
};

export type CatalogV2Product = {
  id: string;
  name: string;
  specifications: CatalogV2SpecDef[];
};

export type CatalogV2 = {
  schema_version: 2;
  products: CatalogV2Product[];
  raw: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asSpecType(value: unknown): CrmSpecType {
  if (typeof value === "string") {
    const lower = value.trim().toLowerCase().replace(/-/g, "_");
    if ((CRM_SPEC_TYPES as readonly string[]).includes(lower)) {
      return lower as CrmSpecType;
    }
    if (lower === "checkbox" || lower === "toggle" || lower === "bool") {
      return "boolean";
    }
    if (lower === "dropdown") return "select";
    if (lower === "multiselect" || lower === "multi select") {
      return "multi_select";
    }
    if (lower === "size" || lower === "dimension") return "dimensions";
  }
  return "text";
}

function parseOptions(raw: unknown): CrmSpecOption[] {
  if (!Array.isArray(raw)) return [];
  const out: CrmSpecOption[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const label =
      asString(item.label) ??
      asString(item.name) ??
      asString(item.value);
    if (!label) continue;
    const optionId =
      asString(item.option_id) ??
      asString(item.id) ??
      asString(item.value) ??
      label;
    out.push({ option_id: optionId, label });
  }
  return out;
}

function parseSpecDef(raw: unknown): CatalogV2SpecDef | null {
  if (!isRecord(raw)) return null;
  const key = asString(raw.key) ?? asString(raw.id) ?? asString(raw.name);
  if (!key) return null;
  const label = asString(raw.label) ?? asString(raw.name) ?? humanizeKey(key);
  const options = parseOptions(raw.options);
  return {
    key,
    label,
    type: asSpecType(raw.type),
    ...(options.length > 0 ? { options } : {}),
  };
}

function parseSpecDefList(raw: unknown): CatalogV2SpecDef[] {
  if (!Array.isArray(raw)) return [];
  const out: CatalogV2SpecDef[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    // v1 catalogs store `fields` as string keys — skip those.
    if (typeof item === "string") continue;
    const def = parseSpecDef(item);
    if (!def || seen.has(def.key)) continue;
    seen.add(def.key);
    out.push(def);
  }
  return out;
}

function productSpecifications(product: Record<string, unknown>): CatalogV2SpecDef[] {
  const fromSpecs = parseSpecDefList(product.specifications);
  if (fromSpecs.length > 0) return fromSpecs;
  const fromSpecFields = parseSpecDefList(product.spec_fields);
  if (fromSpecFields.length > 0) return fromSpecFields;
  const fromFields = parseSpecDefList(product.fields);
  if (fromFields.length > 0) return fromFields;
  return specsFromOptionsBag(product.options);
}

function specsFromOptionsBag(raw: unknown): CatalogV2SpecDef[] {
  if (!isRecord(raw)) return [];
  const fo = raw.field_options;
  if (!isRecord(fo)) return [];
  const out: CatalogV2SpecDef[] = [];
  for (const [key, optionsRaw] of Object.entries(fo)) {
    const options = parseOptions(optionsRaw);
    out.push({
      key,
      label: humanizeKey(key),
      type: "select",
      ...(options.length > 0 ? { options } : {}),
    });
  }
  return out;
}

export function humanizeKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function hasCatalogV2Schema(payload: unknown): boolean {
  if (!isRecord(payload)) return false;
  return payload.schema_version === 2;
}

export function catalogProductCount(payload: unknown): number {
  if (!isRecord(payload) || !Array.isArray(payload.products)) return 0;
  return payload.products.length;
}

/**
 * Strict v2 gate: `schema_version === 2` required.
 * Returns a normalized product list for UI; the raw payload is still stored.
 */
export function parseCatalogV2(payload: unknown): CatalogV2 {
  if (!hasCatalogV2Schema(payload)) {
    throw new Error(CRM_V2_SCHEMA_ERROR);
  }
  const record = payload as Record<string, unknown>;
  const products: CatalogV2Product[] = [];
  if (Array.isArray(record.products)) {
    for (const item of record.products) {
      if (!isRecord(item)) continue;
      const name = asString(item.name);
      if (!name) continue;
      const id = asString(item.id) ?? name;
      products.push({
        id,
        name,
        specifications: productSpecifications(item),
      });
    }
  }
  return { schema_version: 2, products, raw: payload };
}

export function findCatalogProduct(
  catalog: CatalogV2 | null | undefined,
  productId?: string | null,
  productName?: string | null
): CatalogV2Product | null {
  if (!catalog) return null;
  const id = productId?.trim();
  if (id) {
    const byId = catalog.products.find((p) => p.id === id);
    if (byId) return byId;
  }
  const name = productName?.trim();
  if (!name) return null;
  const exact = catalog.products.find((p) => p.name === name);
  if (exact) return exact;
  const aliases = new Set(productCatalogAliases(name));
  return (
    catalog.products.find((p) =>
      productCatalogAliases(p.name).some((alias) => aliases.has(alias))
    ) ?? null
  );
}

export function findSpecDef(
  product: CatalogV2Product | null | undefined,
  key: string
): CatalogV2SpecDef | null {
  if (!product) return null;
  return product.specifications.find((s) => s.key === key) ?? null;
}

export function findSpecOptions(
  catalog: CatalogV2 | null | undefined,
  productId: string | null | undefined,
  productName: string | null | undefined,
  specKey: string
): CrmSpecOption[] {
  const product = findCatalogProduct(catalog, productId, productName);
  return findSpecDef(product, specKey)?.options ?? [];
}

export function parseCrmSnapshot(raw: unknown): CrmSnapshot | null {
  if (!isRecord(raw)) return null;
  const items = Array.isArray(raw.line_items) ? raw.line_items : [];
  return {
    line_items: items.filter(isRecord).map((item) => {
      const product = isRecord(item.product) ? item.product : null;
      return {
        product_id:
          asString(item.product_id) ??
          (product ? asString(product.id) : null),
        product_name:
          asString(item.product_name) ??
          asString(item.name) ??
          (product ? asString(product.name) : null),
        specifications: parseSnapshotSpecs(item.specifications),
      };
    }),
  };
}

function parseSnapshotSpecs(raw: unknown): CrmSpec[] {
  if (!Array.isArray(raw)) return [];
  const out: CrmSpec[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const key = asString(item.key);
    if (!key) continue;
    const label = asString(item.label) ?? humanizeKey(key);
    const display =
      item.display_value == null ? null : String(item.display_value);
    out.push({
      key,
      label,
      type: asSpecType(item.type),
      display_value: display,
      value: item.value,
    });
  }
  return out;
}

export function specsFromCatalogProduct(
  product: CatalogV2Product,
  values: Record<string, { display_value: string; value: unknown }>
): CrmSpec[] {
  return product.specifications.map((def) => {
    const filled = values[def.key];
    return {
      key: def.key,
      label: def.label,
      type: def.type,
      display_value: filled?.display_value ?? null,
      value: filled?.value ?? null,
    };
  });
}

export function buildCrmSnapshot(
  product: CatalogV2Product,
  values: Record<string, { display_value: string; value: unknown }>
): CrmSnapshot {
  return {
    line_items: [
      {
        product_id: product.id,
        product_name: product.name,
        specifications: specsFromCatalogProduct(product, values),
      },
    ],
  };
}
