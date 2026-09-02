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
import { createClient } from "@/lib/supabase/client";
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

/** One running timer somewhere on the board (possibly another user's). */
interface BoardEntry {
  id: string;
  user_id: string;
  worker_name: string;
  order_id: string | null;
  started_at: string;
  ended_at: string | null;
  paused_at: string | null;
  paused_seconds: number;
  running: boolean;
  elapsed_seconds: number;
}

/** Who is actively working a card + for how long — shown on every card. */
export interface BoardTimerState {
  entryId: string;
  userId: string;
  workerName: string;
  running: boolean;
  paused: boolean;
  elapsedSeconds: number;
  /** True when this board timer is the current viewer's own. */
  isMine: boolean;
}

interface ActiveTimerContextValue {
  /** Live timer state for an order, or null when this user has none on it. */
  forOrder: (orderId: string) => OrderTimerState | null;
  /** Cumulative worked seconds this user has logged on an order (0 when none). */
  workedTotalForOrder: (orderId: string) => number;
  /** Cumulative worked seconds by EVERYONE on an order — for the on-card total
   *  badge, so anyone can see how long a job took without opening it. */
  boardWorkedTotalForOrder: (orderId: string) => number;
  /** Who (any user) is actively working an order, for the on-card chip. */
  boardActiveForOrder: (orderId: string) => BoardTimerState | null;
  /** This user's currently RUNNING (not paused) timer, if any — used to prompt
   *  "you're still timing job X" when they open a different card. */
  myActiveRunning: { entryId: string; orderId: string | null; orderTitle: string | null } | null;
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
  const [boardTotals, setBoardTotals] = useState<Record<string, number>>({});
  const [board, setBoard] = useState<BoardEntry[]>([]);
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

  const refetchBoard = useCallback(async () => {
    try {
      const res = await fetch("/api/time-entries/active-board");
      const data = (await res.json()) as { entries?: BoardEntry[] };
      if (res.ok) setBoard(data.entries ?? []);
    } catch {
      /* keep previous on transient error */
    }
  }, []);

  const refetchBoardTotals = useCallback(async () => {
    try {
      const res = await fetch("/api/time-entries/board-totals");
      const data = (await res.json()) as { totals?: Record<string, number> };
      if (res.ok) setBoardTotals(data.totals ?? {});
    } catch {
      /* keep previous on transient error */
    }
  }, []);

  const refreshAll = useCallback(() => {
    void refetch();
    void refetchTotals();
    void refetchBoard();
    void refetchBoardTotals();
  }, [refetch, refetchTotals, refetchBoard, refetchBoardTotals]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    function onChanged() {
      refreshAll();
    }
    window.addEventListener(TIME_ENTRIES_CHANGED_EVENT, onChanged);
    return () =>
      window.removeEventListener(TIME_ENTRIES_CHANGED_EVENT, onChanged);
  }, [refreshAll]);

  // Own running list used to only refresh on this tab's clicks. If the timer
  // is stopped from another tab, the sidebar, or the server, the card kept
  // ticking. Poll + live updates keep admin and designer in sync.
  useEffect(() => {
    const id = window.setInterval(() => {
      refreshAll();
    }, 10000);
    function onVisible() {
      if (document.visibilityState === "visible") refreshAll();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshAll]);

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
        .channel(`board_time_entries_${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "time_entries",
            filter: `user_id=eq.${user.id}`,
          },
          () => {
            refreshAll();
          }
        )
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [refreshAll]);

  // Tick only while something is actively running (not paused) — cheap otherwise.
  const anyRunning =
    entries.some((e) => !e.ended_at && !e.paused_at) ||
    board.some((b) => b.running);
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

  const boardWorkedTotalForOrder = useCallback(
    (orderId: string): number =>
      Math.max(0, Math.floor(boardTotals[orderId] ?? 0)),
    [boardTotals]
  );

  const myEntryIds = useMemo(
    () => new Set(entries.filter((e) => !e.ended_at).map((e) => e.id)),
    [entries]
  );

  const myActiveRunning = useMemo(() => {
    const e = entries.find((x) => !x.ended_at && !x.paused_at);
    if (!e) return null;
    return {
      entryId: e.id,
      orderId: e.order_id ?? null,
      orderTitle: e.order_title ?? null,
    };
  }, [entries]);

  const boardByOrder = useMemo(() => {
    const map = new Map<string, BoardEntry>();
    for (const b of board) {
      if (!b.order_id) continue;
      const cur = map.get(b.order_id);
      // Prefer a running timer over a paused one when a card has more than one.
      if (!cur || (b.running && !cur.running)) map.set(b.order_id, b);
    }
    return map;
  }, [board]);

  const boardActiveForOrder = useCallback(
    (orderId: string): BoardTimerState | null => {
      const b = boardByOrder.get(orderId);
      if (!b) return null;
      const elapsed = b.running
        ? durationSeconds(b.started_at, null, nowMs, {
            pausedAt: b.paused_at ?? null,
            pausedSeconds: b.paused_seconds ?? 0,
          })
        : b.elapsed_seconds;
      return {
        entryId: b.id,
        userId: b.user_id,
        workerName: b.worker_name,
        running: b.running,
        paused: !b.running,
        elapsedSeconds: elapsed,
        isMine: myEntryIds.has(b.id),
      };
    },
    [boardByOrder, nowMs, myEntryIds]
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
    () => ({ forOrder, workedTotalForOrder, boardWorkedTotalForOrder, boardActiveForOrder, myActiveRunning, start, pause, resume, stop, busyOrderId }),
    [forOrder, workedTotalForOrder, boardWorkedTotalForOrder, boardActiveForOrder, myActiveRunning, start, pause, resume, stop, busyOrderId]
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
    boardWorkedTotalForOrder: () => 0,
    boardActiveForOrder: () => null,
    myActiveRunning: null,
    start: async () => {},
    pause: async () => {},
    resume: async () => {},
    stop: async () => {},
    busyOrderId: null,
  };
}
