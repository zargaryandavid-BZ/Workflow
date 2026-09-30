import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantContext } from "@/lib/auth";
import {
  durationSeconds,
  timerKindFromActivity,
} from "@/lib/time-tracking";

/**
 * Every currently-running timer across the tenant (all users), with the worker's
 * name. Pre-production owners receive Prepress entries plus their own entries;
 * other designers' timers stay hidden from that role. Control of another
 * person's timer remains gated separately (see PATCH /api/time-entries/[id]).
 */
export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Service-role client: tenant access is already verified above via
  // getTenantContext(). RLS on time_entries only lets a member read their OWN
  // rows (or every row when they are a tenant admin), so a user-scoped client
  // returns an empty board for non-admins (designers, account managers) and the
  // "who is working" chip never appears for them. Read tenant-wide here, scoped
  // explicitly by tenant_id below — this endpoint exposes only non-sensitive
  // "who is working + for how long" data for the caller's own tenant.
  const supabase = createAdminClient();
  const query = supabase
    .from("time_entries")
    .select("id, user_id, order_id, activity_type, started_at, ended_at, paused_at, paused_seconds")
    .eq("tenant_id", ctx.tenant.id)
    .is("ended_at", null)
    .not("order_id", "is", null);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = ((data ?? []) as Array<{
    id: string;
    user_id: string;
    order_id: string | null;
    activity_type: string;
    started_at: string;
    ended_at: string | null;
    paused_at: string | null;
    paused_seconds: number | null;
  }>).filter((row) => {
    const kind = timerKindFromActivity(row.activity_type);
    if (ctx.role === "admin") return true;
    if (ctx.role === "preprod_owner") {
      return kind === "prepress" || row.user_id === ctx.userId;
    }
    return kind === "designer";
  });

  const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
  const nameById = new Map<string, string>();
  if (userIds.length) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", userIds);
    for (const p of (profiles ?? []) as Array<{ id: string; full_name: string | null }>) {
      const name = p.full_name?.trim();
      if (name) nameById.set(p.id, name);
    }
  }

  const nowMs = Date.now();
  const entries = rows.map((r) => ({
    id: r.id,
    user_id: r.user_id,
    worker_name: nameById.get(r.user_id) ?? "",
    order_id: r.order_id,
    timer_kind: timerKindFromActivity(r.activity_type),
    started_at: r.started_at,
    ended_at: r.ended_at,
    paused_at: r.paused_at,
    paused_seconds: Number(r.paused_seconds) || 0,
    running: !r.paused_at,
    elapsed_seconds: durationSeconds(r.started_at, null, nowMs, {
      pausedAt: r.paused_at,
      pausedSeconds: Number(r.paused_seconds) || 0,
    }),
  }));

  return NextResponse.json({ entries });
}
