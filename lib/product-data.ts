/** Product / material matrix from bazaar-products-export-2026-06-20.json */

export const PRODUCTS = [
  "Pouches Combo",
  "Jar Combo",
  "Tube Combo",
  "Labels (Roll)",
  "Labels (Sheet)",
  "Folding Cartons / Boxes",
  "Business Cards",
  "Flyers / Postcards",
  "Booklets",
  "Diecut Stickers",
  "Vinyl Labels / 54'' Rolls",
  "Vinyl Signage",
  "Banners / Large Format",
  "Window Decals",
  "Wallpaper",
  "Sheet Products (Boyd)",
  "Apparel",
  "Pouches Only",
  "Tube Only",
  "Jar Only",
  "Other",
] as const;

export const MATERIALS = [
  // Pouches / Cosmetic Web
  "Pouch Double sided",
  "Pouche One sided",
  "Clear Cosmetic Web",
  "White Cosmetic Web",
  "Silver Cosmetic Web",
  // Jar / Tube combos
  "Plastic & Side & Top",
  "Plastic & Side",
  "Plastic & Top",
  "Plastic",
  "Glass & Side & Top",
  "Glass & Side",
  "Glass",
  // BOPP (labels / stickers)
  "Clear BOPP",
  "White BOPP",
  "Silver BOPP",
  "Holo BOPP",
  // Label Sheets
  "Gloss Label Sheet",
  "Matte Label Sheet",
  "Semi Gloss",
  // Cardstock (16th Street)
  "14pt C1S",
  "14pt C2S",
  "16pt C1S",
  "16pt C2S",
  "18pt C1S",
  "18pt C2S",
  "18pt Silver",
  "24pt C1S",
  "24pt C2S",
  // Cardstock / Sheet (Boyd Street)
  "16pt (Boyd)",
  "18pt (Boyd)",
  "20pt (Boyd)",
  "24pt (Boyd)",
  // Cover / Text
  "80lb Cover",
  "100lb Cover",
  "110lb Cover",
  "80lb Text",
  "100lb Text",
  // Vinyl (Boyd Street)
  "White Vinyl",
  "White Vinyl - Aggressive Glue",
  "Holographic Vinyl",
  // Specialty / Large Format
  "Banner Material",
  "Window Decal",
  "Self-Adhesive (Peel-and-Stick)",
  "Traditional / Unpasted",
  // Apparel
  "Sweatshirt",
  "Hoodie",
  "Polo",
  "Tee",
  "Activewear",
  "Hat",
  "Bikini",
  "Short",
  "Jogger",
] as const;

/**
 * Category → products for cascading order-form dropdowns.
 * Category is also a stored custom field; this map defines the relationship.
 */
export const PRODUCT_CATEGORIES: Record<string, readonly string[]> = {
  Combos: ["Pouches Combo", "Jar Combo", "Tube Combo"],
  "Labels & Stickers": ["Labels (Roll)", "Labels (Sheet)", "Diecut Stickers"],
  "Packaging & Boxes": ["Folding Cartons / Boxes"],
  Print: [
    "Business Cards",
    "Flyers / Postcards",
    "Booklets",
    "Sheet Products (Boyd)",
  ],
  "Signage / Large Format": [
    "Vinyl Labels / 54'' Rolls",
    "Vinyl Signage",
    "Banners / Large Format",
    "Window Decals",
    "Wallpaper",
  ],
  Apparel: ["Apparel"],
  Components: ["Pouches Only", "Tube Only", "Jar Only"],
  Other: ["Other"],
};

export const PRODUCT_CATEGORY_NAMES = Object.keys(PRODUCT_CATEGORIES);

/** Valid materials per product — used for cascading Materials dropdown. */
export const PRODUCT_MATERIALS: Record<string, string[]> = {
  "Pouches Combo": ["Pouch Double sided", "Pouche One sided"],
  "Jar Combo": [
    "Plastic & Side & Top",
    "Glass & Side & Top",
    "Glass & Side",
    "Plastic & Top",
    "Glass",
  ],
  "Tube Combo": [
    "Plastic & Side",
    "Plastic & Side & Top",
    "Glass & Side & Top",
    "Glass & Side",
    "Plastic & Top",
    "Glass",
  ],
  "Labels (Roll)": [
    "Clear BOPP",
    "White BOPP",
    "Silver BOPP",
    "Holo BOPP",
    "Gloss Label Sheet",
    "Matte Label Sheet",
    "Semi Gloss",
  ],
  "Labels (Sheet)": [
    "Gloss Label Sheet",
    "Matte Label Sheet",
    "Semi Gloss",
  ],
  "Folding Cartons / Boxes": [
    "14pt C1S",
    "14pt C2S",
    "16pt C1S",
    "16pt C2S",
    "18pt C1S",
    "18pt C2S",
    "18pt Silver",
    "24pt C1S",
    "24pt C2S",
    "16pt (Boyd)",
    "18pt (Boyd)",
    "20pt (Boyd)",
    "24pt (Boyd)",
  ],
  "Business Cards": [
    "14pt C1S",
    "14pt C2S",
    "16pt C1S",
    "16pt C2S",
    "18pt C1S",
    "18pt C2S",
    "18pt Silver",
    "24pt C1S",
    "24pt C2S",
    "80lb Cover",
    "100lb Cover",
    "110lb Cover",
  ],
  "Flyers / Postcards": [
    "14pt C1S",
    "14pt C2S",
    "16pt C1S",
    "16pt C2S",
    "18pt C1S",
    "18pt C2S",
    "18pt Silver",
    "24pt C1S",
    "24pt C2S",
    "80lb Cover",
    "100lb Cover",
    "110lb Cover",
    "80lb Text",
    "100lb Text",
  ],
  Booklets: [
    "80lb Cover",
    "100lb Cover",
    "110lb Cover",
    "80lb Text",
    "100lb Text",
  ],
  "Diecut Stickers": [
    "Clear BOPP",
    "White BOPP",
    "Silver BOPP",
    "Holo BOPP",
    "Gloss Label Sheet",
    "Matte Label Sheet",
    "Semi Gloss",
    "White Vinyl",
    "White Vinyl - Aggressive Glue",
    "Holographic Vinyl",
  ],
  "Vinyl Labels / 54'' Rolls": [
    "White Vinyl",
    "White Vinyl - Aggressive Glue",
    "Holographic Vinyl",
  ],
  "Vinyl Signage": [
    "White Vinyl",
    "White Vinyl - Aggressive Glue",
    "Holographic Vinyl",
  ],
  "Banners / Large Format": [
    "Banner Material",
    "Window Decal",
    "Self-Adhesive (Peel-and-Stick)",
    "Traditional / Unpasted",
  ],
  "Window Decals": ["Window Decal"],
  Wallpaper: ["Self-Adhesive (Peel-and-Stick)", "Traditional / Unpasted"],
  "Sheet Products (Boyd)": ["18pt (Boyd)", "20pt (Boyd)", "24pt (Boyd)"],
  Apparel: [
    "Sweatshirt",
    "Hoodie",
    "Polo",
    "Tee",
    "Activewear",
    "Hat",
    "Bikini",
    "Short",
    "Jogger",
  ],
  "Pouches Only": [
    "Clear Cosmetic Web",
    "White Cosmetic Web",
    "Silver Cosmetic Web",
  ],
  "Tube Only": ["Plastic", "Glass"],
  "Jar Only": ["Plastic", "Glass"],
  Other: [],
};

/** Category that contains a product, or null if unknown. */
export function categoryForProduct(product: string | null | undefined): string | null {
  const name = product?.trim();
  if (!name) return null;
  for (const [category, products] of Object.entries(PRODUCT_CATEGORIES)) {
    if (products.some((p) => p.toLowerCase() === name.toLowerCase())) {
      return category;
    }
  }
  return null;
}

/**
 * Products available in a category.
 * When `allowed` is set (tenant custom-field options), intersect with those.
 * Category labels may include emoji prefixes (e.g. "👕 Apparel").
 */
export function productsForCategory(
  category: string | null | undefined,
  allowed?: string[] | null
): string[] {
  const cat = category?.trim();
  if (!cat) {
    return filterAllowed([...PRODUCTS], allowed);
  }
  let list = PRODUCT_CATEGORIES[cat];
  if (!list) {
    const key = Object.keys(PRODUCT_CATEGORIES).find(
      (k) => k.toLowerCase() === cat.toLowerCase()
    );
    if (key) list = PRODUCT_CATEGORIES[key];
  }
  if (!list) {
    // Match "👕 Apparel" → Apparel
    const stripped = cat
      .replace(
        /^[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Emoji}\uFE0F\u200D\s]+/u,
        ""
      )
      .trim()
      .toLowerCase();
    const key = Object.keys(PRODUCT_CATEGORIES).find(
      (k) => k.toLowerCase() === stripped
    );
    if (key) list = PRODUCT_CATEGORIES[key];
  }
  if (!list) return filterAllowed([...PRODUCTS], allowed);
  return filterAllowed([...list], allowed);
}

/**
 * Materials for a product.
 * Prefer PRODUCT_MATERIALS; fall back to tenant options / full MATERIALS list.
 */
export function materialsForProduct(
  product: string | null | undefined,
  allowed?: string[] | null
): string[] {
  const name = product?.trim();
  if (!name) return filterAllowed([...MATERIALS], allowed);

  const mapped = PRODUCT_MATERIALS[name];
  if (mapped && mapped.length > 0) {
    return filterAllowed(mapped, allowed);
  }

  // Case-insensitive product key match
  const key = Object.keys(PRODUCT_MATERIALS).find(
    (k) => k.toLowerCase() === name.toLowerCase()
  );
  if (key && PRODUCT_MATERIALS[key]?.length) {
    return filterAllowed(PRODUCT_MATERIALS[key], allowed);
  }

  return filterAllowed([...MATERIALS], allowed);
}

function filterAllowed(
  candidates: string[],
  allowed?: string[] | null
): string[] {
  if (!allowed || allowed.length === 0) return candidates;
  const allow = new Set(allowed.map((a) => a.toLowerCase()));
  const filtered = candidates.filter((c) => allow.has(c.toLowerCase()));
  // Keep tenant-only options that aren't in the static catalog when no category filter
  if (filtered.length === 0) return [...allowed];
  return filtered;
}

