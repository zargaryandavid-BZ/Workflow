import type { FastActionButton, FastActionButtonColor, Role } from "@/lib/types";
import { userPassesVisibility } from "@/lib/check-visibility";

export const FAST_ACTION_BUTTON_COLORS: FastActionButtonColor[] = [
  "blue",
  "green",
  "red",
  "orange",
  "yellow",
  "purple",
  "gray",
];

export const FAST_ACTION_COLOR_LABELS: Record<FastActionButtonColor, string> = {
  blue: "Blue",
  green: "Green",
  red: "Red",
  orange: "Orange",
  yellow: "Yellow",
  purple: "Purple",
  gray: "Gray",
};

/** Tailwind classes for the pill buttons rendered in the order modal. */
export const FAST_ACTION_COLOR_CLASSES: Record<FastActionButtonColor, string> =
  {
    blue: "bg-blue-100 text-blue-700 hover:bg-blue-200",
    green: "bg-green-100 text-green-700 hover:bg-green-200",
    red: "bg-red-100 text-red-700 hover:bg-red-200",
    orange: "bg-orange-100 text-orange-700 hover:bg-orange-200",
    yellow: "bg-yellow-100 text-yellow-700 hover:bg-yellow-200",
    purple: "bg-purple-100 text-purple-700 hover:bg-purple-200",
    gray: "bg-slate-100 text-slate-600 hover:bg-slate-200",
  };

/** Dot colors used in the settings list row. */
export const FAST_ACTION_DOT_CLASSES: Record<FastActionButtonColor, string> = {
  blue: "bg-blue-500",
  green: "bg-green-500",
  red: "bg-red-500",
  orange: "bg-orange-500",
  yellow: "bg-yellow-400",
  purple: "bg-purple-500",
  gray: "bg-slate-400",
};

/** All roles that can be configured for visibility. */
export const FAST_ACTION_ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "preprod_owner", label: "Pre-Production Owner" },
  { value: "designer", label: "Designer" },
  { value: "account_manager", label: "Account Manager" },
];

/**
 * Filter buttons for display in the order modal.
 * - Never show a button whose destination is the card's current column.
 * - Respect show_in_columns (empty = all).
 * - Visibility: use the new visibility_mode/roles/users columns when present,
 *   falling back to legacy visible_to_roles for older rows.
 */
export function filterFastActionButtons(
  buttons: FastActionButton[],
  currentColumnId: string,
  userRole: Role,
  userId?: string
): FastActionButton[] {
  return buttons.filter((btn) => {
    if (btn.destination_column_id === currentColumnId) return false;

    if (
      btn.show_in_columns.length > 0 &&
      !btn.show_in_columns.includes(currentColumnId)
    )
      return false;

    // Prefer new unified visibility columns; fall back to legacy visible_to_roles.
    const mode = btn.visibility_mode ?? "all";
    if (mode !== "all" || (btn.visibility_roles?.length ?? 0) > 0 || (btn.visibility_users?.length ?? 0) > 0) {
      return userPassesVisibility(userId ?? "", userRole, {
        mode,
        roles: btn.visibility_roles ?? [],
        userIds: btn.visibility_users ?? [],
      });
    }

    // Legacy fallback
    if (
      btn.visible_to_roles.length > 0 &&
      !btn.visible_to_roles.includes(userRole)
    )
      return false;

    return true;
  });
}

export function isFastActionButtonColor(
  value: unknown
): value is FastActionButtonColor {
  return (
    typeof value === "string" &&
    (FAST_ACTION_BUTTON_COLORS as string[]).includes(value)
  );
}
