import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { normalizeEmergencyBalance } from "@/lib/emergency-balance";
import { EmergencyBalanceManager } from "./emergency-balance-manager";
import type { BoardColumn } from "@/lib/types";

export default async function EmergencyBalancePage() {
  const ctx = await getTenantContext();
  if (!ctx) return null;
  if (ctx.role !== "admin") redirect("/board");

  const supabase = await createClient();
  const [{ data, error }, columnsRes] = await Promise.all([
    supabase
      .from("tenants")
      .select("emergency_balance")
      .eq("id", ctx.tenant.id)
      .maybeSingle(),
    supabase
      .from("board_columns")
      .select("*")
      .eq("tenant_id", ctx.tenant.id)
      .order("position", { ascending: true }),
  ]);

  const migrationRequired = Boolean(
    error && /emergency_balance|column .* does not exist/i.test(error.message)
  );

  const columns = (columnsRes.data ?? []) as BoardColumn[];
  const columnRefs = columns.map((c) => ({ id: c.id, name: c.name }));

  const initial = normalizeEmergencyBalance(
    migrationRequired
      ? null
      : (data as { emergency_balance?: unknown } | null)?.emergency_balance ??
          ctx.tenant.emergency_balance,
    columnRefs
  );

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-800">
        Emergency Balance
      </h1>
      <p className="mb-6 text-sm text-slate-500">
        Pick a board column, then set IF → THEN conditions. Empty conditions
        mean no emergency warning for that column. New board columns show up
        here automatically.
      </p>

      <EmergencyBalanceManager
        columns={columns}
        initial={initial}
        migrationRequired={migrationRequired}
      />
    </div>
  );
}
