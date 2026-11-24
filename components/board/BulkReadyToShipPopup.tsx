"use client";

import { useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Package, RefreshCw, Send, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { getGroupKey } from "@/lib/group-orders";
import { customerContactFromOrder, customerNameFromOrder } from "@/lib/notification-messages";
import { orderTagsFromSpecs } from "@/lib/order-tags";
import {
  expandBoxGroups,
  presetBoxDimensions,
  READY_TO_SHIP_BOX_SIZE_PRESETS,
} from "@/lib/box-size-presets";
import {
  PickupLocationPicker,
  useStaffPickupLocations,
} from "@/components/shipping/pickup-location-picker";
import type { CustomField, OrderWithRelations } from "@/lib/types";

/**
 * Bulk "Ready to Ship" notify — same idea as the Missing Info / Waiting
 * Approval bulk re-request: tick the orders, send. Each selected order gets the
 * exact same notice as the single-card Ready to Ship popup (same endpoint:
 * /api/orders/:id/actions/ready-to-ship), sent by email + SMS to whatever
 * contact is on file. One row per order (multi-line orders send once).
 */

type Row = {
  key: string;
  order: OrderWithRelations;
  partCount: number;
  partsHere: number;
  customerName: string;
  email: string | null;
  phone: string | null;
  alreadyTexted: boolean;
};

type BoxRow = { qty: string; length: string; width: string; height: string; weight: string };

type Result = { title: string; ok: boolean; error?: string };

function emptyBoxRow(): BoxRow {
  return { qty: "1", length: "", width: "", height: "", weight: "" };
}

function boxRowComplete(b: BoxRow | undefined): boolean {
  if (!b) return false;
  return [b.qty, b.length, b.width, b.height, b.weight].every((v) => {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) && n > 0;
  });
}

export function BulkReadyToShipPopup({
  columnId,
  columnName,
  orders,
  customFields,
  fieldValuesByOrder,
  onClose,
  onSent,
}: {
  columnId: string;
  columnName: string;
  /** All board orders currently loaded (used to find this column's cards + their siblings). */
  orders: OrderWithRelations[];
  customFields: CustomField[];
  fieldValuesByOrder: Record<string, Record<string, unknown>>;
  onClose: () => void;
  onSent: () => void;
}) {
  const backdropRef = useRef<HTMLDivElement>(null);

  const rows = useMemo<Row[]>(() => {
    const inColumn = orders
      .filter((o) => o.column_id === columnId)
      .sort((a, b) => a.position - b.position);
    const seen = new Set<string>();
    const out: Row[] = [];
    for (const order of inColumn) {
      const groupKey = getGroupKey(order);
      const key = groupKey ?? order.id;
      if (seen.has(key)) continue;
      seen.add(key);
      const parts = groupKey ? orders.filter((o) => getGroupKey(o) === groupKey) : [order];
      const fv = fieldValuesByOrder[order.id] ?? {};
      const contact = customerContactFromOrder(order, fv, customFields);
      out.push({
        key,
        order,
        partCount: parts.length,
        partsHere: parts.filter((o) => o.column_id === columnId).length,
        customerName: customerNameFromOrder(order, fv, customFields) || "",
        email: contact.email,
        phone: contact.phone,
        alreadyTexted: parts.some((o) =>
          orderTagsFromSpecs(o.specs).some((t) => t.toLowerCase() === "texted")
        ),
      });
    }
    return out;
  }, [orders, columnId, customFields, fieldValuesByOrder]);

  // Ticked by default: has a contact, not already notified, all parts here.
  const [picked, setPicked] = useState<Set<string>>(
    () =>
      new Set(
        rows
          .filter((r) => (r.email || r.phone) && !r.alreadyTexted && r.partsHere >= r.partCount)
          .map((r) => r.key)
      )
  );
  const [fulfillment, setFulfillment] = useState<"choose" | "pickup">("choose");
  const [boxes, setBoxes] = useState<Record<string, BoxRow>>({});
  const [fillPreset, setFillPreset] = useState("");
  const [fillWeight, setFillWeight] = useState("");
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<Result[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const {
    locations: pickupLocations,
    selectedId: pickupLocationId,
    setSelectedId: setPickupLocationId,
  } = useStaffPickupLocations();

  const selectable = rows.filter((r) => r.email || r.phone);
  const selected = rows.filter((r) => picked.has(r.key));
  const allPicked = selectable.length > 0 && selectable.every((r) => picked.has(r.key));
  const boxesMissing =
    fulfillment === "choose" ? selected.filter((r) => !boxRowComplete(boxes[r.key])) : [];
  const canSend =
    !sending &&
    selected.length > 0 &&
    boxesMissing.length === 0 &&
    (fulfillment !== "pickup" || Boolean(pickupLocationId));

  const toggle = (key: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const toggleAll = () =>
    setPicked(allPicked ? new Set() : new Set(selectable.map((r) => r.key)));

  const setBox = (key: string, field: keyof BoxRow, value: string) =>
    setBoxes((prev) => ({ ...prev, [key]: { ...(prev[key] ?? emptyBoxRow()), [field]: value } }));

  function fillSelected() {
    const dims = presetBoxDimensions(fillPreset);
    setBoxes((prev) => {
      const next = { ...prev };
      for (const r of selected) {
        const cur = next[r.key] ?? emptyBoxRow();
        next[r.key] = {
          ...cur,
          ...(dims ?? {}),
          weight: fillWeight.trim() ? fillWeight.trim() : cur.weight,
        };
      }
      return next;
    });
  }

  async function send() {
    if (!canSend) return;
    setSending(true);
    setError(null);
    setProgress(0);
    const out: Result[] = [];
    for (const r of selected) {
      const b = boxes[r.key];
      try {
        const res = await fetch(`/api/orders/${r.order.id}/actions/ready-to-ship`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderId: r.order.id,
            // Email + SMS to whatever contact is on file (route skips the missing one).
            channel: "both",
            boxes:
              fulfillment === "choose" && b
                ? expandBoxGroups([b])
                : [],
            dimUnit: "in",
            weightUnit: "lbs",
            fulfillment,
            pickup_location_id: fulfillment === "pickup" ? pickupLocationId : undefined,
          }),
        });
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        out.push({ title: r.order.title, ok: res.ok, error: res.ok ? undefined : json.error ?? "Failed" });
      } catch (err) {
        out.push({ title: r.order.title, ok: false, error: err instanceof Error ? err.message : "Failed" });
      }
      setProgress(out.length);
    }
    setResults(out);
    setSending(false);
    if (out.some((x) => x.ok)) onSent();
  }

  const sentCount = results?.filter((r) => r.ok).length ?? 0;
  const failed = results?.filter((r) => !r.ok) ?? [];

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === backdropRef.current && !sending) onClose();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-blue-600" />
            <h2 className="text-[15px] font-semibold text-slate-800">Notify ready to ship</h2>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
              {columnName}
            </span>
          </div>
          <button
            onClick={onClose}
            disabled={sending}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {results ? (
          <div className="flex flex-col items-center gap-2 px-5 py-8">
            <CheckCircle2 className="h-10 w-10 text-green-500" />
            <p className="text-sm font-medium text-slate-800">
              Sent {sentCount} ready-to-ship {sentCount === 1 ? "notice" : "notices"}
            </p>
            {failed.length > 0 ? (
              <ul className="mt-2 w-full space-y-1 text-xs text-red-600">
                {failed.map((f) => (
                  <li key={f.title}>
                    {f.title}: {f.error}
                  </li>
                ))}
              </ul>
            ) : null}
            <button
              onClick={onClose}
              className="mt-3 rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-900"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-3 border-b border-slate-100 px-5 py-3 text-sm text-slate-700">
              <div className="flex flex-wrap gap-4">
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="radio"
                    checked={fulfillment === "choose"}
                    onChange={() => setFulfillment("choose")}
                  />
                  Customer picks pickup or delivery (needs boxes)
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="radio"
                    checked={fulfillment === "pickup"}
                    onChange={() => setFulfillment("pickup")}
                  />
                  Pickup only
                </label>
              </div>
              {fulfillment === "pickup" ? (
                <PickupLocationPicker
                  locations={pickupLocations}
                  selectedId={pickupLocationId}
                  onChange={setPickupLocationId}
                />
              ) : (
                <div className="flex flex-wrap items-end gap-2 text-xs text-slate-500">
                  <span className="pb-1.5">Fill ticked orders:</span>
                  <select
                    value={fillPreset}
                    onChange={(e) => setFillPreset(e.target.value)}
                    className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-800"
                  >
                    <option value="">Box size…</option>
                    {READY_TO_SHIP_BOX_SIZE_PRESETS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={0.01}
                    step="any"
                    placeholder="lbs each"
                    value={fillWeight}
                    onChange={(e) => setFillWeight(e.target.value)}
                    className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-800"
                  />
                  <button
                    type="button"
                    onClick={fillSelected}
                    disabled={!fillPreset && !fillWeight.trim()}
                    className="rounded-md border border-slate-300 px-2.5 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  >
                    Apply
                  </button>
                  <span className="pb-1.5">Inches / lbs. Edit any row below.</span>
                </div>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {rows.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-400">No cards in this column.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  <label className="flex cursor-pointer items-center gap-3 px-5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={allPicked}
                      ref={(el) => {
                        if (el) el.indeterminate = selected.length > 0 && !allPicked;
                      }}
                      onChange={toggleAll}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    Select all ({selected.length} of {rows.length} selected)
                  </label>
                  {rows.map((r) => {
                    const noContact = !r.email && !r.phone;
                    const isPicked = picked.has(r.key);
                    const b = boxes[r.key] ?? emptyBoxRow();
                    return (
                      <div key={r.key} className={cn("px-5 py-2.5", noContact && "opacity-50")}>
                        <label className="flex cursor-pointer items-start gap-3">
                          <input
                            type="checkbox"
                            checked={isPicked}
                            disabled={noContact}
                            onChange={() => toggle(r.key)}
                            className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-slate-800">
                              #{r.order.title}
                              {r.partCount > 1 ? (
                                <span className="ml-1 text-xs font-normal text-slate-500">
                                  ({r.partCount} parts)
                                </span>
                              ) : null}
                            </span>
                            <span className="block truncate text-xs text-slate-500">
                              {[r.customerName, r.email, r.phone].filter(Boolean).join(" · ") ||
                                "No email or phone on file"}
                            </span>
                            <span className="mt-0.5 flex flex-wrap gap-1.5 text-[11px]">
                              {r.alreadyTexted ? (
                                <span className="rounded bg-amber-50 px-1.5 text-amber-700">Already notified</span>
                              ) : null}
                              {r.partsHere < r.partCount ? (
                                <span className="rounded bg-rose-50 px-1.5 text-rose-700">
                                  Only {r.partsHere} of {r.partCount} parts here
                                </span>
                              ) : null}
                            </span>
                          </span>
                        </label>
                        {isPicked && fulfillment === "choose" ? (
                          <div className="ml-7 mt-2 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                            <input
                              type="number"
                              min={1}
                              step={1}
                              value={b.qty}
                              onChange={(e) => setBox(r.key, "qty", e.target.value)}
                              aria-label="How many boxes"
                              className="w-12 rounded border border-slate-300 px-1.5 py-1 text-sm text-slate-800"
                            />
                            boxes
                            {(["length", "width", "height"] as const).map((f, i) => (
                              <span key={f} className="inline-flex items-center gap-1.5">
                                {i > 0 ? "×" : null}
                                <input
                                  type="number"
                                  min={0.01}
                                  step="any"
                                  placeholder={f[0]!.toUpperCase()}
                                  value={b[f]}
                                  onChange={(e) => setBox(r.key, f, e.target.value)}
                                  aria-label={f}
                                  className="w-14 rounded border border-slate-300 px-1.5 py-1 text-sm text-slate-800"
                                />
                              </span>
                            ))}
                            in,
                            <input
                              type="number"
                              min={0.01}
                              step="any"
                              placeholder="lbs"
                              value={b.weight}
                              onChange={(e) => setBox(r.key, "weight", e.target.value)}
                              aria-label="Weight each"
                              className="w-16 rounded border border-slate-300 px-1.5 py-1 text-sm text-slate-800"
                            />
                            lbs each
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3">
              <p className="text-xs text-slate-500">
                {error ? (
                  <span className="flex items-center gap-1 text-red-600">
                    <AlertCircle className="h-3.5 w-3.5" />
                    {error}
                  </span>
                ) : sending ? (
                  `Sending ${progress} of ${selected.length}…`
                ) : boxesMissing.length > 0 ? (
                  `Enter boxes for ${boxesMissing.length} ticked order${boxesMissing.length === 1 ? "" : "s"}`
                ) : fulfillment === "pickup" && !pickupLocationId ? (
                  "Choose the pickup location"
                ) : (
                  "Email + text to the contact on file"
                )}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  disabled={sending}
                  className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void send()}
                  disabled={!canSend}
                  className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {sending ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                  {sending ? "Sending…" : `Send (${selected.length})`}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
