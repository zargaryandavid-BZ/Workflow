"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Circle,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchRetryingStale404 } from "@/lib/fetch-with-auth";
import type {
  ActionItem,
  BoardInsights,
  FocusStatus,
  InsightsGroup,
  OrderRef,
} from "@/lib/board-insights";
import { AnalyzeCommentary } from "@/components/app-shell/board-health-commentary";

export type InsightsTab = "overview" | "workload" | "quality" | "actions" | "ai";
type Tab = InsightsTab;

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "workload", label: "Workload" },
  { id: "quality", label: "Designer Quality" },
  { id: "actions", label: "Actions" },
  { id: "ai", label: "AI coach" },
];

const GROUP_COLOR: Record<InsightsGroup, string> = {
  design: "#6366f1",
  client: "#f59e0b",
  production: "#0ea5e9",
  shipping: "#10b981",
  finished: "#94a3b8",
};
const GROUP_LABEL: Record<InsightsGroup, string> = {
  design: "Design",
  client: "Waiting on client",
  production: "Production",
  shipping: "Shipping",
  finished: "Finished",
};

const DONE_KEY = "board-insights-done-v1";

function readDone(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(DONE_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function fmtDays(d: number | null | undefined): string {
  if (d == null) return "—";
  if (d < 1) return `${Math.round(d * 24)}h`;
  return `${d}d`;
}

export function BoardInsightsModal({ onClose, initialTab = "overview" }: { onClose: () => void; initialTab?: InsightsTab }) {
  const [days, setDays] = useState(30);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [data, setData] = useState<BoardInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ai, setAi] = useState<{ text: string; source: string } | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});

  useEffect(() => setDone(readDone()), []);

  const load = useCallback(async (d: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchRetryingStale404(`/api/board/insights?days=${d}`, { cache: "no-store" });
      const json = (await res.json()) as BoardInsights & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to load");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(days);
  }, [days, load]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const runAi = useCallback(async () => {
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await fetchRetryingStale404("/api/board/health/analyze", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days }),
      });
      const json = (await res.json().catch(() => ({}))) as { commentary?: string; source?: string; error?: string };
      if (!res.ok || !json.commentary) throw new Error(json.error ?? "Analysis failed");
      setAi({ text: json.commentary, source: json.source ?? "" });
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setAiLoading(false);
    }
  }, [days]);

  function toggleDone(id: string) {
    setDone((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = new Date().toISOString();
      try {
        localStorage.setItem(DONE_KEY, JSON.stringify(next));
      } catch {
        /* private mode */
      }
      return next;
    });
  }

  const openActions = data ? data.actions.filter((a) => !done[a.id]).length : 0;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-2 sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-full max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-slate-50 shadow-2xl">
        {/* Header */}
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
          <h2 className="text-base font-semibold text-slate-800">Board health dashboard</h2>
          <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className={cn(
                  "rounded-md px-2.5 py-1 font-medium",
                  days === d ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                )}
              >
                {d} days
              </button>
            ))}
          </div>
          <span className="text-xs text-slate-400">compared with the {days} days before</span>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => void load(days)}
              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
              title="Refresh"
              aria-label="Refresh"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-3">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "relative whitespace-nowrap px-3 py-2.5 text-sm font-medium",
                tab === t.id ? "text-blue-700" : "text-slate-500 hover:text-slate-800"
              )}
            >
              {t.label}
              {t.id === "actions" && openActions > 0 ? (
                <span className="ml-1.5 rounded-full bg-red-100 px-1.5 text-[11px] font-bold text-red-700">
                  {openActions}
                </span>
              ) : null}
              {tab === t.id ? <span className="absolute inset-x-2 bottom-0 h-0.5 rounded bg-blue-600" /> : null}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
          ) : !data ? (
            <div className="flex flex-col items-center gap-3 py-20 text-blue-600">
              <span className="inline-flex gap-1.5">
                {[0, 150, 300].map((d) => (
                  <span key={d} className="h-2.5 w-2.5 animate-bounce rounded-full bg-current" style={{ animationDelay: `${d}ms` }} />
                ))}
              </span>
              <p className="text-sm font-semibold">Analyzing the board…</p>
            </div>
          ) : tab === "overview" ? (
            <Overview data={data} onTab={setTab} />
          ) : tab === "workload" ? (
            <Workload data={data} />
          ) : tab === "quality" ? (
            <Quality data={data} />
          ) : tab === "actions" ? (
            <Actions actions={data.actions} done={done} onToggle={toggleDone} />
          ) : (
            <AiCoach text={ai?.text ?? null} source={ai?.source ?? null} loading={aiLoading} error={aiError} onRun={runAi} />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ------------------------------------------------------------------ pieces */

function Card({ title, hint, children, className }: { title: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-xl border border-slate-200 bg-white p-4", className)}>
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Bar({ value, max, color, className }: { value: number; max: number; color: string; className?: string }) {
  const pct = max > 0 ? Math.max(value > 0 ? 3 : 0, Math.round((value / max) * 100)) : 0;
  return (
    <div className={cn("h-2.5 flex-1 rounded-full bg-slate-100", className)}>
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

function OrderLink({ o, extra }: { o: OrderRef; extra?: string }) {
  return (
    <a
      href={`/board?order=${o.id}`}
      className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-700 hover:border-blue-300 hover:text-blue-700"
      title={[o.customer, o.column, o.dueDate ? `due ${o.dueDate}` : null].filter(Boolean).join(" · ")}
    >
      #{o.title}
      {o.late ? <span className="rounded bg-red-100 px-1 text-[10px] font-bold text-red-700">LATE</span> : null}
      {extra ? <span className="text-slate-400">{extra}</span> : null}
    </a>
  );
}

function Ring({ pct, color, label, sub }: { pct: number | null; color: string; label: string; sub: string }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, pct ?? 0));
  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 80 80" className="h-20 w-20 shrink-0 -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke="#e2e8f0" strokeWidth="9" />
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="9"
          strokeDasharray={`${(v / 100) * c} ${c}`}
          strokeLinecap="round"
        />
        <text x="40" y="45" textAnchor="middle" transform="rotate(90 40 40)" fontSize="15" fontWeight="700" fill="#1e293b">
          {pct == null ? "—" : `${Math.round(pct)}%`}
        </text>
      </svg>
      <div>
        <p className="text-sm font-semibold text-slate-800">{label}</p>
        <p className="text-xs text-slate-500">{sub}</p>
      </div>
    </div>
  );
}

function Legend({ color, label, dot }: { color: string; label: string; dot?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("inline-block", dot ? "h-2 w-2 rounded-full" : "h-2.5 w-2.5 rounded-sm")} style={{ background: color }} />
      {label}
    </span>
  );
}

function SeverityDot({ s }: { s: ActionItem["severity"] }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
        s === "high" ? "bg-red-100 text-red-700" : s === "medium" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"
      )}
    >
      {s}
    </span>
  );
}

function ShowAllButton({ total, shown, open, onToggle }: { total: number; shown: number; open: boolean; onToggle: () => void }) {
  if (total <= shown && !open) return null;
  return (
    <button type="button" onClick={onToggle} className="mt-2 text-xs font-semibold text-blue-700 hover:underline">
      {open ? "Show less" : `Show all ${total}`}
    </button>
  );
}

/* ------------------------------------------------------------------ tabs */

function Overview({ data, onTab }: { data: BoardInsights; onTab: (t: Tab) => void }) {
  const f = data.focus;
  return (
    <div className="space-y-4">

      {/* The three bottleneck areas */}
      <div className="grid gap-4 lg:grid-cols-3">
        <DesignPanel f={f.design} onMore={() => onTab("workload")} />
        <ClientPanel f={f.client} onMore={() => onTab("quality")} />
        <ProductionPanel f={f.production} onMore={() => onTab("workload")} />
      </div>

      <FlowCard flow={f.flow} growing={f.growing} longestWait={f.longestWait} days={data.days} />

      {data.actions.length ? (
        <button
          type="button"
          onClick={() => onTab("actions")}
          className="flex w-full items-center justify-between rounded-2xl border-2 border-blue-200 bg-blue-50 px-4 py-3 text-left hover:bg-blue-100"
        >
          <span>
            <span className="block text-sm font-bold text-blue-900">Action plan: {data.actions.length} step-by-step fixes</span>
            <span className="block text-xs text-blue-800">First: {data.actions[0]!.title}</span>
          </span>
          <ArrowRight className="h-5 w-5 text-blue-700" />
        </button>
      ) : null}

    </div>
  );
}

const STATUS_STYLE: Record<FocusStatus, { box: string; badge: string; dot: string; ring: string; text: string }> = {
  red: { box: "border-red-200 bg-red-50 text-red-950", badge: "bg-red-600", dot: "bg-red-500", ring: "border-red-200", text: "text-red-700" },
  amber: { box: "border-amber-200 bg-amber-50 text-amber-950", badge: "bg-amber-500", dot: "bg-amber-500", ring: "border-amber-200", text: "text-amber-700" },
  green: { box: "border-emerald-200 bg-emerald-50 text-emerald-950", badge: "bg-emerald-600", dot: "bg-emerald-500", ring: "border-emerald-200", text: "text-emerald-700" },
};

/** In vs out per working day for each column (Hold left out). Red rows = the pile grows. */
function FlowCard({
  flow,
  growing,
  longestWait,
  days,
}: {
  flow: BoardInsights["focus"]["flow"];
  growing: string[];
  longestWait: string | null;
  days: number;
}) {
  const grow = new Set(growing);
  const max = Math.max(1, ...flow.map((f) => Math.max(f.inPerDay, f.outPerDay)));
  const rows = flow.filter((f) => f.open > 0 || f.inPerDay >= 0.5);
  return (
    <Card
      title="Where jobs pile up: in vs out per day"
      hint={`Average per working day over the last ${days} days. Red = more comes in than goes out. Hold is not counted.`}
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-xs">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="pb-1.5 font-medium">Column</th>
              <th className="pb-1.5 text-right font-medium">Jobs now</th>
              <th className="pb-1.5 pl-3 font-medium">In / day</th>
              <th className="pb-1.5 font-medium">Out / day</th>
              <th className="pb-1.5 text-right font-medium">Avg wait</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => {
              const isGrow = grow.has(f.id);
              const isLongest = f.id === longestWait;
              return (
                <tr key={f.id} className={cn("border-t border-slate-100", isGrow && "bg-red-50/60")}>
                  <td className="py-1.5 pr-2">
                    <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: GROUP_COLOR[f.group] }} />
                    <span className={cn("font-medium", isGrow ? "text-red-800" : "text-slate-700")}>{f.name}</span>
                    {isGrow ? <span className="ml-1.5 rounded bg-red-600 px-1 text-[9px] font-bold uppercase text-white">piling up</span> : null}
                    {isLongest ? <span className="ml-1.5 rounded bg-amber-500 px-1 text-[9px] font-bold uppercase text-white">longest wait</span> : null}
                  </td>
                  <td className="py-1.5 text-right font-semibold tabular-nums text-slate-800">
                    {f.open}
                    {f.late ? <span className="ml-1 text-[10px] font-semibold text-red-600">({f.late} late)</span> : null}
                  </td>
                  <td className="w-[24%] py-1.5 pl-3">
                    <div className="flex items-center gap-1.5">
                      <Bar value={f.inPerDay} max={max} color="#60a5fa" />
                      <span className="w-8 text-right tabular-nums text-slate-600">{f.inPerDay}</span>
                    </div>
                  </td>
                  <td className="w-[24%] py-1.5">
                    <div className="flex items-center gap-1.5">
                      <Bar value={f.outPerDay} max={max} color={isGrow ? "#ef4444" : "#34d399"} />
                      <span className="w-8 text-right tabular-nums text-slate-600">{f.outPerDay}</span>
                    </div>
                  </td>
                  <td className={cn("py-1.5 text-right tabular-nums", (f.avgDaysWaiting ?? 0) >= 3 ? "font-semibold text-red-600" : "text-slate-600")}>
                    {fmtDays(f.avgDaysWaiting)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Panel({
  title,
  status,
  note,
  onMore,
  moreLabel,
  children,
}: {
  title: string;
  status: FocusStatus;
  note: string;
  onMore: () => void;
  moreLabel: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("flex flex-col rounded-2xl border-2 bg-white p-4", STATUS_STYLE[status].ring)}>
      <div className="mb-3 flex items-center gap-2">
        <span className={cn("h-3 w-3 rounded-full", STATUS_STYLE[status].dot)} />
        <h3 className="text-base font-bold text-slate-800">{title}</h3>
        <span className={cn("ml-auto text-[11px] font-bold uppercase", STATUS_STYLE[status].text)}>
          {status === "red" ? "Bottleneck" : status === "amber" ? "Slow" : "OK"}
        </span>
      </div>
      <div className="flex-1 space-y-3">{children}</div>
      <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-700">{note}</p>
      <button type="button" onClick={onMore} className="mt-2 inline-flex items-center gap-1 self-start text-xs font-semibold text-blue-700 hover:underline">
        {moreLabel} <ArrowRight className="h-3 w-3" />
      </button>
    </section>
  );
}

function Stat({ value, label, tone }: { value: React.ReactNode; label: string; tone?: "red" | "amber" }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2">
      <p className={cn("text-2xl font-bold tabular-nums leading-tight", tone === "red" ? "text-red-600" : tone === "amber" ? "text-amber-600" : "text-slate-800")}>
        {value}
      </p>
      <p className="text-[11px] leading-snug text-slate-500">{label}</p>
    </div>
  );
}

function OldestList({ title, orders }: { title: string; orders: OrderRef[] }) {
  if (!orders.length) return null;
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{title}</p>
      <div className="flex flex-wrap gap-1">
        {orders.map((o) => (
          <OrderLink key={o.id} o={o} extra={fmtDays(o.days)} />
        ))}
      </div>
    </div>
  );
}

/** "↑ 38%" vs the previous period. Output going up is green; for duration, going down is green. */
function Growth({ cur, prev, goodWhen = "up" }: { cur: number | null; prev: number | null; goodWhen?: "up" | "down" }) {
  if (cur == null || prev == null || prev === 0) return <span className="text-[10px] text-slate-400">no earlier data</span>;
  const pctChange = Math.round(((cur - prev) / prev) * 100);
  if (pctChange === 0) return <span className="text-[10px] font-semibold text-slate-500">= same</span>;
  const up = pctChange > 0;
  const good = goodWhen === "up" ? up : !up;
  return (
    <span className={cn("inline-flex items-center text-[10px] font-bold", good ? "text-emerald-600" : "text-red-600")} title={`Previous period: ${prev}`}>
      {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {up ? "+" : ""}
      {pctChange}%
    </span>
  );
}

function GrowthStat({
  value,
  label,
  cur,
  prev,
  goodWhen,
  tone,
}: {
  value: React.ReactNode;
  label: string;
  cur: number | null;
  prev: number | null;
  goodWhen?: "up" | "down";
  tone?: "red" | "amber";
}) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-1">
        <p className={cn("text-xl font-bold tabular-nums leading-tight", tone === "red" ? "text-red-600" : tone === "amber" ? "text-amber-600" : "text-slate-800")}>
          {value}
        </p>
        {cur == null && prev == null ? null : <Growth cur={cur} prev={prev} goodWhen={goodWhen} />}
      </div>
      <p className="text-[11px] leading-snug text-slate-500">{label}</p>
    </div>
  );
}

function DesignPanel({ f, onMore }: { f: BoardInsights["focus"]["design"]; onMore: () => void }) {
  return (
    <Panel title="Design" status={f.status} note={f.note} onMore={onMore} moreLabel="Designer details">
      <div className="grid grid-cols-2 gap-2">
        <GrowthStat value={f.perDay ?? "—"} label="designs per day (team)" cur={f.perDay} prev={f.prevPerDay} />
        <GrowthStat
          value={f.avgMinutes == null ? "—" : `${f.avgMinutes}m`}
          label="average job duration"
          cur={f.avgMinutes}
          prev={f.prevAvgMinutes}
          goodWhen="down"
        />
        <GrowthStat value={f.skus} label="SKU qty designed" cur={f.skus} prev={f.prevSkus} />
        <GrowthStat
          value={f.incomingPerDay ?? "—"}
          label={`new jobs per day${f.incomingPerDay != null && f.perDay != null && f.incomingPerDay > f.perDay ? " — more than designers finish" : ""}`}
          cur={f.incomingPerDay}
          prev={f.prevIncomingPerDay}
          goodWhen="down"
          tone={f.incomingPerDay != null && f.perDay != null && f.incomingPerDay > f.perDay ? "red" : undefined}
        />
      </div>
      <div className="divide-y divide-slate-100 rounded-xl border border-slate-100">
        {f.designers.map((d) => (
          <div key={d.id} className="px-3 py-2">
            <p className="text-sm font-semibold text-slate-800">{d.name}</p>
            <div className="mt-1 grid grid-cols-3 gap-2 text-xs">
              <span>
                <b className="text-base tabular-nums text-slate-800">{d.perDay ?? 0}</b> <Growth cur={d.perDay} prev={d.prevPerDay} />
                <span className="block text-[11px] text-slate-500">design/day</span>
              </span>
              <span>
                <b className="text-base tabular-nums text-slate-800">{d.avgMinutes == null ? "—" : `${d.avgMinutes}m`}</b>{" "}
                <Growth cur={d.avgMinutes} prev={d.prevAvgMinutes} goodWhen="down" />
                <span className="block text-[11px] text-slate-500">average job duration</span>
              </span>
              <span>
                <b className="text-base tabular-nums text-slate-800">{d.skus}</b> <Growth cur={d.skus} prev={d.prevSkus} />
                <span className="block text-[11px] text-slate-500">SKU qty</span>
              </span>
            </div>
          </div>
        ))}
        {f.designers.length === 0 ? <p className="px-3 py-2 text-xs text-slate-500">No designers yet.</p> : null}
      </div>
      <p className="text-[10px] text-slate-400">Arrows compare with the previous period of the same length.</p>
    </Panel>
  );
}

function fmtHours(h: number | null): string {
  if (h == null) return "—";
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 48) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}

function ClientPanel({ f, onMore }: { f: BoardInsights["focus"]["client"]; onMore: () => void }) {
  return (
    <Panel title="Waiting on client" status={f.status} note={f.note} onMore={onMore} moreLabel="Missing info and rejections">
      <div className="rounded-xl border border-amber-100 p-3">
        <p className="mb-2 text-xs font-bold text-amber-800">Missing information</p>
        <div className="grid grid-cols-3 gap-1.5">
          <GrowthStat
            value={`${Math.round(f.missingRate ?? 0)}%`}
            label="of orders went to missing info"
            cur={f.missingRate}
            prev={f.prevMissingRate}
            goodWhen="down"
            tone={(f.missingRate ?? 0) >= 20 ? "amber" : undefined}
          />
          <GrowthStat
            value={`${Math.round(f.missingAnsweredPct ?? 0)}%`}
            label="Answered requests"
            cur={f.missingAnsweredPct}
            prev={f.prevMissingAnsweredPct}
          />
          <GrowthStat
            value={fmtHours(f.missingReplyHours)}
            label="average time to reply"
            cur={f.missingReplyHours}
            prev={f.prevMissingReplyHours}
            goodWhen="down"
          />
        </div>
        <div className="mt-2">
          <OldestList title={`Waiting longest to reply (${f.missingNow} now)`} orders={f.missingOldest} />
        </div>
      </div>
      <div className="rounded-xl border border-orange-100 p-3">
        <p className="mb-2 text-xs font-bold text-orange-800">Waiting approval</p>
        <div className="grid grid-cols-3 gap-1.5">
          <GrowthStat
            value={`${Math.round(f.approvalReachPct ?? 0)}%`}
            label="of orders went to approval"
            cur={f.approvalReachPct}
            prev={f.prevApprovalReachPct}
          />
          <GrowthStat
            value={`${Math.round(f.approvalRatePct ?? 0)}%`}
            label="approval rate"
            cur={f.approvalRatePct}
            prev={f.prevApprovalRatePct}
          />
          <GrowthStat
            value={fmtHours(f.approvalHours)}
            label="average approval time"
            cur={f.approvalHours}
            prev={f.prevApprovalHours}
            goodWhen="down"
          />
          <GrowthStat
            value={`${Math.round(f.rejectionRatePct ?? 0)}%`}
            label="rejection rate"
            cur={f.rejectionRatePct}
            prev={f.prevRejectionRatePct}
            goodWhen="down"
            tone={(f.rejectionRatePct ?? 0) >= 20 ? "amber" : undefined}
          />
          <GrowthStat
            value={f.avgRounds ?? "—"}
            label={`proof rounds to fix (${f.multiRejectCount} jobs rejected 2+ times)`}
            cur={f.avgRounds}
            prev={f.prevAvgRounds}
            goodWhen="down"
          />
          <GrowthStat
            value={f.approvalOver2Days}
            label={`of ${f.approvalNow} waiting 2+ days`}
            cur={null}
            prev={null}
            tone={f.approvalOver2Days >= 5 ? "red" : f.approvalOver2Days ? "amber" : undefined}
          />
        </div>
        <div className="mt-2">
          <OldestList title="Waiting longest to reply" orders={f.approvalOldest} />
        </div>
      </div>
    </Panel>
  );
}

/** Bars: jobs that left production each day (week for long periods). Hover for the count. */
function LeftProductionChart({
  data,
  bucketDays,
  perDay,
  prevPerDay,
}: {
  data: { label: string; count: number }[];
  bucketDays: number;
  perDay: number | null;
  prevPerDay: number | null;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.count));
  const total = data.reduce((n, d) => n + d.count, 0);
  const h = hover != null ? data[hover] : null;
  const every = Math.max(1, Math.ceil(data.length / 7));
  return (
    <div className="rounded-xl border border-slate-100 p-2.5">
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-1">
        <p className="text-xs font-semibold text-slate-700">Jobs leaving production {bucketDays > 1 ? "per week" : "per day"}</p>
        <p className="flex items-center gap-1 text-[11px] text-slate-500">
          avg <b className="text-slate-800">{perDay ?? 0}</b>/day <Growth cur={perDay} prev={prevPerDay} />
        </p>
      </div>
      <div className="relative" onMouseLeave={() => setHover(null)}>
        <div className="flex h-20 items-end gap-0.5">
          {data.map((d, i) => (
            <div key={i} className="flex h-full flex-1 flex-col justify-end" onMouseEnter={() => setHover(i)}>
              <div
                className={cn("w-full rounded-sm", hover === i ? "bg-emerald-700" : "bg-emerald-400")}
                style={{ height: `${Math.max(d.count ? 3 : 1, (d.count / max) * 76)}px` }}
              />
            </div>
          ))}
        </div>
        <div className="mt-1 flex gap-0.5">
          {data.map((d, i) => (
            <span key={i} className={cn("flex-1 text-center text-[8px] tabular-nums", hover === i ? "font-bold text-emerald-700" : "text-slate-400")}>
              {i % every === 0 || i === data.length - 1 || hover === i ? d.label : ""}
            </span>
          ))}
        </div>
        {h ? (
          <div
            className="pointer-events-none absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] shadow-lg"
            style={{ left: `clamp(0px, calc(${((hover! + 0.5) / data.length) * 100}% - 3.5rem), calc(100% - 7rem))` }}
          >
            <b>{h.label}</b>
            {bucketDays > 1 ? " (week)" : ""}: <b>{h.count}</b> job{h.count === 1 ? "" : "s"} left
          </div>
        ) : null}
      </div>
      <p className="mt-1 text-[10px] text-slate-400">{total} jobs reached Ready to Ship in this period.</p>
    </div>
  );
}

function ProductionPanel({ f, onMore }: { f: BoardInsights["focus"]["production"]; onMore: () => void }) {
  const onTime = Math.max(0, f.openNow - f.late);
  return (
    <Panel title="Production" status={f.status} note={f.note} onMore={onMore} moreLabel="Stuck in production">
      <div className="grid grid-cols-2 gap-2">
        <Stat value={f.openNow} label="jobs in production" />
        <Stat value={f.daysInProduction == null ? "—" : `${f.daysInProduction}d`} label={`approval → ready to ship (was ${f.prevDaysInProduction ?? "—"}d)`} />
      </div>
      <LeftProductionChart data={f.leftPerBucket} bucketDays={f.bucketDays} perDay={f.leftPerDay} prevPerDay={f.prevLeftPerDay} />
      <div>
        <div className="mb-1 flex justify-between text-[11px] text-slate-500">
          <span>On time {onTime}</span>
          <span className="font-semibold text-red-600">Late {f.late}</span>
        </div>
        <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
          <div className="bg-sky-400" style={{ width: `${(onTime / Math.max(1, f.openNow)) * 100}%` }} />
          <div className="bg-red-500" style={{ width: `${(f.late / Math.max(1, f.openNow)) * 100}%` }} />
        </div>
      </div>
      <OldestList title="In production longest" orders={f.oldest} />
    </Panel>
  );
}

function ColumnLoad({ data }: { data: BoardInsights }) {
  const cols = data.columns.filter((c) => c.open > 0 && c.group !== "shipping");
  const max = Math.max(1, ...cols.map((c) => c.open));
  return (
    <div className="space-y-1.5">
      {cols.map((c) => (
        <div key={c.id} className="flex items-center gap-2 text-xs">
          <span className="w-36 shrink-0 truncate text-slate-700" title={c.name}>
            {c.name}
          </span>
          <div className="relative h-3.5 flex-1 overflow-hidden rounded bg-slate-100">
            <div className="absolute inset-y-0 left-0 rounded" style={{ width: `${(c.open / max) * 100}%`, background: GROUP_COLOR[c.group] }} />
            <div className="absolute inset-y-0 left-0 rounded bg-red-500/80" style={{ width: `${(c.late / max) * 100}%` }} />
          </div>
          <span className="w-16 shrink-0 text-right tabular-nums text-slate-600">
            {c.open}
            {c.late ? <span className="text-red-600"> ({c.late})</span> : null}
          </span>
        </div>
      ))}
      <div className="flex flex-wrap gap-3 pt-1 text-[11px] text-slate-500">
        {(["design", "client", "production"] as InsightsGroup[]).map((g) => (
          <Legend key={g} color={GROUP_COLOR[g]} label={GROUP_LABEL[g]} />
        ))}
        <Legend color="#ef4444" label="Late" />
      </div>
    </div>
  );
}

function Workload({ data }: { data: BoardInsights }) {
  const [allStuck, setAllStuck] = useState(false);
  const stuck = allStuck ? data.stuckProduction : data.stuckProduction.slice(0, 6);
  const max = Math.max(1, ...data.designers.map((d) => d.toDesign + d.onHold + d.waitingClient));
  return (
    <div className="space-y-4">
      <Card title="Designer load" hint="Jobs each designer holds now. Dark = to design (Start / In Progress), grey = on hold, light = waiting on the client.">
        <div className="space-y-3">
          {data.designers.map((d) => (
            <div key={d.id}>
              <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-xs">
                <span className="text-sm font-semibold text-slate-800">{d.name}</span>
                <span className="text-slate-500">
                  <b className="text-slate-800">{d.toDesign}</b> to design ({d.skus} SKUs) · {d.onHold} on hold · {d.waitingClient} waiting on client ·{" "}
                  {d.inProduction} in production ·{" "}
                  <span className={d.late ? "font-semibold text-red-600" : ""}>{d.late} late</span> · oldest {fmtDays(d.oldestDays)}
                </span>
              </div>
              <div className="flex h-4 overflow-hidden rounded bg-slate-100">
                <div className="bg-indigo-500" style={{ width: `${(d.toDesign / max) * 100}%` }} title={`${d.toDesign} to design`} />
                <div className="bg-slate-400" style={{ width: `${(d.onHold / max) * 100}%` }} title={`${d.onHold} on hold`} />
                <div className="bg-amber-300" style={{ width: `${(d.waitingClient / max) * 100}%` }} title={`${d.waitingClient} waiting on client`} />
              </div>
            </div>
          ))}
          {data.designers.length === 0 ? <p className="text-sm text-slate-500">No designers on this workspace.</p> : null}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Load per column" hint="Open jobs and how many are late.">
          <ColumnLoad data={data} />
        </Card>
        <Card title="Stuck in production" hint="Jobs sitting longest in a production column. Click to open the card.">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="pb-1 font-medium">Job</th>
                <th className="pb-1 font-medium">Client</th>
                <th className="pb-1 font-medium">Column</th>
                <th className="pb-1 text-right font-medium">Days there</th>
              </tr>
            </thead>
            <tbody>
              {stuck.map((o) => (
                <tr key={o.id} className="border-t border-slate-100">
                  <td className="py-1.5">
                    <OrderLink o={o} />
                  </td>
                  <td className="max-w-[9rem] truncate py-1.5 text-slate-600">{o.customer ?? "—"}</td>
                  <td className="py-1.5 text-slate-600">{o.column}</td>
                  <td className={cn("py-1.5 text-right font-semibold tabular-nums", (o.days ?? 0) >= 7 ? "text-red-600" : "text-slate-700")}>
                    {fmtDays(o.days)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <ShowAllButton total={data.stuckProduction.length} shown={6} open={allStuck} onToggle={() => setAllStuck((v) => !v)} />
        </Card>
      </div>
    </div>
  );
}

function Quality({ data }: { data: BoardInsights }) {
  const q = data.quality;
  const [allClients, setAllClients] = useState(false);
  const [allJobs, setAllJobs] = useState(false);
  const clients = allClients ? q.clients : q.clients.slice(0, 5);
  const jobs = allJobs ? q.rejections.multiRejectJobs : q.rejections.multiRejectJobs.slice(0, 6);
  const maxRate = Math.max(1, ...data.designers.map((d) => d.rejectionRate ?? 0));
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Missing information" hint="New jobs that needed a missing-info request.">
          <Ring
            pct={q.missingInfo.rate}
            color="#f59e0b"
            label={`${q.missingInfo.orders} of ${q.missingInfo.newOrders} new jobs needed info`}
            sub={`Last period: ${Math.round(q.missingInfo.prevRate ?? 0)}%`}
          />
        </Card>
        <Card title="Proof rejections" hint="Rejected vs approved proofs.">
          <Ring
            pct={q.rejections.rate}
            color="#ef4444"
            label={`${q.rejections.rejected} of ${q.rejections.rejected + q.rejections.approved} proofs rejected`}
            sub={`Last period: ${Math.round(q.rejections.prevRate ?? 0)}%`}
          />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Rejection rate per designer" hint="Share of each designer's proofs the client rejected.">
          <div className="space-y-2">
            {data.designers
              .filter((d) => d.approvals + d.rejections > 0)
              .map((d) => (
                <div key={d.id} className="flex items-center gap-2 text-xs">
                  <span className="w-32 shrink-0 truncate font-medium text-slate-700">{d.name}</span>
                  <Bar value={d.rejectionRate ?? 0} max={Math.max(maxRate, 30)} color="#ef4444" />
                  <span className="w-12 shrink-0 text-right font-semibold tabular-nums text-slate-700">
                    {Math.round(d.rejectionRate ?? 0)}%
                  </span>
                </div>
              ))}
          </div>
        </Card>
        <Card title="Jobs rejected several times" hint="Proof went back 2 or more times.">
          <div className="flex flex-wrap gap-1.5">
            {jobs.map((o) => (
              <OrderLink key={o.id} o={o} extra={`×${o.count}`} />
            ))}
            {q.rejections.multiRejectJobs.length === 0 ? <p className="text-sm text-slate-500">None this period.</p> : null}
          </div>
          <ShowAllButton total={q.rejections.multiRejectJobs.length} shown={6} open={allJobs} onToggle={() => setAllJobs((v) => !v)} />
        </Card>
      </div>

      <Card title="Clients who send work back most" hint="Call them before the next proof.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-xs">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="pb-1.5 font-medium">Client</th>
                <th className="pb-1.5 text-right font-medium">Rejections</th>
                <th className="pb-1.5 text-right font-medium">Missing info</th>
                <th className="pb-1.5 pl-3 font-medium">Jobs</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.customerId} className="border-t border-slate-100 align-top">
                  <td className="py-1.5 font-medium text-slate-800">{c.name}</td>
                  <td className="py-1.5 text-right tabular-nums font-semibold text-red-600">{c.rejections}</td>
                  <td className="py-1.5 text-right tabular-nums font-semibold text-amber-600">{c.missingInfo}</td>
                  <td className="py-1.5 pl-3">
                    <div className="flex flex-wrap gap-1">
                      {c.orders.slice(0, 3).map((o) => (
                        <OrderLink key={o.id} o={o} />
                      ))}
                      {c.orders.length > 3 ? <span className="text-[11px] text-slate-400">+{c.orders.length - 3}</span> : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {q.clients.length === 0 ? <p className="text-sm text-slate-500">No repeat problems this period.</p> : null}
        </div>
        <ShowAllButton total={q.clients.length} shown={5} open={allClients} onToggle={() => setAllClients((v) => !v)} />
      </Card>

      <Card title="Proofs waiting for the client 2+ days">
        <div className="flex flex-wrap gap-1.5">
          {q.waitingApproval.map((o) => (
            <OrderLink key={o.id} o={o} extra={fmtDays(o.days)} />
          ))}
          {q.waitingApproval.length === 0 ? <p className="text-sm text-slate-500">None.</p> : null}
        </div>
      </Card>
    </div>
  );
}

function Actions({ actions, done, onToggle }: { actions: ActionItem[]; done: Record<string, string>; onToggle: (id: string) => void }) {
  const sorted = useMemo(
    () => [...actions].sort((a, b) => Number(Boolean(done[a.id])) - Number(Boolean(done[b.id]))),
    [actions, done]
  );
  const doneCount = actions.filter((a) => done[a.id]).length;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex-1">
          <p className="text-sm font-semibold text-slate-800">
            {doneCount} of {actions.length} done
          </p>
          <p className="text-xs text-slate-500">Tick an item when it is handled. Your ticks are saved in this browser.</p>
        </div>
        <div className="w-40">
          <Bar value={doneCount} max={Math.max(1, actions.length)} color="#10b981" />
        </div>
      </div>
      {sorted.map((a) => {
        const isDone = Boolean(done[a.id]);
        return (
          <div key={a.id} className={cn("rounded-xl border bg-white p-4", isDone ? "border-emerald-200 opacity-60" : "border-slate-200")}>
            <div className="flex items-start gap-3">
              <button
                type="button"
                onClick={() => onToggle(a.id)}
                className="mt-0.5 shrink-0 text-slate-400 hover:text-emerald-600"
                aria-label={isDone ? "Mark not done" : "Mark done"}
              >
                {isDone ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <Circle className="h-5 w-5" />}
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityDot s={a.severity} />
                  <p className={cn("text-sm font-semibold text-slate-800", isDone && "line-through")}>{a.title}</p>
                </div>
                <p className="mt-1 text-xs text-slate-600">{a.detail}</p>
                {a.steps?.length ? (
                  <ol className="mt-2 space-y-1.5">
                    {a.steps.map((step, i) => (
                      <li key={i} className="flex gap-2 text-xs leading-snug text-slate-700">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[10px] font-bold text-blue-800">
                          {i + 1}
                        </span>
                        <span className="pt-0.5">{step}</span>
                      </li>
                    ))}
                  </ol>
                ) : null}
                <p className="mt-2 rounded-md bg-emerald-50 px-2 py-1 text-xs text-emerald-900">
                  <b>Expected result:</b> {a.result}
                </p>
                {a.orders.length ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {a.orders.map((o) => (
                      <OrderLink key={o.id} o={o} extra={o.days != null ? fmtDays(o.days) : undefined} />
                    ))}
                  </div>
                ) : null}
                {isDone ? <p className="mt-1 text-[11px] text-emerald-700">Done {new Date(done[a.id]!).toLocaleDateString()}</p> : null}
              </div>
            </div>
          </div>
        );
      })}
      {actions.length === 0 ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-6 text-center text-sm text-emerald-800">
          Nothing urgent. The board looks healthy.
        </p>
      ) : null}
    </div>
  );
}

function AiCoach({
  text,
  source,
  loading,
  error,
  onRun,
}: {
  text: string | null;
  source: string | null;
  loading: boolean;
  error: string | null;
  onRun: () => void;
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <Sparkles className="h-5 w-5 shrink-0 text-violet-500" />
        <p className="flex-1 text-xs text-slate-600">
          The AI reads every number on this dashboard (load, flow, stage times, rejections, missing info, repeat clients) and writes a
          short plan with expected results.
        </p>
        <button
          type="button"
          disabled={loading}
          onClick={onRun}
          className="whitespace-nowrap rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {loading ? "Analyzing…" : text ? "Run again" : "Analyze board"}
        </button>
      </div>
      {error ? (
        <p className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4" /> {error}
        </p>
      ) : null}
      {text ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm leading-relaxed text-slate-700">
          <AnalyzeCommentary text={text} />
          {source === "fallback" ? <p className="mt-3 text-[11px] text-slate-400">Stats-only briefing (AI unavailable).</p> : null}
        </div>
      ) : null}
    </div>
  );
}
