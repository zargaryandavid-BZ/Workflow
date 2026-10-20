"use client";

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Loader2, PenLine, X } from "lucide-react";

export type PickupFinishedChoice = {
  kind: "review" | "no_review";
  columnName: string;
  buttonId: string | null;
};

export function PickupConfirmationModal({
  orderNumber,
  choices,
  onSave,
  onChoose,
  onClose,
}: {
  orderNumber: string;
  choices: PickupFinishedChoice[];
  onSave: (input: {
    firstName: string;
    lastName: string;
    signatureDataUrl: string;
  }) => Promise<{ message: string }>;
  onChoose: (choice: PickupFinishedChoice) => Promise<void>;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [hasSignature, setHasSignature] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [customerNotice, setCustomerNotice] = useState("");
  const pickupDate = useRef(
    new Date().toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })
  ).current;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, rect.width, rect.height);
    context.strokeStyle = "#111827";
    context.lineWidth = 2.5;
    context.lineCap = "round";
    context.lineJoin = "round";
  }, []);

  function point(event: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function startSignature(event: ReactPointerEvent<HTMLCanvasElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    const next = point(event);
    context.beginPath();
    context.moveTo(next.x, next.y);
    drawingRef.current = true;
  }

  function drawSignature(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    event.preventDefault();
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    const next = point(event);
    context.lineTo(next.x, next.y);
    context.stroke();
    setHasSignature(true);
  }

  function stopSignature(event: ReactPointerEvent<HTMLCanvasElement>) {
    drawingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function clearSignature() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const rect = canvas.getBoundingClientRect();
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, rect.width, rect.height);
    setHasSignature(false);
  }

  async function confirmPickup() {
    if (!firstName.trim()) {
      setError("First name is required.");
      return;
    }
    if (!lastName.trim()) {
      setError("Last name is required.");
      return;
    }
    if (!hasSignature || !canvasRef.current) {
      setError("Signature is required.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const saved = await onSave({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        signatureDataUrl: canvasRef.current.toDataURL("image/png"),
      });
      setCustomerNotice(saved.message);
      setConfirmed(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to confirm pickup"
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pickup-window-title"
        className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2
              id="pickup-window-title"
              className="text-lg font-semibold text-slate-900"
            >
              Pickup window
            </h2>
            <p className="text-sm text-slate-500">Order {orderNumber}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 disabled:opacity-50"
            aria-label="Close pickup window"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {!confirmed ? (
          <>
            <div className="space-y-4 px-5 py-5">
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm font-medium text-slate-700">
                  First name <span className="text-red-500">*</span>
                  <input
                    value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                    autoComplete="given-name"
                    required
                    aria-required="true"
                    className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3 text-base text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </label>
                <label className="text-sm font-medium text-slate-700">
                  Last name <span className="text-red-500">*</span>
                  <input
                    value={lastName}
                    onChange={(event) => setLastName(event.target.value)}
                    autoComplete="family-name"
                    required
                    aria-required="true"
                    className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3 text-base text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </label>
              </div>
              <label className="block text-sm font-medium text-slate-700">
                Pickup date
                <input
                  readOnly
                  value={pickupDate}
                  className="mt-1 h-11 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-base text-slate-700"
                />
              </label>
              <div>
                <div className="mb-1 flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700">
                    <PenLine className="h-4 w-4" />
                    Signature
                  </span>
                  <button
                    type="button"
                    onClick={clearSignature}
                    className="text-sm font-semibold text-blue-700 hover:text-blue-900"
                  >
                    Clear
                  </button>
                </div>
                <canvas
                  ref={canvasRef}
                  aria-label="Signature touchpad"
                  onPointerDown={startSignature}
                  onPointerMove={drawSignature}
                  onPointerUp={stopSignature}
                  onPointerCancel={stopSignature}
                  className="h-40 w-full touch-none rounded-xl border-2 border-dashed border-slate-300 bg-white"
                />
                <p className="mt-1 text-xs text-slate-500">
                  Sign inside the box using a finger, stylus, or mouse.
                </p>
              </div>
              {error ? (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </p>
              ) : null}
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-200 px-5 py-4">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmPickup()}
                disabled={
                  busy ||
                  !firstName.trim() ||
                  !lastName.trim() ||
                  !hasSignature
                }
                className="inline-flex min-w-28 items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Confirm
              </button>
            </div>
          </>
        ) : (
          <div className="space-y-4 px-5 py-5">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              Pickup confirmed for {firstName.trim()} {lastName.trim()}.
              {customerNotice ? ` ${customerNotice}` : ""} Choose the finished
              column.
            </div>
            <div className="space-y-3">
              {choices.map((choice) => (
                <button
                  key={choice.kind}
                  type="button"
                  disabled={busy || !choice.buttonId}
                  onClick={() => {
                    setBusy(true);
                    setError("");
                    void onChoose(choice).catch((err) => {
                      setBusy(false);
                      setError(
                        err instanceof Error
                          ? err.message
                          : "Failed to finish order"
                      );
                    });
                  }}
                  className="flex min-h-14 w-full items-center justify-between rounded-xl border border-slate-200 px-4 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                >
                  <span>Send {choice.columnName}</span>
                  {!choice.buttonId ? (
                    <span className="text-xs font-normal">
                      Not configured
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
            {error ? (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
