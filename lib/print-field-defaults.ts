import type { CustomFieldType } from "@/lib/types";
import {
  CUSTOMER_CONTACT_FIELD_NAME,
  CUSTOMER_NAME_FIELD_NAME,
  DESIGNER_FIELD_NAME,
} from "@/lib/constants";

export interface DefaultFieldDef {
  name: string;
  field_type: CustomFieldType;
  options: string[];
  required?: boolean;
}

/**
 * Default print-production intake fields seeded into `custom_fields` for new
 * tenants. Synced from BazaarPrinting workspace (June 2026).
 * Runtime dropdowns read from the database, not this list.
 */
export const DEFAULT_PRINT_FIELDS: DefaultFieldDef[] = [
  { name: DESIGNER_FIELD_NAME, field_type: "text", options: [] },
  { name: CUSTOMER_NAME_FIELD_NAME, field_type: "text", options: [], required: true },
  {
    name: CUSTOMER_CONTACT_FIELD_NAME,
    field_type: "text",
    options: [],
    required: true,
  },
  {
    name: "Product",
    field_type: "select",
    options: [
      "Labels (Roll)",
      "Labels (Sheet)",
      "Pouches",
      "Folding Cartons / Box",
      "Flyers / Postcards",
      "Business Cards",
      "Booklets",
      "Diecut Stickers",
      "Vinyl Labels / 54'' Rolls",
      "Vinyl Signage",
      "Banners / Large Format",
      "Window Decals",
      "Wallpaper",
      "Sheet Products (Boyd)",
    ],
    required: true,
  },
  {
    name: "Product Type",
    field_type: "select",
    options: ["Sheet", "Roll", "Flat", "Folded"],
    required: true,
  },
  { name: "Finished Size", field_type: "text", options: [], required: true },
  { name: "Artwork (GDrive link)", field_type: "text", options: [] },
  {
    name: "Materials",
    field_type: "select",
    options: [
      "Clear Bopp",
      "White Bopp",
      "Silver Bopp",
      "Semi Gloss",
      "Holo Bopp",
      "Vinyl",
      "Clear Cosm. WEB",
      "White Cosm. WEB",
      "Silver Cosm. WEB",
      "Gloss Label Sheet",
      "Matte Label Sheet",
      "14pt.",
      "16pt.",
      "16pt. Holo",
      "18pt.",
      "24pt.",
      "80lb Cover",
      "100lb Cover",
      "110lb Cover",
    ],
    required: true,
  },
  {
    name: "Finishing",
    field_type: "select",
    options: [
      "Spot UV",
      "Foil Gold",
      "Foil Silver",
      "Foil Holo",
      "Spot UV + Foil Gold",
      "Spot UV + Foil Silver",
      "Spot UV + Foil Holo",
    ],
  },
  {
    name: "Sides",
    field_type: "select",
    options: ["1 Side", "2 Sides"],
  },
  {
    name: "Position",
    field_type: "select",
    options: ["1-Top", "2-Bottom", "3-Right", "4-Left"],
  },
  {
    name: "Color",
    field_type: "select",
    options: ["CMYK", "CMYK+White", "Pantones"],
  },
  { name: "Order QTY", field_type: "number", options: [], required: true },
];
