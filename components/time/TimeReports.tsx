"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { downloadCsv } from "@/lib/download-csv";
import {
  addDays,
  formatHours,
  localDateString,
  startOfWeekMonday,
  type TimeReportKind,
  type TimeReportResponse,
} from "@/lib/time-tracking";

interface TeamMemberOption {
  id: string;
  name: string;
  role: "designer" | "preprod_owner";
}
interface TimeReportsProps {
  isAdmin: boolean;
  canStartPrepress?: boolean;
  teamMembers: TeamMemberOption[];
}
// ─── helpers ───────────────────────────────────────────────────────────────

function dayLabel(date: string): string {
  return new Date(date + "T12:00:00").toLocaleDateString([], {
    weekday: "short",
    month: "numeric",
    day: "numeric",
  });
}
function barHoursLabel(seconds: number): string {
  return (Math.max(0, seconds) / 3600).toFixed(1);
}
function barValueLabel(value: number, unit: "hrs" | "jobs"): string {
  if (value <= 0) return "";
  return unit === "jobs" ? String(value) : barHoursLabel(value);
}
function fmtUsd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function percentOf(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

// Extract a short "product type" from a job label.
// Labels look like "15061-1 | SKU qty: 1 | CustomerName | Box 3.5g bags"
// We grab the last segment (after the final |) as the product label.
function productType(jobLabel: string): string {
  const parts = jobLabel.split("|").map((s) => s.trim());
  return parts[parts.length - 1] || jobLabel;
}

function skuCountFromJob(job: TimeReportResponse["per_job"][number]): number {
  if (typeof job.sku_count === "number" && job.sku_count > 0) return job.sku_count;
  const match = (job.job_label ?? "").match(/SKU qty:\s*(\d+)/i);
  if (match) return Number(match[1]);
  return 1;
}

// ─── Stat card ─────────────────────────────────────────────────────────────

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{label}</p>
      <p className="mt-0.5 text-xl font-bold tabular-nums text-slate-900">
        {value}
        {sub && <span className="ml-1 text-sm font-normal text-slate-500">{sub}</span>}
      </p>
    </div>
  );
}
// ─── Compact bar chart ──────────────────────────────────────────────────────

function DayBars({
  title,
  totalLabel,
  points,
  color = "#378ADD",
  unit = "hrs",
}: {
  title: string;
  totalLabel?: string;
  points: { date: string; seconds: number }[];
  color?: string;
  unit?: "hrs" | "jobs";
}) {
  const max = Math.max(1, ...points.map((p) => p.seconds));
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
        {totalLabel && <span className="text-xs text-slate-400">{totalLabel}</span>}
      </div>
      <div className="flex h-36 items-end gap-1 pt-2">
        {points.map((d) => (
          <div key={d.date} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <div className="flex h-28 w-full flex-col items-center justify-end gap-0.5">
              <span className="h-3 text-[9px] font-semibold tabular-nums text-slate-500">
                {barValueLabel(d.seconds, unit)}
              </span>
              <div className="flex w-full flex-1 items-end justify-center">
                <div
                  className="w-full max-w-10 rounded-t-sm transition-all"
                  style={{
                    backgroundColor: color,
                    height: `${Math.max(d.seconds > 0 ? 4 : 0, (d.seconds / max) * 100)}%`,
                  }}
                  title={
                    unit === "jobs"
                      ? `${dayLabel(d.date)}: ${d.seconds} ${d.seconds === 1 ? "job" : "jobs"}`
                      : `${dayLabel(d.date)}: ${formatHours(d.seconds)}`
                  }
                />
              </div>
            </div>
            <span className="truncate text-[9px] text-slate-400">{dayLabel(d.date)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
// ─── Payroll table ──────────────────────────────────────────────────────────

function ratesToPayload(rates: Record<string, string>): Record<string, number> {
  const payload: Record<string, number> = {};
  for (const [userId, value] of Object.entries(rates)) {
    const n = Number.parseFloat(value);
    if (Number.isFinite(n) && n >= 0) payload[userId] = n;
    else if (value.trim() === "") payload[userId] = 0;
  }
  return payload;
}

function PayrollTable({
  title,
  peopleLabel,
  rateHint,
  perUser,
  totalSeconds,
}: {
  title: string;
  peopleLabel: string;
  rateHint: string;
  perUser: NonNullable<TimeReportResponse["per_user"]>;
  totalSeconds: number;
}) {
  const [rates, setRates] = useState<Record<string, string>>({});
  const ratesRef = useRef<Record<string, string>>({});
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch("/api/settings/payroll-rates");
      if (!res.ok) return;
      const data = (await res.json()) as { rates?: Record<string, number> };
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const [id, n] of Object.entries(data.rates ?? {})) {
        next[id] = String(n);
      }
      ratesRef.current = next;
      setRates(next);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function persist(next: Record<string, string>, immediate = false) {
    const send = () => {
      void fetch("/api/settings/payroll-rates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rates: ratesToPayload(next) }),
      });
    };
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    if (immediate) {
      send();
      return;
    }
    saveTimer.current = window.setTimeout(send, 400);
  }

  function updateRate(userId: string, value: string) {
    const next = { ...ratesRef.current, [userId]: value };
    ratesRef.current = next;
    setRates(next);
    persist(next);
  }

  const totalPay = perUser.reduce((sum, u) => {
    const rate = parseFloat(rates[u.user_id] ?? "0") || 0;
    return sum + (u.seconds / 3600) * rate;
  }, 0);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              downloadCsv(
                "payroll.csv",
                ["Designer", "Hours", "Share %", "Hourly Rate", "Est. Pay"],
                perUser.map((u) => {
                  const hrs = u.seconds / 3600;
                  const pct = percentOf(u.seconds, totalSeconds);
                  const rate = parseFloat(rates[u.user_id] ?? "0") || 0;
                  const pay = hrs * rate;
                  return [
                    u.display_name,
                    hrs.toFixed(1),
                    String(pct),
                    rate.toFixed(2),
                    pay.toFixed(2),
                  ];
                })
              );
            }}
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </Button>
          {totalPay > 0 && (
            <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
              Total labor: {fmtUsd(totalPay)}
            </span>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
              <th className="pb-2 text-left">{peopleLabel}</th>
              <th className="pb-2 text-right">Hours</th>
              <th className="pb-2 text-right">Share</th>
              <th className="pb-2 text-right">Hourly rate</th>
              <th className="pb-2 text-right">Est. Pay</th>
            </tr>
          </thead>
          <tbody>
            {perUser.map((u) => {
              const hrs = u.seconds / 3600;
              const pct = percentOf(u.seconds, totalSeconds);
              const rate = parseFloat(rates[u.user_id] ?? "0") || 0;
              const pay = hrs * rate;
              return (
                <tr key={u.user_id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-2 pr-3">
                    <div className="font-medium text-slate-800">{u.display_name}</div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-[#378ADD] transition-all"
                        style={{ width: `${Math.max(2, pct)}%` }}
                      />
                    </div>
                  </td>
                  <td className="py-2 text-right tabular-nums text-slate-700">
                    {hrs.toFixed(1)}h
                  </td>
                  <td className="py-2 text-right tabular-nums text-slate-400">{pct}%</td>
                  <td className="py-2 text-right">
                    <div className="inline-flex items-center gap-0.5">
                      <span className="text-slate-400">$</span>
                      <input
                        type="number"
                        min={0}
                        step={0.5}
                        value={rates[u.user_id] ?? ""}
                        onChange={(e) => updateRate(u.user_id, e.target.value)}
                        onBlur={() => persist(ratesRef.current, true)}
                        placeholder="0"
                        className="w-16 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-right text-sm tabular-nums text-slate-800 focus:border-blue-400 focus:outline-none"
                      />
                      <span className="text-slate-400">/hr</span>
                    </div>
                  </td>
                  <td className="py-2 text-right tabular-nums font-semibold text-emerald-700">
                    {pay > 0 ? fmtUsd(pay) : <span className="font-normal text-slate-300">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[10px] text-slate-400">
        Rates are stored for the workspace. Enter each {rateHint} hourly rate to calculate estimated pay.
      </p>
    </div>
  );
}

// ─── Per-job table ──────────────────────────────────────────────────────────

function JobTable({
  jobs,
  totalSeconds,
  peopleLabel,
}: {
  jobs: TimeReportResponse["per_job"];
  totalSeconds: number;
  peopleLabel: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? jobs : jobs.slice(0, 10);
  const avgSecs = jobs.length > 0 ? totalSeconds / jobs.length : 0;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">Per-Job Breakdown</h3>
        <span className="text-xs text-slate-400">Avg {formatHours(avgSecs)} / job</span>
      </div>
      {jobs.length === 0 ? (
        <p className="text-xs text-slate-400">No time logged</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                  <th className="pb-2 text-left">Job / Task</th>
                  <th className="pb-2 text-left">{peopleLabel}</th>
                  <th className="pb-2 text-right">Hours</th>
                  <th className="pb-2 text-right">vs avg</th>
                  <th className="pb-2 text-right">%</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const pct = percentOf(row.seconds, totalSeconds);
                  const diff = row.seconds - avgSecs;
                  const diffLabel =
                    Math.abs(diff) < 60
                      ? "≈ avg"
                      : diff > 0
                      ? `+${formatHours(diff)}`
                      : `-${formatHours(Math.abs(diff))}`;
                  const diffColor =
                    Math.abs(diff) < 60
                      ? "text-slate-400"
                      : diff > 0
                      ? "text-rose-500"
                      : "text-emerald-600";
                  return (
                    <tr
                      key={`${row.job_id ?? "c"}-${row.job_title}`}
                      className="border-b border-slate-50 hover:bg-slate-50"
                    >
                      <td
                        className="max-w-xs truncate py-1.5 font-medium text-slate-800"
                        title={row.job_label ?? row.job_title}
                      >
                        {row.job_label ?? row.job_title}
                      </td>
                      <td className="py-1.5 text-xs text-slate-500">
                        {row.designers?.join(", ") ?? "—"}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-slate-600">
                        {formatHours(row.seconds)}
                      </td>
                      <td className={`py-1.5 text-right tabular-nums text-xs ${diffColor}`}>
                        {diffLabel}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-slate-400">{pct}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {jobs.length > 10 && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-2 text-xs text-blue-500 hover:underline"
            >
              {expanded ? "Show less" : `Show all ${jobs.length} jobs`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ─── Product type analysis ──────────────────────────────────────────────────

function ProductInsights({ jobs }: { jobs: TimeReportResponse["per_job"] }) {
  if (jobs.length === 0) return null;

  // Group by product type (last segment of label), compute avg duration + collect designers
  const typeMap = new Map<
    string,
    { count: number; skuTotal: number; totalSecs: number; designers: Set<string> }
  >();
  for (const j of jobs) {
    const t = productType(j.job_label ?? j.job_title);
    const cur = typeMap.get(t) ?? {
      count: 0,
      skuTotal: 0,
      totalSecs: 0,
      designers: new Set<string>(),
    };
    cur.count += 1;
    cur.skuTotal += skuCountFromJob(j);
    cur.totalSecs += j.seconds;
    for (const d of j.designers ?? []) cur.designers.add(d);
    typeMap.set(t, cur);
  }

  const types = [...typeMap.entries()]
    .map(([label, { count, skuTotal, totalSecs, designers }]) => ({
      label,
      count,
      skuTotal,
      avgSecs: totalSecs / count,
      totalSecs,
      designers: [...designers].sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => b.avgSecs - a.avgSecs)
    .slice(0, 8);

  const maxAvg = Math.max(1, ...types.map((t) => t.avgSecs));
  const overallAvg = jobs.reduce((s, j) => s + j.seconds, 0) / jobs.length;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">Job Type Efficiency</h3>
        <span className="text-xs text-slate-400">Overall avg {formatHours(overallAvg)}</span>
      </div>
      <p className="mb-3 text-[11px] text-slate-400">
        Average time per job by product type — use this to set realistic time budgets.
      </p>
      <ul className="space-y-2">
        {types.map((t) => {
          const pct = (t.avgSecs / maxAvg) * 100;
          const isOver = t.avgSecs > overallAvg * 1.5;
          const isUnder = t.avgSecs < overallAvg * 0.5;
          return (
            <li key={t.label}>
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span
                  className="max-w-[14rem] truncate font-medium text-slate-700"
                  title={t.label}
                >
                  {t.label}
                </span>
                <span className="flex shrink-0 items-center gap-2 tabular-nums text-slate-500">
                  {isOver && (
                    <span className="rounded bg-rose-50 px-1 py-0.5 text-[10px] font-semibold text-rose-600">
                      slow
                    </span>
                  )}
                  {isUnder && (
                    <span className="rounded bg-emerald-50 px-1 py-0.5 text-[10px] font-semibold text-emerald-600">
                      fast
                    </span>
                  )}
                  {formatHours(t.avgSecs)} avg · {t.count} {t.count === 1 ? "job" : "jobs"} ·{" "}
                  {t.skuTotal} {t.skuTotal === 1 ? "SKU" : "SKUs"}
                  {t.designers.length > 0 && (
                    <span className="text-slate-400">· {t.designers.join(", ")}</span>
                  )}
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.max(2, pct)}%`,
                    backgroundColor: isOver ? "#f87171" : isUnder ? "#34d399" : "#378ADD",
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[10px] text-slate-400">
        <span className="font-semibold text-rose-500">Slow</span> = 1.5× over average ·{" "}
        <span className="font-semibold text-emerald-600">Fast</span> = under half the average
      </p>
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

const REPORT_KINDS: { id: TimeReportKind; label: string }[] = [
  { id: "designer", label: "Designer" },
  { id: "prepress", label: "Pre-press" },
  { id: "production", label: "Production" },
];

export function TimeReports({
  isAdmin,
  canStartPrepress = false,
  teamMembers,
}: TimeReportsProps) {
  const weekStart = startOfWeekMonday();
  const [from, setFrom] = useState(() => localDateString(weekStart));
  const [to, setTo] = useState(() => localDateString(addDays(weekStart, 6)));
  const [kind, setKind] = useState<TimeReportKind>(() =>
    canStartPrepress && !isAdmin ? "prepress" : "designer"
  );
  const [userFilter, setUserFilter] = useState<string>("");
  const [report, setReport] = useState<TimeReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from, to, kind });
      if (isAdmin && kind !== "production") {
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
  }, [from, to, userFilter, isAdmin, kind]);

  useEffect(() => {
    void load();
  }, [load]);

  const teamForKind = teamMembers.filter((member) =>
    kind === "prepress"
      ? member.role === "preprod_owner"
      : member.role === "designer"
  );

  const peopleLabel =
    kind === "prepress"
      ? "Pre-press"
      : kind === "production"
        ? "—"
        : "Designer";
  const totalSeconds = report?.daily_totals.reduce((s, d) => s + d.seconds, 0) ?? 0;
  const pcSeconds = report?.pc_seconds ?? 0;
  const totalJobs = report?.per_job.length ?? 0;
  const dayCount = report?.daily_totals.filter((d) => d.seconds > 0).length ?? 0;
  const avgJobsPerDay =
    dayCount > 0 ? (report?.per_job.length ?? 0) / dayCount : 0;
  const avgJobDuration = totalJobs > 0 ? totalSeconds / totalJobs : 0;
  const totalHrs = totalSeconds / 3600;
  const pcHrs = pcSeconds / 3600;
  const handoff = report?.prepress_to_production;
  const showTimerCharts = kind !== "production";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {REPORT_KINDS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setKind(item.id);
              setUserFilter("");
            }}
            className={
              kind === item.id
                ? "border-b-2 border-blue-600 px-3 py-2 text-sm font-semibold text-blue-600"
                : "border-b-2 border-transparent px-3 py-2 text-sm font-medium text-slate-500 hover:text-slate-700"
            }
          >
            {item.label}
          </button>
        ))}
      </div>

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
        {isAdmin && kind !== "production" ? (
          <div>
            <Label htmlFor="report-user">Team</Label>
            <Select
              id="report-user"
              value={userFilter}
              onChange={(e) => setUserFilter(e.target.value)}
              className="min-w-[10rem]"
            >
              <option value="">
                {kind === "prepress"
                  ? "All pre-press"
                  : "All designers"}
              </option>
              {teamForKind.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
        >
          Refresh
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading || !report ? (
        <p className="text-sm text-slate-400">{loading ? "Loading…" : "No data"}</p>
      ) : (
        <>
          {kind === "prepress" && handoff ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <Stat
                label="Prepress → Production jobs"
                value={String(handoff.count)}
              />
              <Stat
                label="Avg handoff"
                value={formatHours(handoff.avg_seconds)}
              />
              <Stat
                label="Median handoff"
                value={formatHours(handoff.median_seconds)}
              />
              <Stat label="Fastest" value={formatHours(handoff.min_seconds)} />
              <Stat label="Slowest" value={formatHours(handoff.max_seconds)} />
            </div>
          ) : null}
          {kind === "prepress" && handoff ? (
            <p className="-mt-2 text-[10px] text-slate-400">
              Average time from leaving a Prepress column until the card first
              enters Production (In Production, Hrach, Apparel, and other press
              stages).
            </p>
          ) : null}

          {kind === "production" && report.production_flow ? (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <Stat
                  label="Jobs into production"
                  value={String(report.production_flow.entered_count)}
                />
                <Stat
                  label="Production completed"
                  value={String(report.production_flow.completed_count)}
                />
                <Stat
                  label="Avg duration in production"
                  value={formatHours(
                    report.production_flow.avg_duration_seconds
                  )}
                />
                <Stat
                  label="Median duration"
                  value={formatHours(
                    report.production_flow.median_duration_seconds
                  )}
                />
                <Stat
                  label="Slowest job"
                  value={formatHours(report.production_flow.max_seconds)}
                />
              </div>
              <p className="-mt-2 text-[10px] text-slate-400">
                Into production = cards that entered In Production / Hrach /
                Apparel. Completed = moved to Production Completed (or out of
                production). Average duration is time spent in those production
                columns until completed.
              </p>
            </>
          ) : null}

          {showTimerCharts ? (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <Stat label="Total jobs" value={String(totalJobs)} />
                <Stat label="PC time" value={pcHrs.toFixed(1)} sub="hrs" />
                <Stat label="Total hours" value={totalHrs.toFixed(1)} sub="hrs" />
                <Stat
                  label="Avg job duration"
                  value={formatHours(avgJobDuration)}
                />
                <Stat
                  label="Jobs / active day"
                  value={avgJobsPerDay.toFixed(1)}
                />
              </div>
              <p className="-mt-2 text-[10px] text-slate-400">
                {kind === "prepress"
                  ? "Hours come from the Prepress timer only — designer clocks are excluded."
                  : "PC time is clock time at the desk — two jobs running at once count as one. Total hours sums every job. Designer clocks only."}
              </p>
            </>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-3">
            {showTimerCharts ? (
              <>
                <DayBars
                  title="Hours per day"
                  totalLabel={`Total ${totalHrs.toFixed(1)} hrs`}
                  points={report.daily_totals}
                />
                <DayBars
                  title="PC time per day"
                  color="#0d9488"
                  totalLabel={`Total ${pcHrs.toFixed(1)} hrs`}
                  points={report.daily_totals.map((d) => ({
                    date: d.date,
                    seconds: d.pc_seconds ?? 0,
                  }))}
                />
                <DayBars
                  title="Avg hours per SKU"
                  color="#7c3aed"
                  points={report.daily_totals.map((d) => ({
                    date: d.date,
                    seconds:
                      (d.sku_count ?? 0) > 0 ? d.seconds / d.sku_count! : 0,
                  }))}
                />
              </>
            ) : (
              <>
                <DayBars
                  title="Hours in production (completed)"
                  totalLabel={`Avg ${formatHours(report.production_flow?.avg_duration_seconds ?? 0)}`}
                  points={
                    report.production_flow?.daily_completed.map((d) => ({
                      date: d.date,
                      seconds: d.seconds,
                    })) ?? report.daily_totals
                  }
                />
                <DayBars
                  title="Jobs into production"
                  color="#0d9488"
                  unit="jobs"
                  totalLabel={`${report.production_flow?.entered_count ?? 0} jobs`}
                  points={
                    report.production_flow?.daily_entered.map((d) => ({
                      date: d.date,
                      seconds: d.count,
                    })) ?? []
                  }
                />
                <DayBars
                  title="Jobs completed"
                  color="#7c3aed"
                  unit="jobs"
                  totalLabel={`${report.production_flow?.completed_count ?? 0} jobs`}
                  points={
                    report.production_flow?.daily_completed.map((d) => ({
                      date: d.date,
                      seconds: d.count,
                    })) ?? []
                  }
                />
              </>
            )}
          </div>

          {isAdmin &&
          report.per_user &&
          report.per_user.length > 0 &&
          kind !== "production" ? (
            <PayrollTable
              title={
                kind === "prepress" ? "Pre-press payroll" : "Designer Payroll"
              }
              peopleLabel={peopleLabel}
              rateHint={
                kind === "prepress" ? "pre-press" : "designer's"
              }
              perUser={report.per_user}
              totalSeconds={totalSeconds}
            />
          ) : null}

          {kind === "prepress" && handoff ? (
            <DayBars
              title="Prepress → Production (hours)"
              color="#d97706"
              totalLabel={`Avg ${formatHours(handoff.avg_seconds)}`}
              points={handoff.daily.map((d) => ({
                date: d.date,
                seconds: d.seconds,
              }))}
            />
          ) : null}

          <ProductInsights jobs={report.per_job} />

          <JobTable
            jobs={report.per_job}
            totalSeconds={totalSeconds}
            peopleLabel={kind === "production" ? "Duration" : peopleLabel}
          />
        </>
      )}
    </div>
  );
}

