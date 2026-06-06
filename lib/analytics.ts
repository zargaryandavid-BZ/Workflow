import { createClient } from "@/lib/supabase/client";
import type { BoardColumn, JobNotification } from "@/lib/types";

export type AnalyticsFilter = "today" | "7d" | "30d" | "90d" | "all" | "custom";

export interface PipelineRow {
  columnId: string;
  name: string;
  count: number;
  color: string;
}

export interface ThroughputBucket {
  label: string;
  count: number;
}

export interface DesignerWorkloadRow {
  id: string;
  name: string;
  count: number;
  unassigned: boolean;
}

export interface AnalyticsStats {
  totalJobs: number;
  completed: number;
  overdue: number;
  avgTurnaroundDays: number | null;
  totalTrend: string;
  completedTrend: string;
  overdueTrend: string;
  turnaroundTrend: string;
  pipeline: PipelineRow[];
  dueDateHealth: {
    onTrack: number;
    dueWithin24h: number;
    overdue: number;
  };
  throughput: ThroughputBucket[];
  designerWorkload: DesignerWorkloadRow[];
  missingInfoResponseHours: number | null;
  approvalResponseHours: number | null;
}

const COLUMN_COLORS: Record<string, string> = {
  start: "#378ADD",
  progress: "#1D9E75",
  missing: "#EF9F27",
  approval: "#7F77DD",
  done: "#639922",
};

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function resolveDateRange(
  filter: AnalyticsFilter,
  customFrom?: string,
  customTo?: string
): { dateFrom: string | null; dateTo: string; prevFrom: string | null; prevTo: string | null } {
  const now = new Date();
  const dateTo = now.toISOString();

  if (filter === "all") {
    return { dateFrom: null, dateTo, prevFrom: null, prevTo: null };
  }

  if (filter === "custom" && customFrom && customTo) {
    const from = new Date(`${customFrom}T00:00:00`);
    const to = new Date(`${customTo}T23:59:59.999`);
    const spanMs = to.getTime() - from.getTime();
    const prevTo = new Date(from.getTime() - 1);
    const prevFrom = new Date(prevTo.getTime() - spanMs);
    return {
      dateFrom: from.toISOString(),
      dateTo: to.toISOString(),
      prevFrom: prevFrom.toISOString(),
      prevTo: prevTo.toISOString(),
    };
  }

  const ranges: Record<
    Exclude<AnalyticsFilter, "all" | "custom">,
    { days: number }
  > = {
    today: { days: 0 },
    "7d": { days: 7 },
    "30d": { days: 30 },
    "90d": { days: 90 },
  };

  const cfg = ranges[filter as Exclude<AnalyticsFilter, "all" | "custom">];
  const from =
    filter === "today" ? startOfToday() : daysAgo(cfg?.days ?? 0);
  const spanMs = now.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - spanMs);

  return {
    dateFrom: from.toISOString(),
    dateTo,
    prevFrom: prevFrom.toISOString(),
    prevTo: prevTo.toISOString(),
  };
}

function columnColor(column: BoardColumn): string {
  if (column.color) return column.color;
  const name = column.name.toLowerCase();
  if (column.kind === "done") return COLUMN_COLORS.done;
  if (column.kind === "approval") return COLUMN_COLORS.approval;
  if (column.kind === "exception") return COLUMN_COLORS.missing;
  if (name.includes("progress")) return COLUMN_COLORS.progress;
  if (name.includes("start")) return COLUMN_COLORS.start;
  return "#94a3b8";
}

function inRange(
  iso: string,
  from: string | null,
  to: string | null
): boolean {
  const t = new Date(iso).getTime();
  if (from && t < new Date(from).getTime()) return false;
  if (to && t > new Date(to).getTime()) return false;
  return true;
}

function formatTrend(delta: number, suffix: string): string {
  if (delta === 0) return `No change ${suffix}`;
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta} ${suffix}`;
}

function avgHours(samples: number[]): number | null {
  if (samples.length === 0) return null;
  return samples.reduce((a, b) => a + b, 0) / samples.length;
}

function throughputBucketMode(
  filter: AnalyticsFilter,
  dateFrom: string | null,
  dateTo: string
): "hour" | "day" | "week" | "month" | "quarter" {
  if (filter === "today") return "hour";
  if (filter === "7d") return "day";
  if (filter === "30d") return "week";
  if (filter === "90d") return "month";
  if (filter === "all") return "quarter";
  if (dateFrom) {
    const days =
      (new Date(dateTo).getTime() - new Date(dateFrom).getTime()) /
      (1000 * 60 * 60 * 24);
    if (days <= 14) return "day";
    if (days <= 60) return "week";
    return "month";
  }
  return "month";
}

function buildThroughputBuckets(
  mode: ReturnType<typeof throughputBucketMode>,
  events: { at: string }[],
  dateFrom: string | null,
  dateTo: string
): ThroughputBucket[] {
  const from = dateFrom ? new Date(dateFrom) : null;
  const to = new Date(dateTo);

  if (mode === "hour") {
    const buckets: ThroughputBucket[] = [];
    for (let h = 9; h <= 18; h++) {
      buckets.push({
        label: h <= 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`,
        count: 0,
      });
    }
    for (const e of events) {
      const d = new Date(e.at);
      const h = d.getHours();
      if (h >= 9 && h <= 18) buckets[h - 9].count += 1;
    }
    return buckets;
  }

  if (mode === "day") {
    const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const buckets = labels.map((label) => ({ label, count: 0 }));
    for (const e of events) {
      buckets[new Date(e.at).getDay()].count += 1;
    }
    return buckets;
  }

  if (mode === "week") {
    const buckets = ["W1", "W2", "W3", "W4"].map((label) => ({ label, count: 0 }));
    if (!from) return buckets;
    for (const e of events) {
      const dayOffset = Math.floor(
        (new Date(e.at).getTime() - from.getTime()) / (1000 * 60 * 60 * 24)
      );
      const idx = Math.min(3, Math.max(0, Math.floor(dayOffset / 7)));
      buckets[idx].count += 1;
    }
    return buckets;
  }

  if (mode === "month") {
    const monthFmt = new Intl.DateTimeFormat("en", { month: "short" });
    const bucketMap = new Map<string, number>();
    if (from) {
      const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
      while (cursor <= to) {
        bucketMap.set(monthFmt.format(cursor), 0);
        cursor.setMonth(cursor.getMonth() + 1);
      }
    }
    for (const e of events) {
      const key = monthFmt.format(new Date(e.at));
      bucketMap.set(key, (bucketMap.get(key) ?? 0) + 1);
    }
    return Array.from(bucketMap.entries()).map(([label, count]) => ({
      label,
      count,
    }));
  }

  // quarter
  const bucketMap = new Map<string, number>();
  const startYear = from?.getFullYear() ?? to.getFullYear() - 2;
  for (let y = startYear; y <= to.getFullYear(); y++) {
    for (let q = 1; q <= 4; q++) {
      bucketMap.set(`Q${q} ${y}`, 0);
    }
  }
  for (const e of events) {
    const d = new Date(e.at);
    const key = `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
    bucketMap.set(key, (bucketMap.get(key) ?? 0) + 1);
  }
  return Array.from(bucketMap.entries())
    .slice(-8)
    .map(([label, count]) => ({ label, count }));
}

export async function fetchAnalyticsStats(
  tenantId: string,
  filter: AnalyticsFilter,
  dateFrom: string | null,
  dateTo: string,
  prevFrom: string | null,
  prevTo: string | null,
  customFrom?: string,
  customTo?: string
): Promise<AnalyticsStats> {
  const supabase = createClient();

  const [
    { data: columnsRaw, error: columnsError },
    { data: ordersRaw, error: ordersError },
    { data: activeOrdersRaw, error: activeError },
    { data: activityRaw, error: activityError },
    { data: notificationsRaw, error: notificationsError },
    { data: profilesRaw, error: profilesError },
  ] = await Promise.all([
    supabase
      .from("board_columns")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("position", { ascending: true }),
    supabase
      .from("orders")
      .select("id, column_id, due_date, created_at, updated_at, specs")
      .eq("tenant_id", tenantId),
    supabase
      .from("orders")
      .select("id, column_id, due_date, specs")
      .eq("tenant_id", tenantId),
    supabase
      .from("activity_log")
      .select("id, order_id, action, metadata, created_at")
      .eq("tenant_id", tenantId),
    supabase
      .from("job_notifications")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("status", "responded")
      .not("responded_at", "is", null),
    supabase.from("profiles").select("id, full_name"),
  ]);

  if (
    columnsError ||
    ordersError ||
    activeError ||
    activityError ||
    notificationsError ||
    profilesError
  ) {
    throw new Error(
      columnsError?.message ??
        ordersError?.message ??
        activeError?.message ??
        activityError?.message ??
        notificationsError?.message ??
        profilesError?.message ??
        "Failed to load analytics"
    );
  }

  const columns = (columnsRaw ?? []) as BoardColumn[];
  const doneColumnIds = new Set(
    columns.filter((c) => c.kind === "done").map((c) => c.id)
  );
  const missingInfoColumnIds = new Set(
    columns
      .filter(
        (c) =>
          c.kind === "exception" &&
          c.name.toLowerCase().includes("missing")
      )
      .map((c) => c.id)
  );

  const allOrders = (ordersRaw ?? []) as {
    id: string;
    column_id: string;
    due_date: string | null;
    created_at: string;
    updated_at: string;
    specs: Record<string, unknown>;
  }[];

  const periodOrders = allOrders.filter((o) =>
    inRange(o.created_at, dateFrom, dateTo)
  );
  const prevOrders = allOrders.filter((o) =>
    inRange(o.created_at, prevFrom, prevTo)
  );

  const now = Date.now();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  const in24h = now + 24 * 60 * 60 * 1000;

  const isDone = (columnId: string) => doneColumnIds.has(columnId);

  const completed = periodOrders.filter((o) => isDone(o.column_id)).length;
  const prevCompleted = prevOrders.filter((o) => isDone(o.column_id)).length;
  const overdue = periodOrders.filter(
    (o) =>
      !isDone(o.column_id) &&
      o.due_date &&
      new Date(`${o.due_date}T23:59:59`).getTime() < now
  ).length;
  const prevOverdue = prevOrders.filter(
    (o) =>
      !isDone(o.column_id) &&
      o.due_date &&
      new Date(`${o.due_date}T23:59:59`).getTime() <
        new Date(prevTo ?? dateTo).getTime()
  ).length;

  const doneInPeriod = periodOrders.filter((o) => isDone(o.column_id));
  const turnaroundSamples = doneInPeriod.map(
    (o) =>
      (new Date(o.updated_at).getTime() - new Date(o.created_at).getTime()) /
      (1000 * 60 * 60 * 24)
  );
  const avgTurnaroundDays =
    turnaroundSamples.length > 0
      ? turnaroundSamples.reduce((a, b) => a + b, 0) /
        turnaroundSamples.length
      : null;

  const completionRate =
    periodOrders.length > 0
      ? Math.round((completed / periodOrders.length) * 100)
      : 0;

  const pipelineCounts = new Map<string, number>();
  for (const col of columns) pipelineCounts.set(col.id, 0);
  for (const o of periodOrders) {
    pipelineCounts.set(o.column_id, (pipelineCounts.get(o.column_id) ?? 0) + 1);
  }
  const pipeline: PipelineRow[] = columns.map((col) => ({
    columnId: col.id,
    name: col.name,
    count: pipelineCounts.get(col.id) ?? 0,
    color: columnColor(col),
  }));

  const activeOrders = (activeOrdersRaw ?? []) as {
    id: string;
    column_id: string;
    due_date: string | null;
    specs: Record<string, unknown>;
  }[];
  const activeNonDone = activeOrders.filter((o) => !isDone(o.column_id));

  let onTrack = 0;
  let dueWithin24h = 0;
  let dueOverdue = 0;
  for (const o of activeNonDone) {
    if (!o.due_date) {
      onTrack += 1;
      continue;
    }
    const due = new Date(`${o.due_date}T23:59:59`).getTime();
    if (due < now) dueOverdue += 1;
    else if (due <= in24h) dueWithin24h += 1;
    else if (due >= tomorrow.getTime()) onTrack += 1;
    else onTrack += 1;
  }

  const activity = (activityRaw ?? []) as {
    order_id: string | null;
    action: string;
    metadata: Record<string, unknown>;
    created_at: string;
  }[];

  const completionEvents = activity
    .filter(
      (a) =>
        a.action === "moved" &&
        typeof a.metadata?.to === "string" &&
        doneColumnIds.has(a.metadata.to as string) &&
        inRange(a.created_at, dateFrom, dateTo)
    )
    .map((a) => ({ at: a.created_at }));

  const bucketMode = throughputBucketMode(filter, dateFrom, dateTo);
  const throughput = buildThroughputBuckets(
    bucketMode,
    completionEvents,
    dateFrom,
    dateTo
  );

  const profileNames = new Map<string, string>();
  for (const p of profilesRaw ?? []) {
    profileNames.set(
      p.id as string,
      (p.full_name as string | null) ?? "Unnamed"
    );
  }

  const designerCounts = new Map<string, { name: string; count: number }>();
  let unassignedCount = 0;
  for (const o of activeNonDone) {
    const designerId =
      typeof o.specs?.designer_id === "string" ? o.specs.designer_id : null;
    const designerName =
      typeof o.specs?.designer_name === "string"
        ? o.specs.designer_name
        : designerId
          ? profileNames.get(designerId) ?? "Unnamed"
          : null;
    if (!designerId && !designerName) {
      unassignedCount += 1;
      continue;
    }
    const id = designerId ?? designerName!;
    const name = designerName ?? profileNames.get(designerId!) ?? "Unnamed";
    const row = designerCounts.get(id) ?? { name, count: 0 };
    row.count += 1;
    designerCounts.set(id, row);
  }

  const designerWorkload: DesignerWorkloadRow[] = [
    ...Array.from(designerCounts.entries()).map(([id, row]) => ({
      id,
      name: row.name,
      count: row.count,
      unassigned: false,
    })),
    ...(unassignedCount > 0
      ? [
          {
            id: "__unassigned__",
            name: "Unassigned",
            count: unassignedCount,
            unassigned: true,
          },
        ]
      : []),
  ].sort((a, b) => b.count - a.count);

  const notifications = (notificationsRaw ?? []) as JobNotification[];
  const moveToMissingInfo = new Map<string, string>();
  for (const a of activity) {
    if (a.action !== "moved" || !a.order_id) continue;
    const to = a.metadata?.to as string | undefined;
    if (to && missingInfoColumnIds.has(to)) {
      moveToMissingInfo.set(a.order_id, a.created_at);
    }
  }

  const missingInfoHours: number[] = [];
  const approvalHours: number[] = [];

  for (const n of notifications) {
    if (!n.responded_at) continue;
    const respondedMs = new Date(n.responded_at).getTime();

    if (n.type === "missing_info") {
      const movedAt = moveToMissingInfo.get(n.order_id);
      if (movedAt) {
        missingInfoHours.push(
          (respondedMs - new Date(movedAt).getTime()) / (1000 * 60 * 60)
        );
      }
    }

    if (n.type === "customer_approval") {
      const sentLog = activity.find(
        (a) =>
          a.order_id === n.order_id &&
          a.action === "customer_notified" &&
          a.metadata?.type === "customer_approval" &&
          a.metadata?.notificationId === n.id
      );
      const startAt = sentLog?.created_at ?? n.created_at;
      approvalHours.push(
        (respondedMs - new Date(startAt).getTime()) / (1000 * 60 * 60)
      );
    }
  }

  return {
    totalJobs: periodOrders.length,
    completed,
    overdue,
    avgTurnaroundDays,
    totalTrend: formatTrend(
      periodOrders.length - prevOrders.length,
      "this period"
    ),
    completedTrend: `${completionRate}% completion rate`,
    overdueTrend: formatTrend(overdue - prevOverdue, "vs prior period"),
    turnaroundTrend:
      avgTurnaroundDays !== null
        ? `Avg ${avgTurnaroundDays.toFixed(1)}d turnaround`
        : "No completed jobs yet",
    pipeline,
    dueDateHealth: {
      onTrack,
      dueWithin24h,
      overdue: dueOverdue,
    },
    throughput,
    designerWorkload,
    missingInfoResponseHours: avgHours(missingInfoHours),
    approvalResponseHours: avgHours(approvalHours),
  };
}
