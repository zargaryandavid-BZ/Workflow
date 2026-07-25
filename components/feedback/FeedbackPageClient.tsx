"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Lightbulb, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FeedbackCard } from "@/components/feedback/FeedbackCard";
import { FeedbackModal } from "@/components/feedback/FeedbackModal";
import type { FeedbackItem, FeedbackType } from "@/lib/feedback";
import { cn } from "@/lib/utils";

type FilterTab = "all" | FeedbackType | "mine";

const TABS: { id: FilterTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "improvement", label: "Improvements" },
  { id: "bug", label: "Bugs" },
  { id: "feature_request", label: "Features" },
  { id: "mine", label: "Mine" },
];

interface FeedbackPageClientProps {
  isAdmin: boolean;
}

export function FeedbackPageClient({ isAdmin }: FeedbackPageClientProps) {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<FilterTab>("all");
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

  const filtered = useMemo(() => {
    if (tab === "all") return items;
    if (tab === "mine") return items.filter((i) => i.is_own);
    return items.filter((i) => i.type === tab);
  }, [items, tab]);

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

        <div className="mt-4 flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                tab === t.id
                  ? "bg-[var(--primary)] text-white"
                  : "text-slate-600 hover:bg-slate-100"
              )}
            >
              {t.label}
            </button>
          ))}
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
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-50">
              <Lightbulb className="h-8 w-8 text-amber-400" />
            </div>
            <p className="mt-4 text-sm font-medium text-slate-700">
              {tab === "mine"
                ? "You haven’t submitted any feedback yet"
                : "No feedback yet — be the first to share an idea!"}
            </p>
            <Button type="button" className="mt-4" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Submit Feedback
            </Button>
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-3">
            {filtered.map((item) => (
              <FeedbackCard
                key={item.id}
                item={item}
                isAdmin={isAdmin}
                onEdit={openEdit}
                onUpdated={handleSaved}
                onDeleted={(id) =>
                  setItems((prev) => prev.filter((i) => i.id !== id))
                }
              />
            ))}
          </div>
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
