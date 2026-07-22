"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";

interface PackingSlipModalProps {
  open: boolean;
  orderId: string;
  orderNumber: string;
  buttonId: string;
  /** Modal title — usually the button automation name. */
  title?: string;
  groupSize?: number;
  onClose: () => void;
  onComplete: (message: string) => void;
  onError?: (message: string) => void;
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

/** 1-based part from title suffix (e.g. 266-1 → 1), else 1. */
function partFromOrderNumber(orderNumber: string): number {
  const match = orderNumber.trim().match(/-(\d+)$/);
  if (!match) return 1;
  const n = Number.parseInt(match[1], 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

export function PackingSlipModal({
  open,
  orderId,
  orderNumber,
  buttonId,
  title = "Packing slip",
  groupSize,
  onClose,
  onComplete,
  onError,
}: PackingSlipModalProps) {
  const totalParts = Math.max(1, groupSize ?? 1);
  const part = Math.min(partFromOrderNumber(orderNumber), totalParts);

  const [blindPrinting, setBlindPrinting] = useState(false);
  const [poNumber, setPoNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setBlindPrinting(false);
    setPoNumber("");
    setError(null);
    setLoading(false);
  }, [open, orderId, buttonId]);

  async function generate() {
    const trimmedPo = poNumber.trim();
    setError(null);
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        part: String(part),
        totalParts: String(totalParts),
      });
      const res = await fetch(
        `/api/orders/${orderId}/actions/generate-packing-slip?${qs}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            button_id: buttonId,
            part,
            totalParts,
            blind: blindPrinting,
            poNumber: blindPrinting && trimmedPo ? trimmedPo : undefined,
          }),
        }
      );
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
      if (contentType.includes("text/html")) {
        throw new Error("Server returned an error page instead of a PDF");
      }
      const safeOrder = orderNumber.replace(/[^a-zA-Z0-9._-]/g, "_");
      triggerBlobDownload(
        blob,
        `packing-slip-${safeOrder}-${part}of${totalParts}.pdf`
      );
      onComplete("Packing slip downloaded!");
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Action failed";
      setError(message);
      onError?.(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!loading) onClose();
      }}
      title={title}
      className="max-w-md"
      footer={
        <>
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void generate()}
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Generating…
              </>
            ) : (
              "Generate"
            )}
          </Button>
        </>
      }
    >
      <div className="space-y-3 py-2">
        <p className="text-sm text-slate-600">
          Slip for{" "}
          <span className="font-medium text-slate-800">{orderNumber}</span>
          {totalParts >= 2 ? (
            <span className="text-slate-500">
              {" "}
              (item {part} of {totalParts})
            </span>
          ) : null}
        </p>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={blindPrinting}
            onChange={(e) => {
              setBlindPrinting(e.target.checked);
              if (!e.target.checked) setPoNumber("");
            }}
            className="h-3.5 w-3.5 rounded border-slate-300"
          />
          <span>Blind printing</span>
          <span className="text-xs text-slate-500">
            (hide Bazaar address; customer only)
          </span>
        </label>

        {blindPrinting ? (
          <div>
            <label
              htmlFor="packing-slip-po"
              className="mb-1 block text-xs font-medium text-slate-600"
            >
              PO number{" "}
              <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <input
              id="packing-slip-po"
              type="text"
              value={poNumber}
              onChange={(e) => setPoNumber(e.target.value)}
              placeholder="Replaces order number on the slip"
              className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-800 placeholder:text-slate-400"
            />
          </div>
        ) : null}

        {error ? (
          <p className="rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-700">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
