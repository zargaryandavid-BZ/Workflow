"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Pencil, Trash2, Check, X, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { downloadCsv } from "@/lib/download-csv";
import {
  ACTIVITY_TYPES,
  durationSeconds,
  entrySubjectLabel,
  formatDuration,
  localDateString,
  localDayEndExclusiveIso,
  localDayStartIso,
  TIME_ENTRIES_CHANGED_EVENT,
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

function typeClassName(activityType: string): string {
  return activityType === "Prepress"
    ? "text-violet-600 font-medium"
    : "text-slate-500";
}

function matchesJobQuery(entry: TimeEntry, q: string): boolean {
  if (!q) return true;
  const hay = [
    entry.job_number,
    entry.job_title,
    entry.order_title,
    entry.custom_task_name,
    entrySubjectLabel(entry),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

interface TeamMemberOption {
  id: string;
  name: string;
  role: "designer" | "preprod_owner";
}

interface TimeLogProps {
  highlightedEntryId?: string | null;
  orderId?: string | null;
  isAdmin?: boolean;
  teamMembers?: TeamMemberOption[];
  onChanged?: () => void;
}

export function TimeLog({
  highlightedEntryId,
  orderId,
  isAdmin = false,
  teamMembers = [],
  onChanged,
}: TimeLogProps) {
  const router = useRouter();
  const [date, setDate] = useState(() => localDateString());
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    activity_type: ActivityType;
    notes: string;
    started_at: string;
    ended_at: string;
  } | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [designerId, setDesignerId] = useState("");
  const [jobQuery, setJobQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [durationSort, setDurationSort] = useState<"none" | "asc" | "desc">(
    "none"
  );
  const [nowMs, setNowMs] = useState(() => Date.now());
  const dateInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const dayRes = await fetch(
        orderId
          ? `/api/time-entries?order_id=${encodeURIComponent(orderId)}`
          : `/api/time-entries?started_gte=${encodeURIComponent(localDayStartIso(date))}&started_lt=${encodeURIComponent(localDayEndExclusiveIso(date))}${isAdmin ? "&all=true" : ""}`
      );
      const dayData = (await dayRes.json()) as {
        entries?: TimeEntry[];
        error?: string;
      };
      if (!dayRes.ok) throw new Error(dayData.error ?? "Failed to load log");
      setEntries(dayData.entries ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load log");
    } finally {
      setLoading(false);
    }
  }, [date, orderId, isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    function onChangedEvent() {
      void load();
    }
    window.addEventListener(TIME_ENTRIES_CHANGED_EVENT, onChangedEvent);
    return () =>
      window.removeEventListener(TIME_ENTRIES_CHANGED_EVENT, onChangedEvent);
  }, [load]);

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

  async function stopRunning(id: string) {
    setSavingId(id);
    setError(null);
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to stop");
    } finally {
      setSavingId(null);
    }
  }

  const completed = entries.filter((e) => e.ended_at);
  const inProgress = entries.filter((e) => !e.ended_at);

  const designerOptions = useMemo(() => {
    const byId = new Map<
      string,
      { name: string; role: "designer" | "preprod_owner" }
    >();
    for (const member of teamMembers) {
      const name = member.name.trim();
      if (member.id && name) {
        byId.set(member.id, { name, role: member.role });
      }
    }
    for (const e of entries) {
      const name = e.user_display_name?.trim();
      if (e.user_id && name && !byId.has(e.user_id)) {
        byId.set(e.user_id, {
          name,
          role:
            e.timer_kind === "prepress" ? "preprod_owner" : "designer",
        });
      }
    }
    return [...byId.entries()]
      .map(([id, member]) => ({ id, ...member }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }, [teamMembers, entries]);

  const rowMatchesFilters = useCallback(
    (e: TimeEntry) => {
      if (designerId && e.user_id !== designerId) return false;
      if (typeFilter && e.activity_type !== typeFilter) return false;
      return matchesJobQuery(e, jobQuery.trim().toLowerCase());
    },
    [designerId, typeFilter, jobQuery]
  );

  const visible = useMemo(() => {
    let rows = completed.filter(rowMatchesFilters);
    if (durationSort === "asc") {
      rows = [...rows].sort((a, b) => a.duration_seconds - b.duration_seconds);
    } else if (durationSort === "desc") {
      rows = [...rows].sort((a, b) => b.duration_seconds - a.duration_seconds);
    }
    return rows;
  }, [completed, rowMatchesFilters, durationSort]);

  const visibleInProgress = useMemo(
    () => inProgress.filter(rowMatchesFilters),
    [inProgress, rowMatchesFilters]
  );

  const dayTotalSeconds = visible.reduce(
    (sum, e) => sum + e.duration_seconds,
    0
  );

  const perDesignerTotals = useMemo(() => {
    if (!isAdmin) return [];
    const map = new Map<string, { name: string; seconds: number }>();
    for (const e of completed) {
      const key = e.user_id ?? "unknown";
      const name = e.user_display_name ?? "Unknown";
      const cur = map.get(key) ?? { name, seconds: 0 };
      map.set(key, { name, seconds: cur.seconds + e.duration_seconds });
    }
    return [...map.values()].sort((a, b) => b.seconds - a.seconds);
  }, [completed, isAdmin]);

  const allDaySeconds = completed.reduce((s, e) => s + e.duration_seconds, 0);

  const jobLabel = orderId
    ? completed.find((e) => e.order_id === orderId)?.job_title ||
      inProgress.find((e) => e.order_id === orderId)?.job_title ||
      null
    : null;

  const colSpan = isAdmin ? 10 : 9;

  function exportVisibleCsv() {
    const headers = [
      "Date",
      "Start",
      "End",
      "Duration",
      "Job",
      "Customer",
      "Designer",
      "Activity Type",
      "Notes",
    ];
    const rows = visible.map((entry) => {
      const started = new Date(entry.started_at);
      const ended = entry.ended_at ? new Date(entry.ended_at) : null;
      return [
        started.toLocaleDateString(),
        started.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        ended
          ? ended.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })
          : "",
        formatDuration(entry.duration_seconds),
        entrySubjectLabel(entry),
        entry.customer_name ?? "",
        entry.user_display_name ?? "",
        entry.activity_type,
        entry.notes ?? "",
      ];
    });
    downloadCsv(`time-log-${date}.csv`, headers, rows);
  }

  return (
    <div className="space-y-4">
      {orderId ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Showing Start-button time for this board card
          {jobLabel ? (
            <span className="font-semibold"> · {jobLabel}</span>
          ) : null}
          .{" "}
          <a href="/time?tab=log" className="underline hover:no-underline">
            Show all today
          </a>
        </div>
      ) : null}

      {!loading && !orderId && completed.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm">
          <span className="tabular-nums">
            <span className="font-semibold text-slate-800">{formatDuration(allDaySeconds)}</span>
            <span className="ml-1 text-slate-500">total</span>
          </span>
          {perDesignerTotals.map((d) => (
            <span key={d.name} className="tabular-nums text-slate-600">
              <span className="font-medium">{d.name}</span>
              <span className="ml-1 text-slate-400">{formatDuration(d.seconds)}</span>
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-nowrap items-end gap-3 overflow-x-auto">
        {orderId ? null : (
          <>
            <label className="text-sm font-medium text-slate-700">
              Date
              <Input
                ref={dateInputRef}
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                onClick={() => {
                  try {
                    dateInputRef.current?.showPicker?.();
                  } catch {
                    /* showPicker can throw if the input is not visible */
                  }
                }}
                className="mt-1 w-[13rem] cursor-pointer [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-100"
              />
            </label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mb-0.5"
              onClick={() => setDate(localDateString())}
            >
              Today
            </Button>
          </>
        )}
        <label className="text-sm font-medium text-slate-700">
          Team
          <Select
            value={designerId}
            onChange={(e) => setDesignerId(e.target.value)}
            className="mt-1 w-48"
          >
            <option value="">All members</option>
            {designerOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}:{" "}
                {d.role === "preprod_owner"
                  ? "Pre-production"
                  : "Designer"}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-sm font-medium text-slate-700">
          Type
          <Select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="mt-1 w-44"
          >
            <option value="">All types</option>
            {ACTIVITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-sm font-medium text-slate-700">
          Job number
          <Input
            type="search"
            value={jobQuery}
            onChange={(e) => setJobQuery(e.target.value)}
            placeholder="Search job #"
            className="mt-1 w-44"
          />
        </label>
        <label className="text-sm font-medium text-slate-700">
          Sort by
          <Select
            value={durationSort}
            onChange={(e) =>
              setDurationSort(e.target.value as "none" | "asc" | "desc")
            }
            className="mt-1 w-40"
          >
            <option value="none">Start time</option>
            <option value="asc">Duration asc</option>
            <option value="desc">Duration desc</option>
          </Select>
        </label>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="mb-0.5 ml-auto"
          disabled={loading || visible.length === 0}
          onClick={exportVisibleCsv}
        >
          <Download className="h-3.5 w-3.5" />
          Export CSV
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
          {visibleInProgress.length > 0 ? (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                In progress
              </h3>
              <div className="overflow-x-auto rounded-lg border border-emerald-200">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-emerald-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Start</th>
                      <th className="px-3 py-2 font-semibold">Elapsed</th>
                      <th className="px-3 py-2 font-semibold">Job / Task</th>
                      <th className="px-3 py-2 font-semibold">Type</th>
                      {isAdmin ? (
                        <th className="px-3 py-2 font-semibold">Who</th>
                      ) : null}
                      <th className="px-3 py-2 font-semibold" />
                    </tr>
                  </thead>
                  <tbody>
                    {visibleInProgress.map((entry) => {
                      const elapsed = durationSeconds(
                        entry.started_at,
                        null,
                        nowMs,
                        {
                          pausedAt: entry.paused_at ?? null,
                          pausedSeconds: entry.paused_seconds ?? 0,
                        }
                      );
                      return (
                        <tr
                          key={entry.id}
                          className="border-t border-emerald-100 bg-white"
                        >
                          <td className="px-3 py-2 tabular-nums text-slate-600">
                            <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-500 align-middle" />
                            {new Date(entry.started_at).toLocaleTimeString(
                              [],
                              { hour: "2-digit", minute: "2-digit" }
                            )}
                          </td>
                          <td className="px-3 py-2 tabular-nums font-medium text-emerald-700">
                            {formatDuration(elapsed)}
                          </td>
                          <td className="px-3 py-2 font-medium text-slate-800">
                            {entrySubjectLabel(entry)}
                          </td>
                          <td className="px-3 py-2">
                            <span className={typeClassName(entry.activity_type)}>
                              {entry.activity_type}
                            </span>
                          </td>
                          {isAdmin ? (
                            <td className="px-3 py-2 text-slate-600">
                              {entry.user_display_name ?? "—"}
                            </td>
                          ) : null}
                          <td className="px-3 py-2">
                            <div className="flex gap-1">
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-7"
                                onClick={() =>
                                  router.replace(
                                    `/time?tab=active&entry=${encodeURIComponent(entry.id)}`
                                  )
                                }
                              >
                                View
                              </Button>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                disabled={savingId === entry.id}
                                title="Stop"
                                onClick={() => void stopRunning(entry.id)}
                              >
                                <Square className="h-3.5 w-3.5 fill-current text-red-500" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">Start</th>
                  <th className="px-3 py-2 font-semibold">End</th>
                  <th className="px-3 py-2 font-semibold">Duration</th>
                  <th className="px-3 py-2 font-semibold">Type</th>
                  <th className="px-3 py-2 font-semibold">Job / Task</th>
                  <th className="px-3 py-2 text-right font-semibold">SKU QTY</th>
                  <th className="px-3 py-2 font-semibold">Customer</th>
                  {isAdmin ? (
                    <th className="px-3 py-2 font-semibold">Who</th>
                  ) : null}
                  <th className="px-3 py-2 font-semibold">Notes</th>
                  <th className="px-3 py-2 font-semibold" />
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr>
                    <td
                      colSpan={colSpan}
                      className="px-3 py-6 text-center text-slate-400"
                    >
                      No completed entries for this day
                    </td>
                  </tr>
                ) : (
                  visible.map((entry) => {
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
                                className="h-8 w-36 text-xs"
                              >
                                {ACTIVITY_TYPES.map((t) => (
                                  <option key={t} value={t}>
                                    {t}
                                  </option>
                                ))}
                              </Select>
                            </td>
                            <td className="px-3 py-2 font-medium text-slate-800">
                              {entrySubjectLabel(entry)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                              {entry.sku_count != null && entry.sku_count > 0
                                ? entry.sku_count
                                : "—"}
                            </td>
                            <td className="px-3 py-2 text-slate-500">
                              {entry.customer_name ?? "—"}
                            </td>
                            {isAdmin ? (
                              <td className="px-3 py-2 text-slate-600">
                                {entry.user_display_name ?? "—"}
                              </td>
                            ) : null}
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
                            <td className="px-3 py-2">
                              <span
                                className={typeClassName(entry.activity_type)}
                              >
                                {entry.activity_type}
                              </span>
                            </td>
                            <td className="px-3 py-2 font-medium text-slate-800">
                              {entrySubjectLabel(entry)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                              {entry.sku_count != null && entry.sku_count > 0
                                ? entry.sku_count
                                : "—"}
                            </td>
                            <td className="max-w-[10rem] truncate px-3 py-2 text-slate-500">
                              {entry.customer_name ?? "—"}
                            </td>
                            {isAdmin ? (
                              <td className="px-3 py-2 text-slate-600">
                                {entry.user_display_name ?? "—"}
                              </td>
                            ) : null}
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
