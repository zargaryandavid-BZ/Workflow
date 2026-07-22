"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Trash2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { ActiveTimerCard } from "@/components/time/ActiveTimerCard";
import {
  ACTIVITY_TYPES,
  durationSeconds,
  entrySubjectLabel,
  formatDuration,
  localDateString,
  notifyTimeEntriesChanged,
  type ActivityType,
  type TimeEntry,
} from "@/lib/time-tracking";

function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInputValue(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

interface TimeLogProps {
  highlightedEntryId?: string | null;
  onChanged?: () => void;
}

export function TimeLog({ highlightedEntryId, onChanged }: TimeLogProps) {
  const [date, setDate] = useState(() => localDateString());
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [running, setRunning] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    activity_type: ActivityType;
    notes: string;
    started_at: string;
    ended_at: string;
  } | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [notesDrafts, setNotesDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dayRes, runRes] = await Promise.all([
        fetch(`/api/time-entries?date=${encodeURIComponent(date)}`),
        fetch("/api/time-entries?running=true"),
      ]);
      const dayData = (await dayRes.json()) as {
        entries?: TimeEntry[];
        error?: string;
      };
      const runData = (await runRes.json()) as {
        entries?: TimeEntry[];
        error?: string;
      };
      if (!dayRes.ok) throw new Error(dayData.error ?? "Failed to load log");
      if (!runRes.ok) throw new Error(runData.error ?? "Failed to load timers");

      const dayEntries = dayData.entries ?? [];
      const runEntries = runData.entries ?? [];
      setRunning(runEntries);
      // Completed for the day + any running that started today (avoid dupes)
      const runIds = new Set(runEntries.map((e) => e.id));
      setEntries(dayEntries.filter((e) => !runIds.has(e.id) || e.ended_at));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load log");
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  async function stopTimer(id: string) {
    setSavingId(id);
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
      await load();
      notifyTimeEntriesChanged();
      onChanged?.();
    } finally {
      setSavingId(null);
    }
  }

  async function pauseTimer(id: string) {
    setSavingId(id);
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
      await load();
      notifyTimeEntriesChanged();
      onChanged?.();
    } finally {
      setSavingId(null);
    }
  }

  async function resumeTimer(id: string) {
    setSavingId(id);
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
      await load();
      notifyTimeEntriesChanged();
      onChanged?.();
    } finally {
      setSavingId(null);
    }
  }

  async function saveNotes(id: string) {
    const notes = notesDrafts[id];
    if (notes === undefined) return;
    setSavingId(id);
    try {
      const res = await fetch(`/api/time-entries/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to save notes");
      }
      await load();
      onChanged?.();
    } finally {
      setSavingId(null);
    }
  }

  function beginEdit(entry: TimeEntry) {
    setEditingId(entry.id);
    setEditDraft({
      activity_type: entry.activity_type,
      notes: entry.notes ?? "",
      started_at: toLocalInputValue(entry.started_at),
      ended_at: entry.ended_at ? toLocalInputValue(entry.ended_at) : "",
    });
  }

  async function saveEdit(id: string) {
    if (!editDraft) return;
    const started_at = fromLocalInputValue(editDraft.started_at);
    if (!started_at) {
      setError("Invalid start time");
      return;
    }
    const ended_at = editDraft.ended_at
      ? fromLocalInputValue(editDraft.ended_at)
      : null;
    if (editDraft.ended_at && !ended_at) {
      setError("Invalid end time");
      return;
    }

    setSavingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/time-entries/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activity_type: editDraft.activity_type,
          notes: editDraft.notes,
          started_at,
          ended_at,
        }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to save");
      }
      setEditingId(null);
      setEditDraft(null);
      await load();
      notifyTimeEntriesChanged();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSavingId(null);
    }
  }

  async function deleteEntry(id: string) {
    if (!window.confirm("Delete this time entry?")) return;
    setSavingId(id);
    try {
      const res = await fetch(`/api/time-entries/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to delete");
      }
      await load();
      notifyTimeEntriesChanged();
      onChanged?.();
    } finally {
      setSavingId(null);
    }
  }

  const completed = entries.filter((e) => e.ended_at);
  const dayTotalSeconds =
    running.reduce(
      (sum, e) =>
        sum +
        durationSeconds(e.started_at, null, nowMs, {
          pausedAt: e.paused_at,
          pausedSeconds: e.paused_seconds,
        }),
      0
    ) + completed.reduce((sum, e) => sum + e.duration_seconds, 0);

  // Running that started on selected day (or all running when viewing today)
  const today = localDateString();
  const visibleRunning =
    date === today
      ? running
      : running.filter((e) => localDateString(new Date(e.started_at)) === date);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium text-slate-700">
          Date
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1 w-auto"
          />
        </label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-5"
          onClick={() => setDate(localDateString())}
        >
          Today
        </Button>
      </div>

      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : (
        <>
          {visibleRunning.length > 0 ? (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Running
              </h3>
              {visibleRunning.map((entry) => (
                <ActiveTimerCard
                  key={entry.id}
                  entry={entry}
                  nowMs={nowMs}
                  highlighted={highlightedEntryId === entry.id}
                  notesEditable
                  notesDraft={notesDrafts[entry.id] ?? entry.notes ?? ""}
                  onNotesChange={(v) =>
                    setNotesDrafts((prev) => ({ ...prev, [entry.id]: v }))
                  }
                  onNotesBlur={() => void saveNotes(entry.id)}
                  stopping={savingId === entry.id}
                  pausing={savingId === entry.id}
                  onStop={(id) => void stopTimer(id)}
                  onPause={(id) => void pauseTimer(id)}
                  onResume={(id) => void resumeTimer(id)}
                />
              ))}
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">Start</th>
                  <th className="px-3 py-2 font-semibold">End</th>
                  <th className="px-3 py-2 font-semibold">Duration</th>
                  <th className="px-3 py-2 font-semibold">Job / Task</th>
                  <th className="px-3 py-2 font-semibold">Activity</th>
                  <th className="px-3 py-2 font-semibold">Notes</th>
                  <th className="px-3 py-2 font-semibold" />
                </tr>
              </thead>
              <tbody>
                {completed.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-3 py-6 text-center text-slate-400"
                    >
                      No completed entries for this day
                    </td>
                  </tr>
                ) : (
                  completed.map((entry) => {
                    const editing = editingId === entry.id && editDraft;
                    return (
                      <tr
                        key={entry.id}
                        className={
                          highlightedEntryId === entry.id
                            ? "bg-blue-50"
                            : "border-t border-slate-100"
                        }
                      >
                        {editing ? (
                          <>
                            <td className="px-3 py-2">
                              <Input
                                type="datetime-local"
                                value={editDraft.started_at}
                                onChange={(e) =>
                                  setEditDraft({
                                    ...editDraft,
                                    started_at: e.target.value,
                                  })
                                }
                                className="h-8 text-xs"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <Input
                                type="datetime-local"
                                value={editDraft.ended_at}
                                onChange={(e) =>
                                  setEditDraft({
                                    ...editDraft,
                                    ended_at: e.target.value,
                                  })
                                }
                                className="h-8 text-xs"
                              />
                            </td>
                            <td className="px-3 py-2 tabular-nums text-slate-600">
                              —
                            </td>
                            <td className="px-3 py-2 font-medium text-slate-800">
                              {entrySubjectLabel(entry)}
                            </td>
                            <td className="px-3 py-2">
                              <Select
                                value={editDraft.activity_type}
                                onChange={(e) =>
                                  setEditDraft({
                                    ...editDraft,
                                    activity_type: e.target
                                      .value as ActivityType,
                                  })
                                }
                                className="h-8 text-xs"
                              >
                                {ACTIVITY_TYPES.map((t) => (
                                  <option key={t} value={t}>
                                    {t}
                                  </option>
                                ))}
                              </Select>
                            </td>
                            <td className="px-3 py-2">
                              <Input
                                value={editDraft.notes}
                                onChange={(e) =>
                                  setEditDraft({
                                    ...editDraft,
                                    notes: e.target.value,
                                  })
                                }
                                className="h-8 text-xs"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex gap-1">
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7"
                                  disabled={savingId === entry.id}
                                  onClick={() => void saveEdit(entry.id)}
                                  title="Save"
                                >
                                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                                </Button>
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7"
                                  onClick={() => {
                                    setEditingId(null);
                                    setEditDraft(null);
                                  }}
                                  title="Cancel"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-3 py-2 tabular-nums text-slate-600">
                              {new Date(entry.started_at).toLocaleTimeString(
                                [],
                                { hour: "2-digit", minute: "2-digit" }
                              )}
                            </td>
                            <td className="px-3 py-2 tabular-nums text-slate-600">
                              {entry.ended_at
                                ? new Date(entry.ended_at).toLocaleTimeString(
                                    [],
                                    { hour: "2-digit", minute: "2-digit" }
                                  )
                                : "—"}
                            </td>
                            <td className="px-3 py-2 tabular-nums font-medium text-slate-800">
                              {formatDuration(entry.duration_seconds)}
                            </td>
                            <td className="px-3 py-2 font-medium text-slate-800">
                              {entrySubjectLabel(entry)}
                            </td>
                            <td className="px-3 py-2 text-slate-600">
                              {entry.activity_type}
                            </td>
                            <td className="max-w-[12rem] truncate px-3 py-2 text-slate-500">
                              {entry.notes || "—"}
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex gap-1">
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7"
                                  onClick={() => beginEdit(entry)}
                                  title="Edit"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7 text-red-500 hover:text-red-600"
                                  disabled={savingId === entry.id}
                                  onClick={() => void deleteEntry(entry.id)}
                                  title="Delete"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between border-t border-slate-100 pt-3">
            <span className="text-sm text-slate-500">Day total</span>
            <span className="text-sm font-semibold tabular-nums text-slate-800">
              {formatDuration(dayTotalSeconds)}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
