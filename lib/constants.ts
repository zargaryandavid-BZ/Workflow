import type { ColumnKind, CustomFieldType, Role } from "./types";

export const TENANT_COOKIE = "ppm_tenant";

/** Human-readable role names. */
export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  preprod_owner: "Pre-Production Owner",
  designer: "Designer",
  account_manager: "Account Manager",
  member: "Member",
};

/** Short role tags used in compact UI (e.g. column header indicators). */
export const ROLE_ABBR: Record<Role, string> = {
  admin: "Adm",
  preprod_owner: "PP",
  designer: "Dsg",
  account_manager: "AM",
  member: "Mbr",
};

/** Roles an admin can assign to a teammate. */
export const ASSIGNABLE_ROLES: Role[] = [
  "admin",
  "preprod_owner",
  "designer",
  "account_manager",
];

/** Non-admin roles configurable for per-column drop permissions. */
export const BOARD_ROLES: Role[] = [
  "preprod_owner",
  "designer",
  "account_manager",
];

export function isAssignableRole(value: unknown): value is Role {
  return (
    typeof value === "string" &&
    (ASSIGNABLE_ROLES as string[]).includes(value)
  );
}

export interface DefaultColumn {
  name: string;
  kind: ColumnKind;
}

/**
 * Default pipeline seeded for every new tenant. Order matters: position is
 * assigned by index.
 */
export const DEFAULT_COLUMNS: DefaultColumn[] = [
  { name: "START (Order Created)", kind: "normal" },
  { name: "In Progress", kind: "normal" },
  { name: "Missing Info", kind: "exception" },
  { name: "Returning Tickets", kind: "exception" },
  { name: "Customer Approval", kind: "approval" },
  { name: "Done (Ready for Prod)", kind: "done" },
];

export const PRIORITY_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
] as const;

export const PRIORITY_STYLES: Record<string, string> = {
  low: "bg-slate-100 text-slate-600",
  normal: "bg-blue-100 text-blue-700",
  high: "bg-amber-100 text-amber-700",
  urgent: "bg-red-100 text-red-700",
};

export const COLUMN_ACCENT: Record<ColumnKind, string> = {
  normal: "border-t-slate-400",
  exception: "border-t-amber-500",
  approval: "border-t-violet-500",
  done: "border-t-emerald-500",
};

export interface DefaultFieldDef {
  name: string;
  field_type: CustomFieldType;
  options: string[];
}

/**
 * Default print-production intake fields. These are seeded as custom fields so
 * admins can edit, reorder, or remove them. Everything on the New Print Job
 * form (except Order Number + Description + Priority + SKUs) is driven by these.
 */
/**
 * Name of the legacy "Designer Information" text field. The designer is now a
 * built-in dropdown (sourced from team members with the Designer role), so this
 * field is excluded from the generic custom-field rendering on the job form.
 */
export const DESIGNER_FIELD_NAME = "Designer Information";

/**
 * Name of the built-in "Order QTY" number field. When SKUs are present on a job,
 * this value is auto-calculated as the sum of all SKU quantities.
 */
export const ORDER_QTY_FIELD_NAME = "Order QTY";

/**
 * Name of the built-in "Artwork" link field. Rendered next to the order
 * description on the job form rather than in the generic field grid.
 */
export const ARTWORK_FIELD_NAME = "Artwork (GDrive link)";

export const CUSTOMER_NAME_FIELD_NAME = "Customer Name";
export const CUSTOMER_CONTACT_FIELD_NAME = "Customer Contact";

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

/** Max activity entries kept per order (display + storage). */
export const ACTIVITY_LOG_LIMIT = 50;
