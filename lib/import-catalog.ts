/**
 * Parse CRM catalog JSON (raw Shape A or reshaped Shape B) into flat option
 * lists for Category / Product / Materials custom fields.
 */

export type CatalogOptionLists = {
  categories: string[];
  products: string[];
  materials: string[];
};

type CrmMaterial = { name?: string };
type CrmGroup = { materials?: CrmMaterial[] };
type CrmProduct = {
  name?: string;
  category_id?: number | null;
  material_groups?: CrmGroup[];
};
type CrmCategory = {
  id?: number;
  name?: string;
  sort_order?: number;
  parent_id?: number | null;
};

function uniquePreserveOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const v = raw.trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

/** Normalize for comparison: casing, punctuation, known typos/synonyms. */
export function normalizeOptionText(name: string): string {
  let s = name.trim().toLowerCase();
  s = s.replace(/[–—]/g, "-");
  s = s.replace(/&/g, " and ");
  s = s.replace(/[()]/g, " ");
  s = s.replace(/[-_/+,]+/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  // Known spelling fixes (match only — catalog spelling wins on write)
  s = s.replace(/\bpouche\b/g, "pouch");
  s = s.replace(/\bapplicaion\b/g, "application");
  s = s.replace(/\bholographic\b/g, "holo");
  s = s.replace(/\brainbow holo\b/g, "holo");
  s = s.replace(/\bmetallic\b/g, "silver");
  s = s.replace(/\bsemi gloss\b/g, "semigloss");
  s = s.replace(/\bsemigloss\b/g, "semigloss");
  s = s.replace(/\bdie\s*cut\b/g, "diecut");
  s = s.replace(/\bkiss\s*cut\b/g, "diecut");
  // Light singularization for product compare
  s = s.replace(/\bmenus\b/g, "menu");
  s = s.replace(/\bpouches\b/g, "pouch");
  s = s.replace(/\bstickers\b/g, "sticker");
  s = s.replace(/\blabels\b/g, "label");
  s = s.replace(/\bbanners\b/g, "banner");
  s = s.replace(/\bbags\b/g, "bag");
  s = s.replace(/\bboxes\b/g, "box");
  s = s.replace(/\bcards\b/g, "card");
  s = s.replace(/\brolls\b/g, "roll");
  s = s.replace(/\bsheets\b/g, "sheet");
  s = s.replace(/\btapes\b/g, "tape");
  s = s.replace(/\bleggings\b/g, "legging");
  s = s.replace(/\bhoodies\b/g, "hoodie");
  s = s.replace(/\btees\b/g, "tee");
  return s;
}

/** Shared material family keys — any shared key means same material SKU. */
const OPTION_FAMILY_KEYS = new Set([
  "clear_bopp",
  "white_bopp",
  "silver_bopp",
  "holo_bopp",
  "semigloss",
  "self_adhesive",
  "pouch_double_sided",
  "pouch_one_sided",
  "application",
]);

/** Noise words ignored when scoring text similarity. */
const SIMILARITY_STOP = new Set([
  "custom",
  "printing",
  "printed",
  "the",
  "and",
  "a",
  "an",
  "of",
  "for",
  "with",
]);

/**
 * Token similarity 0–1 (Jaccard), plus phrase containment for
 * "Backlit Film" ↔ "Backlit Film Printing".
 */
export function optionTextSimilarity(a: string, b: string): number {
  const tokensOf = (name: string) =>
    normalizeOptionText(name)
      .split(/\s+/)
      .filter((t) => t.length > 0 && !SIMILARITY_STOP.has(t));

  const ta = tokensOf(a);
  const tb = tokensOf(b);
  if (ta.length === 0 || tb.length === 0) return 0;

  const sa = new Set(ta);
  const sb = new Set(tb);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter += 1;
  const union = sa.size + sb.size - inter;
  const jaccard = union === 0 ? 0 : inter / union;

  // Contiguous core: shorter token list appears in order inside the longer
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  let containment = 0;
  if (short.length >= 2) {
    outer: for (let i = 0; i <= long.length - short.length; i++) {
      for (let j = 0; j < short.length; j++) {
        if (long[i + j] !== short[j]) continue outer;
      }
      containment = short.length / long.length;
      break;
    }
    // Also allow bag-of-words containment when every short token is in long
    if (containment === 0) {
      const longSet = new Set(long);
      if (short.every((t) => longSet.has(t))) {
        containment = short.length / Math.max(long.length, short.length);
      }
    }
  }

  return Math.max(jaccard, containment);
}

/** True when labels are ~90%+ the same in text/meaning (rules threshold). */
export function optionsAreStrongTextMatch(
  a: string,
  b: string,
  threshold = 0.9
): boolean {
  return optionTextSimilarity(a, b) >= threshold;
}
/**
 * Parent catch-all vs specific SKU-style products.
 * Generics conflict with specifics; two specifics do not conflict.
 */
export function productParentFamily(
  name: string
): { family: string; kind: "generic" | "specific" } | null {
  const t = normalizeOptionText(name);

  if (/^(jar|jars)\s+(combo|only)$/.test(t) || /^jar\s+(combo|only)$/.test(t)) {
    return { family: "jar", kind: "generic" };
  }
  if (
    /\bjar\b/.test(t) &&
    (/\d+\s*(oz|ml)\b/.test(t) ||
      /\buv\b/.test(t) ||
      /\blarge\b/.test(t) ||
      /\blabel\b/.test(t))
  ) {
    return { family: "jar", kind: "specific" };
  }

  if (/^(tube|tubes)\s+(combo|only)$/.test(t)) {
    return { family: "tube", kind: "generic" };
  }
  if (
    /\btube\b/.test(t) &&
    (/\bgorilla\b/.test(t) ||
      /\bglass\b/.test(t) ||
      /\bplastic\b/.test(t) ||
      /\blabel\b/.test(t) ||
      /\bchubby\b/.test(t))
  ) {
    return { family: "tube", kind: "specific" };
  }

  if (/^(pouch|pouches)\s+(combo|only)$/.test(t)) {
    return { family: "pouch", kind: "generic" };
  }
  if (
    /\bpouch\b/.test(t) &&
    (/\bstand\s*up\b/.test(t) ||
      /\blay\s*flat\b/.test(t) ||
      /\bstick\s*pack\b/.test(t) ||
      /\bchild\b/.test(t) ||
      /\bresistant\b/.test(t) ||
      /\bflat\b/.test(t))
  ) {
    return { family: "pouch", kind: "specific" };
  }

  if (/^tuck\s+end\s+box(es)?$/.test(t)) {
    return { family: "tuck_end", kind: "generic" };
  }
  if (/\btuck\s+end\b/.test(t)) {
    return { family: "tuck_end", kind: "specific" };
  }

  if (/^apparel$/.test(t)) {
    return { family: "apparel", kind: "generic" };
  }
  if (
    /\b(tee|t shirt|hoodie|legging|sport\s*bra|sweatshirt|tank|polo|crewneck|bra)\b/.test(
      t
    )
  ) {
    return { family: "apparel", kind: "specific" };
  }

  return null;
}

function addProductFamilyKeys(base: string, add: (k: string) => void) {
  // Only tight material-ish application typo cluster remains here.
  // Product near-duplicates use optionTextSimilarity (≥90%).
  if (/\bapplication\b/.test(base)) add("application");
}

/**
 * Identity keys for near-duplicate detection.
 * Catalog spelling wins when any key overlaps an existing option.
 */
export function optionIdentityKeys(name: string): Set<string> {
  const keys = new Set<string>();
  const full = normalizeOptionText(name);
  if (!full) return keys;
  keys.add(full);

  const parenMatch = name.match(/\(([^)]+)\)\s*$/);
  const paren = parenMatch
    ? normalizeOptionText(parenMatch[1] ?? "")
    : "";
  if (paren) keys.add(paren);

  // Drop trailing parenthetical for a "label" form key
  const withoutParen = normalizeOptionText(
    name.replace(/\s*\([^)]*\)\s*$/, "")
  );
  if (withoutParen) keys.add(withoutParen);

  const add = (k: string) => {
    const t = k.trim();
    if (t) keys.add(t);
  };

  // Strip common marketing / substrate noise → core material token
  const stripNoise = (s: string) =>
    s
      .replace(/\b(paper\s+)?labels?\b/g, " ")
      .replace(/\bcardstock\b/g, " ")
      .replace(/\b(c1s|c2s|boyd)\b/g, " ")
      .replace(/\b(self\s*adhesive|peel\s*(and\s*)?stick|wallpaper)\b/g, " ")
      .replace(/\bvinyl\b/g, " ")
      .replace(/\brainbow\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  for (const base of [full, paren, withoutParen]) {
    if (!base) continue;
    const stripped = stripNoise(base);
    if (stripped) add(stripped);

    addProductFamilyKeys(base, add);

    // "clear label" / "clear bopp" / "clear cosmetic web" → clear_bopp family
    const color = stripped.match(
      /^(clear|white|silver|holo)\b/
    )?.[1];
    if (color) {
      if (
        /\b(bopp|cosmetic\s+web|label)\b/.test(base) ||
        stripped === color ||
        stripped === `${color} bopp`
      ) {
        add(`${color}_bopp`);
      }
      if (/\bholo\b/.test(base) || color === "holo") {
        add("holo_bopp");
      }
    }

    // Cosmetic web ↔ BOPP (same color)
    const cos = base.match(
      /^(clear|white|silver)\s+cosmetic\s+web$/
    );
    if (cos) add(`${cos[1]}_bopp`);

    // Point thickness: generic "14pt Cardstock" uses 14pt_card;
    // specific finishes use distinct keys (C1S ≠ C2S).
    const pt = base.match(/^(\d+)\s*pt\b/);
    if (pt) {
      const n = pt[1]!;
      const isSpecific = /\b(c1s|c2s|boyd)\b/.test(base) ||
        (/\bsilver\b/.test(base) && /\d+\s*pt/.test(base) && !/\bcardstock\b/.test(base));
      if (/\bc1s\b/.test(base)) add(`${n}pt_c1s`);
      if (/\bc2s\b/.test(base)) add(`${n}pt_c2s`);
      if (/\bboyd\b/.test(base)) add(`${n}pt_boyd`);
      if (/\bsilver\b/.test(base) && isSpecific && !/\bc1s|c2s|boyd\b/.test(base)) {
        add(`${n}pt_silver`);
      }
      if (!isSpecific) {
        add(`${n}pt_card`);
      }
    }

    // Self-adhesive / peel-and-stick wallpaper cluster
    if (
      /\bself\s*adhesive\b/.test(base) ||
      /\bpeel\s*(and\s*)?stick\b/.test(base)
    ) {
      add("self_adhesive");
    }

    // Semi-gloss paper cluster
    if (/\bsemigloss\b/.test(base) || /\bsemi gloss\b/.test(full)) {
      add("semigloss");
    }

    // Pouch sidedness (typo pouche → pouch already normalized)
    if (/\bpouch/.test(base) && /\bdouble\s*sided\b/.test(base)) {
      add("pouch_double_sided");
    }
    if (/\bpouch/.test(base) && /\bone\s*sided\b/.test(base)) {
      add("pouch_one_sided");
    }
  }

  return keys;
}

/**
 * True when two option labels are functional duplicates (~90% text/meaning).
 * Specific finishes / SKUs (14pt C1S vs 14pt C2S, 1oz Jar vs 2oz Jar) do NOT
 * conflict with each other; both conflict with their generic catch-all.
 * Loose product synonyms (Gift Bags ↔ paper bags, Standard ↔ Premium cards)
 * are NOT treated as duplicates.
 */
export function optionsAreDuplicates(a: string, b: string): boolean {
  if (normalizeOptionText(a) === normalizeOptionText(b)) return true;

  // Parenthetical synonym: "Clear Label (Clear BOPP)" ↔ "Clear BOPP"
  // also "Premium Trading Cards (Scodix)" ↔ "Premium Trading Cards"
  const parenOf = (name: string) => {
    const m = name.match(/\(([^)]+)\)\s*$/);
    return m ? normalizeOptionText(m[1] ?? "") : "";
  };
  const withoutParenOf = (name: string) =>
    normalizeOptionText(name.replace(/\s*\([^)]*\)\s*$/, ""));
  const pa = parenOf(a);
  const pb = parenOf(b);
  const na = normalizeOptionText(a);
  const nb = normalizeOptionText(b);
  if (pa && (pa === nb || pa === parenOf(b))) return true;
  if (pb && (pb === na || pb === parenOf(a))) return true;
  // Same base name, finish only differs in trailing paren
  if (
    withoutParenOf(a) &&
    withoutParenOf(a) === withoutParenOf(b) &&
    withoutParenOf(a).length >= 4
  ) {
    return true;
  }

  // Known material synonym families (BOPP colors, semi-gloss, etc.)
  const ka = optionIdentityKeys(a);
  const kb = optionIdentityKeys(b);
  for (const k of ka) {
    if (!kb.has(k)) continue;
    if (OPTION_FAMILY_KEYS.has(k)) return true;
  }

  // Stripped material cores equal (e.g. "Semi Gloss" vs "Semi-Gloss Paper Label")
  // Require a distinctive leftover (≥6 chars) so "roll" alone never matches.
  const strip = (s: string) =>
    normalizeOptionText(s)
      .replace(/\b(paper\s+)?label\b/g, " ")
      .replace(/\bcardstock\b/g, " ")
      .replace(/\b(c1s|c2s|boyd)\b/g, " ")
      .replace(/\b(self\s*adhesive|peel\s*(and\s*)?stick)\b/g, " ")
      .replace(/\brainbow\b/g, " ")
      .replace(/\bprinting\b/g, " ")
      .replace(/\bcustom\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const sa = strip(a);
  const sb = strip(b);
  if (sa && sb && sa === sb && sa.length >= 6) {
    if (!/^\d+\s*pt$/.test(sa)) return true;
  }

  // Generic cardstock ↔ specific pt finish (not C1S ↔ C2S)
  const ptFamily = (
    name: string
  ): { n: string; kind: "generic" | "specific" } | null => {
    const t = normalizeOptionText(name);
    const m = t.match(/^(\d+)\s*pt\b/);
    if (!m) return null;
    if (/\b(c1s|c2s|boyd)\b/.test(t)) return { n: m[1]!, kind: "specific" };
    if (/\bsilver\b/.test(t) && !/\bcardstock\b/.test(t)) {
      return { n: m[1]!, kind: "specific" };
    }
    if (/\bcardstock\b/.test(t) || new RegExp(`^${m[1]}\\s*pt$`).test(t)) {
      return { n: m[1]!, kind: "generic" };
    }
    return null;
  };
  const fa = ptFamily(a);
  const fb = ptFamily(b);
  if (fa && fb && fa.n === fb.n && fa.kind !== fb.kind) {
    return true;
  }

  // Product parent catch-alls ↔ specific variations (Jar Combo ↔ 1oz Jar…)
  const pfa = productParentFamily(a);
  const pfb = productParentFamily(b);
  if (
    pfa &&
    pfb &&
    pfa.family === pfb.family &&
    pfa.kind !== pfb.kind
  ) {
    return true;
  }

  // General case: require ~90% text / meaning overlap
  return optionsAreStrongTextMatch(a, b);
}

/**
 * Exact same labels on both sides (e.g. Apparel ↔ Apparel) are not useful to review.
 * Keep clusters where spellings differ, or one side has extra near-dup variants.
 */
export function clusterNeedsReview(g: {
  ours: string[];
  catalog: string[];
}): boolean {
  const ours = g.ours.map((s) => s.trim()).filter(Boolean);
  const catalog = g.catalog.map((s) => s.trim()).filter(Boolean);
  if (ours.length === 0 || catalog.length === 0) return false;

  const sortDisp = (arr: string[]) =>
    [...arr].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );
  const oDisp = sortDisp(ours);
  const cDisp = sortDisp(catalog);
  if (
    oDisp.length === cDisp.length &&
    oDisp.every((v, i) => v === cDisp[i])
  ) {
    return false;
  }

  const sortNorm = (arr: string[]) =>
    [...arr].map(normalizeOptionText).filter(Boolean).sort();
  const oNorm = sortNorm(ours);
  const cNorm = sortNorm(catalog);
  if (
    oNorm.length === cNorm.length &&
    oNorm.every((v, i) => v === cNorm[i])
  ) {
    return oDisp.some((v, i) => v !== cDisp[i]);
  }

  return true;
}

/**
 * Merge catalog options into existing field options.
 * - Catalog spelling always wins for duplicates / near-duplicates.
 * - Options only in the field (no catalog match) are kept.
 * - Multiple local near-duplicates collapse into one catalog entry.
 * - Near-duplicates inside the catalog list collapse (first wins).
 */
export function mergeFieldOptions(
  existing: string[] | null | undefined,
  incoming: string[]
): { options: string[]; added: number; overwritten: number } {
  const catalogRaw = uniquePreserveOrder(incoming);
  const catalog: string[] = [];
  for (const opt of catalogRaw) {
    const dupIdx = catalog.findIndex((c) => optionsAreDuplicates(c, opt));
    if (dupIdx >= 0) {
      // Later catalog row wins (URL order) — replace earlier near-duplicate
      catalog[dupIdx] = opt;
    } else {
      catalog.push(opt);
    }
  }

  let remaining = [...(existing ?? [])].map((o) => o.trim()).filter(Boolean);
  let added = 0;
  let overwritten = 0;
  const result: string[] = [];

  for (const catalogOpt of catalog) {
    const matchedIdx: number[] = [];
    for (let i = 0; i < remaining.length; i++) {
      if (optionsAreDuplicates(remaining[i]!, catalogOpt)) {
        matchedIdx.push(i);
      }
    }

    if (matchedIdx.length === 0) {
      result.push(catalogOpt);
      added += 1;
      continue;
    }

    const matchedLabels = matchedIdx.map((i) => remaining[i]!);
    if (matchedLabels.some((m) => m !== catalogOpt) || matchedIdx.length > 1) {
      overwritten += 1;
    }

    remaining = remaining.filter((_, i) => !matchedIdx.includes(i));
    result.push(catalogOpt);
  }

  result.push(...remaining);
  return { options: result, added, overwritten };
}

/**
 * Apply user review decisions onto existing options for one field.
 * - Starts from existing
 * - Removes every label that appeared in resolved duplicate groups
 * - Adds selected keep labels + selected additions
 */
export function applyCatalogReviewToOptions(opts: {
  existing: string[];
  groups: { ours: string[]; catalog: string[]; keep: string[] }[];
  add: string[];
}): string[] {
  const remove = new Set<string>();
  for (const g of opts.groups) {
    for (const v of [...g.ours, ...g.catalog]) {
      remove.add(normalizeOptionText(v));
    }
  }

  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const v = raw.trim();
    if (!v) return;
    const key = normalizeOptionText(v);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(v);
  };

  for (const e of opts.existing) {
    if (remove.has(normalizeOptionText(e))) continue;
    push(e);
  }
  for (const g of opts.groups) {
    for (const k of g.keep) push(k);
  }
  for (const a of opts.add) push(a);
  return out;
}

function parseShapeB(data: Record<string, unknown>): CatalogOptionLists | null {
  if (
    !data.productsByCategory ||
    typeof data.productsByCategory !== "object" ||
    Array.isArray(data.productsByCategory)
  ) {
    return null;
  }
  const productsByCategory = data.productsByCategory as Record<string, unknown>;
  const materialsByProduct =
    data.materialsByProduct &&
    typeof data.materialsByProduct === "object" &&
    !Array.isArray(data.materialsByProduct)
      ? (data.materialsByProduct as Record<string, unknown>)
      : {};

  const categoriesFromMap = Object.keys(productsByCategory);
  const categoriesFromArray = Array.isArray(data.categories)
    ? data.categories
        .map((c) => (typeof c === "string" ? c : null))
        .filter((c): c is string => Boolean(c))
    : [];

  const products: string[] = [];
  for (const list of Object.values(productsByCategory)) {
    if (!Array.isArray(list)) continue;
    for (const p of list) {
      if (typeof p === "string" && p.trim()) products.push(p);
    }
  }

  const materials: string[] = [];
  for (const list of Object.values(materialsByProduct)) {
    if (!Array.isArray(list)) continue;
    for (const m of list) {
      if (typeof m === "string" && m.trim()) materials.push(m);
    }
  }

  return {
    categories: uniquePreserveOrder([
      ...categoriesFromArray,
      ...categoriesFromMap,
    ]),
    products: uniquePreserveOrder(products),
    materials: uniquePreserveOrder(materials),
  };
}

function parseShapeA(data: Record<string, unknown>): CatalogOptionLists | null {
  if (!Array.isArray(data.products)) return null;
  const first = data.products[0];
  if (
    data.products.length > 0 &&
    (typeof first !== "object" || first === null || Array.isArray(first))
  ) {
    return null;
  }

  const categoriesRaw = (data.categories ?? []) as CrmCategory[];
  const productsRaw = data.products as CrmProduct[];

  const catById = new Map<number, string>();
  for (const c of categoriesRaw) {
    if (typeof c.id === "number" && c.name) catById.set(c.id, c.name);
  }

  const bySort = (a: CrmCategory, b: CrmCategory) =>
    (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
    (a.name ?? "").localeCompare(b.name ?? "");
  const childrenOf = (pid: number) =>
    categoriesRaw.filter((c) => c.parent_id === pid).sort(bySort);
  const categories: string[] = [];
  for (const parent of categoriesRaw
    .filter((c) => c.parent_id == null)
    .sort(bySort)) {
    if (parent.name) categories.push(parent.name);
    if (typeof parent.id === "number") {
      for (const child of childrenOf(parent.id)) {
        if (child.name) categories.push(child.name);
      }
    }
  }

  const products: string[] = [];
  const materials: string[] = [];
  for (const p of productsRaw) {
    if (!p.name?.trim()) continue;
    products.push(p.name.trim());
    for (const g of p.material_groups ?? []) {
      for (const m of g.materials ?? []) {
        if (m.name?.trim()) materials.push(m.name.trim());
      }
    }
  }

  return {
    categories: uniquePreserveOrder(categories),
    products: uniquePreserveOrder(products),
    materials: uniquePreserveOrder(materials),
  };
}

export function parseCatalogPayload(data: unknown): CatalogOptionLists {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Catalog response must be a JSON object");
  }
  const obj = data as Record<string, unknown>;
  const shapeB = parseShapeB(obj);
  if (shapeB) return shapeB;
  const shapeA = parseShapeA(obj);
  if (shapeA) return shapeA;
  throw new Error(
    "Unrecognized catalog shape — expected products[] or productsByCategory"
  );
}

/** Canonical Settings field names + aliases (case-insensitive match). */
export const CATALOG_FIELD_TARGETS = [
  {
    key: "categories" as const,
    createName: "Category",
    aliases: ["category"],
  },
  {
    key: "products" as const,
    createName: "Product",
    aliases: ["product", "product type"],
  },
  {
    key: "materials" as const,
    createName: "Materials",
    aliases: ["materials", "material", "material type", "materials type"],
  },
];
