"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActiveTimerCard } from "@/components/time/ActiveTimerCard";
import { NewTimerModal } from "@/components/time/NewTimerModal";
import { TimeLog } from "@/components/time/TimeLog";
import { TimeReports } from "@/components/time/TimeReports";
import { type TimeEntry, notifyTimeEntriesChanged } from "@/lib/time-tracking";
import { cn } from "@/lib/utils";

type Tab = "active" | "log" | "reports";

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

  const tab: Tab =
    tabParam === "log" || tabParam === "reports" || tabParam === "active"
      ? tabParam
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
      const res = await fetch("/api/time-entries?running=true");
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
  }, []);

  useEffect(() => {
    void refetchRunning();
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
              Track time on board jobs and custom tasks
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
          <div className="space-y-3">
            {loading ? (
              <p className="text-sm text-slate-400">Loading…</p>
            ) : running.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 px-6 py-12 text-center">
                <p className="text-sm text-slate-500">No timers running</p>
                <Button
                  type="button"
                  className="mt-4"
                  onClick={() => setModalOpen(true)}
                >
                  <Plus className="h-4 w-4" />
                  Start Timer
                </Button>
              </div>
            ) : (
              running.map((entry) => (
                <ActiveTimerCard
                  key={entry.id}
                  entry={entry}
                  nowMs={nowMs}
                  highlighted={entryParam === entry.id}
                  notesEditable
                  notesDraft={notesDrafts[entry.id] ?? entry.notes ?? ""}
                  onNotesChange={(v) =>
                    setNotesDrafts((prev) => ({ ...prev, [entry.id]: v }))
                  }
                  onNotesBlur={() => void saveNotes(entry.id)}
                  stopping={stoppingId === entry.id}
                  pausing={pausingId === entry.id}
                  onStop={(id) => void stopTimer(id)}
                  onPause={(id) => void pauseTimer(id)}
                  onResume={(id) => void resumeTimer(id)}
                />
              ))
            )}
          </div>
        ) : null}

        {tab === "log" ? (
          <TimeLog
            highlightedEntryId={entryParam}
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
