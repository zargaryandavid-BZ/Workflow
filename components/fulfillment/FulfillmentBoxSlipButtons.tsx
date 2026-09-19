"use client";

import { useState } from "react";
import { Download, Loader2, Printer } from "lucide-react";

function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const quoted = header.match(/filename="([^"]+)"/i);
  if (quoted?.[1]) return quoted[1];
  const plain = header.match(/filename=([^;]+)/i);
  return plain?.[1]?.trim() || fallback;
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

function printPdfBlob(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const w = window.open(url, "_blank");
  if (!w) {
    triggerBlobDownload(blob, "packing-slip.pdf");
    return;
  }
  const printWhenReady = () => {
    try {
      w.focus();
      w.print();
    } catch {
      /* browser may block print until the PDF viewer is ready */
    }
  };
  w.addEventListener("load", printWhenReady);
  window.setTimeout(printWhenReady, 800);
  window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
}

async function fetchBoxSlip(boxId: string): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(`/api/fulfillment/boxes/${boxId}/packing-slip`, {
    method: "POST",
  });
  const contentType = res.headers.get("content-type") ?? "";
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(json.error ?? "Failed to generate packing slip");
  }
  const blob = await res.blob();
  if (!blob.size || contentType.includes("text/html")) {
    throw new Error("Packing slip download was empty");
  }
  return {
    blob,
    filename: filenameFromDisposition(
      res.headers.get("content-disposition"),
      "packing-slip.pdf"
    ),
  };
}

export function FulfillmentBoxSlipButtons({
  boxId,
  hasOrders = true,
}: {
  boxId: string;
  hasOrders?: boolean;
}) {
  const [busy, setBusy] = useState<"download" | "print" | null>(null);
  const [error, setError] = useState("");

  const preview = boxId.startsWith("__");
  const canPrint = !preview && hasOrders;

  async function run(kind: "download" | "print") {
    if (preview || !hasOrders) {
      setError("This box has no orders to print");
      return;
    }
    setError("");
    setBusy(kind);
    try {
      const { blob, filename } = await fetchBoxSlip(boxId);
      if (kind === "download") triggerBlobDownload(blob, filename);
      else printPdfBlob(blob);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-2">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => void run("download")}
          disabled={busy !== null || !canPrint}
          className="inline-flex items-center justify-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {busy === "download" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
          Download slip
        </button>
        <button
          type="button"
          onClick={() => void run("print")}
          disabled={busy !== null || !canPrint}
          className="inline-flex items-center justify-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {busy === "print" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Printer className="h-3.5 w-3.5" />
          )}
          Print slip
        </button>
      </div>
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
