"use client";

import { useEffect, useState } from "react";
import { Loader2, Mail, Package, Phone } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import type { ShippingDimUnit, ShippingWeightUnit } from "@/lib/types";

interface BoxDraft {
  length: string;
  width: string;
  height: string;
  weight: string;
}

interface ShippingModalProps {
  open: boolean;
  orderId: string;
  orderNumber: string;
  productLabel?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  buttonId: string;
  onClose: () => void;
  onSent: (message: string) => void;
  onError: (message: string) => void;
}

function emptyBox(): BoxDraft {
  return { length: "", width: "", height: "", weight: "" };
}

function isPositiveNumber(value: string): boolean {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) && n > 0;
}

function isBoxComplete(box: BoxDraft): boolean {
  return (
    isPositiveNumber(box.length) &&
    isPositiveNumber(box.width) &&
    isPositiveNumber(box.height) &&
    isPositiveNumber(box.weight)
  );
}

export function ShippingModal({
  open,
  orderId,
  orderNumber,
  productLabel,
  customerEmail,
  customerPhone,
  buttonId,
  onClose,
  onSent,
  onError,
}: ShippingModalProps) {
  const [boxCount, setBoxCount] = useState(1);
  const [boxes, setBoxes] = useState<BoxDraft[]>([emptyBox()]);
  const [dimUnit, setDimUnit] = useState<ShippingDimUnit>("in");
  const [weightUnit, setWeightUnit] = useState<ShippingWeightUnit>("lbs");
  const [sending, setSending] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const allBoxesFilled = boxes.every(isBoxComplete);
  const hasContact = Boolean(customerEmail || customerPhone);
  const canSend = allBoxesFilled && hasContact && !sending;

  useEffect(() => {
    if (!open) return;
    setBoxCount(1);
    setBoxes([emptyBox()]);
    setDimUnit("in");
    setWeightUnit("lbs");
    setSending(false);
    setLocalError(null);
  }, [open, orderId]);

  function updateBoxCount(next: number) {
    const safe = Math.min(20, Math.max(1, Math.floor(next) || 1));
    setBoxCount(safe);
    setBoxes((prev) => {
      if (safe === prev.length) return prev;
      if (safe > prev.length) {
        return [
          ...prev,
          ...Array.from({ length: safe - prev.length }, () => emptyBox()),
        ];
      }
      return prev.slice(0, safe);
    });
  }

  function updateBox(index: number, field: keyof BoxDraft, value: string) {
    setBoxes((prev) =>
      prev.map((box, i) => (i === index ? { ...box, [field]: value } : box))
    );
  }

  async function handleSend() {
    setLocalError(null);
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      const nums = [b.length, b.width, b.height, b.weight].map((v) =>
        Number.parseFloat(v)
      );
      if (!nums.every((n) => Number.isFinite(n) && n > 0)) {
        setLocalError(
          `Box ${i + 1}: enter length, width, height, and weight greater than 0.`
        );
        return;
      }
    }
    if (!customerEmail && !customerPhone) {
      setLocalError("No email or phone on file for this customer.");
      return;
    }

    setSending(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/actions/ship`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          button_id: buttonId,
          boxes,
          dimUnit,
          weightUnit,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof json.error === "string" ? json.error : "Failed to send"
        );
      }
      const baseMessage =
        typeof json.taggedCount === "number" && json.taggedCount > 1
          ? `Link sent — ${json.taggedCount} parts tagged Texted.`
          : "Shipment link sent to client";
      const message = json.replacedResponse
        ? `New link sent — previous client response was replaced.`
        : json.resent
          ? `New link sent — previous link is now invalid.`
          : baseMessage;
      onSent(message);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to send";
      setLocalError(message);
      onError(message);
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!sending) onClose();
      }}
      className="max-w-xl"
      overlayClassName="z-[110]"
      title={
        <span className="inline-flex items-center gap-2">
          <Package className="h-4 w-4 text-slate-500" />
          Prepare Shipment — Order #{orderNumber}
        </span>
      }
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!canSend}
            title={
              !allBoxesFilled
                ? "Fill length, width, height, and weight for every box"
                : !hasContact
                  ? "No email or phone on file for this customer"
                  : undefined
            }
            className="inline-flex items-center gap-1.5 rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {sending ? "Sending…" : "Send to Client →"}
          </button>
        </>
      }
    >
      <div className="space-y-4 py-3">
        {productLabel ? (
          <p className="-mt-1 text-sm text-slate-500">{productLabel}</p>
        ) : null}

        <label className="block text-sm text-slate-700">
          How many boxes?
          <input
            type="number"
            min={1}
            max={20}
            value={boxCount}
            onChange={(e) => updateBoxCount(Number(e.target.value))}
            className="ml-3 w-16 rounded-md border border-slate-300 px-2 py-1 text-sm"
          />
        </label>

        <div className="space-y-3">
          {boxes.map((box, index) => (
            <div
              key={index}
              className="rounded-lg border border-slate-200 bg-slate-50 p-3"
            >
              <p className="mb-2 text-sm font-medium text-slate-800">
                Box {index + 1}
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(
                  [
                    ["length", "Length"],
                    ["width", "Width"],
                    ["height", "Height"],
                  ] as const
                ).map(([field, label]) => (
                  <label key={field} className="block text-xs text-slate-500">
                    {label} ({dimUnit}) *
                    <input
                      type="number"
                      min={0.01}
                      step="any"
                      required
                      value={box[field]}
                      onChange={(e) => updateBox(index, field, e.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800"
                    />
                  </label>
                ))}
                <label className="block text-xs text-slate-500">
                  Weight ({weightUnit}) *
                  <input
                    type="number"
                    min={0.01}
                    step="any"
                    required
                    value={box.weight}
                    onChange={(e) => updateBox(index, "weight", e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800"
                  />
                </label>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-6 text-sm text-slate-700">
          <fieldset className="space-y-1">
            <legend className="text-xs font-medium text-slate-500">
              Dimensions unit
            </legend>
            <label className="mr-3 inline-flex items-center gap-1.5">
              <input
                type="radio"
                checked={dimUnit === "in"}
                onChange={() => setDimUnit("in")}
              />
              inches
            </label>
            <label className="inline-flex items-center gap-1.5">
              <input
                type="radio"
                checked={dimUnit === "cm"}
                onChange={() => setDimUnit("cm")}
              />
              cm
            </label>
          </fieldset>
          <fieldset className="space-y-1">
            <legend className="text-xs font-medium text-slate-500">
              Weight unit
            </legend>
            <label className="mr-3 inline-flex items-center gap-1.5">
              <input
                type="radio"
                checked={weightUnit === "lbs"}
                onChange={() => setWeightUnit("lbs")}
              />
              lbs
            </label>
            <label className="inline-flex items-center gap-1.5">
              <input
                type="radio"
                checked={weightUnit === "kg"}
                onChange={() => setWeightUnit("kg")}
              />
              kg
            </label>
          </fieldset>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
            Send to
          </p>
          <div className="space-y-1.5 text-slate-700">
            <p className="flex items-center gap-2">
              <Mail className="h-3.5 w-3.5 text-slate-400" />
              {customerEmail || (
                <span className="text-slate-400">No email on file</span>
              )}
            </p>
            <p className="flex items-center gap-2">
              <Phone className="h-3.5 w-3.5 text-slate-400" />
              {customerPhone || (
                <span className="text-slate-400">No phone on file</span>
              )}
            </p>
          </div>
        </div>

        {localError ? (
          <p className="rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-700">
            {localError}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
