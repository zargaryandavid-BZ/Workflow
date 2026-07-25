"use client";

import { useState } from "react";
import { MessageSquare, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, Textarea } from "@/components/ui/input";
import {
  FEEDBACK_STATUS_BADGE_CLASS,
  FEEDBACK_STATUS_LABELS,
  FEEDBACK_STATUSES,
  FEEDBACK_TYPE_BADGE_CLASS,
  FEEDBACK_TYPE_LABELS,
  type FeedbackItem,
  type FeedbackStatus,
} from "@/lib/feedback";
import { cn } from "@/lib/utils";

interface FeedbackCardProps {
  item: FeedbackItem;
  isAdmin: boolean;
  onEdit: (item: FeedbackItem) => void;
  onUpdated: (item: FeedbackItem) => void;
  onDeleted: (id: string) => void;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function FeedbackCard({
  item,
  isAdmin,
  onEdit,
  onUpdated,
  onDeleted,
}: FeedbackCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState(item.admin_note ?? "");
  const [savingStatus, setSavingStatus] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wasEdited = item.updated_at !== item.created_at;
  const commentLong = item.comment.length > 220 || item.comment.includes("\n");

  async function patch(body: Record<string, unknown>) {
    const res = await fetch(`/api/feedback/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { item?: FeedbackItem; error?: string };
    if (!res.ok) throw new Error(data.error ?? "Update failed");
    if (!data.item) throw new Error("No feedback returned");
    onUpdated(data.item);
    return data.item;
  }

  async function handleStatusChange(status: FeedbackStatus) {
    setSavingStatus(true);
    setError(null);
    try {
      await patch({ status });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setSavingStatus(false);
    }
  }

  async function handleSaveNote() {
    setSavingNote(true);
    setError(null);
    try {
      await patch({ admin_note: noteDraft });
      setNoteOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save note");
    } finally {
      setSavingNote(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm("Delete this feedback entry? This cannot be undone.")) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/feedback/${item.id}`, { method: "DELETE" });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Delete failed");
      onDeleted(item.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
      setDeleting(false);
    }
  }

  return (
    <article className="relative rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      {isAdmin ? (
        <button
          type="button"
          onClick={() => void handleDelete()}
          disabled={deleting}
          className="absolute right-3 top-3 rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
          aria-label="Delete feedback"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 pr-8">
        <span
          className={cn(
            "inline-flex rounded-md px-2 py-0.5 text-xs font-medium",
            FEEDBACK_TYPE_BADGE_CLASS[item.type]
          )}
        >
          {FEEDBACK_TYPE_LABELS[item.type]}
        </span>
        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
          {item.page}
        </span>
        <span className="text-xs text-slate-400">{formatDate(item.created_at)}</span>
        {wasEdited ? (
          <span className="text-xs text-slate-400">
            · Edited {formatDate(item.updated_at)}
          </span>
        ) : null}
      </div>

      <h3 className="mt-2 text-sm font-semibold text-slate-900">{item.title}</h3>

      <p
        className={cn(
          "mt-1 text-sm text-slate-600 whitespace-pre-wrap",
          !expanded && "line-clamp-3"
        )}
      >
        {item.comment}
      </p>
      {commentLong ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-xs font-medium text-[var(--primary)] hover:underline"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}

      <p className="mt-3 text-xs text-slate-500">
        Submitted by:{" "}
        <span className="font-medium text-slate-700">{item.display_name}</span>
      </p>

      {item.admin_note ? (
        <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-900">
          <span className="font-medium">Admin note: </span>
          {item.admin_note}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {isAdmin ? (
          <Select
            value={item.status}
            disabled={savingStatus}
            onChange={(e) =>
              void handleStatusChange(e.target.value as FeedbackStatus)
            }
            className="h-8 w-auto min-w-[8rem] text-xs"
            aria-label="Feedback status"
          >
            {FEEDBACK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {FEEDBACK_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        ) : (
          <span
            className={cn(
              "inline-flex rounded-md px-2 py-0.5 text-xs font-medium",
              FEEDBACK_STATUS_BADGE_CLASS[item.status]
            )}
          >
            {FEEDBACK_STATUS_LABELS[item.status]}
          </span>
        )}

        {item.is_own ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onEdit(item)}
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Button>
        ) : null}

        {isAdmin ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setNoteDraft(item.admin_note ?? "");
              setNoteOpen((v) => !v);
            }}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            {item.admin_note ? "Edit note" : "Add note"}
          </Button>
        ) : null}
      </div>

      {isAdmin && noteOpen ? (
        <div className="mt-3 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <Textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            placeholder="Internal admin response…"
            rows={3}
            className="bg-white"
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setNoteOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={savingNote}
              onClick={() => void handleSaveNote()}
            >
              {savingNote ? "Saving…" : "Save note"}
            </Button>
          </div>
        </div>
      ) : null}

      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
    </article>
  );
}
