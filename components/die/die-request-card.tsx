"use client";

import { useState } from "react";
import { AlertTriangle, BellRing, Check, Copy, ExternalLink, Link2, PackageCheck, Paperclip, Pencil, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { RequiredDatePicker } from "@/components/die/required-date-picker";
import {
  dieManufacturerLabel,
  type DieManufacturer,
} from "@/lib/die-manufacturers";
import {
  DIE_REMINDER,
  dieReminderLabel,
  DIE_PAST_DATE_ERROR,
  dieTodayYmd,
  isDieDatePast,
  DIE_ALERT_CLASS,
  DIE_MAX_FILES,
  dieDateMovedDays,
  dieRequestAlert,
  dieRequestFiles,
  formatDieDateMoved,
  formatDieQuotedPrice,
  formatDieSize,
  isDieFileImage,
  type DieRequest,
} from "@/lib/die-request";
import { dispatchDieQuotedCountChanged } from "@/lib/die-nav";
import { cn, formatDate } from "@/lib/utils";
import { appOrigin } from "@/lib/app-url";

function formatRequestTime(value: string): { date: string; time: string } {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: value, time: "" };
  return {
    date: date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "America/Los_Angeles",
    }),
    time: date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/Los_Angeles",
    }),
  };
}

function DieRequestHistory({ req }: { req: DieRequest }) {
  const stages = [
    {
      label: "Created",
      at: req.created_at,
      detail: `Request created for ${req.order_title ?? "order"}.`,
    },
    {
      label: "Sent to manufacturer",
      at: req.sent_at,
      detail: `Sent to ${req.manufacturer_name ?? req.to_email}.`,
    },
    {
      label: "Priced",
      at: req.quoted_at,
      detail:
        req.quoted_at && req.quoted_price != null
          ? `${formatDieQuotedPrice(req.quoted_price)}${
              req.time_estimate ? ` · ${req.time_estimate}` : ""
            }`
          : null,
    },
    {
      label: "Confirmed",
      at: req.ordered_at,
      detail: req.ordered_at ? "Final order sent to the manufacturer." : null,
    },
    {
      label: "Received",
      at: req.received_at,
      detail: req.received_at ? "Die received by the shop." : null,
    },
  ];

  return (
    <ol className="space-y-0 py-4">
      {stages.map((stage, index) => {
        const when = stage.at ? formatRequestTime(stage.at) : null;
        const complete = Boolean(stage.at);
        return (
          <li key={stage.label} className="relative flex gap-3 pb-5 last:pb-0">
            {index < stages.length - 1 ? (
              <span className="absolute left-[7px] top-4 h-full w-px bg-slate-200" />
            ) : null}
            <span
              className={cn(
                "relative mt-1 h-4 w-4 shrink-0 rounded-full border-2",
                complete
                  ? "border-blue-600 bg-blue-600"
                  : "border-slate-300 bg-white"
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p
                  className={cn(
                    "font-semibold",
                    complete ? "text-slate-900" : "text-slate-400"
                  )}
                >
                  {stage.label}
                </p>
                <p className="text-xs text-slate-500">
                  {when ? `${when.date} · ${when.time}` : "Pending"}
                </p>
              </div>
              {stage.detail ? (
                <p className="mt-0.5 text-sm text-slate-600">{stage.detail}</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function DieRequestCard({
  req,
  dieCode = null,
  manufacturers,
  onEditDie,
  onSaved,
}: {
  req: DieRequest;
  /** Template ID of the die this request is for. */
  dieCode?: string | null;
  manufacturers: DieManufacturer[];
  onEditDie?: () => void;
  onSaved: (notice?: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editTab, setEditTab] = useState<"details" | "history">("details");
  const [width, setWidth] = useState(req.width != null ? String(req.width) : "");
  const [height, setHeight] = useState(
    req.height != null ? String(req.height) : ""
  );
  const [depth, setDepth] = useState(req.depth != null ? String(req.depth) : "");
  const [productName, setProductName] = useState(req.product_name ?? "");
  const [requiredDate, setRequiredDate] = useState(req.required_date);
  const [manufacturerId, setManufacturerId] = useState(
    req.manufacturer_id ?? manufacturers[0]?.id ?? ""
  );
  const [comment, setComment] = useState(req.comment ?? "");
  const [allowOwnDate, setAllowOwnDate] = useState(req.allow_own_date);
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reminding, setReminding] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedImages, setFailedImages] = useState<Record<number, boolean>>({});

  const alert = dieRequestAlert(req);
  const attached = dieRequestFiles(req);
  const remaining = Math.max(0, DIE_MAX_FILES - attached.length);
  const requestedAt = formatRequestTime(req.sent_at);

  function startEdit() {
    setWidth(req.width != null ? String(req.width) : "");
    setHeight(req.height != null ? String(req.height) : "");
    setDepth(req.depth != null ? String(req.depth) : "");
    setProductName(req.product_name ?? "");
    setRequiredDate(req.required_date);
    setManufacturerId(req.manufacturer_id ?? manufacturers[0]?.id ?? "");
    setComment(req.comment ?? "");
    setAllowOwnDate(req.allow_own_date);
    setFiles([]);
    setError(null);
    setEditTab("details");
    setEditing(true);
  }

  async function save() {
    setError(null);
    // An older request keeps its date; only a changed date must be today or later.
    if (requiredDate !== req.required_date && isDieDatePast(requiredDate)) {
      setError(`Required date is in the past. ${DIE_PAST_DATE_ERROR}`);
      return;
    }
    setSaving(true);
    try {
      const form = new FormData();
      form.set("manufacturerId", manufacturerId);
      form.set("productName", productName);
      form.set("width", width);
      form.set("height", height);
      form.set("depth", depth);
      form.set("requiredDate", requiredDate);
      form.set("allowOwnDate", allowOwnDate ? "true" : "false");
      form.set("comment", comment);
      for (const f of files) form.append("files", f);
      const res = await fetch(`/api/die-requests/${req.id}`, {
        method: "PATCH",
        body: form,
      });
      const json = (await res.json()) as {
        error?: string;
        resent?: boolean;
        warning?: string | null;
      };
      if (!res.ok) throw new Error(json.error ?? "Failed to save");
      setEditing(false);
      onSaved(
        json.resent
          ? json.warning
            ? `Saved, but the new manufacturer wasn't reached: ${json.warning}`
            : "Moved to the new manufacturer and sent them the quote link. The old link no longer works."
          : undefined
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function remindNow() {
    setReminding(true);
    setError(null);
    try {
      const res = await fetch(`/api/die-requests/${req.id}/remind`, { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as { error?: string; warning?: string | null };
      if (!res.ok) throw new Error(json.error ?? "Failed to send the reminder");
      onSaved(
        json.warning
          ? `Reminder saved, but it didn't go out: ${json.warning}`
          : `Reminder sent to ${req.manufacturer_name ?? req.to_email}.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send the reminder");
    } finally {
      setReminding(false);
    }
  }

  async function cancelRequest() {
    const ok = window.confirm(
      `Cancel this die request${req.order_title ? ` for ${req.order_title}` : ""}? ` +
        "The manufacturer's link stops working. A new die that was only on order is deleted too."
    );
    if (!ok) return;
    setCancelling(true);
    setError(null);
    try {
      const res = await fetch(`/api/die-requests/${req.id}/cancel`, { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as { error?: string; dieDeleted?: boolean };
      if (!res.ok) throw new Error(json.error ?? "Failed to cancel");
      dispatchDieQuotedCountChanged();
      onSaved(
        json.dieDeleted
          ? `Request cancelled. ${dieCode ?? "The die"} was only on order, so it was deleted too.`
          : "Request cancelled."
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel");
    } finally {
      setCancelling(false);
    }
  }

  async function confirmOrder() {
    setConfirming(true);
    setError(null);
    try {
      const res = await fetch(`/api/die-requests/${req.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The quote on screen; the server refuses if it changed since.
        body: JSON.stringify({ quoted_at: req.quoted_at }),
      });
      const json = (await res.json()) as { error?: string; warning?: string | null };
      if (res.status === 409) {
        // Already confirmed, or the quote changed: reload to show what's true now.
        onSaved(json.error ?? "This request changed. Check it again.");
        return;
      }
      if (!res.ok) throw new Error(json.error ?? "Failed to confirm");
      dispatchDieQuotedCountChanged();
      onSaved(
        json.warning
          ? `Final request saved, but notify failed: ${json.warning}`
          : "Final request sent to the manufacturer."
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to confirm");
    } finally {
      setConfirming(false);
    }
  }

  async function markReceived(undo: boolean) {
    setReceiving(true);
    setError(null);
    try {
      const res = await fetch(`/api/die-requests/${req.id}/received`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ undo }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to update");
      onSaved(
        undo
          ? `${req.order_title ?? "Die"} is back to ordered.`
          : `${req.order_title ?? "Die"} marked as received.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setReceiving(false);
    }
  }

  const statusTag =
    req.status === "received"
      ? {
          label: "Received",
          className: "bg-emerald-100 text-emerald-800",
        }
      : req.status === "ordered"
      ? {
          label: "Ordered",
          className: "bg-blue-100 text-blue-800",
        }
      : req.status === "quoted"
        ? {
            label: "Quoted",
            className: "bg-emerald-100 text-emerald-800",
          }
        : {
            label: "Waiting",
            className: "bg-amber-100 text-amber-800",
          };

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-2">
            <span className="truncate font-semibold text-slate-800">
              {req.order_title ?? "Order"}
            </span>
            {dieCode ? (
              <span className="shrink-0 rounded border border-slate-200 px-1.5 py-px font-mono text-[11px] font-semibold text-slate-600">
                {dieCode}
              </span>
            ) : null}
            {alert ? (
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                  DIE_ALERT_CLASS[alert.level]
                )}
              >
                <AlertTriangle className="h-3 w-3" />
                {alert.label}
              </span>
            ) : (
              <span
                className={cn(
                  "inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                  statusTag.className
                )}
              >
                {statusTag.label}
              </span>
            )}
            <ManufacturerLink token={req.token} />
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {req.customer_name ? `${req.customer_name} · ` : null}
            {req.manufacturer_name
              ? `${req.manufacturer_name} · ${req.to_email}`
              : `Sent to ${req.to_email}`}
            {req.status === "sent" ? (
              <>
                {dieReminderLabel(req) ? (
                  <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-px font-semibold text-amber-800">
                    <BellRing className="h-3 w-3" />
                    {dieReminderLabel(req)}
                    {req.last_reminder_at ? ` · last ${formatDate(req.last_reminder_at.slice(0, 10))}` : ""}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => void remindNow()}
                  disabled={reminding}
                  className="ml-2 inline-flex items-center gap-1 rounded border border-slate-200 px-1.5 py-px font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  title={`Email + text the manufacturer the quote link again. Automatic reminders: after ${DIE_REMINDER.afterDays} days, then every ${DIE_REMINDER.everyDays} days, ${DIE_REMINDER.max} at most.`}
                >
                  <BellRing className="h-3 w-3" />
                  {reminding ? "Sending…" : "Remind now"}
                </button>
              </>
            ) : null}
          </p>

          {editing ? (
            <Modal
              open
              fitViewport
              className="max-w-2xl"
              title={`Edit die request — ${req.order_title ?? "Order"}`}
              onClose={() => setEditing(false)}
            >
            <div className="flex border-b border-slate-200 pt-2" role="tablist">
              {(["details", "history"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={editTab === tab}
                  onClick={() => setEditTab(tab)}
                  className={cn(
                    "-mb-px border-b-2 px-4 py-2 text-sm font-semibold capitalize",
                    editTab === tab
                      ? "border-blue-600 text-blue-700"
                      : "border-transparent text-slate-500 hover:text-slate-800"
                  )}
                >
                  {tab}
                </button>
              ))}
            </div>
            <div
              className={cn(
                "space-y-3 py-3",
                editTab !== "details" && "hidden"
              )}
            >
              {attached.length > 0 ? (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Attached files
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {attached.map((file, i) => {
                      const url = `/api/die/${req.token}/file?i=${i}`;
                      return isDieFileImage(file) && !failedImages[i] ? (
                        <a
                          key={`${file.path}-${i}`}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="block"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`${url}&preview=1`}
                            alt={file.name}
                            className="h-24 w-24 rounded-md border border-slate-200 object-cover"
                            onError={() =>
                              setFailedImages((prev) => ({
                                ...prev,
                                [i]: true,
                              }))
                            }
                          />
                        </a>
                      ) : (
                        <a
                          key={`${file.path}-${i}`}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex max-w-64 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-slate-100"
                        >
                          <Paperclip className="h-4 w-4 shrink-0" />
                          <span className="truncate">{file.name}</span>
                        </a>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <p className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">
                  No files are attached to this request.
                </p>
              )}
              <div className="flex min-w-0 flex-wrap items-end gap-2">
                <div className="min-w-[8rem] w-[11rem] shrink-0">
                  <Label htmlFor={`edit-product-${req.id}`}>Product</Label>
                  <Input
                    id={`edit-product-${req.id}`}
                    className="mt-1.5"
                    value={productName}
                    onChange={(e) => setProductName(e.target.value)}
                  />
                </div>
                <div className="w-[5.5rem] shrink-0">
                  <Label htmlFor={`edit-x-${req.id}`}>Width (X)</Label>
                  <Input
                    id={`edit-x-${req.id}`}
                    className="mt-1.5"
                    type="number"
                    min="0"
                    step="0.001"
                    value={width}
                    onChange={(e) => setWidth(e.target.value)}
                  />
                </div>
                <div className="w-[5.5rem] shrink-0">
                  <Label htmlFor={`edit-y-${req.id}`}>Height (Y)</Label>
                  <Input
                    id={`edit-y-${req.id}`}
                    className="mt-1.5"
                    type="number"
                    min="0"
                    step="0.001"
                    value={height}
                    onChange={(e) => setHeight(e.target.value)}
                  />
                </div>
                <div className="w-[5.5rem] shrink-0">
                  <Label htmlFor={`edit-z-${req.id}`}>Depth (Z)</Label>
                  <Input
                    id={`edit-z-${req.id}`}
                    className="mt-1.5"
                    type="number"
                    min="0"
                    step="0.001"
                    value={depth}
                    onChange={(e) => setDepth(e.target.value)}
                  />
                </div>
                <div className="w-[10.5rem] shrink-0">
                  <Label>Required date</Label>
                  <RequiredDatePicker
                    minDate={dieTodayYmd()}
                    value={requiredDate}
                    dueDate={req.order_due_date}
                    dueLabel="Order due"
                    selectedLabel="Required date"
                    onChange={setRequiredDate}
                  />
                </div>
                <div className="w-[6.75rem] shrink-0">
                  <Label htmlFor={`edit-own-date-${req.id}`}>Own date</Label>
                  <label
                    htmlFor={`edit-own-date-${req.id}`}
                    className="mt-1.5 flex h-10 cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700"
                    title="Allow the manufacturer to offer their own due date"
                  >
                    <input
                      id={`edit-own-date-${req.id}`}
                      type="checkbox"
                      className="h-4 w-4 accent-blue-600"
                      checked={allowOwnDate}
                      onChange={(e) => setAllowOwnDate(e.target.checked)}
                    />
                    Allow
                  </label>
                </div>
                <div className="w-[13.7rem] shrink-0">
                  <Label htmlFor={`edit-mfg-${req.id}`}>Die manufacturer</Label>
                  <Select
                    id={`edit-mfg-${req.id}`}
                    className="mt-1.5"
                    value={manufacturerId}
                    onChange={(e) => setManufacturerId(e.target.value)}
                  >
                    {manufacturers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {dieManufacturerLabel(m)}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="min-w-[8rem] flex-[2]">
                  <Label htmlFor={`edit-comment-${req.id}`}>Comment</Label>
                  <Input
                    id={`edit-comment-${req.id}`}
                    className="mt-1.5"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                  />
                </div>
                <div className="w-[8.5rem] shrink-0">
                  <Label htmlFor={`edit-file-${req.id}`}>
                    Files ({attached.length + files.length}/{DIE_MAX_FILES})
                  </Label>
                  <label
                    htmlFor={`edit-file-${req.id}`}
                    className="mt-1.5 flex h-10 cursor-pointer items-center truncate rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-600 hover:bg-slate-50"
                  >
                    <Paperclip className="mr-1 h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">
                      {files.length
                        ? `${files.length} new`
                        : remaining
                          ? "Add"
                          : "Full"}
                    </span>
                  </label>
                  <input
                    id={`edit-file-${req.id}`}
                    className="sr-only"
                    type="file"
                    multiple
                    disabled={remaining === 0}
                    onChange={(e) => {
                      const next = [
                        ...files,
                        ...Array.from(e.target.files ?? []),
                      ].slice(0, remaining);
                      setFiles(next);
                      e.target.value = "";
                    }}
                  />
                </div>
                <Button
                  type="button"
                  className="shrink-0"
                  onClick={() => void save()}
                  disabled={saving}
                >
                  {saving ? "Saving…" : "Save"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="shrink-0"
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </Button>
              </div>
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
            </div>
            {editTab === "history" ? <DieRequestHistory req={req} /> : null}
            </Modal>
          ) : (
            <>
              <p className="mt-2 text-slate-600">
                {req.product_name ? `${req.product_name} · ` : null}
                {formatDieSize(req.width, req.height, req.depth)}
                {" · required "}
                {formatDate(req.required_date)}
                {req.allow_own_date ? " · own date allowed" : ""}
              </p>
              {attached.length > 0 ? (
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-slate-600">
                  {attached.map((file, i) => (
                    <a
                      key={`${file.path}-${i}`}
                      href={`/api/die/${req.token}/file?i=${i}`}
                      className="inline-flex items-center gap-1 underline-offset-2 hover:text-slate-900 hover:underline"
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Paperclip className="h-3 w-3" />
                      {file.name}
                    </a>
                  ))}
                </p>
              ) : null}
              {req.comment ? (
                <p className="mt-1 text-sm text-slate-600">
                  Comment: {req.comment}
                </p>
              ) : null}
              {req.status === "quoted" ||
              req.status === "ordered" ||
              req.status === "received" ? (
                <div className="mt-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-slate-800">
                  <p>
                    Price {formatDieQuotedPrice(req.quoted_price)}
                    {" · "}
                    {req.time_estimate ?? "—"}
                    {" · required "}
                    {formatDate(req.required_date)}
                    {" → confirmed "}
                    {formatDate(req.confirmed_due_date)}
                    {req.confirmed_due_date
                      ? ` (${formatDieDateMoved(
                          dieDateMovedDays(
                            req.required_date,
                            req.confirmed_due_date
                          )
                        )})`
                      : ""}
                  </p>
                  {req.client_note?.trim() ? (
                    <p className="mt-1 text-slate-700">
                      Manufacturer note: {req.client_note.trim()}
                    </p>
                  ) : null}
                  {req.status === "quoted" ? (
                    <Button
                      type="button"
                      className="mt-2"
                      onClick={() => void confirmOrder()}
                      disabled={confirming}
                    >
                      {confirming
                        ? "Sending…"
                        : "Confirm & send final request"}
                    </Button>
                  ) : (
                    <p className="mt-1 text-xs font-medium text-blue-800">
                      Final request sent
                      {req.ordered_at
                        ? ` · ${formatDate(req.ordered_at.slice(0, 10))}`
                        : ""}
                    </p>
                  )}
                  {req.status === "ordered" ? (
                    <Button
                      type="button"
                      className="mt-2 inline-flex items-center gap-1.5"
                      onClick={() => void markReceived(false)}
                      disabled={receiving}
                    >
                      <PackageCheck className="h-4 w-4" />
                      {receiving ? "Saving…" : "Mark die received"}
                    </Button>
                  ) : null}
                  {req.status === "received" ? (
                    <p className="mt-2 flex flex-wrap items-center gap-2 text-sm font-semibold text-emerald-800">
                      <PackageCheck className="h-4 w-4" />
                      Die received
                      {req.received_at
                        ? ` · ${formatDate(req.received_at.slice(0, 10))}`
                        : ""}
                      <button
                        type="button"
                        className="text-xs font-medium text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline disabled:opacity-50"
                        onClick={() => void markReceived(true)}
                        disabled={receiving}
                      >
                        Undo
                      </button>
                    </p>
                  ) : null}
                </div>
              ) : null}
              {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
            </>
          )}
        </div>
        <div className="shrink-0 text-right text-[11px] leading-tight text-slate-500">
          <p className="font-semibold uppercase tracking-wide text-slate-400">
            Requested
          </p>
          <p className="mt-1 whitespace-nowrap">{requestedAt.date}</p>
          {requestedAt.time ? (
            <p className="mt-0.5 whitespace-nowrap">{requestedAt.time}</p>
          ) : null}
        </div>
        {attached.length > 0 ? (
          <div className="flex shrink-0 flex-wrap justify-end gap-1">
            {attached.map((file, i) => {
              const url = `/api/die/${req.token}/file?i=${i}`;
              if (!isDieFileImage(file) || failedImages[i]) {
                return (
                  <a
                    key={`${file.path}-${i}`}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex h-20 w-20 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-500"
                    title={file.name}
                  >
                    <Paperclip className="h-4 w-4" />
                  </a>
                );
              }
              return (
                <a
                  key={`${file.path}-${i}`}
                  href={`${url}&preview=1`}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`${url}&preview=1`}
                    alt={file.name}
                    className="h-20 w-20 rounded-md border border-slate-200 object-cover"
                    onError={() =>
                      setFailedImages((prev) => ({ ...prev, [i]: true }))
                    }
                  />
                </a>
              );
            })}
          </div>
        ) : null}
        {!editing && req.status !== "ordered" && req.status !== "received" ? (
          <button
            type="button"
            className="shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            onClick={onEditDie ?? startEdit}
            aria-label={`Edit ${req.order_title ?? "request"}`}
          >
            <Pencil className="h-4 w-4" />
          </button>
        ) : null}
        {!editing && (req.status === "sent" || req.status === "quoted") ? (
          <button
            type="button"
            className="shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
            onClick={() => void cancelRequest()}
            disabled={cancelling}
            aria-label={`Cancel request ${req.order_title ?? ""}`}
            title="Cancel request"
          >
            <XCircle className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    </li>
  );
}

/**
 * The quote page link emailed / texted to the manufacturer (/die/<token>),
 * so staff can open it or send it again by hand.
 */
function ManufacturerLink({ token }: { token: string }) {
  const [copied, setCopied] = useState<"ok" | "manual" | null>(null);
  const path = `/die/${token}`;
  // Same public site the email / text uses (never localhost).
  const url = `${appOrigin()}${path}`;

  async function copy() {
    try {
      await Promise.race([
        navigator.clipboard.writeText(url),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 1500)),
      ]);
      setCopied("ok");
    } catch {
      // No clipboard access: show the link selected so it can be copied by hand.
      setCopied("manual");
    }
    setTimeout(() => setCopied(null), 4000);
  }

  return (
    <span className="ml-1 inline-flex min-w-0 items-center gap-x-2 text-xs font-normal">
      <span className="inline-flex items-center gap-1 font-semibold text-slate-600">
        <Link2 className="h-3.5 w-3.5" /> Manufacturer link:
      </span>
      {copied === "manual" ? (
        <input
          readOnly
          autoFocus
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="h-6 min-w-0 flex-1 rounded border border-slate-300 px-1.5 font-mono text-[11px] text-slate-700"
          aria-label="Manufacturer link"
        />
      ) : (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-w-0 max-w-full items-center gap-1 truncate font-mono text-[11px] text-blue-700 hover:underline"
          title="Open the page the manufacturer sees"
        >
          <span className="truncate">{url}</span>
          <ExternalLink className="h-3 w-3 shrink-0" />
        </a>
      )}
      <button
        type="button"
        onClick={() => void copy()}
        className="inline-flex items-center gap-1 rounded border border-slate-200 px-1.5 py-0.5 font-semibold text-slate-600 hover:bg-slate-50"
      >
        {copied === "ok" ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
        {copied === "ok" ? "Copied" : "Copy"}
      </button>
    </span>
  );
}
