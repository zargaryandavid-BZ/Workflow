"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import {
  fetchAnalyticsStats,
  resolveDateRange,
  type AnalyticsFilter,
  type AnalyticsStats,
} from "@/lib/analytics";
import { cn } from "@/lib/utils";

const FILTERS: { id: AnalyticsFilter; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "90d", label: "90 days" },
  { id: "all", label: "All time" },
  { id: "custom", label: "Custom" },
];

function formatHours(hours: number | null): string {
  if (hours === null) return "—";
  return `${hours.toFixed(1)} hrs`;
}

function formatDays(days: number | null): string {
  if (days === null) return "—";
  return `${days.toFixed(1)}d`;
}

function BarChart({
  data,
  barColor = "#378ADD",
}: {
  data: { label: string; count: number }[];
  barColor?: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="flex h-40 items-end gap-1.5 pt-2">
      {data.map((d) => (
        <div
          key={d.label}
          className="flex min-w-0 flex-1 flex-col items-center gap-1"
        >
          <div className="flex h-32 w-full items-end justify-center">
            <div
              className="w-full max-w-8 rounded-t-sm transition-all"
              style={{
                height: `${Math.max(4, (d.count / max) * 100)}%`,
                backgroundColor: barColor,
              }}
              title={`${d.label}: ${d.count}`}
            />
          </div>
          <span className="truncate text-[10px] text-slate-400">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

function HorizontalBars({
  rows,
}: {
  rows: { label: string; count: number; color: string; muted?: boolean }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.label}>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span
              className={cn(
                "truncate font-medium",
                row.muted ? "text-amber-600" : "text-slate-700"
              )}
            >
              {row.label}
            </span>
            <span className="ml-2 shrink-0 text-slate-500">{row.count}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${(row.count / max) * 100}%`,
                backgroundColor: row.color,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function KpiCard({
  label,
  value,
  trend,
}: {
  label: string;
  value: string;
  trend: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-800">{value}</p>
      <p className="mt-1 text-xs text-slate-400">{trend}</p>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-24 rounded-lg border border-slate-200 bg-slate-100"
          />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-48 rounded-lg border border-slate-200 bg-slate-100" />
        <div className="h-48 rounded-lg border border-slate-200 bg-slate-100" />
      </div>
    </div>
  );
}

export default function AnalyticsDashboard({
  tenantId,
}: {
  tenantId: string;
}) {
  const [filter, setFilter] = useState<AnalyticsFilter>("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [appliedCustom, setAppliedCustom] = useState<{
    from: string;
    to: string;
  } | null>(null);
  const [stats, setStats] = useState<AnalyticsStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const custom =
        filter === "custom" && appliedCustom ? appliedCustom : undefined;
      const { dateFrom, dateTo, prevFrom, prevTo } = resolveDateRange(
        filter,
        custom?.from,
        custom?.to
      );
      const data = await fetchAnalyticsStats(
        tenantId,
        filter,
        dateFrom,
        dateTo,
        prevFrom,
        prevTo
      );
      setStats(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load analytics"
      );
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, [tenantId, filter, appliedCustom]);

  useEffect(() => {
    if (filter === "custom" && !appliedCustom) {
      setLoading(false);
      return;
    }
    loadStats();
  }, [filter, appliedCustom, loadStats]);

  function selectFilter(next: AnalyticsFilter) {
    setFilter(next);
    if (next !== "custom") {
      setAppliedCustom(null);
    }
  }

  function applyCustomRange() {
    if (!customFrom || !customTo) return;
    setAppliedCustom({ from: customFrom, to: customTo });
  }

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">
            Production analytics
          </h1>
          <p className="text-sm text-slate-500">
            Real-time metrics from your production board.
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
          <div className="flex flex-wrap justify-end gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => selectFilter(f.id)}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                  filter === f.id
                    ? "border border-slate-200 bg-white text-slate-800 shadow-sm"
                    : "border border-transparent text-slate-500 hover:text-slate-700"
                )}
              >
                {f.id === "custom" ? (
                  <span className="inline-flex items-center gap-1">
                    <CalendarDays className="h-3 w-3" />
                    Custom
                  </span>
                ) : (
                  f.label
                )}
              </button>
            ))}
          </div>

          {filter === "custom" ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <label className="flex items-center gap-1">
                From
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs"
                />
              </label>
              <label className="flex items-center gap-1">
                To
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs"
                />
              </label>
              <button
                type="button"
                onClick={applyCustomRange}
                disabled={!customFrom || !customTo}
                className="rounded-md bg-[var(--primary)] px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
              >
                Apply
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Could not load analytics
        </p>
      ) : null}

      {loading ? <Skeleton /> : null}

      {!loading && stats ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Total jobs"
              value={String(stats.totalJobs)}
              trend={stats.totalTrend}
            />
            <KpiCard
              label="Completed"
              value={String(stats.completed)}
              trend={stats.completedTrend}
            />
            <KpiCard
              label="Overdue"
              value={String(stats.overdue)}
              trend={stats.overdueTrend}
            />
            <KpiCard
              label="Avg turnaround"
              value={formatDays(stats.avgTurnaroundDays)}
              trend={stats.turnaroundTrend}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-medium text-slate-700">
                Pipeline breakdown
              </h2>
              <div className="mt-4">
                <HorizontalBars
                  rows={stats.pipeline.map((row) => ({
                    label: row.name,
                    count: row.count,
                    color: row.color,
                  }))}
                />
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-medium text-slate-700">
                Due date health
              </h2>
              <div className="mt-4 space-y-3">
                {[
                  {
                    label: "On track",
                    count: stats.dueDateHealth.onTrack,
                    dot: "bg-emerald-500",
                  },
                  {
                    label: "Due within 24h",
                    count: stats.dueDateHealth.dueWithin24h,
                    dot: "bg-amber-500",
                  },
                  {
                    label: "Overdue",
                    count: stats.dueDateHealth.overdue,
                    dot: "bg-red-500",
                  },
                ].map((row) => (
                  <div
                    key={row.label}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="flex items-center gap-2 text-slate-700">
                      <span
                        className={cn("h-2 w-2 rounded-full", row.dot)}
                      />
                      {row.label}
                    </span>
                    <span className="font-medium text-slate-800">
                      {row.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-medium text-slate-700">
                Jobs completed
              </h2>
              <BarChart data={stats.throughput} barColor="#378ADD" />
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-medium text-slate-700">
                Designer workload
              </h2>
              <div className="mt-4">
                {stats.designerWorkload.length === 0 ? (
                  <p className="text-xs text-slate-400">No active jobs</p>
                ) : (
                  <HorizontalBars
                    rows={stats.designerWorkload.map((row) => ({
                      label: row.name,
                      count: row.count,
                      color: row.unassigned ? "#EF9F27" : "#378ADD",
                      muted: row.unassigned,
                    }))}
                  />
                )}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-medium text-slate-700">
              Customer response time
            </h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="rounded-md border border-slate-100 bg-slate-50 px-4 py-3">
                <p className="text-xs text-slate-400">Missing info</p>
                <p className="mt-1 text-xl font-semibold text-slate-800">
                  {formatHours(stats.missingInfoResponseHours)}
                </p>
              </div>
              <div className="rounded-md border border-slate-100 bg-slate-50 px-4 py-3">
                <p className="text-xs text-slate-400">Approval</p>
                <p className="mt-1 text-xl font-semibold text-slate-800">
                  {formatHours(stats.approvalResponseHours)}
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
