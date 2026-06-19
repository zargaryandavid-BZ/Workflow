import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ButtonAutomationManager } from "./button-automation-manager";
import type { BoardColumn, ButtonAutomation } from "@/lib/types";

export default async function ButtonAutomationSettingsPage() {
  const ctx = await getTenantContext();
  if (!ctx) return null;
  if (ctx.role !== "admin") redirect("/board");

  const supabase = await createClient();
  const [buttonsRes, columnsRes] = await Promise.all([
    supabase
      .from("button_automations")
      .select("*")
      .eq("tenant_id", ctx.tenant.id)
      .order("position", { ascending: true }),
    supabase
      .from("board_columns")
      .select("*")
      .eq("tenant_id", ctx.tenant.id)
      .order("position", { ascending: true }),
  ]);

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-800">Button Automation</h1>
      <p className="mb-5 text-sm text-slate-500">
        Action buttons shown in order detail modals — filtered by column.
      </p>
      <ButtonAutomationManager
        initialButtons={(buttonsRes.data ?? []) as ButtonAutomation[]}
        columns={(columnsRes.data ?? []) as BoardColumn[]}
      />
    </div>
  );
}
