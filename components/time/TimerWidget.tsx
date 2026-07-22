"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  type TimeEntry,
  TIME_ENTRIES_CHANGED_EVENT,
  notifyTimeEntriesChanged,
} from "@/lib/time-tracking";
import { ActiveTimerCard } from "@/components/time/ActiveTimerCard";
import { NewTimerModal } from "@/components/time/NewTimerModal";
import { cn } from "@/lib/utils";

export function TimerWidget() {
  const router = useRouter();
  const [running, setRunning] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [pausingId, setPausingId] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch("/api/time-entries?running=true");
      const data = (await res.json()) as {
        entries?: TimeEntry[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Failed to load timers");
      setRunning(data.entries ?? []);
    } catch {
      // Keep previous state on transient errors
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEffect(() => {
    function onChanged() {
      void refetch();
    }
    window.addEventListener(TIME_ENTRIES_CHANGED_EVENT, onChanged);
    return () =>
      window.removeEventListener(TIME_ENTRIES_CHANGED_EVENT, onChanged);
  }, [refetch]);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled || !user) return;

      channel = supabase
        .channel(`time_entries_live_${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "time_entries",
            filter: `user_id=eq.${user.id}`,
          },
          () => {
            void refetch();
          }
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [refetch]);

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
      notifyTimeEntriesChanged();
      await refetch();
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
      notifyTimeEntriesChanged();
      await refetch();
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
      notifyTimeEntriesChanged();
      await refetch();
    } finally {
      setPausingId(null);
    }
  }

  if (loading && running.length === 0) {
    return (
      <div className="border-t border-slate-200 px-3 py-2">
        <div className="h-8 animate-pulse rounded-md bg-slate-100" />
      </div>
    );
  }

  return (
    <>
      <div className="border-t border-slate-200 p-2">
        {running.length === 0 ? (
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-slate-600 hover:bg-slate-50"
          >
            <Clock className="h-4 w-4 shrink-0 text-slate-400" />
            <span className="flex-1 font-medium">Start Timer</span>
            <Plus className="h-4 w-4 text-slate-400" />
          </button>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <span className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                <Clock className="h-3.5 w-3.5 text-slate-400" />
                {running.length} running
              </span>
              <button
                type="button"
                onClick={() => setModalOpen(true)}
                className={cn(
                  "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium",
                  "text-[var(--primary)] hover:bg-blue-50"
                )}
              >
                <Plus className="h-3 w-3" />
                New
              </button>
            </div>
            <div className="max-h-48 space-y-1.5 overflow-y-auto">
              {running.map((entry) => (
                <ActiveTimerCard
                  key={entry.id}
                  entry={entry}
                  nowMs={nowMs}
                  compact
                  stopping={stoppingId === entry.id}
                  pausing={pausingId === entry.id}
                  onStop={(id) => void stopTimer(id)}
                  onPause={(id) => void pauseTimer(id)}
                  onResume={(id) => void resumeTimer(id)}
                  onClick={(id) =>
                    router.push(`/time?tab=active&entry=${id}`)
                  }
                />
              ))}
            </div>
          </div>
        )}
      </div>
      <NewTimerModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onStarted={() => void refetch()}
      />
    </>
  );
}
