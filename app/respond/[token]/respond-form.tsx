"use client";

import { useRef, useState } from "react";
import {
  Check,
  CheckCircle2,
  CloudUpload,
  Paperclip,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/input";
import {
  RESPOND_ACCEPT,
  RESPOND_MAX_BYTES,
  formatFileSize,
  type OrderMetaChip,
} from "@/lib/respond-page";
import type { CustomerResponse, NotificationType } from "@/lib/types";

interface Props {
  token: string;
  type: NotificationType;
  productLabel?: string;
  orderNumber?: string;
  staffNote?: string | null;
  metaChips?: OrderMetaChip[];
  tenantName?: string;
  orderReview?: React.ReactNode;
}

export function RespondForm({
  token,
  type,
  productLabel,
  orderNumber,
  staffNote,
  metaChips = [],
  tenantName,
  orderReview,
}: Props) {
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [doneKind, setDoneKind] = useState<
    "approved" | "rejected" | "info" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canSend = note.trim().length > 0 || pendingFiles.length > 0;

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setError(null);
    const next: File[] = [];
    for (const file of Array.from(list)) {
      if (file.size > RESPOND_MAX_BYTES) {
        setError(`${file.name} is larger than 50MB.`);
        continue;
      }
      next.push(file);
    }
    if (next.length > 0) {
      setPendingFiles((prev) => [...prev, ...next]);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeFile(index: number) {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function respond(response: CustomerResponse) {
    if (type === "missing_info" && response === "info_submitted" && !canSend) {
      setError("Please attach a file or leave a comment before sending.");
      return;
    }

    setError(null);
    setLoading(true);

    try {
      for (const file of pendingFiles) {
        const form = new FormData();
        form.append("file", file);
        form.append("token", token);
        const uploadRes = await fetch("/api/notifications/upload", {
          method: "POST",
          body: form,
        });
        const uploadJson = await uploadRes.json();
        if (!uploadRes.ok) {
          throw new Error(uploadJson.error ?? `Failed to upload ${file.name}`);
        }
      }

      const res = await fetch("/api/notifications/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          response,
          note: note.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error ?? "Something went wrong");
      }
      setDone(true);
      if (type === "customer_approval") {
        setDoneKind(
          response === "approved" ? "approved" : "rejected"
        );
      } else {
        setDoneKind("info");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    const approvalDone =
      type === "customer_approval" && doneKind === "approved";
    const rejectionDone =
      type === "customer_approval" && doneKind === "rejected";

    return (
      <div className="rounded-lg bg-emerald-50 p-6 text-center text-emerald-900">
        <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
        <h2 className="mt-3 text-lg font-semibold">
          {approvalDone
            ? "Thank you!"
            : rejectionDone
              ? "Feedback received"
              : type === "ready_to_ship"
                ? "Got it!"
                : "Response received!"}
        </h2>
        <p className="mt-2 text-sm text-emerald-800">
          {approvalDone
            ? "Your approval has been recorded. We'll get started right away."
            : rejectionDone
              ? "Thank you for your feedback. Our team will be in touch shortly."
              : type === "ready_to_ship"
                ? "You're all set. Contact us anytime to arrange pickup or delivery. You can close this page."
                : `Thank you — the ${tenantName ?? "team"} has been notified and will review your response shortly. You can close this page.`}
        </p>
      </div>
    );
  }

  if (type === "customer_approval") {
    return (
      <div className="space-y-5">
        <p className="text-sm leading-relaxed text-slate-600">
          Your print proof is ready for review.
        </p>

        {orderReview}

        {!orderReview && metaChips.length > 0 ? (
          <div className="grid grid-cols-2 gap-2">
            {metaChips.map((chip) => (
              <div
                key={chip.label}
                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
              >
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  {chip.label}
                </p>
                <p className="mt-0.5 text-sm font-medium text-slate-800">
                  {chip.value}
                </p>
              </div>
            ))}
          </div>
        ) : null}

        {staffNote?.trim() ? (
          <div className="rounded-r-lg border-l-[3px] border-[#1d4ed8] bg-[#f0f9ff] px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#1d4ed8]">
              Note from our team
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
              {staffNote.trim()}
            </p>
          </div>
        ) : null}

        <p className="text-sm font-medium text-slate-700">
          Please review and confirm below:
        </p>
        <div>
          <Label htmlFor="approval-comment">Comment</Label>
          <Textarea
            id="approval-comment"
            className="mt-1.5"
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              setError(null);
            }}
            placeholder="Optional note — required if not approving"
            rows={4}
          />
        </div>
        {error ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        ) : null}
        <div className="flex gap-3">
          <Button
            className="flex-1"
            onClick={() => respond("approved")}
            disabled={loading}
          >
            <Check className="h-4 w-4" /> Approve
          </Button>
          <Button
            variant="danger"
            className="flex-1"
            onClick={() => {
              if (!note.trim()) {
                setError("Please tell us why the proof was not approved.");
                return;
              }
              respond("changes_requested");
            }}
            disabled={loading}
          >
            <X className="h-4 w-4" /> Not Approved
          </Button>
        </div>
      </div>
    );
  }

  if (type === "ready_to_ship") {
    return (
      <div className="space-y-5">
        <p className="text-sm leading-relaxed text-slate-600">
          Great news — your order is ready for pickup or delivery.
        </p>

        {orderReview}

        {!orderReview && metaChips.length > 0 ? (
          <div className="grid grid-cols-2 gap-2">
            {metaChips.map((chip) => (
              <div
                key={chip.label}
                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
              >
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  {chip.label}
                </p>
                <p className="mt-0.5 text-sm font-medium text-slate-800">
                  {chip.value}
                </p>
              </div>
            ))}
          </div>
        ) : null}

        {staffNote?.trim() ? (
          <div className="rounded-r-lg border-l-[3px] border-emerald-600 bg-emerald-50 px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
              Note from our team
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
              {staffNote.trim()}
            </p>
          </div>
        ) : null}

        <p className="text-sm leading-relaxed text-slate-600">
          Pickup is available at 306 Boyd St, LA — Mon–Fri 9:30 AM–5:30 PM,
          Saturday until 4:00 PM. Please contact us to arrange pickup or
          delivery.
        </p>

        {error ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        ) : null}

        <Button
          className="w-full"
          onClick={() => respond("info_submitted")}
          disabled={loading}
        >
          <Check className="h-4 w-4" /> Got it
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {orderReview}

      {!orderReview && metaChips.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          {metaChips.map((chip) => (
            <div
              key={chip.label}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
            >
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                {chip.label}
              </p>
              <p className="mt-0.5 text-sm font-medium text-slate-800">
                {chip.value}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      <p className="text-sm leading-relaxed text-slate-600">
        We need more information for your {productLabel ?? "order"}
        {orderNumber ? ` ${orderNumber}` : ""} before we can proceed.
        {" "}Please see the note from our team below, then attach your file or
        leave a reply.
      </p>

      {staffNote?.trim() ? (
        <div className="rounded-r-lg border-l-[3px] border-[#1d4ed8] bg-[#f0f9ff] px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#1d4ed8]">
            Note from our team
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
            {staffNote.trim()}
          </p>
        </div>
      ) : null}

      <div>
        <Label className="mb-1.5 block text-sm font-medium text-slate-700">
          Attach a file
        </Label>
        <input
          ref={fileInputRef}
          type="file"
          accept={RESPOND_ACCEPT}
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />

        {pendingFiles.length > 0 ? (
          <ul className="mb-2 space-y-1.5">
            {pendingFiles.map((file, index) => (
              <li
                key={`${file.name}-${index}`}
                className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm text-slate-700"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <span className="truncate">{file.name}</span>
                  <span className="shrink-0 text-xs text-slate-400">
                    {formatFileSize(file.size)}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => removeFile(index)}
                  className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
                  aria-label={`Remove ${file.name}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            addFiles(e.dataTransfer.files);
          }}
          disabled={loading}
          className={`flex w-full items-center gap-2.5 rounded-lg border border-dashed px-3 py-2.5 text-left text-sm transition-colors disabled:opacity-60 ${
            dragOver
              ? "border-[#1d4ed8] bg-[#f0f9ff] text-[#1d4ed8]"
              : "border-slate-300 bg-slate-50 text-slate-500 hover:border-[#1d4ed8] hover:bg-[#f0f9ff]"
          }`}
        >
          <CloudUpload className="h-4 w-4 shrink-0" />
          <span className="min-w-0">
            <span className="block text-slate-600">
              {pendingFiles.length > 0
                ? "Add another file"
                : "Drag & drop or click to upload"}
            </span>
            <span className="text-xs text-slate-400">
              PDF, AI, EPS, PNG, JPG · Max 50MB
            </span>
          </span>
        </button>
      </div>

      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-slate-200" />
        <span className="text-xs text-slate-400">or leave a comment</span>
        <div className="h-px flex-1 bg-slate-200" />
      </div>

      <div>
        <Label
          htmlFor="reply-note"
          className="mb-2 block text-sm font-medium text-slate-700"
        >
          Your reply / comment
        </Label>
        <Textarea
          id="reply-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. 'Sending the file tomorrow morning.' or 'Please use the logo from our last order.'"
          rows={3}
          className="min-h-[80px]"
        />
      </div>

      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => respond("info_submitted")}
        disabled={loading || !canSend}
        className="w-full rounded-lg bg-[#1d4ed8] px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:bg-[#1e40af] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "Sending…" : "Send reply"}
      </button>
    </div>
  );
}
