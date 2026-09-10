"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActiveTimerCard } from "@/components/time/ActiveTimerCard";
import { NewTimerModal } from "@/components/time/NewTimerModal";
import { TimeLog } from "@/components/time/TimeLog";
import { TimeReports } from "@/components/time/TimeReports";
import {
  type TimeEntry,
  TIME_ENTRIES_CHANGED_EVENT,
  notifyTimeEntriesChanged,
  durationSeconds,
  formatDuration,
  isTimerPaused,
} from "@/lib/time-tracking";
import { cn } from "@/lib/utils";

type Tab = "active" | "log" | "reports";

// ─── Active timers tab ────────────────────────────────────────────────────────

function ActiveTimersTab({
  loading,
  running,
  nowMs,
  entryParam,
  notesDrafts,
  stoppingId,
  pausingId,
  isAdmin,
  onNotesChange,
  onNotesBlur,
  onStop,
  onPause,
  onResume,
  onStart,
}: {
  loading: boolean;
  running: TimeEntry[];
  nowMs: number;
  entryParam: string | null;
  notesDrafts: Record<string, string>;
  stoppingId: string | null;
  pausingId: string | null;
  isAdmin: boolean;
  onNotesChange: (id: string, v: string) => void;
  onNotesBlur: (id: string) => void;
  onStop: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onStart: () => void;
}) {
  if (loading) return <p className="text-sm text-slate-400">Loading…</p>;

  if (running.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 px-6 py-12 text-center">
        <p className="text-sm text-slate-500">No timers running</p>
        <p className="mt-1 text-xs text-slate-400">
          Press Start on a board card, or start a timer here.
        </p>
        <Button type="button" className="mt-4" onClick={onStart}>
          <Plus className="h-4 w-4" />
          Start Timer
        </Button>
      </div>
    );
  }

  const runningCount = running.filter((e) => !isTimerPaused(e)).length;
  const pausedCount = running.filter((e) => isTimerPaused(e)).length;
  const totalElapsed = running.reduce(
    (sum, e) =>
      sum +
      durationSeconds(e.started_at, null, nowMs, {
        pausedAt: e.paused_at ?? null,
        pausedSeconds: e.paused_seconds ?? 0,
      }),
    0
  );

  // Group by designer for admin view
  const groups: { name: string; entries: TimeEntry[] }[] = [];
  if (isAdmin) {
    const byDesigner = new Map<string, { name: string; entries: TimeEntry[] }>();
    for (const e of running) {
      const key = e.user_id ?? "unknown";
      const name = e.user_display_name ?? "Unknown";
      if (!byDesigner.has(key)) byDesigner.set(key, { name, entries: [] });
      byDesigner.get(key)!.entries.push(e);
    }
    groups.push(...byDesigner.values());
    groups.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    groups.push({ name: "", entries: running });
  }

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm">
        <span>
          <span className="font-semibold text-emerald-600">{runningCount}</span>
          <span className="ml-1 text-slate-500">running</span>
        </span>
        {pausedCount > 0 && (
          <span>
            <span className="font-semibold text-amber-500">{pausedCount}</span>
            <span className="ml-1 text-slate-500">paused</span>
          </span>
        )}
        <span className="ml-auto tabular-nums text-slate-700">
          <span className="font-semibold">{formatDuration(totalElapsed)}</span>
          <span className="ml-1 text-slate-400">total tracked</span>
        </span>
      </div>

      {/* Timer cards grouped by designer */}
      {groups.map((group) => {
        const groupElapsed = group.entries.reduce(
          (sum, e) =>
            sum +
            durationSeconds(e.started_at, null, nowMs, {
              pausedAt: e.paused_at ?? null,
              pausedSeconds: e.paused_seconds ?? 0,
            }),
          0
        );
        return (
          <div key={group.name || "self"}>
            {isAdmin && (
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {group.name}
                </span>
                <span className="text-xs tabular-nums text-slate-400">
                  {formatDuration(groupElapsed)}
                </span>
              </div>
            )}
            <div className="space-y-1.5">
              {group.entries.map((entry) => (
                <ActiveTimerCard
                  key={entry.id}
                  entry={entry}
                  nowMs={nowMs}
                  highlighted={entryParam === entry.id}
                  notesEditable
                  notesDraft={notesDrafts[entry.id] ?? entry.notes ?? ""}
                  onNotesChange={(v) => onNotesChange(entry.id, v)}
                  onNotesBlur={() => onNotesBlur(entry.id)}
                  stopping={stoppingId === entry.id}
                  pausing={pausingId === entry.id}
                  onStop={onStop}
                  onPause={onPause}
                  onResume={onResume}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const TABS: { id: Tab; label: string }[] = [
  { id: "active", label: "Active Timers" },
  { id: "log", label: "Log" },
  { id: "reports", label: "Reports" },
];

interface DesignerOption {
  id: string;
  name: string;
}

interface TimePageClientProps {
  isAdmin: boolean;
  designers: DesignerOption[];
}

export function TimePageClient({ isAdmin, designers }: TimePageClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const entryParam = searchParams.get("entry");
  const orderParam = searchParams.get("order");

  const tab: Tab =
    tabParam === "log" || tabParam === "reports" || tabParam === "active"
      ? tabParam
      : orderParam
        ? "log"
        : "active";

  const [running, setRunning] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [modalOpen, setModalOpen] = useState(false);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [pausingId, setPausingId] = useState<string | null>(null);
  const [notesDrafts, setNotesDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const refetchRunning = useCallback(async () => {
    try {
      const qs = isAdmin
        ? "/api/time-entries?running=true&all=true"
        : "/api/time-entries?running=true";
      const res = await fetch(qs);
      const data = (await res.json()) as {
        entries?: TimeEntry[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Failed to load timers");
      setRunning(data.entries ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load timers");
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    void refetchRunning();
  }, [refetchRunning]);

  useEffect(() => {
    function onChanged() {
      void refetchRunning();
    }
    window.addEventListener(TIME_ENTRIES_CHANGED_EVENT, onChanged);
    return () =>
      window.removeEventListener(TIME_ENTRIES_CHANGED_EVENT, onChanged);
  }, [refetchRunning]);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  function setTab(next: Tab) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", next);
    if (next !== "active") params.delete("entry");
    router.replace(`/time?${params.toString()}`);
  }

  async function stopTimer(id: string) {
    setStoppingId(id);
    try {
      const res = await fetch(`/api/time-entries/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ended_at: new Date().toISOString() }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to stop");
      }
      await refetchRunning();
      notifyTimeEntriesChanged();
    } finally {
      setStoppingId(null);
    }
  }

  async function pauseTimer(id: string) {
    setPausingId(id);
    try {
      const res = await fetch(`/api/time-entries/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pause" }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to pause");
      }
      await refetchRunning();
      notifyTimeEntriesChanged();
    } finally {
      setPausingId(null);
    }
  }

  async function resumeTimer(id: string) {
    setPausingId(id);
    try {
      const res = await fetch(`/api/time-entries/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resume" }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to resume");
      }
      await refetchRunning();
      notifyTimeEntriesChanged();
    } finally {
      setPausingId(null);
    }
  }

  async function saveNotes(id: string) {
    const notes = notesDrafts[id];
    if (notes === undefined) return;
    try {
      await fetch(`/api/time-entries/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      await refetchRunning();
    } catch {
      // ignore
    }
  }

  return (
    <div className="board-scroll h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Time (beta)</h1>
            <p className="mt-1 text-sm text-slate-500">
              Same clock as the Start button on board cards. Start or pause there
              and it shows up here.
            </p>
          </div>
          <Button type="button" onClick={() => setModalOpen(true)}>
            <Plus className="h-4 w-4" />
            Start Timer
          </Button>
        </div>

        <div className="mb-6 flex gap-1 border-b border-slate-200">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                tab === t.id
                  ? "border-[var(--primary)] text-[var(--primary)]"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {error ? (
          <p className="mb-4 text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}

        {tab === "active" ? (
          <ActiveTimersTab
            loading={loading}
            running={running}
            nowMs={nowMs}
            entryParam={entryParam}
            notesDrafts={notesDrafts}
            stoppingId={stoppingId}
            pausingId={pausingId}
            isAdmin={isAdmin}
            onNotesChange={(id, v) => setNotesDrafts((prev) => ({ ...prev, [id]: v }))}
            onNotesBlur={(id) => void saveNotes(id)}
            onStop={(id) => void stopTimer(id)}
            onPause={(id) => void pauseTimer(id)}
            onResume={(id) => void resumeTimer(id)}
            onStart={() => setModalOpen(true)}
          />
        ) : null}

        {tab === "log" ? (
          <TimeLog
            highlightedEntryId={entryParam}
            orderId={orderParam}
            isAdmin={isAdmin}
            designers={designers}
            onChanged={() => void refetchRunning()}
          />
        ) : null}

        {tab === "reports" ? (
          <TimeReports isAdmin={isAdmin} designers={designers} />
        ) : null}
      </div>

      <NewTimerModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onStarted={() => void refetchRunning()}
      />
    </div>
  );
}
