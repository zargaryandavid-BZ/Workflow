import type { CustomFieldType } from "@/lib/types";
import {
  CUSTOMER_CONTACT_FIELD_NAME,
  CUSTOMER_NAME_FIELD_NAME,
  DESIGNER_FIELD_NAME,
} from "@/lib/constants";
import { PRODUCTS } from "@/lib/product-data";

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
    options: [...PRODUCTS],
    required: true,
  },
  {
    name: "Materials",
    field_type: "select",
    options: [
      // BOPP
      "Clear BOPP",
      "White BOPP",
      "Silver BOPP",
      "Holo BOPP",
      // Label Sheets
      "Gloss Label Sheet",
      "Matte Label Sheet",
      "Semi Gloss",
      // Cosmetic Web
      "Clear Cosmetic Web",
      "White Cosmetic Web",
      "Silver Cosmetic Web",
      // Cardstock
      "14pt C1S",
      "14pt C2S",
      "16pt C1S",
      "16pt C2S",
      "18pt C1S",
      "18pt C2S",
      "18pt Silver",
      "24pt C1S",
      "24pt C2S",
      // Cardstock / Sheet (Boyd)
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
      // Vinyl
      "White Vinyl",
      "White Vinyl - Aggressive Glue",
      "Holographic Vinyl",
      // Specialty
      "Banner Material",
      "Window Decal",
      "Self-Adhesive (Peel-and-Stick)",
      "Traditional / Unpasted",
    ],
    required: true,
  },
  { name: "Finished Size", field_type: "text", options: [], required: true },
  { name: "Artwork (GDrive link)", field_type: "text", options: [] },
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
