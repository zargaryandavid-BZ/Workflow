import type { SupabaseClient } from "@supabase/supabase-js";
import type { CardWarningRule } from "./types";

export function cardWarningRulesMigrationMessage(): string {
  return (
    "Run migration 0030_card_warning_rules.sql in the Supabase SQL editor, " +
    "or run `supabase db push` from this project."
  );
}

export async function loadCardWarningRulesWithStatus(
  supabase: SupabaseClient,
  tenantId: string
): Promise<{ rules: CardWarningRule[]; migrationRequired: boolean }> {
  const { data, error } = await supabase
    .from("card_warning_rules")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("threshold_days", { ascending: true })
    .order("position", { ascending: true });

  if (error) {
    const msg = error.message ?? "";
    if (
      msg.includes("does not exist") ||
      msg.includes("relation") ||
      error.code === "42P01"
    ) {
      return { rules: [], migrationRequired: true };
    }
    return { rules: [], migrationRequired: false };
  }

  return { rules: (data ?? []) as CardWarningRule[], migrationRequired: false };
}

export async function loadEnabledCardWarningRules(
  supabase: SupabaseClient,
  tenantId: string
): Promise<CardWarningRule[]> {
  const { data } = await supabase
    .from("card_warning_rules")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("enabled", true)
    .order("threshold_days", { ascending: true });

  return (data ?? []) as CardWarningRule[];
}
