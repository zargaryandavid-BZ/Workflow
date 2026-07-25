"use client";

import { useEffect, useRef, useState } from "react";
import {
  Bug,
  HelpCircle,
  ImagePlus,
  Lightbulb,
  MoreHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { ImageLightbox } from "@/components/ui/image-lightbox";
import { compressImage } from "@/lib/compress-image";
import {
  FEEDBACK_PAGES,
  FEEDBACK_TYPE_LABELS,
  type FeedbackImage,
  type FeedbackItem,
  type FeedbackSubmitType,
} from "@/lib/feedback";
import {
  FEEDBACK_IMAGE_MAX_BYTES,
  FEEDBACK_IMAGE_RAW_MAX_BYTES,
  MAX_FEEDBACK_IMAGES,
  feedbackImageSizeError,
} from "@/lib/feedback-images";
import { uploadSizeError } from "@/lib/order-assets";
import { cn } from "@/lib/utils";

const TYPE_OPTIONS: {
  value: FeedbackSubmitType;
  label: string;
  icon: typeof Lightbulb;
}[] = [
  { value: "bug", label: FEEDBACK_TYPE_LABELS.bug, icon: Bug },
  {
    value: "feature_request",
    label: FEEDBACK_TYPE_LABELS.feature_request,
    icon: Sparkles,
  },
  { value: "question", label: FEEDBACK_TYPE_LABELS.question, icon: HelpCircle },
  { value: "other", label: FEEDBACK_TYPE_LABELS.other, icon: MoreHorizontal },
];

type PendingImage = {
  id: string;
  file: File;
  previewUrl: string;
};

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
  const [type, setType] = useState<FeedbackSubmitType>("bug");
  const [page, setPage] = useState<string>(FEEDBACK_PAGES[0]);
  const [title, setTitle] = useState("");
  const [comment, setComment] = useState("");
  const [pending, setPending] = useState<PendingImage[]>([]);
  const [existingImages, setExistingImages] = useState<FeedbackImage[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [lightboxLabel, setLightboxLabel] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const isEdit = Boolean(editing);
  const totalImages = existingImages.length + pending.length;
  const canAddMore = totalImages < MAX_FEEDBACK_IMAGES;

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setType(
        editing.type === "improvement" ? "feature_request" : editing.type
      );
      setPage(editing.page);
      setTitle(editing.title);
      setComment(editing.comment);
      setExistingImages(editing.images ?? []);
    } else {
      setType("bug");
      setPage(FEEDBACK_PAGES[0]);
      setTitle("");
      setComment("");
      setExistingImages([]);
    }
    setPending((prev) => {
      for (const img of prev) URL.revokeObjectURL(img.previewUrl);
      return [];
    });
    setError(null);
    setSubmitting(false);
    setLightboxSrc(null);
  }, [open, editing]);

  async function handleFiles(list: FileList | File[]) {
    const room = MAX_FEEDBACK_IMAGES - existingImages.length - pending.length;
    const fileArray = Array.from(list).slice(0, room);
    if (!fileArray.length) return;

    setError(null);
    const added: PendingImage[] = [];

    for (const rawFile of fileArray) {
      if (!rawFile.type.startsWith("image/")) {
        setError("Images only (PNG, JPG, WebP, GIF)");
        break;
      }
      const rawSizeError = uploadSizeError(
        rawFile.size,
        FEEDBACK_IMAGE_RAW_MAX_BYTES
      );
      if (rawSizeError) {
        setError(rawSizeError);
        break;
      }
      const file = await compressImage(rawFile);
      const sizeError = feedbackImageSizeError(file.size);
      if (sizeError) {
        setError(sizeError);
        break;
      }
      added.push({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
      });
    }

    if (added.length) setPending((prev) => [...prev, ...added]);
    if (inputRef.current) inputRef.current.value = "";
  }

  function removePending(id: string) {
    setPending((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  }

  async function removeExisting(imageId: string) {
    if (!editing) return;
    setError(null);
    try {
      const res = await fetch(
        `/api/feedback/${editing.id}/images/${imageId}`,
        { method: "DELETE" }
      );
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to remove image");
      setExistingImages((prev) => prev.filter((img) => img.id !== imageId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove image");
    }
  }

  async function uploadPending(
    feedbackId: string,
    files: PendingImage[]
  ): Promise<FeedbackImage[]> {
    const uploaded: FeedbackImage[] = [];
    for (const img of files) {
      const fd = new FormData();
      fd.append("file", img.file, img.file.name);
      const res = await fetch(`/api/feedback/${feedbackId}/images`, {
        method: "POST",
        body: fd,
      });
      const data = (await res.json()) as {
        image?: FeedbackImage;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Failed to upload image");
      if (data.image) uploaded.push(data.image);
    }
    return uploaded;
  }

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

      let item = data.item;
      if (pending.length > 0) {
        const uploaded = await uploadPending(item.id, pending);
        for (const img of pending) URL.revokeObjectURL(img.previewUrl);
        setPending([]);
        item = {
          ...item,
          images: [...(item.images ?? existingImages), ...uploaded],
        };
      } else if (isEdit) {
        item = { ...item, images: existingImages };
      }

      onSaved(item);
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
    <>
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
            <Button type="submit" form="feedback-form" disabled={submitting}>
              {submitting
                ? "Saving…"
                : isEdit
                  ? "Save Changes"
                  : "Submit Feedback"}
            </Button>
          </>
        }
      >
        <form
          id="feedback-form"
          onSubmit={handleSubmit}
          className="space-y-4 py-2"
        >
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

          <div>
            <Label>
              Screenshots{" "}
              <span className="font-normal text-slate-400">
                (optional, {totalImages}/{MAX_FEEDBACK_IMAGES})
              </span>
            </Label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {existingImages.map((img) => (
                <div
                  key={img.id}
                  className="relative h-16 w-16 overflow-hidden rounded-md border border-slate-200 bg-slate-50"
                >
                  {img.url ? (
                    <button
                      type="button"
                      className="h-full w-full"
                      onClick={() => {
                        setLightboxSrc(img.url);
                        setLightboxLabel(img.file_name);
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img.url}
                        alt={img.file_name}
                        className="h-full w-full object-cover"
                      />
                    </button>
                  ) : (
                    <div className="flex h-full items-center justify-center text-[10px] text-slate-400">
                      Image
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => void removeExisting(img.id)}
                    className="absolute right-0.5 top-0.5 rounded bg-black/60 p-0.5 text-white hover:bg-black/80"
                    aria-label="Remove image"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {pending.map((img) => (
                <div
                  key={img.id}
                  className="relative h-16 w-16 overflow-hidden rounded-md border border-slate-200 bg-slate-50"
                >
                  <button
                    type="button"
                    className="h-full w-full"
                    onClick={() => {
                      setLightboxSrc(img.previewUrl);
                      setLightboxLabel(img.file.name);
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.previewUrl}
                      alt={img.file.name}
                      className="h-full w-full object-cover"
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => removePending(img.id)}
                    className="absolute right-0.5 top-0.5 rounded bg-black/60 p-0.5 text-white hover:bg-black/80"
                    aria-label="Remove image"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {canAddMore ? (
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="flex h-16 w-16 flex-col items-center justify-center gap-0.5 rounded-md border border-dashed border-slate-300 text-slate-500 hover:border-[var(--primary)] hover:bg-blue-50/50 hover:text-[var(--primary)]"
                  title={`Add image (${totalImages}/${MAX_FEEDBACK_IMAGES})`}
                >
                  <ImagePlus className="h-5 w-5" />
                  <span className="text-[10px]">Add</span>
                </button>
              ) : null}
            </div>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) void handleFiles(e.target.files);
              }}
            />
            <p className="mt-1 text-xs text-slate-400">
              Up to {MAX_FEEDBACK_IMAGES} images,{" "}
              {Math.round(FEEDBACK_IMAGE_MAX_BYTES / (1024 * 1024))} MB each
            </p>
          </div>

          {lastEditedLabel ? (
            <p className="text-xs text-slate-400">
              Last edited: {lastEditedLabel}
            </p>
          ) : null}

          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </form>
      </Modal>

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
