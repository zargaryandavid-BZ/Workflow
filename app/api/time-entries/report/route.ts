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
  timerKindFromActivity,
  type TimeReportResponse,
} from "@/lib/time-tracking";
import { pcWorkedSeconds, pcWorkedSecondsByLocalDay } from "@/lib/pc-worked-time";
import {
  computePrepressToProductionHandoffs,
  computeProductionStays,
  medianSeconds,
  moveNamesFromMetadata,
  parseReportKind,
} from "@/lib/prepress-production-handoff";

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

  const kind = parseReportKind(searchParams.get("kind"));

  const userIdParam = searchParams.get("user_id");
  // null user filter = all people (admin only)
  let filterUserId: string | null = ctx.userId;
  if (isAdmin) {
    if (userIdParam === "all" || userIdParam === "" || kind === "production") {
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

  const rows = ((data ?? []) as unknown as RawEntry[]).filter((row) => {
    if (kind === "production") return false;
    const timerKind = timerKindFromActivity(row.activity_type);
    return kind === "prepress"
      ? timerKind === "prepress"
      : timerKind === "designer";
  });
  const nowMs = Date.now();

  const dailyMap = new Map<string, number>();
  const dailyJobs = new Map<string, Map<string, number>>();
  const jobMap = new Map<
    string,
    {
      job_id: string | null;
      job_title: string;
      job_label: string;
      seconds: number;
      sku_count: number;
      userIds: Set<string>;
    }
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
      existing.sku_count = skuCount;
      existing.userIds.add(row.user_id);
    } else {
      jobMap.set(key, {
        job_id: row.order_id,
        job_title: title,
        job_label: label,
        seconds: secs,
        sku_count: skuCount,
        userIds: new Set([row.user_id]),
      });
    }
  }

  const dailyPc = pcWorkedSecondsByLocalDay(rows, nowMs);

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
        pc_seconds: dailyPc.get(key) ?? 0,
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
    pc_seconds: pcWorkedSeconds(rows, nowMs),
    kind,
  };

  if (isAdmin && filterUserId === null && kind !== "production") {
    report.per_user = [...userMap.entries()]
      .map(([user_id, seconds]) => ({
        user_id,
        display_name: nameById.get(user_id) ?? "Unnamed",
        seconds,
      }))
      .sort((a, b) => b.seconds - a.seconds);
  }

  if (kind === "prepress") {
    const handoff = await loadHandoffSummary(supabase, {
      tenantId: ctx.tenant.id,
      from,
      to,
    });
    report.prepress_to_production = handoff.summary;
  }

  if (kind === "production") {
    const flow = await loadProductionSummary(supabase, {
      tenantId: ctx.tenant.id,
      from,
      to,
    });
    report.production_flow = flow.summary;
    applyProductionHandoffJobs(report, flow.jobs);
  }

  return NextResponse.json(report);
}

const MOVE_ACTIONS = ["moved", "idle_auto_moved", "column_moved"];

type HandoffJobRow = TimeReportResponse["per_job"][number] & {
  entered_date: string;
};

function eachLocalDate(from: string, to: string): string[] {
  const dates: string[] = [];
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const cursor = new Date(fy, fm - 1, fd);
  const end = new Date(ty, tm - 1, td);
  while (cursor <= end) {
    dates.push(localDateString(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

async function loadHandoffSummary(
  supabase: Awaited<ReturnType<typeof createClient>>,
  opts: { tenantId: string; from: string; to: string }
): Promise<{
  summary: NonNullable<TimeReportResponse["prepress_to_production"]>;
  jobs: HandoffJobRow[];
}> {
  const emptyDaily = eachLocalDate(opts.from, opts.to).map((date) => ({
    date,
    count: 0,
    seconds: 0,
  }));
  const empty = {
    summary: {
      count: 0,
      avg_seconds: 0,
      median_seconds: 0,
      min_seconds: 0,
      max_seconds: 0,
      daily: emptyDaily,
    },
    jobs: [] as HandoffJobRow[],
  };

  const { data: columns } = await supabase
    .from("board_columns")
    .select("id, name")
    .eq("tenant_id", opts.tenantId);
  const nameById = new Map(
    ((columns ?? []) as { id: string; name: string | null }[]).map((c) => [
      c.id,
      c.name ?? "",
    ])
  );

  const fromDate = new Date(`${opts.from}T12:00:00`);
  const lookback = localDateString(addDays(fromDate, -90));
  const { data: logs } = await supabase
    .from("activity_log")
    .select("order_id, created_at, metadata")
    .eq("tenant_id", opts.tenantId)
    .in("action", MOVE_ACTIONS)
    .gte("created_at", localDayStartIso(lookback))
    .lt("created_at", localDayEndExclusiveIso(opts.to));

  const events = [];
  for (const row of (logs ?? []) as {
    order_id: string | null;
    created_at: string;
    metadata: Record<string, unknown> | null;
  }[]) {
    if (!row.order_id) continue;
    const names = moveNamesFromMetadata(row.metadata, nameById);
    events.push({
      orderId: row.order_id,
      at: row.created_at,
      fromName: names.fromName,
      toName: names.toName,
    });
  }

  const rangeStart = Date.parse(localDayStartIso(opts.from));
  const rangeEnd = Date.parse(localDayEndExclusiveIso(opts.to));
  const inRange = computePrepressToProductionHandoffs(events).filter((h) => {
    const t = Date.parse(h.enteredProductionAt);
    return Number.isFinite(t) && t >= rangeStart && t < rangeEnd;
  });

  const secondsList = inRange.map((h) => h.seconds);
  const byDay = new Map(emptyDaily.map((d) => [d.date, { ...d }]));
  for (const h of inRange) {
    const date = localDateString(new Date(h.enteredProductionAt));
    const cur = byDay.get(date);
    if (cur) {
      cur.count += 1;
      cur.seconds += h.seconds;
    }
  }

  const orderIds = [...new Set(inRange.map((h) => h.orderId))];
  const titleById = new Map<string, { title: string; label: string; sku: number }>();
  if (orderIds.length > 0) {
    const { data: orders } = await supabase
      .from("orders")
      .select("id, title, specs, customer:customers(name)")
      .eq("tenant_id", opts.tenantId)
      .in("id", orderIds);
    for (const o of (orders ?? []) as {
      id: string;
      title: string | null;
      specs: Record<string, unknown> | null;
      customer: { name: string } | { name: string }[] | null;
    }[]) {
      const cust = Array.isArray(o.customer) ? o.customer[0] : o.customer;
      const title = o.title?.trim() || "Untitled job";
      titleById.set(o.id, {
        title,
        label: formatTimeReportJobLabel({
          orderTitle: title,
          specs: o.specs,
          customerName: cust?.name?.trim() || null,
        }),
        sku: Math.max(1, skuCountFromSpecs(o.specs)),
      });
    }
  }

  const jobs: HandoffJobRow[] = inRange
    .map((h) => {
      const info = titleById.get(h.orderId);
      return {
        job_id: h.orderId,
        job_title: info?.title ?? h.orderId,
        job_label: info?.label ?? h.orderId,
        seconds: h.seconds,
        sku_count: info?.sku ?? 1,
        entered_date: localDateString(new Date(h.enteredProductionAt)),
      };
    })
    .sort((a, b) => b.seconds - a.seconds);

  const count = inRange.length;
  const total = secondsList.reduce((s, n) => s + n, 0);
  return {
    summary: {
      count,
      avg_seconds: count > 0 ? Math.round(total / count) : 0,
      median_seconds: medianSeconds(secondsList),
      min_seconds: count > 0 ? Math.min(...secondsList) : 0,
      max_seconds: count > 0 ? Math.max(...secondsList) : 0,
      daily: eachLocalDate(opts.from, opts.to).map(
        (date) => byDay.get(date) ?? { date, count: 0, seconds: 0 }
      ),
    },
    jobs,
  };
}

async function loadProductionSummary(
  supabase: Awaited<ReturnType<typeof createClient>>,
  opts: { tenantId: string; from: string; to: string }
): Promise<{
  summary: NonNullable<TimeReportResponse["production_flow"]>;
  jobs: HandoffJobRow[];
}> {
  const emptyDaily = eachLocalDate(opts.from, opts.to).map((date) => ({
    date,
    count: 0,
    seconds: 0,
  }));

  const { data: columns } = await supabase
    .from("board_columns")
    .select("id, name")
    .eq("tenant_id", opts.tenantId);
  const nameById = new Map(
    ((columns ?? []) as { id: string; name: string | null }[]).map((c) => [
      c.id,
      c.name ?? "",
    ])
  );

  const fromDate = new Date(`${opts.from}T12:00:00`);
  const lookback = localDateString(addDays(fromDate, -90));
  const { data: logs } = await supabase
    .from("activity_log")
    .select("order_id, created_at, metadata")
    .eq("tenant_id", opts.tenantId)
    .in("action", MOVE_ACTIONS)
    .gte("created_at", localDayStartIso(lookback))
    .lt("created_at", localDayEndExclusiveIso(opts.to));

  const events = [];
  for (const row of (logs ?? []) as {
    order_id: string | null;
    created_at: string;
    metadata: Record<string, unknown> | null;
  }[]) {
    if (!row.order_id) continue;
    const names = moveNamesFromMetadata(row.metadata, nameById);
    events.push({
      orderId: row.order_id,
      at: row.created_at,
      fromName: names.fromName,
      toName: names.toName,
    });
  }

  const rangeStart = Date.parse(localDayStartIso(opts.from));
  const rangeEnd = Date.parse(localDayEndExclusiveIso(opts.to));
  const inRangeMs = (iso: string) => {
    const t = Date.parse(iso);
    return Number.isFinite(t) && t >= rangeStart && t < rangeEnd;
  };

  const stays = computeProductionStays(events);
  const entered = stays.filter((s) => inRangeMs(s.enteredAt));
  const completed = stays.filter((s) => s.completed && inRangeMs(s.leftAt));
  const durationRows = completed;
  const secondsList = durationRows.map((s) => s.seconds);

  const dailyEntered = new Map(emptyDaily.map((d) => [d.date, { ...d }]));
  const dailyCompleted = new Map(emptyDaily.map((d) => [d.date, { ...d }]));
  for (const s of entered) {
    const date = localDateString(new Date(s.enteredAt));
    const cur = dailyEntered.get(date);
    if (cur) {
      cur.count += 1;
      cur.seconds += s.seconds;
    }
  }
  for (const s of completed) {
    const date = localDateString(new Date(s.leftAt));
    const cur = dailyCompleted.get(date);
    if (cur) {
      cur.count += 1;
      cur.seconds += s.seconds;
    }
  }

  const orderIds = [
    ...new Set([
      ...entered.map((s) => s.orderId),
      ...completed.map((s) => s.orderId),
    ]),
  ];
  const titleById = new Map<
    string,
    { title: string; label: string; sku: number }
  >();
  if (orderIds.length > 0) {
    const { data: orders } = await supabase
      .from("orders")
      .select("id, title, specs, customer:customers(name)")
      .eq("tenant_id", opts.tenantId)
      .in("id", orderIds);
    for (const o of (orders ?? []) as {
      id: string;
      title: string | null;
      specs: Record<string, unknown> | null;
      customer: { name: string } | { name: string }[] | null;
    }[]) {
      const cust = Array.isArray(o.customer) ? o.customer[0] : o.customer;
      const title = o.title?.trim() || "Untitled job";
      titleById.set(o.id, {
        title,
        label: formatTimeReportJobLabel({
          orderTitle: title,
          specs: o.specs,
          customerName: cust?.name?.trim() || null,
        }),
        sku: Math.max(1, skuCountFromSpecs(o.specs)),
      });
    }
  }

  const jobs: HandoffJobRow[] = durationRows
    .map((s) => {
      const info = titleById.get(s.orderId);
      return {
        job_id: s.orderId,
        job_title: info?.title ?? s.orderId,
        job_label: info?.label ?? s.orderId,
        seconds: s.seconds,
        sku_count: info?.sku ?? 1,
        entered_date: localDateString(new Date(s.leftAt)),
      };
    })
    .sort((a, b) => b.seconds - a.seconds);

  const count = durationRows.length;
  const total = secondsList.reduce((s, n) => s + n, 0);
  return {
    summary: {
      entered_count: new Set(entered.map((s) => s.orderId)).size,
      completed_count: new Set(completed.map((s) => s.orderId)).size,
      avg_duration_seconds: count > 0 ? Math.round(total / count) : 0,
      median_duration_seconds: medianSeconds(secondsList),
      min_seconds: count > 0 ? Math.min(...secondsList) : 0,
      max_seconds: count > 0 ? Math.max(...secondsList) : 0,
      daily_entered: eachLocalDate(opts.from, opts.to).map(
        (date) => dailyEntered.get(date) ?? { date, count: 0, seconds: 0 }
      ),
      daily_completed: eachLocalDate(opts.from, opts.to).map(
        (date) => dailyCompleted.get(date) ?? { date, count: 0, seconds: 0 }
      ),
    },
    jobs,
  };
}

function applyProductionHandoffJobs(
  report: TimeReportResponse,
  jobs: HandoffJobRow[]
) {
  const dailyMap = new Map(
    report.daily_totals.map((d) => [d.date, { ...d, seconds: 0, job_count: 0, sku_count: 0, pc_seconds: 0 }])
  );
  for (const job of jobs) {
    const day = dailyMap.get(job.entered_date);
    if (!day) continue;
    day.seconds += job.seconds;
    day.job_count += 1;
    day.sku_count += job.sku_count ?? 1;
  }
  report.daily_totals = [...dailyMap.values()];
  report.per_job = jobs.map(({ entered_date: _d, ...rest }) => rest);
  report.pc_seconds = 0;
  report.per_activity = [];
}
