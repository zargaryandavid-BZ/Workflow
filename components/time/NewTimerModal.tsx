"use client";

import { useCallback, useEffect, useState } from "react";
import { Play } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { ACTIVITY_TYPES, type ActivityType, notifyTimeEntriesChanged } from "@/lib/time-tracking";
import { cn } from "@/lib/utils";

type Mode = "job" | "custom";

interface AssignableOrder {
  id: string;
  title: string;
  due_date: string | null;
  customer_name: string | null;
  assigned: boolean;
}

interface NewTimerModalProps {
  open: boolean;
  onClose: () => void;
  onStarted: () => void;
}

export function NewTimerModal({ open, onClose, onStarted }: NewTimerModalProps) {
  const [mode, setMode] = useState<Mode>("custom");
  const [activityType, setActivityType] = useState<ActivityType>("Design");
  const [notes, setNotes] = useState("");
  const [customTaskName, setCustomTaskName] = useState("");
  const [orderQuery, setOrderQuery] = useState("");
  const [orders, setOrders] = useState<AssignableOrder[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [hasAssignedJobs, setHasAssignedJobs] = useState(false);
  const [assignedCheckDone, setAssignedCheckDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setMode("custom");
    setActivityType("Design");
    setNotes("");
    setCustomTaskName("");
    setOrderQuery("");
    setSelectedOrderId(null);
    setOrders([]);
    setHasAssignedJobs(false);
    setAssignedCheckDone(false);
    setError(null);
    setSubmitting(false);
  }, []);

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  // Decide whether Board Job is available. No assigned jobs → Custom Task only.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setAssignedCheckDone(false);
    void (async () => {
      try {
        const res = await fetch("/api/time-entries/assignable-orders");
        const data = (await res.json()) as {
          orders?: AssignableOrder[];
        };
        if (cancelled) return;
        // Without `q`, API returns only jobs assigned to the current user.
        const list = data.orders ?? [];
        const assigned = list.length > 0;
        setHasAssignedJobs(assigned);
        setOrders(assigned ? list : []);
        setMode(assigned ? "job" : "custom");
      } catch {
        if (!cancelled) {
          setHasAssignedJobs(false);
          setMode("custom");
        }
      } finally {
        if (!cancelled) setAssignedCheckDone(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open || mode !== "job" || !hasAssignedJobs || !assignedCheckDone) {
      return;
    }
    // Initial list already loaded by the assigned check; only refetch when searching.
    if (!orderQuery.trim()) return;

    const handle = window.setTimeout(async () => {
      setOrdersLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("q", orderQuery.trim());
        const res = await fetch(
          `/api/time-entries/assignable-orders?${params.toString()}`
        );
        const data = (await res.json()) as {
          orders?: AssignableOrder[];
          error?: string;
        };
        if (!res.ok) throw new Error(data.error ?? "Failed to load orders");
        setOrders(data.orders ?? []);
      } catch (err) {
        setOrders([]);
        setError(err instanceof Error ? err.message : "Failed to load orders");
      } finally {
        setOrdersLoading(false);
      }
    }, 200);
    return () => window.clearTimeout(handle);
  }, [open, mode, orderQuery, hasAssignedJobs, assignedCheckDone]);

  async function handleStart() {
    setError(null);
    if (mode === "job" && !selectedOrderId) {
      setError("Select a board job");
      return;
    }
    if (mode === "custom" && !customTaskName.trim()) {
      setError("Enter a task name");
      return;
    }

    setSubmitting(true);
    try {
      const body =
        mode === "job"
          ? {
              order_id: selectedOrderId,
              activity_type: activityType,
              notes: notes.trim() || undefined,
            }
          : {
              custom_task_name: customTaskName.trim(),
              activity_type: activityType,
              notes: notes.trim() || undefined,
            };

      const res = await fetch("/api/time-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not start timer");
      notifyTimeEntriesChanged();
      onStarted();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start timer");
    } finally {
      setSubmitting(false);
    }
  }

  const selected = orders.find((o) => o.id === selectedOrderId) ?? null;
  const showModeTabs = assignedCheckDone && hasAssignedJobs;
  const showJobPicker = mode === "job" && hasAssignedJobs;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Start Timer"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void handleStart()}
            disabled={submitting || !assignedCheckDone}
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            {submitting ? "Starting…" : "Start"}
          </Button>
        </>
      }
    >
      <div className="space-y-4 py-2">
        {showModeTabs ? (
          <div className="flex rounded-md border border-slate-200 p-0.5">
            {(
              [
                ["job", "Board Job"],
                ["custom", "Custom Task"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setMode(id)}
                className={cn(
                  "flex-1 rounded px-3 py-1.5 text-sm font-medium transition-colors",
                  mode === id
                    ? "bg-blue-50 text-[var(--primary)]"
                    : "text-slate-600 hover:bg-slate-50"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}

        {!assignedCheckDone ? (
          <p className="text-xs text-slate-400">Loading…</p>
        ) : showJobPicker ? (
          <div className="space-y-2">
            <Label htmlFor="timer-job-search">Job</Label>
            <Input
              id="timer-job-search"
              value={orderQuery}
              onChange={(e) => {
                setOrderQuery(e.target.value);
                setSelectedOrderId(null);
              }}
              placeholder="Search assigned jobs…"
              autoComplete="off"
            />
            {selected ? (
              <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-slate-700">
                <span className="font-medium">{selected.title}</span>
                {selected.customer_name ? (
                  <span className="text-slate-500">
                    {" "}
                    · {selected.customer_name}
                  </span>
                ) : null}
                <button
                  type="button"
                  className="ml-2 text-xs text-blue-600 underline"
                  onClick={() => setSelectedOrderId(null)}
                >
                  Change
                </button>
              </div>
            ) : (
              <div className="max-h-48 overflow-y-auto rounded-md border border-slate-200">
                {ordersLoading ? (
                  <p className="px-3 py-2 text-xs text-slate-400">Loading…</p>
                ) : orders.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-slate-400">
                    {orderQuery ? "No matching jobs" : "No jobs assigned to you"}
                  </p>
                ) : (
                  orders.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => setSelectedOrderId(o.id)}
                      className="flex w-full flex-col items-start gap-0.5 border-b border-slate-100 px-3 py-2 text-left last:border-b-0 hover:bg-slate-50"
                    >
                      <span className="text-sm font-medium text-slate-800">
                        {o.title}
                      </span>
                      <span className="text-[11px] text-slate-500">
                        {o.customer_name ?? "No customer"}
                        {o.due_date
                          ? ` · due ${o.due_date.slice(0, 10)}`
                          : ""}
                        {!o.assigned ? " · not assigned to you" : ""}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        ) : (
          <div>
            <Label htmlFor="timer-task-name">Task name</Label>
            <Input
              id="timer-task-name"
              value={customTaskName}
              onChange={(e) => setCustomTaskName(e.target.value)}
              placeholder="e.g. Team standup"
            />
          </div>
        )}

        <div>
          <Label htmlFor="timer-activity">Activity type</Label>
          <Select
            id="timer-activity"
            value={activityType}
            onChange={(e) => setActivityType(e.target.value as ActivityType)}
          >
            {ACTIVITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="timer-notes">Notes (optional)</Label>
          <Textarea
            id="timer-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="What are you working on?"
          />
        </div>

        {error ? (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
