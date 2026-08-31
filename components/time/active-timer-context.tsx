"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type TimeEntry,
  durationSeconds,
  isTimerPaused,
  TIME_ENTRIES_CHANGED_EVENT,
  notifyTimeEntriesChanged,
} from "@/lib/time-tracking";

export interface OrderTimerState {
  entry: TimeEntry;
  running: boolean;
  paused: boolean;
  elapsedSeconds: number;
}

interface ActiveTimerContextValue {
  /** Live timer state for an order, or null when this user has none on it. */
  forOrder: (orderId: string) => OrderTimerState | null;
  /** Cumulative worked seconds this user has logged on an order (0 when none). */
  workedTotalForOrder: (orderId: string) => number;
  /** Start (or resume) the timer on an order; auto-pauses any other running one. */
  start: (orderId: string) => Promise<void>;
  pause: (entryId: string, reason?: string) => Promise<void>;
  resume: (entryId: string) => Promise<void>;
  stop: (entryId: string) => Promise<void>;
  busyOrderId: string | null;
}

const Ctx = createContext<ActiveTimerContextValue | null>(null);

export function ActiveTimerProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const entriesRef = useRef<TimeEntry[]>([]);
  entriesRef.current = entries;

  const refetch = useCallback(async () => {
    try {
      const res = await fetch("/api/time-entries?running=true");
      const data = (await res.json()) as { entries?: TimeEntry[] };
      if (res.ok) setEntries(data.entries ?? []);
    } catch {
      /* keep previous on transient error */
    }
  }, []);

  const refetchTotals = useCallback(async () => {
    try {
      const res = await fetch("/api/time-entries/totals");
      const data = (await res.json()) as { totals?: Record<string, number> };
      if (res.ok) setTotals(data.totals ?? {});
    } catch {
      /* keep previous on transient error */
    }
  }, []);

  useEffect(() => {
    void refetch();
    void refetchTotals();
  }, [refetch, refetchTotals]);

  useEffect(() => {
    function onChanged() {
      void refetch();
      void refetchTotals();
    }
    window.addEventListener(TIME_ENTRIES_CHANGED_EVENT, onChanged);
    return () =>
      window.removeEventListener(TIME_ENTRIES_CHANGED_EVENT, onChanged);
  }, [refetch, refetchTotals]);

  // Tick only while something is actively running (not paused) — cheap otherwise.
  const anyRunning = entries.some((e) => !e.ended_at && !e.paused_at);
  useEffect(() => {
    if (!anyRunning) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [anyRunning]);

  const byOrder = useMemo(() => {
    const map = new Map<string, TimeEntry>();
    for (const e of entries) {
      if (e.order_id && !e.ended_at) map.set(e.order_id, e);
    }
    return map;
  }, [entries]);

  const forOrder = useCallback(
    (orderId: string): OrderTimerState | null => {
      const entry = byOrder.get(orderId);
      if (!entry) return null;
      const paused = isTimerPaused(entry);
      return {
        entry,
        running: !paused,
        paused,
        elapsedSeconds: durationSeconds(entry.started_at, null, nowMs, {
          pausedAt: entry.paused_at ?? null,
          pausedSeconds: entry.paused_seconds ?? 0,
        }),
      };
    },
    [byOrder, nowMs]
  );

  const workedTotalForOrder = useCallback(
    (orderId: string): number => Math.max(0, Math.floor(totals[orderId] ?? 0)),
    [totals]
  );

  const patch = useCallback(
    async (entryId: string, body: Record<string, unknown>) => {
      const res = await fetch(`/api/time-entries/${entryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? "Timer update failed");
      }
    },
    []
  );

  const start = useCallback(
    async (orderId: string) => {
      setBusyOrderId(orderId);
      try {
        // One active card at a time: pause any other running timer first.
        for (const e of entriesRef.current) {
          if (e.order_id !== orderId && !e.ended_at && !e.paused_at) {
            await patch(e.id, { action: "pause" });
          }
        }
        const existing = entriesRef.current.find(
          (e) => e.order_id === orderId && !e.ended_at
        );
        if (existing) {
          if (isTimerPaused(existing)) await patch(existing.id, { action: "resume" });
        } else {
          const res = await fetch("/api/time-entries", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              order_id: orderId,
              activity_type: "Design",
              started_at: new Date().toISOString(),
            }),
          });
          if (!res.ok) {
            const d = (await res.json().catch(() => ({}))) as { error?: string };
            throw new Error(d.error ?? "Failed to start timer");
          }
        }
        notifyTimeEntriesChanged();
        await refetch();
      } finally {
        setBusyOrderId(null);
      }
    },
    [patch, refetch]
  );

  const pause = useCallback(
    async (entryId: string, reason?: string) => {
      await patch(entryId, { action: "pause", ...(reason ? { pause_reason: reason } : {}) });
      notifyTimeEntriesChanged();
      await refetch();
    },
    [patch, refetch]
  );

  const resume = useCallback(
    async (entryId: string) => {
      // Keep one active card: pause others, then resume this one.
      for (const e of entriesRef.current) {
        if (e.id !== entryId && !e.ended_at && !e.paused_at) {
          await patch(e.id, { action: "pause" });
        }
      }
      await patch(entryId, { action: "resume" });
      notifyTimeEntriesChanged();
      await refetch();
    },
    [patch, refetch]
  );

  const stop = useCallback(
    async (entryId: string) => {
      await patch(entryId, { ended_at: new Date().toISOString() });
      notifyTimeEntriesChanged();
      await refetch();
    },
    [patch, refetch]
  );

  const value = useMemo(
    () => ({ forOrder, workedTotalForOrder, start, pause, resume, stop, busyOrderId }),
    [forOrder, workedTotalForOrder, start, pause, resume, stop, busyOrderId]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useActiveTimer(): ActiveTimerContextValue {
  const ctx = useContext(Ctx);
  if (ctx) return ctx;
  // Safe no-op fallback when used outside the provider (e.g. isolated tests).
  return {
    forOrder: () => null,
    workedTotalForOrder: () => 0,
    start: async () => {},
    pause: async () => {},
    resume: async () => {},
    stop: async () => {},
    busyOrderId: null,
  };
}
