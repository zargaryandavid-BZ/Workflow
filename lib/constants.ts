import type { ColumnKind, Role } from "./types";

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
  preprod_owner: "P",
  designer: "D",
  account_manager: "A",
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

/** Kanban card styling when no designer is assigned. */
export const UNASSIGNED_DESIGNER_CARD_CLASS =
  "border-amber-300 bg-amber-50/90 hover:border-amber-400";
export const UNASSIGNED_DESIGNER_TEXT_CLASS = "font-medium text-amber-800";

export const COLUMN_ACCENT: Record<ColumnKind, string> = {
  normal: "border-t-slate-400",
  exception: "border-t-amber-500",
  approval: "border-t-violet-500",
  done: "border-t-emerald-500",
};

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

/** Max activity entries kept per order (display + storage). */
export const ACTIVITY_LOG_LIMIT = 50;
