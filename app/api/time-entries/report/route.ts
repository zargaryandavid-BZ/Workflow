import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { skuCountFromSpecs } from "@/lib/skus";
import {
  durationSeconds,
  formatTimeReportJobLabel,
  localDateString,
  localDayEndExclusiveIso,
  localDayStartIso,
  startOfWeekMonday,
  addDays,
  type TimeReportResponse,
} from "@/lib/time-tracking";

type OrderJoin = {
  title: string;
  specs: Record<string, unknown> | null;
  customer: { name: string } | { name: string }[] | null;
} | null;

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
  order?: OrderJoin | OrderJoin[] | null;
};

function joinedOrder(row: RawEntry): OrderJoin {
  const j = row.order;
  if (!j) return null;
  return Array.isArray(j) ? j[0] ?? null : j;
}

function customerNameFromJoin(order: OrderJoin): string | null {
  if (!order?.customer) return null;
  const c = Array.isArray(order.customer) ? order.customer[0] : order.customer;
  return c?.name?.trim() || null;
}

function orderTitle(row: RawEntry): string {
  const custom = row.custom_task_name?.trim();
  if (custom && !row.order_id) return custom;
  const joined = joinedOrder(row);
  const live = joined?.title?.trim();
  if (live) return live;
  return row.order_title?.trim() || "Untitled job";
}

function jobLabel(row: RawEntry): string {
  const custom = row.custom_task_name?.trim();
  if (custom && !row.order_id) return custom;
  const joined = joinedOrder(row);
  return formatTimeReportJobLabel({
    orderTitle: orderTitle(row),
    specs: joined?.specs ?? null,
    customerName: customerNameFromJoin(joined),
  });
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
      "id, user_id, order_id, order_title, custom_task_name, activity_type, started_at, ended_at, paused_at, paused_seconds, order:orders(title, specs, customer:customers(name))"
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
  const dailyJobs = new Map<string, Map<string, number>>();
  const jobMap = new Map<
    string,
    { job_id: string | null; job_title: string; job_label: string; seconds: number; userIds: Set<string> }
  >();
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
    const label = jobLabel(row);
    const key = row.order_id ?? `custom:${title}`;
    const joined = joinedOrder(row);
    const skuCount = row.order_id
      ? Math.max(1, skuCountFromSpecs(joined?.specs ?? null))
      : 1;
    const jobsForDay = dailyJobs.get(day) ?? new Map<string, number>();
    jobsForDay.set(key, skuCount);
    dailyJobs.set(day, jobsForDay);

    const existing = jobMap.get(key);
    if (existing) {
      existing.seconds += secs;
      existing.userIds.add(row.user_id);
    } else {
      jobMap.set(key, {
        job_id: row.order_id,
        job_title: title,
        job_label: label,
        seconds: secs,
        userIds: new Set([row.user_id]),
      });
    }
  }

  // Fill every day in range so the chart has continuous bars
  const daily_totals: TimeReportResponse["daily_totals"] = [];
  {
    const [fy, fm, fd] = from.split("-").map(Number);
    const [ty, tm, td] = to.split("-").map(Number);
    const cursor = new Date(fy, fm - 1, fd);
    const end = new Date(ty, tm - 1, td);
    while (cursor <= end) {
      const key = localDateString(cursor);
      const jobs = dailyJobs.get(key);
      let sku_count = 0;
      if (jobs) {
        for (const n of jobs.values()) sku_count += n;
      }
      daily_totals.push({
        date: key,
        seconds: dailyMap.get(key) ?? 0,
        job_count: jobs?.size ?? 0,
        sku_count,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  const per_activity = [...activityMap.entries()]
    .map(([activity_type, seconds]) => ({ activity_type, seconds }))
    .sort((a, b) => b.seconds - a.seconds);

  // Resolve all user IDs that appear anywhere (job designers + per_user)
  const allUserIds = new Set([...userMap.keys()]);
  for (const j of jobMap.values()) {
    for (const uid of j.userIds) allUserIds.add(uid);
  }
  const nameById = new Map<string, string>();
  if (allUserIds.size > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", [...allUserIds]);
    for (const p of (profiles ?? []) as { id: string; full_name: string | null }[]) {
      nameById.set(p.id, p.full_name?.trim() || "Unnamed");
    }
  }

  const per_job = [...jobMap.values()]
    .sort((a, b) => b.seconds - a.seconds)
    .map(({ userIds, ...rest }) => ({
      ...rest,
      designers: [...userIds]
        .map((id) => nameById.get(id) ?? "Unnamed")
        .sort((a, b) => a.localeCompare(b)),
    }));

  const report: TimeReportResponse = {
    daily_totals,
    per_job,
    per_activity,
  };

  if (isAdmin && filterUserId === null) {
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
