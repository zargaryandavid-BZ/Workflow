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
        // If this order is part of a group, ask for confirmation first.
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
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error ?? "Failed to generate PDF");
        }
        const blob = await res.blob();
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `job-ticket-${orderNumber.replace(/[^a-zA-Z0-9._-]/g, "_")}.pdf`;
        link.click();
        URL.revokeObjectURL(link.href);
        onComplete({ message: "PDF downloaded!" });
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setLoading(false);
    }
  }

  // Confirmation dialog for grouped SMS sends
  if (pendingConfirm) {
    return (
      <div className="w-full rounded-lg border border-amber-200 bg-amber-50 p-3">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium text-amber-800">
              This order has <strong>{groupSize} parts</strong>
              {groupSameColumnCount != null && groupColumnName ? (
                <>, <strong>{groupSameColumnCount}/{groupSize}</strong> in the same column: <strong>{groupColumnName}</strong></>
              ) : null}
            </p>
            <p className="mt-0.5 text-amber-700">
              Please confirm all parts are ready before sending the SMS to the customer.
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
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
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
