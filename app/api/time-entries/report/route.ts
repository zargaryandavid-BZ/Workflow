import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import {
  durationSeconds,
  localDateString,
  localDayEndExclusiveIso,
  localDayStartIso,
  startOfWeekMonday,
  addDays,
  type TimeReportResponse,
} from "@/lib/time-tracking";

type RawEntry = {
  id: string;
  user_id: string;
  order_id: string | null;
  order_title: string | null;
  custom_task_name: string | null;
  activity_type: string;
  started_at: string;
  ended_at: string | null;
  paused_at: string | null;
  paused_seconds: number;
  order?: { title: string } | { title: string }[] | null;
};

function orderTitle(row: RawEntry): string {
  const custom = row.custom_task_name?.trim();
  if (custom) return custom;
  const joined = Array.isArray(row.order) ? row.order[0] : row.order;
  const live = joined?.title?.trim();
  if (live) return live;
  return row.order_title?.trim() || "Untitled job";
}

export async function GET(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const isAdmin = ctx.role === "admin";

  let from = searchParams.get("from");
  let to = searchParams.get("to");
  if (!from || !to) {
    const weekStart = startOfWeekMonday();
    from = from ?? localDateString(weekStart);
    to = to ?? localDateString(addDays(weekStart, 6));
  }

  const userIdParam = searchParams.get("user_id");
  // null user filter = all designers (admin only)
  let filterUserId: string | null = ctx.userId;
  if (isAdmin) {
    if (userIdParam === "all" || userIdParam === "") {
      filterUserId = null;
    } else if (userIdParam) {
      filterUserId = userIdParam;
    }
  } else if (userIdParam && userIdParam !== ctx.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  let query = supabase
    .from("time_entries")
    .select(
      "id, user_id, order_id, order_title, custom_task_name, activity_type, started_at, ended_at, paused_at, paused_seconds, order:orders(title)"
    )
    .eq("tenant_id", ctx.tenant.id)
    .gte("started_at", localDayStartIso(from))
    .lt("started_at", localDayEndExclusiveIso(to));

  if (filterUserId) {
    query = query.eq("user_id", filterUserId);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as RawEntry[];
  const nowMs = Date.now();

  const dailyMap = new Map<string, number>();
  const jobMap = new Map<string, { job_id: string | null; job_title: string; seconds: number }>();
  const activityMap = new Map<string, number>();
  const userMap = new Map<string, number>();

  for (const row of rows) {
    const secs = durationSeconds(row.started_at, row.ended_at, nowMs, {
      pausedAt: row.paused_at,
      pausedSeconds: Number(row.paused_seconds) || 0,
    });
    const day = localDateString(new Date(row.started_at));
    dailyMap.set(day, (dailyMap.get(day) ?? 0) + secs);
    activityMap.set(
      row.activity_type,
      (activityMap.get(row.activity_type) ?? 0) + secs
    );
    userMap.set(row.user_id, (userMap.get(row.user_id) ?? 0) + secs);

    const title = orderTitle(row);
    const key = row.order_id ?? `custom:${title}`;
    const existing = jobMap.get(key);
    if (existing) {
      existing.seconds += secs;
    } else {
      jobMap.set(key, {
        job_id: row.order_id,
        job_title: title,
        seconds: secs,
      });
    }
  }

  // Fill every day in range so the chart has continuous bars
  const daily_totals: { date: string; seconds: number }[] = [];
  {
    const [fy, fm, fd] = from.split("-").map(Number);
    const [ty, tm, td] = to.split("-").map(Number);
    const cursor = new Date(fy, fm - 1, fd);
    const end = new Date(ty, tm - 1, td);
    while (cursor <= end) {
      const key = localDateString(cursor);
      daily_totals.push({ date: key, seconds: dailyMap.get(key) ?? 0 });
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  const per_job = [...jobMap.values()].sort((a, b) => b.seconds - a.seconds);
  const per_activity = [...activityMap.entries()]
    .map(([activity_type, seconds]) => ({ activity_type, seconds }))
    .sort((a, b) => b.seconds - a.seconds);

  const report: TimeReportResponse = {
    daily_totals,
    per_job,
    per_activity,
  };

  if (isAdmin && filterUserId === null) {
    const userIds = [...userMap.keys()];
    const nameById = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", userIds);
      for (const p of (profiles ?? []) as {
        id: string;
        full_name: string | null;
      }[]) {
        nameById.set(p.id, p.full_name?.trim() || "Unnamed");
      }
    }
    report.per_user = [...userMap.entries()]
      .map(([user_id, seconds]) => ({
        user_id,
        display_name: nameById.get(user_id) ?? "Unnamed",
        seconds,
      }))
      .sort((a, b) => b.seconds - a.seconds);
  }

  return NextResponse.json(report);
}
