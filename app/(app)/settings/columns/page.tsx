import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ColumnsManager } from "./columns-manager";
import type { BoardColumn } from "@/lib/types";

export default async function ColumnsSettingsPage() {
  const ctx = await getTenantContext();
  if (!ctx) return null;
  if (ctx.role !== "admin") redirect("/board");

  const supabase = await createClient();
  const [columnsRes, ordersRes] = await Promise.all([
    supabase
      .from("board_columns")
      .select("*")
      .eq("tenant_id", ctx.tenant.id)
      .order("position", { ascending: true }),
    supabase.from("orders").select("column_id").eq("tenant_id", ctx.tenant.id),
  ]);

  const counts: Record<string, number> = {};
  for (const o of (ordersRes.data ?? []) as { column_id: string }[]) {
    counts[o.column_id] = (counts[o.column_id] ?? 0) + 1;
  }

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-800">
        Production Columns
      </h1>
      <p className="mb-5 text-sm text-slate-500">
        Define your pipeline stages. Reorder them, set a color and picture, edit
        names, and remove stages you no longer need.
      </p>
      <ColumnsManager
        initialColumns={(columnsRes.data ?? []) as BoardColumn[]}
        orderCounts={counts}
      />
    </div>
  );
}
