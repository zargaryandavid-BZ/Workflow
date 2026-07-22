import { MATERIALS, PRODUCTS, PRODUCT_CATEGORY_NAMES } from "@/lib/product-data";

const COLOR_OPTIONS = ["CMYK", "CMYK+White", "Pantones"];
const SIDES_OPTIONS = ["1 Side", "2 Sides"];
const ROLL_DIRECTION_OPTIONS = ["1-Top", "2-Bottom", "3-Right", "4-Left"];
const FINISHING_OPTIONS = [
  "Spot UV",
  "Foil Gold",
  "Foil Silver",
  "Foil Holo",
  "Spot UV + Foil Gold",
  "Spot UV + Foil Silver",
  "Spot UV + Foil Holo",
];
const LAMINATION_OPTIONS = [
  "None",
  "Gloss",
  "Matte",
  "Soft Touch",
  "Holo",
  "Coating",
];

/** Hardcoded fallback when tenant custom_fields.options is empty. */
export const WEBHOOK_FALLBACK_SELECT_OPTIONS: Record<string, string[]> = {
  product: [...PRODUCTS],
  product_category: [...PRODUCT_CATEGORY_NAMES],
  materials: [...MATERIALS],
  sides: SIDES_OPTIONS,
  color: COLOR_OPTIONS,
  color_mode: COLOR_OPTIONS,
  finishing: FINISHING_OPTIONS,
  lamination: LAMINATION_OPTIONS,
  position: ROLL_DIRECTION_OPTIONS,
  roll_direction: ROLL_DIRECTION_OPTIONS,
};

/**
 * Tenant DB options take precedence; fall back to known defaults when empty.
 */
export function selectOptionsForWebhookField(
  webhookKey: string,
  dbOptions: string[] | undefined
): string[] {
  if (dbOptions && dbOptions.length > 0) return dbOptions;
  return WEBHOOK_FALLBACK_SELECT_OPTIONS[webhookKey] ?? [];
}
