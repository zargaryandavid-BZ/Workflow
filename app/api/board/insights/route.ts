import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { INSIGHTS_PERIODS, loadBoardInsights } from "@/lib/board-insights.server";
import { getSharedDriveCache, setSharedDriveCache } from "@/lib/drive-status-cache";
import type { BoardInsights } from "@/lib/board-insights";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TTL_MS = 60_000;

/** Board health dashboard data: workload, flow, bottlenecks, quality, actions. `?days=7|30|90`. */
export async function GET(req: Request) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const raw = Number(new URL(req.url).searchParams.get("days") ?? 30);
  const days = (INSIGHTS_PERIODS as readonly number[]).includes(raw) ? raw : 30;

  const key = `${ctx.tenant.id}:board-insights:${days}`;
  const cached = await getSharedDriveCache<BoardInsights>(key);
  if (cached) return NextResponse.json(cached);

  try {
    // Tenant membership is checked above (getTenantContext); every query is
    // filtered by tenant_id. The service client skips per-row RLS checks on
    // thousands of activity rows, which made this scan take minutes.
    const timings: Record<string, number> = {};
    const data = await loadBoardInsights(createAdminClient(), ctx.tenant.id, days, timings);
    await setSharedDriveCache(key, data, TTL_MS);
    return NextResponse.json(data, {
      headers: { "Server-Timing": Object.entries(timings).map(([k, v]) => `${k};dur=${v}`).join(", ") },
    });
  } catch (err) {
    console.error("[board/insights]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load insights" },
      { status: 500 }
    );
  }
}
