"use client";

/**
 * TopbarTimerBadges
 * Shows live running-timer pills in the topbar for Designer and Pre-Press timers.
 * Each pill displays:  ● Design  02:15:33   or   ● Pre-Press  00:45:10
 * Clicking navigates to /time?tab=active.
 * Hidden when no timer is running.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  durationSeconds,
  TIME_ENTRIES_CHANGED_EVENT,
  type TimeEntry,
} from "@/lib/time-tracking";

function fmtElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function elapsed(entry: TimeEntry, nowMs: number): number {
  return durationSeconds(entry.started_at, null, nowMs, {
    pausedAt: entry.paused_at ?? null,
    pausedSeconds: entry.paused_seconds ?? 0,
  });
}

export function TopbarTimerBadges() {
  const router = useRouter();
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refetch = async () => {
    try {
      const res = await fetch("/api/time-entries?running=true", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { entries?: TimeEntry[] };
        setEntries(data.entries ?? []);
      }
    } catch {
      /* keep previous on transient network error */
    }
  };

  // Initial load + polling every 15 s
  useEffect(() => {
    void refetch();
    const pollId = setInterval(() => void refetch(), 15_000);
    return () => clearInterval(pollId);
  }, []);

  // Instant refresh when any timer changes in this tab
  useEffect(() => {
    function onChanged() { void refetch(); }
    window.addEventListener(TIME_ENTRIES_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(TIME_ENTRIES_CHANGED_EVENT, onChanged);
  }, []);

  // Tick every second only while something is actively running (not paused)
  const anyRunning = entries.some((e) => !e.ended_at && !e.paused_at);
  useEffect(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    if (!anyRunning) return;
    tickRef.current = setInterval(() => setNowMs(Date.now()), 1000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [anyRunning]);

  // Pick the first non-ended entry per timer kind (running wins over paused)
  const designer = entries
    .filter((e) => e.timer_kind === "designer" && !e.ended_at)
    .sort((a, b) => (a.paused_at ? 1 : 0) - (b.paused_at ? 1 : 0))[0] ?? null;

  const prepress = entries
    .filter((e) => e.timer_kind === "prepress" && !e.ended_at)
    .sort((a, b) => (a.paused_at ? 1 : 0) - (b.paused_at ? 1 : 0))[0] ?? null;

  if (!designer && !prepress) return null;

  const label = (e: TimeEntry) =>
    e.job_title ?? e.order_title ?? e.custom_task_name ?? "No job";

  return (
    <div className="flex items-center gap-1.5">
      {designer && (
        <button
          type="button"
          onClick={() => router.push("/time?tab=active")}
          title={`Designer timer · ${label(designer)}`}
          className={cn(
            "flex items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[11px] font-semibold tabular-nums transition-colors",
            designer.paused_at
              ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
              : "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
          )}
        >
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              designer.paused_at
                ? "bg-amber-400"
                : "animate-pulse bg-blue-500"
            )}
          />
          <span className="hidden sm:inline">Design&nbsp;</span>
          {fmtElapsed(elapsed(designer, nowMs))}
        </button>
      )}

      {prepress && (
        <button
          type="button"
          onClick={() => router.push("/time?tab=active")}
          title={`Pre-Press timer · ${label(prepress)}`}
          className={cn(
            "flex items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[11px] font-semibold tabular-nums transition-colors",
            prepress.paused_at
              ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
              : "border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100"
          )}
        >
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              prepress.paused_at
                ? "bg-amber-400"
                : "animate-pulse bg-purple-500"
            )}
          />
          <span className="hidden sm:inline">Pre-Press&nbsp;</span>
          {fmtElapsed(elapsed(prepress, nowMs))}
        </button>
      )}
    </div>
  );
}
