"use client";

import { useEffect, useRef, useState } from "react";
import { MessageSquare, X } from "lucide-react";

export type FinishedSmsPromptOrder = {
  id: string;
  title: string;
};

/**
 * Optional "text the customer it's done" offer after a card lands in a
 * Finished / no-review column. It used to be a blocking pop-up on every move
 * ("Yes" / "Ignore, do not send"). Not texting is the default, so this is now a
 * small corner note that doesn't stop the work: click "Text customer" to send,
 * or ignore it and it disappears by itself. Nothing is sent unless clicked.
 */
const AUTO_HIDE_MS = 15_000;

export function FinishedCompletionSmsDialog({
  orders,
  onClose,
}: {
  orders: FinishedSmsPromptOrder[];
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [hover, setHover] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const ordersKey = orders.map((o) => o.id).join(",");
  useEffect(() => {
    if (busy || hover || error) return;
    const t = window.setTimeout(() => onCloseRef.current(), AUTO_HIDE_MS);
    return () => window.clearTimeout(t);
  }, [busy, hover, error, ordersKey]);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      for (const order of orders) {
        const res = await fetch(`/api/orders/${order.id}/finished-sms`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "send" }),
        });
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          throw new Error(json.error ?? "Could not send the completion text.");
        }
      }
      onClose();
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "Could not send the completion text.");
    }
  }

  const many = orders.length > 1;

  return (
    <div
      role="status"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="fixed bottom-4 right-4 z-[60] w-80 rounded-lg border border-slate-200 bg-white p-3 shadow-lg"
    >
      <div className="flex items-start gap-2">
        <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-slate-700">
            Customer not texted that{" "}
            {many ? `${orders.length} jobs are` : `${orders[0]?.title ?? "this job"} is`}{" "}
            finished.
          </p>
          {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => void send()}
            className="mt-2 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {busy ? "Sending…" : "Text customer"}
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
