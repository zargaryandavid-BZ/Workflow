import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadCardWarningRulesWithStatus } from "@/lib/card-warning-rules.server";
import { CardWarningsManager } from "./card-warnings-manager";
import type { BoardColumn } from "@/lib/types";

export default async function CardWarningsPage() {
  const ctx = await getTenantContext();
  if (!ctx) return null;
  if (ctx.role !== "admin") redirect("/board");

  const supabase = await createClient();
  const [{ rules, migrationRequired }, columnsRes] = await Promise.all([
    loadCardWarningRulesWithStatus(supabase, ctx.tenant.id),
    supabase
      .from("board_columns")
      .select("*")
      .eq("tenant_id", ctx.tenant.id)
      .order("position", { ascending: true }),
  ]);

  const columns = (columnsRes.data ?? []) as BoardColumn[];

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-800">Card Warnings</h1>
      <p className="mb-6 text-sm text-slate-500">
        Configure visual alerts for cards that haven&apos;t moved in a while.
      </p>

      {migrationRequired ? (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">Database migration required</p>
          <p className="mt-1 text-amber-800">
            Run migration{" "}
            <code className="rounded bg-amber-100 px-1">
              0030_card_warning_rules.sql
            </code>{" "}
            in the Supabase SQL editor, or run{" "}
            <code className="rounded bg-amber-100 px-1">supabase db push</code>{" "}
            from this project.
          </p>
        </div>
      ) : null}

      <CardWarningsManager
        initialRules={rules}
        columns={columns}
        disabled={migrationRequired}
        initialOpacity={ctx.tenant.warning_opacity ?? 30}
        initialSpeedMs={ctx.tenant.warning_speed_ms ?? 2500}
        initialSpreadPx={ctx.tenant.warning_spread_px ?? 3}
      />
    </div>
  );
}
