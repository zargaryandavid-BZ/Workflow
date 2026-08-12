import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { evaluateBoardHealth } from "@/lib/board-health";
import { loadEnabledCardWarningRules } from "@/lib/card-warning-rules.server";
import { normalizeWorkingDays } from "@/lib/card-warning-rules";
import { normalizeEmergencyBalance } from "@/lib/emergency-balance";
import type { BoardColumn, CardWarningRule } from "@/lib/types";

export const dynamic = "force-dynamic";

const PAGE = 1000;

type OrderRow = {
  id: string;
  column_id: string;
  due_date: string | null;
  last_moved_at: string | null;
  specs: unknown;
  tag: { name: string | null } | { name: string | null }[] | null;
};

function tagName(
  tag: OrderRow["tag"]
): { name?: string | null } | null {
  if (!tag) return null;
  if (Array.isArray(tag)) return tag[0] ?? null;
  return tag;
}

export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createClient();
  const tenantId = ctx.tenant.id;

  const [columnsRes, rules] = await Promise.all([
    supabase
      .from("board_columns")
      .select("id, name, kind")
      .eq("tenant_id", tenantId)
      .order("position", { ascending: true }),
    loadEnabledCardWarningRules(supabase, tenantId),
  ]);

  const columns = (columnsRes.data ?? []) as Pick<
    BoardColumn,
    "id" | "name" | "kind"
  >[];

  const orders: OrderRow[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("orders")
      .select("id, column_id, due_date, last_moved_at, specs, tag:tags(name)")
      .eq("tenant_id", tenantId)
      .is("removed_at", null)
      .range(from, from + PAGE - 1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const batch = (data ?? []) as unknown as OrderRow[];
    orders.push(...batch);
    if (batch.length < PAGE) break;
    from += PAGE;
  }

  const emergencyBalance = normalizeEmergencyBalance(
    ctx.tenant.emergency_balance,
    columns.map((c) => ({ id: c.id, name: c.name }))
  );

  const health = evaluateBoardHealth({
    columns,
    orders: orders.map((o) => ({
      id: o.id,
      column_id: o.column_id,
      due_date: o.due_date,
      last_moved_at: o.last_moved_at,
      specs: o.specs,
      tag: tagName(o.tag),
    })),
    warningRules: rules as CardWarningRule[],
    warningWorkingDays: normalizeWorkingDays(ctx.tenant.warning_working_days),
    emergencyBalance,
  });

  return NextResponse.json(health);
}
