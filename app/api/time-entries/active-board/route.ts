import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { durationSeconds } from "@/lib/time-tracking";

/**
 * Every currently-running timer across the tenant (all users), with the worker's
 * name. Anyone who can open the board gets this so the "who's working this card
 * and for how long" chip shows on every card they can see — the board component
 * only renders it on cards the user is already allowed to see. Control of another
 * person's timer stays gated (see PATCH /api/time-entries/[id]).
 */
export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("time_entries")
    .select("id, user_id, order_id, started_at, ended_at, paused_at, paused_seconds")
    .eq("tenant_id", ctx.tenant.id)
    .is("ended_at", null)
    .not("order_id", "is", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as Array<{
    id: string;
    user_id: string;
    order_id: string | null;
    started_at: string;
    ended_at: string | null;
    paused_at: string | null;
    paused_seconds: number | null;
  }>;

  const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
  const nameById = new Map<string, string>();
  if (userIds.length) {
    const { data: profiles } = await supabase
      .from("user_profiles")
      .select("id, full_name")
      .in("id", userIds);
    for (const p of (profiles ?? []) as Array<{ id: string; full_name: string | null }>) {
      nameById.set(p.id, p.full_name?.trim() || "Unnamed");
    }
  }

  const nowMs = Date.now();
  const entries = rows.map((r) => ({
    id: r.id,
    user_id: r.user_id,
    worker_name: nameById.get(r.user_id) ?? "Unnamed",
    order_id: r.order_id,
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
