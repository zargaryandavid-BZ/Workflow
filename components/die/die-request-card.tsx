"use client";

import { useState } from "react";
import { AlertTriangle, Paperclip, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { RequiredDatePicker } from "@/components/die/required-date-picker";
import {
  dieManufacturerLabel,
  type DieManufacturer,
} from "@/lib/die-manufacturers";
import {
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

export function DieRequestCard({
  req,
  manufacturers,
  onSaved,
}: {
  req: DieRequest;
  manufacturers: DieManufacturer[];
  onSaved: (notice?: string) => void;
}) {
  const [editing, setEditing] = useState(false);
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
  const [error, setError] = useState<string | null>(null);
  const [failedImages, setFailedImages] = useState<Record<number, boolean>>({});

  const alert = dieRequestAlert(req);
  const attached = dieRequestFiles(req);
  const remaining = Math.max(0, DIE_MAX_FILES - attached.length);

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
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    setError(null);
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
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to save");
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function confirmOrder() {
    setConfirming(true);
    setError(null);
    try {
      const res = await fetch(`/api/die-requests/${req.id}/confirm`, {
        method: "POST",
      });
      const json = (await res.json()) as { error?: string; warning?: string | null };
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

  const statusTag =
    req.status === "ordered"
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
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {req.customer_name ? `${req.customer_name} · ` : null}
            {req.manufacturer_name
              ? `${req.manufacturer_name} · ${req.to_email}`
              : `Sent to ${req.to_email}`}
          </p>

            {editing ? (
            <div className="mt-3 space-y-2">
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
                <div className="w-[9.5rem] shrink-0">
                  <Label>Required date</Label>
                  <RequiredDatePicker
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
              {req.status === "quoted" || req.status === "ordered" ? (
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
                </div>
              ) : null}
              {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
            </>
          )}
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
        {!editing && req.status !== "ordered" ? (
          <button
            type="button"
            className="shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            onClick={startEdit}
            aria-label={`Edit ${req.order_title ?? "request"}`}
          >
            <Pencil className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    </li>
  );
}
