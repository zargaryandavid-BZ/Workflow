"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronDown, Columns3 } from "lucide-react";
import {
  fetchAnalyticsStats,
  resolveDateRange,
  type AnalyticsColumnOption,
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
                row.muted
                  ? "text-amber-600"
                  : row.count === 0
                    ? "text-slate-400"
                    : "text-slate-700"
              )}
            >
              {row.label}
            </span>
            <span
              className={cn(
                "ml-2 shrink-0",
                row.count === 0 ? "text-slate-400" : "text-slate-500"
              )}
            >
              {row.count}
            </span>
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

function DesignerWorkloadSection({
  stats,
  columns,
  selectedColumnIds,
  setSelectedColumnIds,
  workloadLoading,
}: {
  stats: AnalyticsStats;
  columns: AnalyticsColumnOption[];
  selectedColumnIds: Set<string>;
  setSelectedColumnIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  workloadLoading: boolean;
}) {
  const [columnDropdownOpen, setColumnDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!columnDropdownOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setColumnDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [columnDropdownOpen]);

  const selectedLabel =
    selectedColumnIds.size === 0
      ? "All columns"
      : selectedColumnIds.size === 1
        ? (columns.find((c) => selectedColumnIds.has(c.id))?.name ??
          "1 column")
        : `${selectedColumnIds.size} columns selected`;

  const totalJobs = stats.designerWorkload.reduce((sum, row) => sum + row.count, 0);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-slate-700">
          Designer workload
        </h2>
        {selectedColumnIds.size > 0 ? (
          <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs text-blue-600">
            {selectedColumnIds.size}{" "}
            {selectedColumnIds.size === 1 ? "column" : "columns"}
          </span>
        ) : null}
      </div>

      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => setColumnDropdownOpen((prev) => !prev)}
          className="flex w-full items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 hover:border-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-400"
        >
          <Columns3 className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span className="flex-1 truncate text-left">{selectedLabel}</span>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform",
              columnDropdownOpen && "rotate-180"
            )}
          />
        </button>

        {columnDropdownOpen ? (
          <div className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-md">
            {columns.length === 0 ? (
              <p className="px-3 py-2 text-xs text-slate-400">No columns</p>
            ) : (
              columns.map((col) => (
                <label
                  key={col.id}
                  className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={selectedColumnIds.has(col.id)}
                    onChange={(e) => {
                      setSelectedColumnIds((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(col.id);
                        else next.delete(col.id);
                        return next;
                      });
                    }}
                    className="rounded border-slate-300 text-blue-500 focus:ring-blue-400"
                  />
                  {col.name}
                </label>
              ))
            )}

            <div className="mt-1 flex justify-between border-t border-slate-100 px-3 py-1.5">
              <button
                type="button"
                onClick={() => setSelectedColumnIds(new Set())}
                className="text-xs text-slate-400 underline hover:text-slate-600"
              >
                Clear all
              </button>
              <button
                type="button"
                onClick={() =>
                  setSelectedColumnIds(new Set(columns.map((c) => c.id)))
                }
                className="text-xs text-slate-400 underline hover:text-slate-600"
              >
                Select all
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {selectedColumnIds.size > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {[...selectedColumnIds].map((id) => {
            const col = columns.find((c) => c.id === id);
            if (!col) return null;
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs text-blue-600"
              >
                {col.name}
                <button
                  type="button"
                  onClick={() =>
                    setSelectedColumnIds((prev) => {
                      const next = new Set(prev);
                      next.delete(id);
                      return next;
                    })
                  }
                  className="leading-none text-blue-400 hover:text-blue-600"
                  aria-label={`Remove ${col.name}`}
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      ) : null}

      <div className={cn("mt-4", workloadLoading && "opacity-60")}>
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

      <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2">
        <span className="text-xs text-slate-400">
          {selectedColumnIds.size === 0 ? "Total jobs" : "Jobs in selection"}
        </span>
        <span className="text-xs font-medium text-slate-600">{totalJobs}</span>
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
  const [columns, setColumns] = useState<AnalyticsColumnOption[]>([]);
  const [selectedColumnIds, setSelectedColumnIds] = useState<Set<string>>(
    () => new Set()
  );
  const [loading, setLoading] = useState(true);
  const [workloadLoading, setWorkloadLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const skipColumnReloadRef = useRef(true);
  const selectedColumnIdsRef = useRef(selectedColumnIds);
  selectedColumnIdsRef.current = selectedColumnIds;

  const loadStats = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (opts?.silent) setWorkloadLoading(true);
      else setLoading(true);
      setError(null);
      try {
        const custom =
          filter === "custom" && appliedCustom ? appliedCustom : undefined;
        const { dateFrom, dateTo, prevFrom, prevTo } = resolveDateRange(
          filter,
          custom?.from,
          custom?.to
        );
        const columnIds = [...selectedColumnIdsRef.current];
        const data = await fetchAnalyticsStats(
          tenantId,
          filter,
          dateFrom,
          dateTo,
          prevFrom,
          prevTo,
          custom?.from,
          custom?.to,
          columnIds.length > 0 ? columnIds : undefined
        );
        if (opts?.silent) {
          setStats((prev) =>
            prev
              ? {
                  ...prev,
                  designerWorkload: data.designerWorkload,
                  columns: data.columns,
                }
              : data
          );
        } else {
          setStats(data);
        }
        if (data.columns?.length) {
          setColumns(data.columns);
        }
      } catch (err) {
        if (!opts?.silent) {
          setError(
            err instanceof Error ? err.message : "Could not load analytics"
          );
          setStats(null);
        }
      } finally {
        if (opts?.silent) setWorkloadLoading(false);
        else setLoading(false);
      }
    },
    [tenantId, filter, appliedCustom]
  );

  useEffect(() => {
    if (filter === "custom" && !appliedCustom) {
      setLoading(false);
      return;
    }
    skipColumnReloadRef.current = true;
    void loadStats();
  }, [filter, appliedCustom, loadStats]);

  useEffect(() => {
    if (skipColumnReloadRef.current) {
      skipColumnReloadRef.current = false;
      return;
    }
    void loadStats({ silent: true });
  }, [selectedColumnIds, loadStats]);

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
        <div className="grid items-stretch gap-4 lg:grid-cols-2">
          {/* Left column: Pipeline breakdown */}
          <div className="flex flex-col rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-medium text-slate-700">
              Pipeline breakdown
            </h2>
            <div className="mt-4 flex-1">
              <HorizontalBars
                rows={stats.pipeline.map((row) => ({
                  label: row.name,
                  count: row.count,
                  color: row.color,
                }))}
              />
            </div>
          </div>

          {/* Right column: Due date health + Designer workload */}
          <div className="flex h-full flex-col gap-4">
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
                      <span className={cn("h-2 w-2 rounded-full", row.dot)} />
                      {row.label}
                    </span>
                    <span className="font-medium text-slate-800">
                      {row.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <DesignerWorkloadSection
              stats={stats}
              columns={columns}
              selectedColumnIds={selectedColumnIds}
              setSelectedColumnIds={setSelectedColumnIds}
              workloadLoading={workloadLoading}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
