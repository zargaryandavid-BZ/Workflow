import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ButtonAutomation } from "@/lib/types";

function isMissingButtonAutomationsTable(error: { message?: string; code?: string }) {
  const msg = error.message ?? "";
  return (
    error.code === "PGRST205" ||
    msg.includes("button_automations") ||
    msg.includes("schema cache")
  );
}

/** Returns [] when migration 0022 has not been applied yet. */
export async function loadButtonAutomations(
  supabase: SupabaseClient,
  tenantId: string
): Promise<ButtonAutomation[]> {
  const { buttons } = await loadButtonAutomationsWithStatus(supabase, tenantId);
  return buttons;
}

export async function loadButtonAutomationsWithStatus(
  supabase: SupabaseClient,
  tenantId: string
): Promise<{ buttons: ButtonAutomation[]; migrationRequired: boolean }> {
  const { data, error } = await supabase
    .from("button_automations")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("position", { ascending: true });

  if (error) {
    if (isMissingButtonAutomationsTable(error)) {
      return { buttons: [], migrationRequired: true };
    }
    throw new Error(error.message);
  }

  return { buttons: (data ?? []) as ButtonAutomation[], migrationRequired: false };
}

export function buttonAutomationsMigrationMessage() {
  return "Button Automation requires migration 0022_button_automations.sql. Run it in Supabase or use supabase db push.";
}
