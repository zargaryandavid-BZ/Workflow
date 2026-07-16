"use client";

import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { orderCardShareUrl } from "@/lib/button-automations";
import type { ButtonAutomation } from "@/lib/types";
import { ShippingModal } from "./shipping-modal";
import { PackingSlipModal } from "./packing-slip-modal";

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
  appearance?: "default" | "menu";
  /** When >= 2, SMS buttons show a group confirmation dialog before sending. */
  groupSize?: number;
  /** How many of the group are in the same column as this order. */
  groupSameColumnCount?: number;
  /** Name of the current column (shown in the SMS confirmation dialog). */
  groupColumnName?: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  productLabel?: string | null;
  onComplete: (result: ActionButtonResult) => void;
  onError: (message: string) => void;
}

export function ActionButton({
  button,
  orderId,
  orderNumber,
  appUrl,
  appearance = "default",
  groupSize,
  groupSameColumnCount,
  groupColumnName,
  customerEmail,
  customerPhone,
  productLabel,
  onComplete,
  onError,
}: ActionButtonProps) {
  const [loading, setLoading] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState(false);
  const [shippingOpen, setShippingOpen] = useState(false);
  const [packingOpen, setPackingOpen] = useState(false);

  function openShippingModal() {
    setLoading(false);
    setShippingOpen(true);
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
        openShippingModal();
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
        setPackingOpen(true);
        return;
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setLoading(false);
    }
  }

  const shippingModal = (
    <ShippingModal
      open={shippingOpen}
      orderId={orderId}
      orderNumber={orderNumber}
      productLabel={productLabel}
      customerEmail={customerEmail}
      customerPhone={customerPhone}
      buttonId={button.id}
      onClose={() => setShippingOpen(false)}
      onSent={(message) => {
        setPendingConfirm(false);
        setShippingOpen(false);
        onComplete({ message, refreshOrder: true });
      }}
      onError={onError}
    />
  );

  const packingModal = (
    <PackingSlipModal
      open={packingOpen}
      orderId={orderId}
      orderNumber={orderNumber}
      buttonId={button.id}
      title={button.name}
      groupSize={groupSize}
      onClose={() => setPackingOpen(false)}
      onComplete={(message) => {
        setPackingOpen(false);
        onComplete({ message });
      }}
      onError={onError}
    />
  );

  if (pendingConfirm) {
    return (
      <>
        {/* EXISTING yellow confirmation banner — appearance unchanged */}
        <div className="w-full rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium text-amber-800">
                This order has <strong>{groupSize} parts</strong>
                {groupSameColumnCount != null ? (
                  groupSameColumnCount >= (groupSize ?? 0) ? (
                    <>
                      {" "}
                      — all <strong>{groupSize}</strong> are here
                      {groupColumnName ? (
                        <>
                          {" "}
                          in <strong>{groupColumnName}</strong>
                        </>
                      ) : null}
                    </>
                  ) : (
                    <>
                      {" "}
                      — only{" "}
                      <strong>
                        {groupSameColumnCount}/{groupSize}
                      </strong>{" "}
                      {groupSameColumnCount === 1 ? "is" : "are"} here
                      {groupColumnName ? (
                        <>
                          {" "}
                          in <strong>{groupColumnName}</strong>
                        </>
                      ) : null}
                    </>
                  )
                ) : null}
                .
              </p>
              <p className="mt-0.5 text-amber-700">
                {groupSameColumnCount != null &&
                groupSize != null &&
                groupSameColumnCount >= groupSize
                  ? "Send the shipping SMS (order ready)? Every part in this column will be tagged Texted."
                  : "Do you still want to send the shipping SMS (order ready)? Only this card will be tagged Texted."}
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
                  onClick={openShippingModal}
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
        {shippingModal}
        {packingModal}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className={
          appearance === "menu"
            ? "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            : "inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        }
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : button.icon ? (
          <span aria-hidden>{button.icon}</span>
        ) : null}
        {loading ? "Working…" : button.name}
      </button>
      {shippingModal}
      {packingModal}
    </>
  );
}
