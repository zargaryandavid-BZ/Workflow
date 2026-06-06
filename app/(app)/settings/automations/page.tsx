import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SystemConfigPanel } from "@/components/settings/SystemConfigPanel";
import { AutomationsManager } from "./automations-manager";
import type { AutomationRule, BoardColumn } from "@/lib/types";

export default async function AutomationsSettingsPage() {
  const ctx = await getTenantContext();
  if (!ctx) return null;
  if (ctx.role !== "admin") redirect("/board");

  const supabase = await createClient();
  const [rulesRes, columnsRes] = await Promise.all([
    supabase
      .from("automation_rules")
      .select("*")
      .eq("tenant_id", ctx.tenant.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("board_columns")
      .select("*")
      .eq("tenant_id", ctx.tenant.id)
      .order("position", { ascending: true }),
  ]);

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-800">Automations</h1>
      <p className="mb-6 text-sm text-slate-500">
        Notify customers and move jobs automatically as they flow through the
        pipeline.
      </p>
      <AutomationsManager
        initialRules={(rulesRes.data ?? []) as AutomationRule[]}
        columns={(columnsRes.data ?? []) as BoardColumn[]}
      />
      <SystemConfigPanel />
    </div>
  );
}
