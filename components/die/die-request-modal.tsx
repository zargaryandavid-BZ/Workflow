"use client";

import { useState } from "react";
import { Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { DieOrderPicker } from "@/components/die/die-order-picker";
import { RequiredDatePicker } from "@/components/die/required-date-picker";
import { formatShortOrderNumber } from "@/lib/board-order-filters";
import { dieManufacturerLabel, type DieManufacturer } from "@/lib/die-manufacturers";
import {
  DIE_PAST_DATE_ERROR,
  dieTodayYmd,
  isDieDatePast, DIE_MAX_FILES } from "@/lib/die-request";
import { DIE_TYPE_LABEL, type Die } from "@/lib/dies";
import { formatDate } from "@/lib/utils";

/**
 * Send a quote request for a die to a manufacturer (same request flow as
 * before: email + text with the manufacturer's quote link).
 */
export function DieRequestModal({
  die,
  manufacturers,
  onClose,
  onSent,
}: {
  die: Die;
  manufacturers: DieManufacturer[];
  onClose: () => void;
  onSent: (notice: string) => void;
}) {
  const [orderId, setOrderId] = useState<string | null>(die.order_id);
  const [orderDue, setOrderDue] = useState<string | null>(null);
  const [productName, setProductName] = useState(die.name);
  const [width, setWidth] = useState(die.length != null ? String(die.length) : "");
  const [height, setHeight] = useState(die.width != null ? String(die.width) : "");
  const [depth, setDepth] = useState(die.height != null ? String(die.height) : "");
  const [requiredDate, setRequiredDate] = useState("");
  const [allowOwnDate, setAllowOwnDate] = useState(false);
  // Reorder goes to the die's own manufacturer by default.
  const [manufacturerId, setManufacturerId] = useState(
    (die.manufacturer_id && manufacturers.some((m) => m.id === die.manufacturer_id)
      ? die.manufacturer_id
      : manufacturers[0]?.id) ?? ""
  );
  const manufacturerName =
    manufacturers.find((m) => m.id === manufacturerId)?.full_name ?? "the manufacturer";
  const [orderLabel, setOrderLabel] = useState<string | null>(
    die.order_title ? formatShortOrderNumber(die.order_title) : null
  );
  // Second step: "Send this reorder?" before anything goes out.
  const [reviewing, setReviewing] = useState(false);
  const [comment, setComment] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function validate(): string | null {
    if (!orderId) return "Pick the order this die is for.";
    if (!requiredDate) return "Pick a required date.";
    if (isDieDatePast(requiredDate)) return `Required date is in the past. ${DIE_PAST_DATE_ERROR}`;
    if (!manufacturerId) return "Add a die manufacturer first (Manufacturers tab).";
    return null;
  }

  function review() {
    const problem = validate();
    setError(problem);
    if (!problem) setReviewing(true);
  }

  async function send() {
    setError(null);
    const problem = validate();
    if (problem) {
      setReviewing(false);
      return setError(problem);
    }
    setSending(true);
    try {
      const form = new FormData();
      form.set("orderId", orderId!);
      form.set("dieId", die.id);
      form.set("manufacturerId", manufacturerId);
      form.set("productName", productName);
      form.set("width", width);
      form.set("height", height);
      form.set("depth", depth);
      form.set("requiredDate", requiredDate);
      form.set("allowOwnDate", allowOwnDate ? "true" : "false");
      form.set("comment", comment);
      for (const f of files) form.append("files", f);
      const res = await fetch("/api/die-requests", { method: "POST", body: form });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        warning?: string | null;
      };
      if (!res.ok) throw new Error(json.error ?? "Failed to send");
      // Stamp the die's Ordered date + a "Reordered" history line.
      await fetch(`/api/dies/${die.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reorder: true }),
      }).catch(() => null);
      onSent(
        json.warning
          ? `Reorder saved, but the message didn't go out: ${json.warning}`
          : `Reorder for ${die.template_code} sent to ${manufacturerName}. It's on the Requests tab.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setSending(false);
    }
  }

  const sizeInputs = [
    ["Width (X)", width, setWidth],
    ["Height (Y)", height, setHeight],
    ["Depth (Z)", depth, setDepth],
  ] as const;

  return (
    <Modal
      open
      fitViewport
      onClose={onClose}
      className="max-w-2xl"
      title={
        <span>
          Reorder · {die.name}
          <span className="ml-2 font-mono text-xs font-medium text-slate-500">
            {die.template_code} · {DIE_TYPE_LABEL[die.die_type]}
          </span>
        </span>
      }
      footer={
        <>
          <span />
          {reviewing ? (
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={() => setReviewing(false)} disabled={sending}>
                Back
              </Button>
              <Button type="button" onClick={() => void send()} disabled={sending}>
                {sending ? "Sending…" : "Yes, send reorder"}
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button type="button" onClick={review} disabled={manufacturers.length === 0}>
                Review reorder
              </Button>
            </div>
          )}
        </>
      }
    >
      {reviewing ? (
        <div className="space-y-3 py-4">
          <p className="text-base font-semibold text-slate-900">Send this reorder?</p>
          <dl className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-slate-50 text-sm">
            {[
              ["Die", `${die.template_code} · ${productName || die.name}`],
              ["Manufacturer", manufacturerName],
              ["Order", orderLabel],
              ["Needed by", requiredDate ? formatDate(requiredDate) : null],
              ["Size", [width, height, depth].filter((v) => Number(v) > 0).join(" × ") || null],
              ["Own date", allowOwnDate ? "Manufacturer may offer their own date" : null],
              ["Files", files.length ? files.map((f) => f.name).join(", ") : null],
              ["Comment", comment.trim() || null],
            ]
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 px-3 py-2">
                  <dt className="text-slate-500">{k}</dt>
                  <dd className="text-right font-medium text-slate-900">{v}</dd>
                </div>
              ))}
          </dl>
          <p className="text-sm text-slate-600">
            {manufacturerName} gets an email and a text with the quote link
            {die.has_pdf ? " and the die PDF" : ""}. You can cancel it from the Requests tab until it&apos;s confirmed.
          </p>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </div>
      ) : (
      <div className="space-y-4 py-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="req-order">Order *</Label>
            <DieOrderPicker
              id="req-order"
              initialText={die.order_title ? formatShortOrderNumber(die.order_title) : ""}
              onClear={() => {
                setOrderId(null);
                setOrderLabel(null);
              }}
              onPick={(hit) => {
                setOrderId(hit.id);
                setOrderLabel(hit.orderNumber || formatShortOrderNumber(hit.title));
                setOrderDue(hit.dueDate ? hit.dueDate.slice(0, 10) : null);
                const due = hit.dueDate ? hit.dueDate.slice(0, 10) : null;
                // Never fill a due date that has already passed.
                if (due && !requiredDate && !isDieDatePast(due)) setRequiredDate(due);
              }}
            />
          </div>
          <div>
            <Label htmlFor="req-product">Product</Label>
            <Input
              id="req-product"
              className="mt-1"
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {sizeInputs.map(([label, value, set]) => (
            <div key={label}>
              <Label>{label}</Label>
              <Input
                className="mt-1"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.001"
                value={value}
                onChange={(e) => set(e.target.value)}
              />
            </div>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="req-required">Required date *</Label>
            <RequiredDatePicker
              minDate={dieTodayYmd()}
              id="req-required"
              value={requiredDate}
              dueDate={orderDue}
              dueLabel="Order due"
              selectedLabel="Required date"
              onChange={setRequiredDate}
            />
          </div>
          <div>
            <Label htmlFor="req-mfg">Die manufacturer *</Label>
            {manufacturers.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">Add one in Settings first.</p>
            ) : (
              <Select
                id="req-mfg"
                className="mt-1"
                value={manufacturerId}
                onChange={(e) => setManufacturerId(e.target.value)}
              >
                {manufacturers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {dieManufacturerLabel(m)}
                  </option>
                ))}
              </Select>
            )}
          </div>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4 accent-blue-600"
            checked={allowOwnDate}
            onChange={(e) => setAllowOwnDate(e.target.checked)}
          />
          Let the manufacturer offer their own due date
        </label>

        <div>
          <Label htmlFor="req-comment">Comment</Label>
          <Input
            id="req-comment"
            className="mt-1"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Optional"
          />
        </div>

        <div>
          <Label htmlFor="req-files">Files (up to {DIE_MAX_FILES})</Label>
          <label
            htmlFor="req-files"
            className="mt-1 flex h-10 cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-600 hover:bg-slate-50"
          >
            <Paperclip className="h-4 w-4 shrink-0" />
            <span className="truncate">
              {files.length ? files.map((f) => f.name).join(", ") : "Attach pictures or files"}
            </span>
          </label>
          <input
            id="req-files"
            className="sr-only"
            type="file"
            multiple
            onChange={(e) => {
              setFiles((prev) =>
                [...prev, ...Array.from(e.target.files ?? [])].slice(0, DIE_MAX_FILES)
              );
              e.target.value = "";
            }}
          />
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>
      )}
    </Modal>
  );
}
