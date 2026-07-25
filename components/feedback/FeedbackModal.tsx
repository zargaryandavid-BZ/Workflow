"use client";

import { useEffect, useState } from "react";
import { Bug, HelpCircle, Lightbulb, MoreHorizontal, Sparkles } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import {
  FEEDBACK_PAGES,
  FEEDBACK_TYPE_LABELS,
  type FeedbackItem,
  type FeedbackType,
} from "@/lib/feedback";
import { cn } from "@/lib/utils";

const TYPE_OPTIONS: {
  value: FeedbackType;
  label: string;
  icon: typeof Lightbulb;
}[] = [
  { value: "improvement", label: FEEDBACK_TYPE_LABELS.improvement, icon: Lightbulb },
  { value: "bug", label: FEEDBACK_TYPE_LABELS.bug, icon: Bug },
  { value: "feature_request", label: FEEDBACK_TYPE_LABELS.feature_request, icon: Sparkles },
  { value: "question", label: FEEDBACK_TYPE_LABELS.question, icon: HelpCircle },
  { value: "other", label: FEEDBACK_TYPE_LABELS.other, icon: MoreHorizontal },
];

interface FeedbackModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: (item: FeedbackItem) => void;
  /** When set, modal is in edit mode. */
  editing?: FeedbackItem | null;
}

export function FeedbackModal({
  open,
  onClose,
  onSaved,
  editing = null,
}: FeedbackModalProps) {
  const [type, setType] = useState<FeedbackType>("improvement");
  const [page, setPage] = useState<string>(FEEDBACK_PAGES[0]);
  const [title, setTitle] = useState("");
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = Boolean(editing);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setType(editing.type);
      setPage(editing.page);
      setTitle(editing.title);
      setComment(editing.comment);
    } else {
      setType("improvement");
      setPage(FEEDBACK_PAGES[0]);
      setTitle("");
      setComment("");
    }
    setError(null);
    setSubmitting(false);
  }, [open, editing]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const payload = { type, page, title: title.trim(), comment: comment.trim() };
      const res = await fetch(
        isEdit && editing ? `/api/feedback/${editing.id}` : "/api/feedback",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = (await res.json()) as { item?: FeedbackItem; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to save feedback");
      if (!data.item) throw new Error("No feedback returned");
      onSaved(data.item);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save feedback");
    } finally {
      setSubmitting(false);
    }
  }

  const lastEditedLabel =
    editing && editing.updated_at !== editing.created_at
      ? new Date(editing.updated_at).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-amber-500" />
          {isEdit ? "Edit Feedback" : "Submit Feedback"}
        </span>
      }
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="feedback-form"
            disabled={submitting}
          >
            {submitting
              ? "Saving…"
              : isEdit
                ? "Save Changes"
                : "Submit Feedback"}
          </Button>
        </>
      }
    >
      <form id="feedback-form" onSubmit={handleSubmit} className="space-y-4 py-2">
        <div>
          <Label>Type *</Label>
          <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {TYPE_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const selected = type === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setType(opt.value)}
                  className={cn(
                    "flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                    selected
                      ? "border-[var(--primary)] bg-[var(--primary)]/5 text-slate-900"
                      : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <Label htmlFor="feedback-page">Page / Section *</Label>
          <Select
            id="feedback-page"
            value={page}
            onChange={(e) => setPage(e.target.value)}
            required
          >
            {FEEDBACK_PAGES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
            {page && !(FEEDBACK_PAGES as readonly string[]).includes(page) ? (
              <option value={page}>{page}</option>
            ) : null}
          </Select>
        </div>

        <div>
          <Label htmlFor="feedback-title">Title *</Label>
          <Input
            id="feedback-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Short summary of your feedback"
            required
            maxLength={200}
          />
        </div>

        <div>
          <Label htmlFor="feedback-comment">Description *</Label>
          <Textarea
            id="feedback-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Describe the idea, bug, or request…"
            required
            rows={5}
          />
        </div>

        {lastEditedLabel ? (
          <p className="text-xs text-slate-400">
            Last edited: {lastEditedLabel}
          </p>
        ) : null}

        {error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : null}
      </form>
    </Modal>
  );
}
