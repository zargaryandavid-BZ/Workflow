"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HeartPulse, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  BOARD_HEALTH_META,
  type BoardHealthLevel,
  type BoardHealthResult,
} from "@/lib/board-health";

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
};

interface BoardHealthButtonProps {
  /** From tenant settings; when false, do not render. */
  enabled?: boolean;
}

type AnalyzeResponse = {
  commentary?: string;
  source?: "openai" | "fallback";
  error?: string;
};

export function BoardHealthButton({ enabled = true }: BoardHealthButtonProps) {
  const [open, setOpen] = useState(false);
  const [health, setHealth] = useState<BoardHealthResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [commentary, setCommentary] = useState<string | null>(null);
  const [analyzeSource, setAnalyzeSource] = useState<
    "openai" | "fallback" | null
  >(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/board/health", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as BoardHealthResult;
      if (typeof data.level === "number") setHealth(data);
    } catch {
      // Non-fatal — icon still renders.
    } finally {
      setLoading(false);
    }
  }, []);

  const runAnalyze = useCallback(async () => {
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const res = await fetch("/api/board/health/analyze", {
        method: "POST",
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as AnalyzeResponse;
      if (!res.ok) {
        setAnalyzeError(data.error ?? "Analysis failed");
        return;
      }
      if (data.commentary) {
        setCommentary(data.commentary);
        setAnalyzeSource(data.source ?? null);
      } else {
        setAnalyzeError("No commentary returned");
      }
    } catch {
      setAnalyzeError("Analysis failed");
    } finally {
      setAnalyzing(false);
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
  }, [open, load, enabled]);

  if (!enabled) return null;
  if (health && health.visible === false) return null;

  const result = health ?? EMPTY;
  const level = result.level as BoardHealthLevel;
  const meta = BOARD_HEALTH_META[level];
  const c = result.counts;
  const show = result.show ?? EMPTY.show;
  const throughLabel = result.throughLabel ?? EMPTY.throughLabel;

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
        <div className="absolute left-0 z-30 mt-1 w-[22rem] max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-3.5 shadow-lg">
          <div className="mb-1 flex items-center gap-2">
            <HeartPulse
              className={cn("h-4 w-4 shrink-0", meta.iconClass)}
              strokeWidth={2.25}
            />
            <p className="text-sm font-semibold text-slate-800">
              Board health:{" "}
              <span style={{ color: meta.color }}>
                {level} — {meta.label}
              </span>
            </p>
          </div>
          <p className="mb-3 text-sm text-slate-600">{result.summary}</p>
          <div className="divide-y divide-slate-100 border-t border-slate-100 text-sm">
            {show.late ? (
              <HealthRow label="Late" count={c.late} tone="late" />
            ) : null}
            {show.dueToday ? (
              <HealthRow label="Due today" count={c.dueToday} tone="today" />
            ) : null}
            {show.warnings ? (
              <HealthRow label="Warnings" count={c.warnings} tone="warn" />
            ) : null}
            {show.stuck ? (
              <HealthRow label="Stuck" count={c.stuck} tone="stuck" />
            ) : null}
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            Open jobs through {throughLabel}: {c.open}
          </p>

          <div className="mt-3 border-t border-slate-100 pt-3">
            <button
              type="button"
              disabled={analyzing}
              onClick={() => void runAnalyze()}
              className={cn(
                "inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border text-xs font-medium transition-colors",
                analyzing
                  ? "cursor-wait border-slate-200 bg-slate-50 text-slate-400"
                  : "border-slate-300 text-slate-700 hover:bg-slate-50"
              )}
            >
              <Sparkles className="h-3.5 w-3.5" />
              {analyzing
                ? "Analyzing…"
                : commentary
                  ? "Refresh AI analysis"
                  : "Analyze situation"}
            </button>

            {analyzeError ? (
              <p className="mt-2 text-xs text-red-600">{analyzeError}</p>
            ) : null}

            {commentary ? (
              <div className="mt-2 max-h-64 overflow-y-auto rounded-lg bg-slate-50 px-2.5 py-2 text-xs leading-relaxed text-slate-700 whitespace-pre-wrap">
                {commentary}
                {analyzeSource === "fallback" ? (
                  <p className="mt-2 text-[10px] text-slate-400">
                    Stats-only briefing (AI unavailable).
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="mt-2 text-[11px] text-slate-400">
                AI reviews stuck dwell time, start→finish turnaround, column
                bottlenecks, and designer latency.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function HealthRow({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: "late" | "today" | "warn" | "stuck";
}) {
  const countClass =
    tone === "late"
      ? "font-semibold text-red-600"
      : tone === "today"
        ? "font-semibold text-orange-600"
        : tone === "warn"
          ? "font-semibold text-amber-600"
          : "font-semibold text-slate-800";
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-slate-600">{label}</span>
      <span className={countClass}>{count}</span>
    </div>
  );
}
