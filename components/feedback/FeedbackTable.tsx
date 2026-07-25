"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, ImageIcon, MessageSquare, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, Textarea } from "@/components/ui/input";
import { ImageLightbox } from "@/components/ui/image-lightbox";
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

interface FeedbackTableProps {
  items: FeedbackItem[];
  isAdmin: boolean;
  onEdit: (item: FeedbackItem) => void;
  onUpdated: (item: FeedbackItem) => void;
  onDeleted: (id: string) => void;
  emptyMessage: string;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function FeedbackRow({
  item,
  isAdmin,
  onEdit,
  onUpdated,
  onDeleted,
}: {
  item: FeedbackItem;
  isAdmin: boolean;
  onEdit: (item: FeedbackItem) => void;
  onUpdated: (item: FeedbackItem) => void;
  onDeleted: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState(item.admin_note ?? "");
  const [savingStatus, setSavingStatus] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [lightboxLabel, setLightboxLabel] = useState("");

  const images = item.images ?? [];
  const imageCount = images.filter((img) => img.url).length;

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
    <>
      <tr className="hover:bg-slate-50/80">
        <td className="px-3 py-2.5">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label={expanded ? "Collapse row" : "Expand row"}
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
        </td>
        <td className="px-3 py-2.5">
          <span
            className={cn(
              "inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium",
              FEEDBACK_TYPE_BADGE_CLASS[item.type]
            )}
          >
            {FEEDBACK_TYPE_LABELS[item.type]}
          </span>
        </td>
        <td className="px-3 py-2.5">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-left font-medium text-slate-900 hover:text-[var(--primary)]"
          >
            {item.title}
          </button>
          {imageCount > 0 ? (
            <span className="mt-0.5 flex items-center gap-1 text-xs text-slate-400">
              <ImageIcon className="h-3 w-3" />
              {imageCount}
            </span>
          ) : null}
        </td>
        <td className="px-3 py-2.5 text-slate-600">{item.page}</td>
        <td className="px-3 py-2.5">
          {isAdmin ? (
            <Select
              value={item.status}
              disabled={savingStatus}
              onChange={(e) =>
                void handleStatusChange(e.target.value as FeedbackStatus)
              }
              className="h-8 w-auto min-w-[7.5rem] text-xs"
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
                "inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium",
                FEEDBACK_STATUS_BADGE_CLASS[item.status]
              )}
            >
              {FEEDBACK_STATUS_LABELS[item.status]}
            </span>
          )}
        </td>
        <td className="px-3 py-2.5 text-slate-600">{item.display_name}</td>
        <td className="px-3 py-2.5 whitespace-nowrap text-slate-500">
          {formatDate(item.created_at)}
        </td>
        <td className="px-3 py-2.5">
          <div className="flex justify-end gap-0.5">
            {item.is_own ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onEdit(item)}
                title="Edit"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            ) : null}
            {isAdmin ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setNoteDraft(item.admin_note ?? "");
                  setNoteOpen(true);
                  setExpanded(true);
                }}
                title={item.admin_note ? "Edit note" : "Add note"}
              >
                <MessageSquare className="h-3.5 w-3.5" />
              </Button>
            ) : null}
            {isAdmin ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={deleting}
                onClick={() => void handleDelete()}
                className="text-slate-400 hover:text-red-600"
                title="Delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            ) : null}
          </div>
        </td>
      </tr>

      {expanded ? (
        <tr className="bg-slate-50/60">
          <td colSpan={8} className="px-3 py-3">
            <div className="space-y-3 pl-6">
              <p className="whitespace-pre-wrap break-words text-sm text-slate-700">
                {item.comment}
              </p>

              {images.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {images.map((img) =>
                    img.url ? (
                      <button
                        key={img.id}
                        type="button"
                        onClick={() => {
                          setLightboxSrc(img.url);
                          setLightboxLabel(img.file_name);
                        }}
                        className="h-16 w-16 overflow-hidden rounded-md border border-slate-200 bg-white transition hover:ring-2 hover:ring-[var(--primary)]/40"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={img.url}
                          alt={img.file_name}
                          className="h-full w-full object-cover"
                        />
                      </button>
                    ) : null
                  )}
                </div>
              ) : null}

              {item.admin_note && !noteOpen ? (
                <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-900">
                  <span className="font-medium">Admin note: </span>
                  {item.admin_note}
                </div>
              ) : null}

              {isAdmin && noteOpen ? (
                <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                  <Textarea
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    placeholder="Internal admin response…"
                    rows={3}
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

              {error ? (
                <p className="text-xs text-red-600">{error}</p>
              ) : null}
            </div>
          </td>
        </tr>
      ) : null}

      {lightboxSrc ? (
        <ImageLightbox
          src={lightboxSrc}
          label={lightboxLabel}
          onClose={() => setLightboxSrc(null)}
        />
      ) : null}
    </>
  );
}

export function FeedbackTable({
  items,
  isAdmin,
  onEdit,
  onUpdated,
  onDeleted,
  emptyMessage,
}: FeedbackTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
          <tr>
            <th className="w-8 px-3 py-2.5" aria-label="Expand" />
            <th className="px-3 py-2.5">Type</th>
            <th className="px-3 py-2.5">Title</th>
            <th className="px-3 py-2.5">Page</th>
            <th className="px-3 py-2.5">Status</th>
            <th className="px-3 py-2.5">Submitted by</th>
            <th className="px-3 py-2.5">Date</th>
            <th className="px-3 py-2.5 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {items.length === 0 ? (
            <tr>
              <td
                colSpan={8}
                className="px-3 py-10 text-center text-sm text-slate-500"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            items.map((item) => (
              <FeedbackRow
                key={item.id}
                item={item}
                isAdmin={isAdmin}
                onEdit={onEdit}
                onUpdated={onUpdated}
                onDeleted={onDeleted}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
