import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { NotificationRule } from "@/lib/types";

function isMissingNotificationRulesTable(error: { message?: string } | null) {
  const msg = error?.message?.toLowerCase() ?? "";
  return (
    msg.includes("notification_rules") ||
    msg.includes("schema cache") ||
    msg.includes("pgrst205")
  );
}

export async function loadNotificationRules(
  supabase: SupabaseClient,
  tenantId: string
): Promise<NotificationRule[]> {
  const { data, error } = await supabase
    .from("notification_rules")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("position", { ascending: true });

  if (error) {
    if (isMissingNotificationRulesTable(error)) return [];
    throw error;
  }
  return (data ?? []) as NotificationRule[];
}

export async function loadNotificationRulesWithStatus(
  supabase: SupabaseClient,
  tenantId: string
): Promise<{ rules: NotificationRule[]; migrationRequired: boolean }> {
  const { data, error } = await supabase
    .from("notification_rules")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("position", { ascending: true })
    .limit(1);

  if (error && isMissingNotificationRulesTable(error)) {
    return { rules: [], migrationRequired: true };
  }

  const rules = await loadNotificationRules(supabase, tenantId);
  return { rules, migrationRequired: false };
}

export function notificationRulesMigrationMessage(): string {
  return "Notification Rules require migration 0023_notification_rules.sql. Run it in Supabase or use supabase db push.";
}
