"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
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
  onComplete: (result: ActionButtonResult) => void;
  onError: (message: string) => void;
}

export function ActionButton({
  button,
  orderId,
  orderNumber,
  appUrl,
  onComplete,
  onError,
}: ActionButtonProps) {
  const [loading, setLoading] = useState(false);

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
