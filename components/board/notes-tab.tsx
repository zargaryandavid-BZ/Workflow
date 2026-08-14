"use client";

import { useState } from "react";
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
  onChanged,
}: NotesTabProps) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="space-y-4">
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

      {notes.length === 0 ? (
        <p className="text-sm text-slate-400">No notes yet.</p>
      ) : (
        <ul className="space-y-3">
          {notes.map((note) => (
            <li
              key={note.id}
              className="rounded-lg border border-slate-200 bg-slate-50 p-3"
            >
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
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
