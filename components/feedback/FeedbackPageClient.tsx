"use client";

import { useCallback, useEffect, useState } from "react";
import { Lightbulb, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FeedbackModal } from "@/components/feedback/FeedbackModal";
import { FeedbackTable } from "@/components/feedback/FeedbackTable";
import type { FeedbackItem } from "@/lib/feedback";

interface FeedbackPageClientProps {
  isAdmin: boolean;
}

export function FeedbackPageClient({ isAdmin }: FeedbackPageClientProps) {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<FeedbackItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/feedback");
      const data = (await res.json()) as {
        items?: FeedbackItem[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Failed to load feedback");
      setItems(data.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load feedback");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function handleSaved(item: FeedbackItem) {
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.id === item.id);
      if (idx === -1) return [item, ...prev];
      const next = [...prev];
      next[idx] = item;
      return next;
    });
  }

  function openCreate() {
    setEditing(null);
    setModalOpen(true);
  }

  function openEdit(item: FeedbackItem) {
    setEditing(item);
    setModalOpen(true);
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b border-slate-200 bg-gradient-to-b from-amber-50/80 to-white px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
              <Lightbulb className="h-5 w-5 text-amber-500" />
              Feedback & Improvements
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Share ideas, report bugs, or request features
            </p>
          </div>
          <Button type="button" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Submit
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        {loading ? (
          <p className="text-sm text-slate-400">Loading feedback…</p>
        ) : error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
            <button
              type="button"
              onClick={() => void load()}
              className="ml-2 font-medium underline"
            >
              Retry
            </button>
          </div>
        ) : (
          <FeedbackTable
            items={items}
            isAdmin={isAdmin}
            onEdit={openEdit}
            onUpdated={handleSaved}
            onDeleted={(id) =>
              setItems((prev) => prev.filter((i) => i.id !== id))
            }
            emptyMessage="No feedback yet — be the first to share an idea!"
          />
        )}
      </div>

      <FeedbackModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        onSaved={handleSaved}
        editing={editing}
      />
    </div>
  );
}
