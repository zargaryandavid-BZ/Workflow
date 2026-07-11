"use client";

import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { orderCardShareUrl } from "@/lib/button-automations";
import type { ButtonAutomation } from "@/lib/types";

export interface ActionButtonResult {
  message: string;
  /** Refetch order detail + board when the action changed order data (e.g. Emailed tag). */
  refreshOrder?: boolean;
}

interface ActionButtonProps {
  button: ButtonAutomation;
  orderId: string;
  orderNumber: string;
  appUrl: string;
  /** When >= 2, SMS buttons show a group confirmation dialog before sending. */
  groupSize?: number;
  /** How many of the group are in the same column as this order. */
  groupSameColumnCount?: number;
  /** Name of the current column (shown in the SMS confirmation dialog). */
  groupColumnName?: string;
  onComplete: (result: ActionButtonResult) => void;
  onError: (message: string) => void;
}

export function ActionButton({
  button,
  orderId,
  orderNumber,
  appUrl,
  groupSize,
  groupSameColumnCount,
  groupColumnName,
  onComplete,
  onError,
}: ActionButtonProps) {
  const [loading, setLoading] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState(false);
  const [packingOpen, setPackingOpen] = useState(false);
  const [packingError, setPackingError] = useState<string | null>(null);
  const defaultParts = Math.max(1, groupSize ?? 1);
  const [part, setPart] = useState(1);
  const [totalParts, setTotalParts] = useState(defaultParts);

  async function sendSms() {
    setLoading(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/actions/send-sms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ button_id: button.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error ?? "Failed to send SMS");
      }
      onComplete({ message: "SMS sent!", refreshOrder: true });
    } catch (err) {
      onError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setLoading(false);
      setPendingConfirm(false);
    }
  }

  function triggerBlobDownload(blob: Blob, filename: string) {
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  }

  async function downloadPdfBlob(
    res: Response,
    filename: string,
    successMessage: string
  ) {
    const contentType = res.headers.get("content-type") ?? "";
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error(
        typeof json.error === "string" ? json.error : "Failed to generate PDF"
      );
    }
    const blob = await res.blob();
    if (!blob.size) {
      throw new Error("PDF download was empty");
    }
    // Guard against HTML error pages returned as 200.
    if (contentType.includes("text/html")) {
      throw new Error("Server returned an error page instead of a PDF");
    }
    triggerBlobDownload(blob, filename);
    onComplete({ message: successMessage });
  }

  async function generatePackingSlip() {
    const safePart = Math.max(1, Math.floor(Number(part)) || 1);
    const safeTotal = Math.max(safePart, Math.floor(Number(totalParts)) || 1);
    setPackingError(null);
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        part: String(safePart),
        totalParts: String(safeTotal),
      });
      const res = await fetch(
        `/api/orders/${orderId}/actions/generate-packing-slip?${qs}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            button_id: button.id,
            part: safePart,
            totalParts: safeTotal,
          }),
        }
      );
      const safeOrder = orderNumber.replace(/[^a-zA-Z0-9._-]/g, "_");
      await downloadPdfBlob(
        res,
        `packing-slip-${safeOrder}-${safePart}of${safeTotal}.pdf`,
        "Packing slip downloaded!"
      );
      setPackingOpen(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Action failed";
      setPackingError(message);
      onError(message);
    } finally {
      setLoading(false);
    }
  }

  async function handleClick() {
    setLoading(true);
    try {
      if (button.action_type === "copy_link") {
        const url = orderCardShareUrl(orderId, appUrl || window.location.origin);
        await navigator.clipboard.writeText(url);
        onComplete({ message: "Link copied!" });
        return;
      }

      if (button.action_type === "send_email") {
        const res = await fetch(`/api/orders/${orderId}/actions/send-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ button_id: button.id }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(json.error ?? "Failed to send email");
        }
        onComplete({ message: "Email sent!", refreshOrder: true });
        return;
      }

      if (button.action_type === "send_sms") {
        if ((groupSize ?? 0) >= 2) {
          setLoading(false);
          setPendingConfirm(true);
          return;
        }
        await sendSms();
        return;
      }

      if (button.action_type === "generate_pdf") {
        const res = await fetch(`/api/orders/${orderId}/actions/generate-pdf`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ button_id: button.id }),
        });
        await downloadPdfBlob(
          res,
          `job-ticket-${orderNumber.replace(/[^a-zA-Z0-9._-]/g, "_")}.pdf`,
          "PDF downloaded!"
        );
        return;
      }

      if (button.action_type === "generate_packing_slip") {
        setLoading(false);
        setPackingError(null);
        setPart(1);
        setTotalParts(Math.max(1, groupSize ?? 1));
        setPackingOpen(true);
        return;
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setLoading(false);
    }
  }

  if (packingOpen) {
    return (
      <div className="w-full min-w-[16rem] rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="mb-2 text-sm font-medium text-slate-800">Packing slip</p>
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
          <span>Part</span>
          <input
            type="number"
            min={1}
            max={totalParts}
            value={part}
            onChange={(e) => {
              const next = Number(e.target.value);
              if (!Number.isFinite(next)) return;
              setPart(Math.min(Math.max(1, Math.floor(next)), totalParts));
            }}
            className="w-14 rounded-md border border-slate-300 bg-white px-2 py-1 text-center text-sm"
          />
          <span>of</span>
          <input
            type="number"
            min={1}
            value={totalParts}
            readOnly
            tabIndex={-1}
            aria-label="Total parts"
            className="w-14 cursor-default rounded-md border border-slate-200 bg-slate-100 px-2 py-1 text-center text-sm text-slate-700"
          />
          <button
            type="button"
            onClick={() => {
              setPackingOpen(false);
              setPackingError(null);
            }}
            disabled={loading}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void generatePackingSlip()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {loading ? "Generating…" : "Generate"}
          </button>
        </div>
        {packingError ? (
          <p className="mt-2 rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-700">
            {packingError}
          </p>
        ) : null}
      </div>
    );
  }

  if (pendingConfirm) {
    return (
      <div className="w-full rounded-lg border border-amber-200 bg-amber-50 p-3">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium text-amber-800">
              This order has <strong>{groupSize} parts</strong>
              {groupSameColumnCount != null && groupColumnName ? (
                <>
                  , <strong>
                    {groupSameColumnCount}/{groupSize}
                  </strong>{" "}
                  in the same column: <strong>{groupColumnName}</strong>
                </>
              ) : null}
            </p>
            <p className="mt-0.5 text-amber-700">
              Please confirm all parts are ready before sending the SMS to the
              customer.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setPendingConfirm(false)}
                disabled={loading}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={sendSms}
                disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {loading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                {loading ? "Sending…" : "Yes, send SMS"}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : button.icon ? (
        <span aria-hidden>{button.icon}</span>
      ) : null}
      {loading ? "Working…" : button.name}
    </button>
  );
}
