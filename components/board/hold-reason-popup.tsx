"use client";

import { useState } from "react";
import { PauseCircle } from "lucide-react";
import { Modal } from "@/components/ui/modal";

const QUICK_REASONS = [
  "Waiting on customer",
  "Missing info / artwork",
  "Waiting on payment",
  "Stock / material issue",
  "Waiting on approval",
  "Other",
] as const;

/**
 * Shown right after a card is moved into a Hold column. Requires a reason before
 * closing so the board always records WHY a job is paused — the reason is logged
 * as a hold_reason activity and shows in the card's activity timeline under the
 * "→ Hold" line.
 */
export function HoldReasonPopup({
  orderId,
  orderTitle,
  columnName,
  onClose,
  onSaved,
}: {
  orderId: string;
  orderTitle: string;
  columnName: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const value = reason.trim();
    if (!value) {
      setError("Please add a reason.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/hold-reason`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: value, columnName }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? "Could not save the reason.");
      }
      onSaved("Hold reason saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the reason.");
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose}>
      <div className="w-[420px] max-w-full p-5">
        <div className="mb-3 flex items-center gap-2">
          <PauseCircle className="h-5 w-5 text-amber-500" />
          <h2 className="text-base font-semibold text-slate-800">
            Why is this on hold?
          </h2>
        </div>
        <p className="mb-3 text-[13px] text-slate-500">
          {orderTitle} moved to <span className="font-medium">{columnName}</span>.
          Add a reason so everyone can see why it&rsquo;s paused.
        </p>

        <div className="mb-3 flex flex-wrap gap-1.5">
          {QUICK_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r === "Other" ? "" : r)}
              className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-[12px] font-medium text-slate-700 hover:border-amber-400 hover:bg-amber-50"
            >
              {r}
            </button>
          ))}
        </div>

        <textarea
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="Type the reason…"
          className="w-full resize-none rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none"
        />

        {error ? (
          <p className="mt-1 text-[12px] font-medium text-rose-600">{error}</p>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 disabled:opacity-50"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="rounded-md bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save reason"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
