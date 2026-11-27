/**
 * Per-product question rules for the order card editor and admin "+ New card".
 *
 * Hayk 2026-11-26: fixing a spec on a card must work like the CRM quote
 * builder — pick category → product → only that product's questions, in the
 * CRM's order, with that product's materials.
 *
 * `productLineRules()` is a port of the CRM quote builder's
 * `builderLineRules()` (CRM lib/bazaar/quote-builder/line-rules.ts) — the
 * hidden / required / cutting decisions only. Partner dies, die-size queries and
 * the per-line material check are left out (Workflow has no Partner die feed).
 *
 * DISPLAY ONLY: nothing here rewrites stored card values. A field the product
 * hides but that already holds a real value is reported as "saved" so the card
 * keeps showing it (and saving re-sends it untouched).
 *
 * Pure module (relative .ts imports only) — safe on client, server, node --test.
 */
import {
  isCustomFieldRelevant,
  productFamily,
  type ProductFamily,
} from "./spec-row-filter.ts";

export type CatalogFieldDef = { key: string; type: string };

/** One product from /api/crm-catalog `products` (CRM public v1 feed, trimmed). */
export type CatalogProductInfo = {
  id?: string;
  slug?: string;
  name: string;
  category?: string | null;
  /** Typed question list (`options.fields`). Empty = feed has no list. */
  fields?: CatalogFieldDef[];
  hiddenFields?: string[];
  requiredFields?: string[];
  fieldLabels?: Record<string, string>;
  fieldOrder?: string[];
  fieldOptions?: Record<string, unknown> | null;
  toggles?: { key: string; label: string }[];
  materials?: string[];
  finishing?: string[] | null;
  specialEffects?: string[] | null;
};

export type ProductLineRules = {
  dieCatalogName: string | null;
  isLabels: boolean;
  isPouch: boolean;
  isBoxes: boolean;
  isApparel: boolean;
  isDieCategory: boolean;
  isSheetCutting: boolean;
  /** Cutting / Die controls exist for this product. */
  showCutting: boolean;
  /** Generic keys (material, lamination, roll_direction, width, …) to hide. */
  hiddenFields: string[];
  requiredFields: string[];
};

// ── Category helpers ────────────────────────────────────────────────────────

function norm(s: unknown): string {
  return typeof s === "string" ? s.trim().toLowerCase().replace(/\s+/g, " ") : "";
}

/** Same four CRM die-catalog groups as CRM resolvePartnerDieCatalogCategoryName. */
export function dieCatalogCategoryName(category: unknown): string | null {
  const c = norm(category);
  if (!c) return null;
  if (c === "labels & stickers" || c === "labels-stickers") return "labels & stickers";
  if (c === "packaging & boxes" || c === "packaging-boxes" || c === "boxes & sleeves")
    return "packaging & boxes";
  if (c === "marketing materials" || c === "marketing-materials") return "marketing materials";
  if (
    c === "bags & pouches" ||
    c === "bags & flexible packaging" ||
    c === "bags-flexible-packaging"
  )
    return "bags & pouches";
  return null;
}

/** Apparel sub-categories in the v1 feed (parent "Apparel" is not sent by name). */
const APPAREL_CATEGORY_RE =
  /^(apparel|tees? & polos|bottoms|activewear|hoodies & sweatshirts|hats|outerwear|bags & accessories apparel)$/;

export function isApparelCategory(category: unknown): boolean {
  return APPAREL_CATEGORY_RE.test(norm(category));
}

/** Website megamenu order (CRM WEBSITE_CATEGORY_GROUPS), then catalog order. */
const WEBSITE_CATEGORY_ORDER = [
  "labels & stickers",
  "packaging & boxes",
  "bags & pouches",
  "banners & signs",
  "marketing materials",
  "trading cards",
  "wallpapers",
  "apparel",
  "tees & polos",
  "hoodies & sweatshirts",
  "bottoms",
  "activewear",
  "hats",
  "combos",
];

export function sortCategoriesWebsiteOrder(categories: string[]): string[] {
  const rank = (c: string) => {
    const i = WEBSITE_CATEGORY_ORDER.indexOf(norm(c));
    return i === -1 ? WEBSITE_CATEGORY_ORDER.length : i;
  };
  return categories
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i)
    .map((x) => x.c);
}

// ── builderLineRules port ───────────────────────────────────────────────────

/**
 * Hidden / required / cutting rules for one product (CRM builderLineRules).
 *
 * Workflow differences (documented, intentional):
 * - Workflow has ONE "Sides" field; CRM products ask SIDES or DOUBLE_SIDED,
 *   so either key keeps Sides visible.
 * - die_cut / perforation have no CRM builder rule; they follow the product's
 *   own `hidden_fields` (and die_cut also hides with cutting).
 * - special_effects is hidden when the product's question list lacks it.
 */
export function productLineRules(
  product: CatalogProductInfo,
  opts?: { material?: string | null },
): ProductLineRules {
  const dieCatalogName = dieCatalogCategoryName(product.category);
  const isLabels = dieCatalogName === "labels & stickers";
  const isBoxes = dieCatalogName === "packaging & boxes";
  const isPouch = dieCatalogName === "bags & pouches";
  const isDieCategory = dieCatalogName != null && !isPouch;
  const navName = norm(product.category);
  const isApparel = isApparelCategory(product.category);

  const materialName = String(opts?.material ?? "");
  const isSheetCutting =
    /sheet|cardstock|\bcover\b|\btext\b|c1s|c2s/i.test(materialName) ||
    materialName.trim().toLowerCase() === "semi gloss" ||
    isBoxes ||
    navName === "marketing materials" ||
    navName === "trading cards";

  const fields = new Set((product.fields ?? []).map((f) => f.key.toUpperCase()));
  const cuttingOptions = product.fieldOptions?.CUTTING;
  const hasCatalogCutting =
    (Array.isArray(cuttingOptions) && cuttingOptions.length > 0) ||
    fields.has("CUTTING");
  const cutHiddenCategory = navName === "banners & signs" || navName === "more";
  const showCutting =
    !isPouch && !cutHiddenCategory && (hasCatalogCutting || isDieCategory || isSheetCutting);

  const materials = product.materials ?? [];
  const hidden = new Set<string>();
  if (fields.size > 0) {
    if (!fields.has("MATERIAL")) hidden.add("material");
    if (!(fields.has("FINISHING") || fields.has("LAMINATION"))) hidden.add("lamination");
    if (!fields.has("ROLL_DIRECTION")) hidden.add("roll_direction");
    const hasSize =
      fields.has("SET_SIZE") ||
      fields.has("CUSTOM_SIZE") ||
      fields.has("SET_SIZE_3") ||
      fields.has("CUSTOM_SIZE_3");
    if (!hasSize) {
      hidden.add("width");
      hidden.add("height");
    }
    if (!fields.has("COLOR_MODE")) hidden.add("color_mode");
    if (!(fields.has("SIDES") || fields.has("DOUBLE_SIDED"))) hidden.add("sides");
    if (!fields.has("SPECIAL_EFFECTS")) hidden.add("special_effects");
    if (!fields.has("PERFORATION")) hidden.add("perforation");
  } else {
    if (materials.length === 0) hidden.add("material");
    if ((product.finishing ?? []).length === 0) hidden.add("lamination");
    if (!(product.toggles ?? []).some((t) => t.key === "ROLL_DIRECTION")) {
      hidden.add("roll_direction");
    }
  }
  if (isApparel) {
    for (const f of [
      "material",
      "lamination",
      "color_mode",
      "sides",
      "width",
      "height",
      "roll_direction",
    ])
      hidden.add(f);
  }
  if (!showCutting) {
    hidden.add("cutting_type");
    hidden.add("die_cut");
  }
  const explicit = new Set((product.hiddenFields ?? []).map((h) => norm(h)));
  if (explicit.has("die_cut")) hidden.add("die_cut");
  if (explicit.has("perforation")) hidden.add("perforation");

  let required = ["material", "width", "height", "quantity", "unit_price"];
  if (materials.length === 0) required = required.filter((f) => f !== "material");
  if (showCutting) required.push("cutting_type");
  required = required.filter((f) => !hidden.has(f));

  return {
    dieCatalogName,
    isLabels,
    isPouch,
    isBoxes,
    isApparel,
    isDieCategory,
    isSheetCutting,
    showCutting,
    hiddenFields: [...hidden].sort(),
    requiredFields: required,
  };
}

// ── Question order + labels ─────────────────────────────────────────────────

/** CRM bazaar-product-configure DEFAULT_FIELD_ORDER (used when field_order is empty). */
export const CRM_DEFAULT_FIELD_ORDER = [
  "GUSSET",
  "TEAR_NOTCH",
  "APPLICATION",
  "MATERIAL",
  "FINISHING",
  "SPECIAL_EFFECTS",
  "FOLD_TYPE",
  "ROLL_DIRECTION",
  "SET_SIZE",
  "SET_SIZE_3",
  "CONTAINER",
  "MOUNT_DIRECTION",
  "WHITE_MASK",
  "APPLICATION_GLUE",
  "GROMMETS",
  "WIND_SLITS",
  "ROUND_CORNERS",
  "PERFORATION",
  "TAMPER_SEAL",
  "VARIABLE_DATA",
  "ADD_TOP_LABEL",
  "QUANTITY",
  "DOUBLE_SIDED",
];

/** Keys that are bookkeeping, not questions for the floor. */
const INTERNAL_QUESTION_KEYS = new Set(["DESIGN_JOB_POSSIBLE", "BAZAAR_ITEM_ID"]);

const QUESTION_LABEL_FALLBACKS: Record<string, string> = {
  MATERIAL: "Material",
  FINISHING: "Finishing",
  SPECIAL_EFFECTS: "Special effects",
  ROLL_DIRECTION: "Roll direction",
  COLOR_MODE: "Color mode",
  SET_SIZE: "Size",
  SET_SIZE_3: "Size (L × W × H)",
  CUSTOM_SIZE: "Custom size (W × H)",
  CUSTOM_SIZE_3: "Custom size (L × W × H)",
  DOUBLE_SIDED: "Double-sided",
  DESIGN_SERVICE: "Design service",
  GUSSET_SIZE: "Gusset size",
  SEAL_SIDES: "Seal sides",
  TEAR_NOTCH: "Tear notch",
  HANG_HOLE: "Hang hole",
  ROUND_CORNERS: "Rounded corners",
  DIE: "Die",
  CUTTING: "Cutting",
};

export function humanizeQuestionKey(key: string): string {
  const fb = QUESTION_LABEL_FALLBACKS[key.toUpperCase()];
  if (fb) return fb;
  const words = key.replace(/[_-]+/g, " ").trim().toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

/** CRM field_labels may be keyed "MATERIAL" or "material". */
export function questionLabel(product: CatalogProductInfo, key: string): string {
  const labels = product.fieldLabels ?? {};
  const fromCrm = labels[key] ?? labels[key.toUpperCase()] ?? labels[key.toLowerCase()];
  return typeof fromCrm === "string" && fromCrm.trim()
    ? fromCrm.trim()
    : humanizeQuestionKey(key);
}

export type ProductQuestion = { key: string; type: string; label: string };

/**
 * The product's own questions, in CRM order: `field_order` when the product
 * has one, else the CRM builder default order; anything not listed keeps its
 * catalog position at the end. Internal keys are dropped.
 */
export function orderedProductQuestions(product: CatalogProductInfo): ProductQuestion[] {
  const fields = (product.fields ?? []).filter(
    (f) => f && f.key && !INTERNAL_QUESTION_KEYS.has(f.key.toUpperCase()),
  );
  const order = (product.fieldOrder?.length ? product.fieldOrder : CRM_DEFAULT_FIELD_ORDER).map(
    (k) => k.toUpperCase(),
  );
  const rank = (key: string) => {
    const i = order.indexOf(key.toUpperCase());
    return i === -1 ? order.length : i;
  };
  return fields
    .map((f, i) => ({ f, i }))
    .sort((a, b) => rank(a.f.key) - rank(b.f.key) || a.i - b.i)
    .map(({ f }) => ({ key: f.key, type: f.type, label: questionLabel(product, f.key) }));
}

// ── Workflow custom fields ↔ CRM questions ─────────────────────────────────

/** Workflow custom-field name → generic rule key used in hiddenFields. */
const CUSTOM_FIELD_RULE_KEYS: Record<string, string> = {
  materials: "material",
  finishing: "lamination",
  "special effects": "special_effects",
  "roll direction": "roll_direction",
  position: "roll_direction",
  width: "width",
  height: "height",
  "color mode": "color_mode",
  color: "color_mode",
  sides: "sides",
  die: "cutting_type",
  "die cut": "die_cut",
  perforation: "perforation",
};

export function customFieldRuleKey(fieldName: string): string | null {
  return CUSTOM_FIELD_RULE_KEYS[norm(fieldName)] ?? null;
}

/** CRM question key → Workflow custom field(s) that already ask it on the card. */
const QUESTION_CUSTOM_FIELDS: Record<string, string[]> = {
  MATERIAL: ["Materials"],
  MATERIALS: ["Materials"],
  FINISHING: ["Finishing"],
  LAMINATION: ["Finishing"],
  SPECIAL_EFFECTS: ["Special effects"],
  ROLL_DIRECTION: ["Roll Direction", "Position"],
  COLOR_MODE: ["Color Mode", "Color"],
  SIDES: ["Sides"],
  DOUBLE_SIDED: ["Sides"],
  SET_SIZE: ["Width", "Height", "Finished Size"],
  CUSTOM_SIZE: ["Width", "Height", "Finished Size"],
  DIE: ["Die"],
  CUTTING: ["Die"],
  PERFORATION: ["Perforation"],
  DESIGN_SERVICE: ["Need a design", "Need a Design"],
};

/** Quantity lives in the SKU editor / Quantity field on every card. */
const ALWAYS_ELSEWHERE = new Set(["QUANTITY"]);

/**
 * True when the card already shows this CRM question through a Workflow custom
 * field (or the SKU editor) — the specs section must not ask it twice.
 */
export function questionHandledByCustomField(
  key: string,
  customFieldNames: string[],
): boolean {
  const k = key.toUpperCase();
  if (ALWAYS_ELSEWHERE.has(k)) return true;
  const aliases = QUESTION_CUSTOM_FIELDS[k];
  if (!aliases) return false;
  const names = new Set(customFieldNames.map((n) => norm(n)));
  return aliases.some((a) => names.has(norm(a)));
}

export type CustomFieldDisplay = "show" | "hide" | "saved";

/**
 * Should a Workflow print custom field show on this card?
 *
 * - "show": a question this product asks (empty ones only when hideEmpty=false).
 * - "saved": the product does not ask it but the card already holds a real
 *   value — still shown (in "Saved values not used by this product") so nothing
 *   disappears or is overwritten.
 * - "hide": not asked by the product and holds nothing meaningful
 *   ("None", 0, unchecked).
 *
 * `rules` null = product not in the CRM catalog (or catalog not loaded): fall
 * back to the product-family check from spec-row-filter.
 */
export function customFieldDisplay(input: {
  fieldName: string;
  value: unknown;
  rules: Pick<ProductLineRules, "hiddenFields"> | null;
  family?: ProductFamily | null;
  hideEmpty: boolean;
}): CustomFieldDisplay {
  const { fieldName, value, rules, hideEmpty } = input;
  const family = input.family ?? null;
  const ruleKey = customFieldRuleKey(fieldName);
  const hasValue = !isEmptyValue(value);
  // Generic print fields use the shared row filter ("None"/0/"No" = empty).
  const meaningful = ruleKey
    ? hasValue && isCustomFieldRelevant(fieldName, value, null)
    : hasValue;
  const productHides = Boolean(ruleKey && rules?.hiddenFields.includes(ruleKey));
  const familyHides = Boolean(
    ruleKey && family && !isCustomFieldRelevant(fieldName, "x", family),
  );
  if (productHides || familyHides) {
    if (meaningful) return "saved";
    // A raw stored value the filter calls empty ("None", "0") — keep it hidden
    // from view; it is still re-sent unchanged on save.
    return "hide";
  }
  if (hideEmpty && !meaningful) return "hide";
  return "show";
}

function isEmptyValue(v: unknown): boolean {
  return v === null || v === undefined || v === "" || v === false;
}

/** Re-export so callers need one import for family + rules. */
export { productFamily };

/** Find a product in the trimmed catalog by name / id / slug (case + space tolerant). */
export function findCatalogProductInfo(
  products: CatalogProductInfo[] | null | undefined,
  name: string,
): CatalogProductInfo | null {
  if (!products || !name.trim()) return null;
  const want = norm(name);
  return (
    products.find((p) => norm(p.name) === want) ??
    products.find((p) => norm(p.id) === want || norm(p.slug) === want) ??
    null
  );
}

/** Products for the "+ New card" picker: category filter + type-to-search. */
export function filterPickerProducts(
  products: CatalogProductInfo[],
  opts: { category?: string | null; search?: string | null },
): CatalogProductInfo[] {
  const cat = norm(opts.category);
  const q = norm(opts.search);
  return products
    .filter((p) => !cat || norm(p.category) === cat)
    .filter((p) => !q || norm(p.name).includes(q) || norm(p.category).includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ── Admin "+ New card" (connected create) ──────────────────────────────────

/** CRM question key → generic hidden-rule key. */
const QUESTION_RULE_KEYS: Record<string, string> = {
  MATERIAL: "material",
  MATERIALS: "material",
  FINISHING: "lamination",
  LAMINATION: "lamination",
  ROLL_DIRECTION: "roll_direction",
  COLOR_MODE: "color_mode",
  SIDES: "sides",
  SPECIAL_EFFECTS: "special_effects",
  PERFORATION: "perforation",
  CUTTING: "cutting_type",
  DIE: "cutting_type",
};

/** Asked elsewhere on the create form (SKU quantities). */
const CREATE_SKIP_KEYS = new Set(["QUANTITY", "DESIGN_JOB_POSSIBLE", "BAZAAR_ITEM_ID"]);

/**
 * The questions "+ New card" asks for one product: the product's own
 * questions minus those its rules hide, in CRM order, with CRM labels.
 */
export function createFormQuestions(product: CatalogProductInfo): ProductQuestion[] {
  const rules = productLineRules(product);
  return orderedProductQuestions(product).filter((q) => {
    const k = q.key.toUpperCase();
    if (CREATE_SKIP_KEYS.has(k)) return false;
    const ruleKey = QUESTION_RULE_KEYS[k];
    return !(ruleKey && rules.hiddenFields.includes(ruleKey));
  });
}

/**
 * Raw v2-shaped product for lib/crm-catalog-v2 `parseCatalogV2`, so the
 * create snapshot (crm_snapshot) keeps exactly the shape the catalog_cache
 * path produced — only the question list / order / labels change.
 */
export function rawV2ProductFromInfo(product: CatalogProductInfo): Record<string, unknown> {
  const questions = createFormQuestions(product);
  const named = (list: string[] | null | undefined) =>
    (list ?? []).map((name) => ({ id: name, name }));
  const labels: Record<string, string> = {};
  for (const q of questions) labels[q.key] = q.label;
  return {
    id: product.id || product.name,
    name: product.name,
    materials: named(product.materials),
    finishing: named(product.finishing),
    special_effects: named(product.specialEffects),
    options: {
      fields: questions.map((q) => ({ key: q.key, type: q.type })),
      field_options: product.fieldOptions ?? {},
      field_labels: labels,
    },
  };
}
