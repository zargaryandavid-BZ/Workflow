import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantContext } from "@/lib/auth";
import { durationSeconds } from "@/lib/time-tracking";

/**
 * Per-order cumulative worked seconds across EVERY user in the tenant (finished
 * + running + paused entries). This powers the always-on "total time worked on
 * this job" badge on the board card, so anyone who can see a card sees how long
 * has been spent on it without opening it — even after the timer is stopped and
 * even when the person who worked it is someone else.
 *
 * Uses the service-role client for the same reason as active-board: RLS on
 * time_entries only lets a member read their own rows (or all rows if admin), so
 * a user-scoped client would return each person only their own time. The query
 * is scoped explicitly by tenant_id and returns only aggregate durations.
 */
export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("time_entries")
    .select("order_id, started_at, ended_at, paused_at, paused_seconds")
    .eq("tenant_id", ctx.tenant.id)
    .not("order_id", "is", null);

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
