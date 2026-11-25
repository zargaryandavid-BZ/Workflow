"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, BarChart3, HeartPulse, Info, Sparkles } from "lucide-react";
import { dedupedFetchRetryingStale404, fetchRetryingStale404 } from "@/lib/fetch-with-auth";
import { cn } from "@/lib/utils";
import {
  BOARD_HEALTH_META,
  type BoardHealthLevel,
  type BoardHealthResult,
} from "@/lib/board-health";
import type { BoardInsights, FocusStatus } from "@/lib/board-insights";
import { BoardInsightsModal, type InsightsTab } from "@/components/app-shell/board-insights-modal";

const EMPTY: BoardHealthResult = {
  level: 5,
  label: "Healthy",
  summary: "No late, stuck, or warning jobs.",
  counts: {
    open: 0,
    late: 0,
    dueToday: 0,
    warnings: 0,
    stuck: 0,
    attention: 0,
  },
  visible: true,
  show: {
    late: true,
    dueToday: true,
    warnings: true,
    stuck: true,
  },
  throughLabel: "Ready to Ship",
  designers: [],
};

interface BoardHealthButtonProps {
  /** From tenant settings; when false, do not render. */
  enabled?: boolean;
}

const DOT: Record<FocusStatus, string> = {
  red: "bg-red-500",
  amber: "bg-amber-500",
  green: "bg-emerald-500",
};

export function BoardHealthButton({ enabled = true }: BoardHealthButtonProps) {
  const [open, setOpen] = useState(false);
  const [health, setHealth] = useState<BoardHealthResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [focus, setFocus] = useState<BoardInsights["focus"] | null>(null);
  const [popup, setPopup] = useState<BoardInsights["popup"] | null>(null);
  const [dashboardTab, setDashboardTab] = useState<InsightsTab | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await dedupedFetchRetryingStale404("/api/board/health", {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as BoardHealthResult;
      if (typeof data.level === "number") setHealth(data);
    } catch {
      // Non-fatal — icon still renders.
    } finally {
      setLoading(false);
    }
  }, []);

  /** Design / client / production summary (same data as the dashboard, 60 s cache). */
  const loadFocus = useCallback(async () => {
    try {
      const res = await fetchRetryingStale404("/api/board/insights?days=30", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as BoardInsights;
      if (data.focus) setFocus(data.focus);
      if (data.popup) setPopup(data.popup);
    } catch {
      // Popup still shows the health counts.
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void load();
    function onFocus() {
      void load();
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load, enabled]);

  useEffect(() => {
    if (!open || !enabled) return;
    void load();
    void loadFocus();
    function onPointerDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, load, loadFocus, enabled]);

  if (!enabled) return null;
  if (health && health.visible === false) return null;

  const result = health ?? EMPTY;
  const level = result.level as BoardHealthLevel;
  const meta = BOARD_HEALTH_META[level];
  const c = result.counts;
  const show = result.show ?? EMPTY.show;

  function openDashboard(tab: InsightsTab) {
    setOpen(false);
    setDashboardTab(tab);
  }

  const tiles = [
    show.late ? { label: "Late", value: c.late, cls: "bg-red-50 text-red-600" } : null,
    show.dueToday ? { label: "Due today", value: c.dueToday, cls: "bg-orange-50 text-orange-600" } : null,
    { label: "Not assigned", value: popup ? popup.unassigned : "…", cls: popup?.unassigned ? "bg-violet-50 text-violet-700" : "bg-slate-50 text-slate-800" },
    { label: "Created today", value: popup ? popup.createdToday : "…", cls: "bg-blue-50 text-blue-700" },
  ].filter(Boolean) as { label: string; value: number | string; cls: string }[];

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-slate-100",
          loading && !health ? "text-slate-300" : meta.iconClass
        )}
        title={`Board health: ${level} — ${meta.label}`}
        aria-label={`Board health: ${level} ${meta.label}`}
        aria-expanded={open}
      >
        <HeartPulse className="h-5 w-5" strokeWidth={2.25} />
      </button>

      {open ? (
        <div className="absolute left-0 z-50 mt-1 w-[24rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
          {/* Header */}
          <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
            <HeartPulse className={cn("h-5 w-5 shrink-0", meta.iconClass)} strokeWidth={2.25} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-slate-800">Board health</p>
              <p className="truncate text-xs text-slate-500">{result.summary}</p>
            </div>
            <span
              className="rounded-full px-2.5 py-1 text-[11px] font-bold uppercase text-white"
              style={{ background: meta.color }}
            >
              {meta.label}
            </span>
          </div>

          <div className="space-y-3 p-4">
            {/* Health counts */}
            <div className="grid grid-cols-4 gap-1.5">
              {tiles.map((t) => (
                <div key={t.label} className={cn("rounded-lg px-2 py-1.5 text-center", t.cls)}>
                  <p className="flex h-7 items-center justify-center text-lg font-bold leading-tight tabular-nums">
                    {t.value === "…" ? <AnalyzingDots /> : t.value}
                  </p>
                  <p className="text-[10px] font-medium text-slate-500">{t.label}</p>
                </div>
              ))}
            </div>

            {/* The three bottleneck areas */}
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              <AreaRow
                title="Design"
                status={focus?.design.status}
                text={
                  focus
                    ? `${focus.design.perDay ?? 0} designs/day · ${focus.design.incomingPerDay ?? 0} new jobs/day · ${focus.design.queue} waiting`
                    : null
                }
                onClick={() => openDashboard("overview")}
              />
              <AreaRow
                title="Waiting on client"
                status={focus?.client.status}
                text={
                  focus
                    ? popup
                      ? `Missing info ${popup.missingToday} today / ${popup.missingTotal} total · Waiting approval ${popup.approvalToday} today / ${popup.approvalTotal} total`
                      : `${focus.client.missingNow} missing info · ${focus.client.approvalNow} waiting approval`
                    : null
                }
                onClick={() => openDashboard("overview")}
              />
              <AreaRow
                title="Production"
                status={focus?.production.status}
                text={popup ? `${popup.floorOpen} jobs in In Production + Finishing · ${popup.floorLate} late` : null}
                onClick={() => openDashboard("overview")}
              />
            </div>

            {/* Jobs created per day */}
            {popup ? <CreatedChart data={popup.createdPerDay} change={popup.createdChange} /> : null}

            {/* Designer load: jobs in Start / In Progress */}
            {popup && popup.designers.length > 0 ? (
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Designer load</p>
                <div className="max-h-40 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
                  {popup.designers.map((d) => (
                    <div key={d.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                      <span className="min-w-0 flex-1 truncate font-medium text-slate-700">{d.name}</span>
                      <span className="shrink-0 tabular-nums text-slate-500">
                        Orders <b className="text-slate-800">{d.orders}</b> · SKU <b className="text-slate-800">{d.skus}</b> · Qty{" "}
                        <b className="text-slate-800">{d.qty.toLocaleString("en-US")}</b>
                      </span>
                    </div>
                  ))}
                  {popup.unassigned ? (
                    <div className="flex items-center gap-2 bg-violet-50 px-3 py-1.5 text-xs">
                      <span className="flex-1 font-semibold text-violet-800">Not assigned</span>
                      <span className="font-semibold text-violet-800">
                        {popup.unassigned} job{popup.unassigned === 1 ? "" : "s"}
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {/* Actions */}
            <button
              type="button"
              onClick={() => openDashboard("overview")}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700"
            >
              <BarChart3 className="h-4 w-4" />
              Open full dashboard
            </button>
            <button
              type="button"
              onClick={() => openDashboard("ai")}
              className="inline-flex w-full items-center justify-center gap-1.5 text-xs font-semibold text-violet-700 hover:underline"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Ask the AI coach
            </button>
          </div>
        </div>
      ) : null}
      {dashboardTab ? <BoardInsightsModal initialTab={dashboardTab} onClose={() => setDashboardTab(null)} /> : null}
    </div>
  );
}

/** Three bouncing dots shown while the board is being analyzed. */
function AnalyzingDots({ small }: { small?: boolean }) {
  const size = small ? "h-1 w-1" : "h-1.5 w-1.5";
  return (
    <span className="inline-flex items-center gap-0.5" aria-label="Analyzing">
      {[0, 150, 300].map((delay) => (
        <span key={delay} className={cn(size, "animate-bounce rounded-full bg-current")} style={{ animationDelay: `${delay}ms` }} />
      ))}
    </span>
  );
}

function AreaRow({
  title,
  status,
  text,
  onClick,
}: {
  title: string;
  status: FocusStatus | undefined;
  text: string | null;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-slate-50">
      <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", status ? DOT[status] : "animate-pulse bg-blue-300")} />
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold text-slate-800">{title}</span>
        {text ? (
          <span className="block text-[11px] leading-snug text-slate-500">{text}</span>
        ) : (
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-blue-600">
            Analyzing <AnalyzingDots small />
          </span>
        )}
      </span>
      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-300" />
    </button>
  );
}

type CreatedDay = BoardInsights["popup"]["createdPerDay"][number];
type CreatedChange = BoardInsights["popup"]["createdChange"];

/** "Week +12% ↑" chip: jobs created vs the period before. */
function ChangeChip({ label, cur, prev }: { label: string; cur: number; prev: number }) {
  const pct = prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null;
  const up = pct != null && pct > 0;
  const down = pct != null && pct < 0;
  return (
    <div
      className="flex-1 rounded-lg bg-slate-50 px-2 py-1"
      title={`${label}: ${cur} created (previous: ${prev})`}
    >
      <p className="text-[10px] font-medium text-slate-500">{label}</p>
      <p className="flex items-baseline gap-1">
        <span className="text-sm font-bold tabular-nums text-slate-800">{cur}</span>
        <span
          className={cn(
            "inline-flex items-center text-[10px] font-bold",
            up ? "text-emerald-600" : down ? "text-red-600" : "text-slate-400"
          )}
        >
          {up ? <ArrowUpRight className="h-3 w-3" /> : down ? <ArrowDownRight className="h-3 w-3" /> : null}
          {pct == null ? "—" : `${pct > 0 ? "+" : ""}${pct}%`}
        </span>
      </p>
    </div>
  );
}

/** Jobs created per day (last 14 days). Hover a bar: count, qty and where the jobs are now. */
function CreatedChart({ data, change }: { data: CreatedDay[]; change: CreatedChange }) {
  const [hover, setHover] = useState<number | null>(null);
  const [info, setInfo] = useState(false);
  const max = Math.max(1, ...data.map((d) => d.count));
  const total = data.reduce((n, d) => n + d.count, 0);
  const h = hover != null ? data[hover] : null;
  return (
    <div>
      <div className="relative mb-1 flex items-center justify-between">
        <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Jobs created per day
          <button
            type="button"
            onMouseEnter={() => setInfo(true)}
            onMouseLeave={() => setInfo(false)}
            onClick={() => setInfo((v) => !v)}
            className="text-slate-400 hover:text-blue-600"
            aria-label="About this chart"
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </p>
        <p className="text-[11px] text-slate-400">{total} in 14 days</p>
        {info ? (
          <div className="absolute left-0 top-5 z-10 w-64 rounded-lg border border-slate-200 bg-white p-2.5 text-[11px] normal-case leading-snug text-slate-600 shadow-lg">
            New jobs added to the board each day (shop time). Hover a bar to see how many came in, their total quantity, and which
            column those jobs are in now. Day = today so far vs yesterday by the same time; Week and Month = last 7 / 30 days vs the 7 / 30 days before.
          </div>
        ) : null}
      </div>

      <div className="mb-1.5 flex gap-1.5">
        <ChangeChip label="Day" cur={change.day.cur} prev={change.day.prev} />
        <ChangeChip label="Week" cur={change.week.cur} prev={change.week.prev} />
        <ChangeChip label="Month" cur={change.month.cur} prev={change.month.prev} />
      </div>

      <div className="relative rounded-xl border border-slate-200 px-2 pb-1 pt-2" onMouseLeave={() => setHover(null)}>
        <div className="flex h-16 items-end gap-1">
          {data.map((d, i) => (
            <div
              key={d.date}
              className="flex h-full flex-1 cursor-default flex-col items-center justify-end"
              onMouseEnter={() => setHover(i)}
            >
              <div
                className={cn(
                  "w-full rounded-sm transition-colors",
                  hover === i ? "bg-blue-700" : i === data.length - 1 ? "bg-blue-600" : "bg-blue-300"
                )}
                style={{ height: `${Math.max(d.count ? 3 : 1, (d.count / max) * 56)}px` }}
              />
            </div>
          ))}
        </div>
        <div className="mt-1 flex gap-1">
          {data.map((d, i) => (
            <span
              key={d.date}
              className={cn("flex-1 text-center text-[8px] tabular-nums", hover === i ? "font-bold text-blue-700" : "text-slate-400")}
            >
              {i === data.length - 1 ? "Today" : d.label.split("/")[1]}
            </span>
          ))}
        </div>

        {h ? (
          <div
            className="pointer-events-none absolute bottom-full z-10 mb-1 w-48 rounded-lg border border-slate-200 bg-white p-2 text-[11px] shadow-lg"
            style={{ left: `clamp(0px, calc(${((hover! + 0.5) / data.length) * 100}% - 6rem), calc(100% - 12rem))` }}
          >
            <p className="font-semibold text-slate-800">{hover === data.length - 1 ? `Today (${h.label})` : h.label}</p>
            <p className="text-slate-600">
              <b>{h.count}</b> job{h.count === 1 ? "" : "s"} created · Qty <b>{h.qty.toLocaleString("en-US")}</b>
            </p>
            {h.where.length ? (
              <div className="mt-1 border-t border-slate-100 pt-1">
                <p className="text-[10px] font-semibold uppercase text-slate-400">Where they are now</p>
                {h.where.slice(0, 6).map((w) => (
                  <p key={w.name} className="flex justify-between gap-2 text-slate-600">
                    <span className="truncate">{w.name}</span>
                    <b className="tabular-nums">{w.count}</b>
                  </p>
                ))}
                {h.where.length > 6 ? <p className="text-[10px] text-slate-400">+{h.where.length - 6} more columns</p> : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
