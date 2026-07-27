import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  computeDesignerLeaderboard,
  currentMonthBounds,
} from "@/lib/designer-leaderboard";

type OrderRow = {
  id: string;
  created_at: string;
  column_id: string;
  specs: Record<string, unknown> | null;
};

async function fetchAllOrders(
  supabase: ReturnType<typeof createAdminClient>,
  tenantId: string,
  extra?: { dateFrom?: string; dateTo?: string }
): Promise<OrderRow[]> {
  const pageSize = 1000;
  const rows: OrderRow[] = [];
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    let q = supabase
      .from("orders")
      .select("id, created_at, column_id, specs")
      .eq("tenant_id", tenantId)
      .is("removed_at", null)
      .order("created_at", { ascending: true })
      .range(from, to);
    if (extra?.dateFrom) q = q.gte("created_at", extra.dateFrom);
    if (extra?.dateTo) q = q.lte("created_at", extra.dateTo);

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as OrderRow[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

/**
 * Designer motivational leaderboard for the current calendar month.
 *
 * Includes every assigned card created this month (any column), same
 * Orders/SKUs idea as Analytics → Designer workload. Fully paginated so
 * the whole month is loaded when the trophy is opened.
 */
export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { dateFrom, dateTo, monthKey, monthLabel } = currentMonthBounds();

  try {
    const [{ data: memberships, error: membershipsError }, monthOrders] =
      await Promise.all([
        supabase
          .from("memberships")
          .select("user_id, role")
          .eq("tenant_id", ctx.tenant.id)
          .eq("role", "designer"),
        fetchAllOrders(supabase, ctx.tenant.id, { dateFrom, dateTo }),
      ]);

    if (membershipsError) {
      return NextResponse.json(
        { error: membershipsError.message },
        { status: 500 }
      );
    }

    const designerIds = (memberships ?? []).map(
      (m: { user_id: string }) => m.user_id
    );

    const { data: profiles } =
      designerIds.length > 0
        ? await supabase
            .from("profiles")
            .select("id, full_name")
            .in("id", designerIds)
        : { data: [] as { id: string; full_name: string | null }[] };

    const profileNames = new Map(
      ((profiles ?? []) as { id: string; full_name: string | null }[]).map(
        (p) => [p.id, p.full_name?.trim() || "Unnamed"] as const
      )
    );

    const designers = designerIds.map((id) => ({
      id,
      name: profileNames.get(id) ?? "Unnamed",
    }));

    const leaderboard = computeDesignerLeaderboard({
      monthLabel,
      monthKey,
      dateFrom,
      dateTo,
      designers,
      orders: monthOrders.map((o) => ({
        id: o.id,
        created_at: o.created_at,
        specs: o.specs,
      })),
      profileNames,
    });

    return NextResponse.json(leaderboard);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
