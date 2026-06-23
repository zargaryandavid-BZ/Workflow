import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { FastActionButton } from "@/lib/types";

function isMissingFastActionButtonsTable(
  error: { message?: string; code?: string } | null
) {
  if (!error) return false;
  const msg = error.message?.toLowerCase() ?? "";
  return (
    error.code === "PGRST205" ||
    msg.includes("fast_action_buttons") ||
    msg.includes("schema cache")
  );
}

/** Returns [] when migration 0024 has not been applied yet. */
export async function loadFastActionButtons(
  supabase: SupabaseClient,
  tenantId: string
): Promise<FastActionButton[]> {
  const { buttons } = await loadFastActionButtonsWithStatus(supabase, tenantId);
  return buttons;
}

export async function loadFastActionButtonsWithStatus(
  supabase: SupabaseClient,
  tenantId: string
): Promise<{ buttons: FastActionButton[]; migrationRequired: boolean }> {
  const { data, error } = await supabase
    .from("fast_action_buttons")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("enabled", true)
    .order("position", { ascending: true });

  if (error) {
    if (isMissingFastActionButtonsTable(error)) {
      return { buttons: [], migrationRequired: true };
    }
    throw new Error(error.message);
  }

  return {
    buttons: (data ?? []) as FastActionButton[],
    migrationRequired: false,
  };
}

/** Used in the settings page — loads all buttons (including disabled). */
export async function loadAllFastActionButtonsWithStatus(
  supabase: SupabaseClient,
  tenantId: string
): Promise<{ buttons: FastActionButton[]; migrationRequired: boolean }> {
  const { data, error } = await supabase
    .from("fast_action_buttons")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("position", { ascending: true });

  if (error) {
    if (isMissingFastActionButtonsTable(error)) {
      return { buttons: [], migrationRequired: true };
    }
    throw new Error(error.message);
  }

  return {
    buttons: (data ?? []) as FastActionButton[],
    migrationRequired: false,
  };
}

export function fastActionButtonsMigrationMessage(): string {
  return "Fast Action Buttons require migration 0024_fast_action_buttons.sql. Run it in Supabase or use supabase db push.";
}
