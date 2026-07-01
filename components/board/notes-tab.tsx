"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils";
import type { OrderNote } from "@/lib/types";

interface NotesTabProps {
  notes: OrderNote[];
  orderId: string;
  userId?: string;
  isAdmin?: boolean;
  onChanged: () => void;
}

export function NotesTab({
  notes,
  orderId,
  userId,
  isAdmin = false,
  onChanged,
}: NotesTabProps) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setError(json.error ?? "Failed to save note");
        return;
      }
      setText("");
      onChanged();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(noteId: string) {
    if (!window.confirm("Delete this note?")) return;
    setDeletingId(noteId);
    try {
      await fetch(`/api/orders/${orderId}/notes/${noteId}`, { method: "DELETE" });
      onChanged();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Compose */}
      <form onSubmit={handleSubmit} className="space-y-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add an internal note…"
          rows={3}
          className="min-h-[80px] w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
        />
        {error ? (
          <p className="text-xs text-red-600">{error}</p>
        ) : null}
        <div className="flex justify-end">
          <Button type="submit" disabled={submitting || !text.trim()}>
            {submitting ? "Saving…" : "Add Note"}
          </Button>
        </div>
      </form>

      {/* History */}
      {notes.length === 0 ? (
        <p className="text-sm text-slate-400">No notes yet.</p>
      ) : (
        <ul className="space-y-3">
          {notes.map((note) => {
            const canDelete = isAdmin || note.created_by === userId;
            return (
              <li
                key={note.id}
                className="rounded-lg border border-slate-200 bg-slate-50 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-slate-500">
                      <span className="font-semibold text-slate-700">
                        {note.creator_name ?? "Staff member"}
                      </span>
                      {" · "}
                      {formatDateTime(note.created_at)}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">
                      {note.text}
                    </p>
                  </div>
                  {canDelete ? (
                    <button
                      type="button"
                      onClick={() => handleDelete(note.id)}
                      disabled={deletingId === note.id}
                      className="shrink-0 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-40"
                      title="Delete note"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
