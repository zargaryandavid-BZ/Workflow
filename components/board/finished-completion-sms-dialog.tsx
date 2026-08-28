"use client";

import { useEffect, useRef, useState } from "react";

export type FinishedSmsPromptOrder = {
  id: string;
  title: string;
};

export function FinishedCompletionSmsDialog({
  orders,
  onClose,
}: {
  orders: FinishedSmsPromptOrder[];
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<"send" | "skip" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ignoreRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    ignoreRef.current?.focus();
  }, []);

  async function postAction(action: "send" | "skip") {
    setBusy(action);
    setError(null);
    try {
      for (const order of orders) {
        const res = await fetch(`/api/orders/${order.id}/finished-sms`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          throw new Error(json.error ?? "Could not update completion SMS.");
        }
      }
      onClose();
    } catch (err) {
      setBusy(null);
      setError(err instanceof Error ? err.message : "Could not update completion SMS.");
    }
  }

  const many = orders.length > 1;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-labelledby="finished-sms-title"
        className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl"
      >
        <h2
          id="finished-sms-title"
          className="text-base font-semibold text-slate-800"
        >
          Do you want to send a completion SMS?
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          {many
            ? `Text the customer that ${orders.length} jobs are complete?`
            : `Text the customer that ${orders[0]?.title ?? "this order"} is complete?`}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Ignore (default) does not send a completion text.
        </p>
        {error ? (
          <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void postAction("send")}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {busy === "send" ? "Sending…" : "Yes"}
          </button>
          <button
            ref={ignoreRef}
            type="button"
            disabled={busy !== null}
            onClick={() => void postAction("skip")}
            className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-50"
          >
            {busy === "skip" ? "Saving…" : "Ignore, do not send"}
          </button>
        </div>
      </div>
    </div>
  );
}
