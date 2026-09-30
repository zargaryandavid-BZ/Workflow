import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantContext } from "@/lib/auth";
import { durationSeconds } from "@/lib/time-tracking";
import { isColumnVisibleToUser } from "@/lib/columns";
import type { BoardColumn } from "@/lib/types";

/**
 * Per-order cumulative worked seconds across every user in the tenant (finished
 * + running + paused entries). Pre-production owners only receive their own
 * totals so designers' worked time stays hidden from that role.
 *
 * Uses the service-role client for the same reason as active-board: RLS on
 * time_entries only lets a member read their own rows (or all rows if admin), so
 * a user-scoped client would return each person only their own time. The query
 * is scoped explicitly by tenant_id and returns only aggregate durations.
 */
export async function GET(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const timerKind = new URL(request.url).searchParams.get("timer_kind");
  if (
    timerKind === "prepress" &&
    ctx.role !== "admin" &&
    ctx.role !== "preprod_owner"
  ) {
    return NextResponse.json({ totals: {} });
  }
  let query = supabase
    .from("time_entries")
    .select("order_id, activity_type, started_at, ended_at, paused_at, paused_seconds")
    .eq("tenant_id", ctx.tenant.id)
    .not("order_id", "is", null);

  query =
    timerKind === "prepress"
      ? query.eq("activity_type", "Prepress")
      : query.neq("activity_type", "Prepress");

  if (ctx.role === "preprod_owner" && timerKind !== "prepress") {
    query = query.eq("user_id", ctx.userId);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let visibleOrderIds: Set<string> | null = null;
  if (ctx.role !== "admin") {
    const { data: columns, error: columnsError } = await supabase
      .from("board_columns")
      .select(
        "id, visible_to_roles, visible_to_users, visibility_mode, visibility_roles, visibility_users_v2"
      )
      .eq("tenant_id", ctx.tenant.id);
    if (columnsError) {
      return NextResponse.json(
        { error: columnsError.message },
        { status: 500 }
      );
    }

    const visibleColumnIds = ((columns ?? []) as Pick<
      BoardColumn,
      | "id"
      | "visible_to_roles"
      | "visible_to_users"
      | "visibility_mode"
      | "visibility_roles"
      | "visibility_users_v2"
    >[])
      .filter((column) =>
        isColumnVisibleToUser(column, ctx.role, ctx.userId)
      )
      .map((column) => column.id);

    if (visibleColumnIds.length === 0) {
      return NextResponse.json({ totals: {} });
    }

    const { data: orders, error: ordersError } = await supabase
      .from("orders")
      .select("id")
      .eq("tenant_id", ctx.tenant.id)
      .in("column_id", visibleColumnIds)
      .is("removed_at", null);
    if (ordersError) {
      return NextResponse.json(
        { error: ordersError.message },
        { status: 500 }
      );
    }
    visibleOrderIds = new Set(
      ((orders ?? []) as { id: string }[]).map((order) => order.id)
    );
  }

  const nowMs = Date.now();
  const totals: Record<string, number> = {};
  for (const row of (data ?? []) as Array<{
    order_id: string | null;
    started_at: string;
    ended_at: string | null;
    paused_at: string | null;
    paused_seconds: number | null;
  }>) {
    if (!row.order_id) continue;
    if (visibleOrderIds && !visibleOrderIds.has(row.order_id)) continue;
    const secs = durationSeconds(row.started_at, row.ended_at, nowMs, {
      pausedAt: row.paused_at,
      pausedSeconds: Number(row.paused_seconds) || 0,
    });
    totals[row.order_id] = (totals[row.order_id] ?? 0) + secs;
  }

  return NextResponse.json({ totals });
}
