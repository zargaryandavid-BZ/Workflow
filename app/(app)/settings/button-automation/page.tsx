import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadButtonAutomationsWithStatus } from "@/lib/button-automations.server";
import { ButtonAutomationManager } from "./button-automation-manager";
import type { BoardColumn } from "@/lib/types";

export default async function ButtonAutomationSettingsPage() {
  const ctx = await getTenantContext();
  if (!ctx) return null;
  if (ctx.role !== "admin") redirect("/board");

  const supabase = await createClient();
  const [{ buttons, migrationRequired }, columnsRes] = await Promise.all([
    loadButtonAutomationsWithStatus(supabase, ctx.tenant.id),
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
      {migrationRequired ? (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">Database migration required</p>
          <p className="mt-1 text-amber-800">
            Run migration{" "}
            <code className="rounded bg-amber-100 px-1">
              0022_button_automations.sql
            </code>{" "}
            in the Supabase SQL editor, or run{" "}
            <code className="rounded bg-amber-100 px-1">supabase db push</code>{" "}
            from this project.
          </p>
        </div>
      ) : null}
      <ButtonAutomationManager
        initialButtons={buttons}
        columns={(columnsRes.data ?? []) as BoardColumn[]}
        disabled={migrationRequired}
      />
    </div>
  );
}
