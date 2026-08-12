"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HeartPulse } from "lucide-react";
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
};

export function BoardHealthButton() {
  const [open, setOpen] = useState(false);
  const [health, setHealth] = useState<BoardHealthResult | null>(null);
  const [loading, setLoading] = useState(true);
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

  useEffect(() => {
    void load();
    function onFocus() {
      void load();
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  useEffect(() => {
    if (!open) return;
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
  }, [open, load]);

  const result = health ?? EMPTY;
  const level = result.level as BoardHealthLevel;
  const meta = BOARD_HEALTH_META[level];
  const c = result.counts;

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
        <div className="absolute left-0 z-30 mt-1 w-64 rounded-xl border border-slate-200 bg-white p-3.5 shadow-lg">
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
            <HealthRow label="Late" count={c.late} tone="late" />
            <HealthRow label="Due today" count={c.dueToday} tone="today" />
            <HealthRow label="Warnings" count={c.warnings} tone="warn" />
            <HealthRow label="Stuck" count={c.stuck} tone="stuck" />
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            Open jobs through Ready to Ship: {c.open}
          </p>
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
