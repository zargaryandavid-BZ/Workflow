"use client";

import { useCallback, useEffect, useState } from "react";
import { Input, Label, Select } from "@/components/ui/input";
import {
  addDays,
  formatHours,
  localDateString,
  startOfWeekMonday,
  type TimeReportResponse,
} from "@/lib/time-tracking";
import { cn } from "@/lib/utils";

const ACTIVITY_COLORS: Record<string, string> = {
  Design: "#378ADD",
  Revision: "#7F77DD",
  Prepress: "#1D9E75",
  "Proof Review": "#D4537E",
  "Client Communication": "#EF9F27",
  Admin: "#888780",
  Meeting: "#639922",
  Other: "#B4B2A9",
};

interface DesignerOption {
  id: string;
  name: string;
}

interface TimeReportsProps {
  isAdmin: boolean;
  designers: DesignerOption[];
}

export function TimeReports({ isAdmin, designers }: TimeReportsProps) {
  const weekStart = startOfWeekMonday();
  const [from, setFrom] = useState(() => localDateString(weekStart));
  const [to, setTo] = useState(() => localDateString(addDays(weekStart, 6)));
  const [userFilter, setUserFilter] = useState<string>("");
  const [report, setReport] = useState<TimeReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from, to });
      if (isAdmin) {
        params.set("user_id", userFilter || "all");
      }
      const res = await fetch(`/api/time-entries/report?${params.toString()}`);
      const data = (await res.json()) as TimeReportResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to load report");
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load report");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [from, to, userFilter, isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalSeconds =
    report?.daily_totals.reduce((s, d) => s + d.seconds, 0) ?? 0;
  const maxDay = Math.max(
    1,
    ...(report?.daily_totals.map((d) => d.seconds) ?? [1])
  );

  const pieTotal =
    report?.per_activity.reduce((s, a) => s + a.seconds, 0) ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="report-from">From</Label>
          <Input
            id="report-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-auto"
          />
        </div>
        <div>
          <Label htmlFor="report-to">To</Label>
          <Input
            id="report-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-auto"
          />
        </div>
        {isAdmin ? (
          <div>
            <Label htmlFor="report-user">Viewing</Label>
            <Select
              id="report-user"
              value={userFilter}
              onChange={(e) => setUserFilter(e.target.value)}
              className="min-w-[10rem]"
            >
              <option value="">All designers</option>
              {designers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
      </div>

      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      {loading || !report ? (
        <p className="text-sm text-slate-400">
          {loading ? "Loading…" : "No data"}
        </p>
      ) : (
        <>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-medium text-slate-700">
                Hours per day
              </h3>
              <span className="text-xs text-slate-400">
                Total {formatHours(totalSeconds)}
              </span>
            </div>
            <div className="flex h-40 items-end gap-1.5 pt-2">
              {report.daily_totals.map((d) => {
                const label = new Date(
                  d.date + "T12:00:00"
                ).toLocaleDateString([], {
                  weekday: "short",
                  month: "numeric",
                  day: "numeric",
                });
                return (
                  <div
                    key={d.date}
                    className="flex min-w-0 flex-1 flex-col items-center gap-1"
                  >
                    <div className="flex h-32 w-full items-end justify-center">
                      <div
                        className="w-full max-w-10 rounded-t-sm bg-[#378ADD] transition-all"
                        style={{
                          height: `${Math.max(
                            d.seconds > 0 ? 4 : 0,
                            (d.seconds / maxDay) * 100
                          )}%`,
                        }}
                        title={`${label}: ${formatHours(d.seconds)}`}
                      />
                    </div>
                    <span className="truncate text-[10px] text-slate-400">
                      {label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h3 className="mb-3 text-sm font-medium text-slate-700">
                Time by activity
              </h3>
              {report.per_activity.length === 0 ? (
                <p className="text-xs text-slate-400">No time logged</p>
              ) : (
                <div className="flex items-center gap-6">
                  <Donut
                    slices={report.per_activity.map((a) => ({
                      label: a.activity_type,
                      value: a.seconds,
                      color:
                        ACTIVITY_COLORS[a.activity_type] ?? "#B4B2A9",
                    }))}
                    total={pieTotal}
                  />
                  <ul className="min-w-0 flex-1 space-y-1.5">
                    {report.per_activity.map((a) => (
                      <li
                        key={a.activity_type}
                        className="flex items-center justify-between gap-2 text-xs"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-sm"
                            style={{
                              backgroundColor:
                                ACTIVITY_COLORS[a.activity_type] ?? "#B4B2A9",
                            }}
                          />
                          <span className="truncate text-slate-700">
                            {a.activity_type}
                          </span>
                        </span>
                        <span className="shrink-0 tabular-nums text-slate-500">
                          {formatHours(a.seconds)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h3 className="mb-3 text-sm font-medium text-slate-700">
                Per-job totals
              </h3>
              {report.per_job.length === 0 ? (
                <p className="text-xs text-slate-400">No time logged</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="pb-2 font-semibold">Job / Task</th>
                        <th className="pb-2 font-semibold">Hours</th>
                        <th className="pb-2 font-semibold">%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.per_job.map((row) => {
                        const pct =
                          totalSeconds > 0
                            ? Math.round((row.seconds / totalSeconds) * 100)
                            : 0;
                        return (
                          <tr
                            key={`${row.job_id ?? "c"}-${row.job_title}`}
                            className="border-t border-slate-100"
                          >
                            <td className="max-w-[14rem] truncate py-2 font-medium text-slate-800">
                              {row.job_title}
                            </td>
                            <td className="py-2 tabular-nums text-slate-600">
                              {formatHours(row.seconds)}
                            </td>
                            <td className="py-2 tabular-nums text-slate-500">
                              {pct}%
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {isAdmin && report.per_user && report.per_user.length > 0 ? (
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h3 className="mb-3 text-sm font-medium text-slate-700">
                Per designer
              </h3>
              <ul className="space-y-2">
                {report.per_user.map((u) => {
                  const pct =
                    totalSeconds > 0
                      ? (u.seconds / totalSeconds) * 100
                      : 0;
                  return (
                    <li key={u.user_id}>
                      <div className="mb-0.5 flex justify-between text-xs">
                        <span className="font-medium text-slate-700">
                          {u.display_name}
                        </span>
                        <span className="tabular-nums text-slate-500">
                          {formatHours(u.seconds)}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={cn("h-full rounded-full bg-[#378ADD]")}
                          style={{ width: `${Math.max(2, pct)}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function Donut({
  slices,
  total,
}: {
  slices: { label: string; value: number; color: string }[];
  total: number;
}) {
  const size = 112;
  const stroke = 18;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;

  if (total <= 0) {
    return (
      <div
        className="shrink-0 rounded-full bg-slate-100"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      {slices.map((s) => {
        const len = (s.value / total) * c;
        const el = (
          <circle
            key={s.label}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={s.color}
            strokeWidth={stroke}
            strokeDasharray={`${len} ${c - len}`}
            strokeDashoffset={-offset}
          />
        );
        offset += len;
        return el;
      })}
    </svg>
  );
}
