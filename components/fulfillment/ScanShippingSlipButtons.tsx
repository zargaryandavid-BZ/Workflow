"use client";

import { useState } from "react";
import { Download, Loader2, Printer } from "lucide-react";
import {
  filenameFromDisposition,
  printPdfBlob,
  triggerBlobDownload,
} from "@/lib/browser-pdf";
import { cn } from "@/lib/utils";

function partFromOrderNumber(orderNumber: string): number {
  const match = orderNumber.trim().match(/-(\d+)$/);
  if (!match) return 1;
  const n = Number.parseInt(match[1], 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

async function fetchOrderPackingSlip(params: {
  orderId: string;
  orderNumber: string;
  groupSize: number;
}): Promise<{ blob: Blob; filename: string }> {
  const totalParts = Math.max(1, params.groupSize);
  const part = Math.min(partFromOrderNumber(params.orderNumber), totalParts);
  const qs = new URLSearchParams({
    part: String(part),
    totalParts: String(totalParts),
  });
  const res = await fetch(
    `/api/orders/${params.orderId}/actions/generate-packing-slip?${qs}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ part, totalParts }),
      signal: AbortSignal.timeout(170_000),
    }
  );
  const contentType = res.headers.get("content-type") ?? "";
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(json.error ?? "Failed to generate shipping slip");
  }
  const blob = await res.blob();
  if (!blob.size || contentType.includes("text/html")) {
    throw new Error("Shipping slip download was empty");
  }
  const safeOrder = params.orderNumber.replace(/[^a-zA-Z0-9._-]/g, "_");
  return {
    blob,
    filename: filenameFromDisposition(
      res.headers.get("content-disposition"),
      `shipping-slip-${safeOrder}-${part}of${totalParts}.pdf`
    ),
  };
}

export function ScanShippingSlipButtons({
  orderId,
  orderNumber,
  groupSize,
}: {
  orderId: string;
  orderNumber: string;
  groupSize: number;
}) {
  const [busy, setBusy] = useState<"download" | "print" | null>(null);
  const [error, setError] = useState("");

  async function run(kind: "download" | "print") {
    setError("");
    setBusy(kind);
    try {
      const { blob, filename } = await fetchOrderPackingSlip({
        orderId,
        orderNumber,
        groupSize,
      });
      if (kind === "download") triggerBlobDownload(blob, filename);
      else printPdfBlob(blob, filename);
    } catch (err) {
      const timedOut =
        err instanceof Error &&
        (err.name === "TimeoutError" || /timed out/i.test(err.message));
      setError(
        timedOut
          ? "Shipping slip took too long. Try again."
          : err instanceof Error
            ? err.message
            : "Failed"
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <p className="mb-2 text-[11px] md:text-[12px] font-semibold uppercase tracking-wide text-slate-400">
        Shipping slip
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => void run("print")}
          disabled={busy !== null}
          className={cn(
            "inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-[13px] md:text-[15px] font-medium",
            "border-slate-200 bg-white text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          )}
        >
          {busy === "print" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Printer className="h-4 w-4" />
          )}
          Print shipping slip
        </button>
        <button
          type="button"
          onClick={() => void run("download")}
          disabled={busy !== null}
          className={cn(
            "inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-[13px] md:text-[15px] font-medium",
            "border-slate-200 bg-white text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          )}
        >
          {busy === "download" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          Download shipping slip
        </button>
      </div>
      {error ? (
        <p className="mt-2 text-[12px] md:text-[14px] text-red-600">{error}</p>
      ) : null}
    </div>
  );
}
