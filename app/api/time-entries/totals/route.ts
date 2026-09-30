import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { durationSeconds } from "@/lib/time-tracking";

/**
 * Per-order cumulative worked seconds for the current user, across ALL of their
 * time entries (finished + running). The board uses this so a card keeps showing
 * how long was worked after the timer is stopped — instead of dropping the time.
 */
export async function GET(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();
  const timerKind = new URL(request.url).searchParams.get("timer_kind");
  let query = supabase
    .from("time_entries")
    .select("order_id, activity_type, started_at, ended_at, paused_at, paused_seconds")
    .eq("tenant_id", ctx.tenant.id)
    .eq("user_id", ctx.userId)
    .not("order_id", "is", null);

  query =
    timerKind === "prepress"
      ? query.eq("activity_type", "Prepress")
      : query.neq("activity_type", "Prepress");

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
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
    const secs = durationSeconds(row.started_at, row.ended_at, nowMs, {
      pausedAt: row.paused_at,
      pausedSeconds: Number(row.paused_seconds) || 0,
    });
    totals[row.order_id] = (totals[row.order_id] ?? 0) + secs;
  }

  return NextResponse.json({ totals });
}
