import type { CustomFieldType } from "@/lib/types";
import {
  CUSTOMER_CONTACT_FIELD_NAME,
  CUSTOMER_NAME_FIELD_NAME,
} from "@/lib/constants";

export interface DefaultFieldDef {
  name: string;
  field_type: CustomFieldType;
  options: string[];
}

/**
 * Default print-production intake fields seeded into `custom_fields` for new
 * tenants. Runtime dropdowns read from the database, not this list.
 */
export const DEFAULT_PRINT_FIELDS: DefaultFieldDef[] = [
  { name: CUSTOMER_NAME_FIELD_NAME, field_type: "text", options: [] },
  { name: CUSTOMER_CONTACT_FIELD_NAME, field_type: "text", options: [] },
  {
    name: "Product",
    field_type: "select",
    options: [
      "Labels (Roll)",
      "Business Cards",
      "Flyers",
      "Banners",
      "Posters",
      "Brochures",
      "Stickers",
      "Other",
    ],
  },
  {
    name: "Product Type",
    field_type: "select",
    options: ["Sheet", "Roll", "Flat", "Folded"],
  },
  { name: "Finished Size", field_type: "text", options: [] },
  { name: "Artwork (GDrive link)", field_type: "text", options: [] },
  {
    name: "Materials",
    field_type: "select",
    options: [
      "14pt Gloss",
      "16pt Matte",
      "100lb Gloss Text",
      "Vinyl",
      "BOPP",
      "Other",
    ],
  },
  {
    name: "Lamination",
    field_type: "select",
    options: ["None", "Gloss", "Matte", "Soft Touch", "Spot UV"],
  },
  {
    name: "Special Finishing",
    field_type: "select",
    options: ["None", "Foil", "Emboss", "Die Cut", "Perforation", "Scoring"],
  },
  {
    name: "Sides",
    field_type: "select",
    options: ["1 Side", "2 Sides"],
  },
  {
    name: "Position",
    field_type: "select",
    options: ["Front", "Back", "Both", "Sleeve", "Other"],
  },
  {
    name: "Color",
    field_type: "select",
    options: [
      "Full Color (CMYK)",
      "Black & White",
      "1 Color",
      "2 Color",
      "PMS",
    ],
  },
  { name: "Order QTY", field_type: "number", options: [] },
];
