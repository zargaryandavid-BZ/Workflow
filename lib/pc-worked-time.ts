/** Timer open window: pause clips the end; `now` is used while still running. */
export function entryWallRangeMs(
  startedAt: string,
  endedAt: string | null,
  nowMs: number = Date.now(),
  opts?: { pausedAt?: string | null }
): { startMs: number; endMs: number } | null {
  const startMs = new Date(startedAt).getTime();
  if (Number.isNaN(startMs)) return null;
  let endMs: number;
  if (endedAt) {
    endMs = new Date(endedAt).getTime();
  } else if (opts?.pausedAt) {
    endMs = new Date(opts.pausedAt).getTime();
  } else {
    endMs = nowMs;
  }
  if (Number.isNaN(endMs) || endMs <= startMs) return null;
  return { startMs, endMs };
}

/**
 * Worked time on the clock: same length as logged duration (wall minus pauses),
 * placed at the end of the timer so leftover overnight open time is not counted.
 */
export function entryActiveWorkRangeMs(
  startedAt: string,
  endedAt: string | null,
  nowMs: number = Date.now(),
  opts?: { pausedAt?: string | null; pausedSeconds?: number }
): { startMs: number; endMs: number } | null {
  const wall = entryWallRangeMs(startedAt, endedAt, nowMs, opts);
  if (!wall) return null;
  const pausedSec = Math.max(0, Math.floor(opts?.pausedSeconds ?? 0));
  const wallSec = Math.floor((wall.endMs - wall.startMs) / 1000);
  const durSec = Math.max(0, wallSec - pausedSec);
  if (durSec <= 0) return null;
  const endMs = wall.endMs;
  const startMs = Math.max(wall.startMs, endMs - durSec * 1000);
  if (endMs <= startMs) return null;
  return { startMs, endMs };
}

export function unionIntervalSeconds(
  ranges: { startMs: number; endMs: number }[]
): number {
  const sorted = ranges
    .filter((r) => r.endMs > r.startMs)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  if (sorted.length === 0) return 0;
  let total = 0;
  let curStart = sorted[0].startMs;
  let curEnd = sorted[0].endMs;
  for (let i = 1; i < sorted.length; i++) {
    const r = sorted[i];
    if (r.startMs <= curEnd) {
      curEnd = Math.max(curEnd, r.endMs);
    } else {
      total += Math.floor((curEnd - curStart) / 1000);
      curStart = r.startMs;
      curEnd = r.endMs;
    }
  }
  total += Math.floor((curEnd - curStart) / 1000);
  return Math.max(0, total);
}

function localDateFromMs(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function nextLocalMidnightMs(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
}

export function splitRangeByLocalDays(
  startMs: number,
  endMs: number
): { date: string; startMs: number; endMs: number }[] {
  const out: { date: string; startMs: number; endMs: number }[] = [];
  let cur = startMs;
  while (cur < endMs) {
    const date = localDateFromMs(cur);
    const split = Math.min(endMs, nextLocalMidnightMs(cur));
    if (split > cur) out.push({ date, startMs: cur, endMs: split });
    cur = split;
  }
  return out;
}

type WorkEntry = {
  user_id: string;
  started_at: string;
  ended_at: string | null;
  paused_at?: string | null;
  paused_seconds?: number;
};

function activeRange(e: WorkEntry, nowMs: number) {
  return entryActiveWorkRangeMs(e.started_at, e.ended_at, nowMs, {
    pausedAt: e.paused_at,
    pausedSeconds: e.paused_seconds,
  });
}

/** Clock time at the PC: merge overlapping jobs per person, then sum people. */
export function pcWorkedSeconds(
  entries: WorkEntry[],
  nowMs: number = Date.now()
): number {
  const byUser = new Map<string, { startMs: number; endMs: number }[]>();
  for (const e of entries) {
    const range = activeRange(e, nowMs);
    if (!range) continue;
    const list = byUser.get(e.user_id) ?? [];
    list.push(range);
    byUser.set(e.user_id, list);
  }
  let total = 0;
  for (const ranges of byUser.values()) {
    total += unionIntervalSeconds(ranges);
  }
  return total;
}

/** Same as pcWorkedSeconds, split at local midnight so each chart day is clock time that day. */
export function pcWorkedSecondsByLocalDay(
  entries: WorkEntry[],
  nowMs: number = Date.now()
): Map<string, number> {
  const byDayUser = new Map<string, Map<string, { startMs: number; endMs: number }[]>>();
  for (const e of entries) {
    const range = activeRange(e, nowMs);
    if (!range) continue;
    for (const piece of splitRangeByLocalDays(range.startMs, range.endMs)) {
      let byUser = byDayUser.get(piece.date);
      if (!byUser) {
        byUser = new Map();
        byDayUser.set(piece.date, byUser);
      }
      const list = byUser.get(e.user_id) ?? [];
      list.push({ startMs: piece.startMs, endMs: piece.endMs });
      byUser.set(e.user_id, list);
    }
  }
  const out = new Map<string, number>();
  for (const [date, byUser] of byDayUser) {
    let total = 0;
    for (const ranges of byUser.values()) {
      total += unionIntervalSeconds(ranges);
    }
    out.set(date, total);
  }
  return out;
}
